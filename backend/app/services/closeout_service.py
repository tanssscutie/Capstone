"""Transaction close-out: both parties confirm how an awarded deal ended.

Either the buyer or the awarded supplier proposes an outcome — "completed",
or "did not push through" (with a reason). It only becomes final once the
OTHER party confirms; nobody can close a transaction on their own, and an
unanswered claim never auto-confirms. The other party can instead say "not
yet" (with a reason), and the proposer can withdraw — either way a new claim
can be made later. Every step goes on the ledger and into the award thread as
a TrustLink message.

Not post-award tracking (outside the study's scope): no delivery dates,
payments or receipts — only the two parties' agreement on the outcome. The
confirmed outcomes feed the trust profile's "Completed transactions" and
"Did not push through" counts.
"""
import logging
from typing import List, Optional, Tuple

from fastapi import HTTPException, status
from sqlmodel import Session, select

from app.core.clock import now_ph
from app.core.database import engine
from app.models.order_update import OrderUpdate
from app.models.quotation import Quotation
from app.models.requirement import Requirement
from app.models.transaction_closeout import TransactionCloseout
from app.models.user import User
from app.repositories import message_repository as msg_repo
from app.repositories import notification_repository as notif_repo
from app.repositories import requirement_repository as repo
from app.schemas.requirement import CloseoutOut, CloseoutProposalOut
from app.services.requirement_service import NotOwner, RequirementNotFound, _log, requirement_service

logger = logging.getLogger("trustlink.closeout")

OUTCOME_LABELS = {"completed": "completed", "not_pushed_through": "did not push through"}
FINAL_STATES = ("completed", "not_pushed_through")


def _conflict(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


def _out(row: TransactionCloseout) -> CloseoutProposalOut:
    return CloseoutProposalOut(
        id=row.id,
        outcome=row.outcome,
        proposed_by_role=row.proposed_by_role,
        note=row.note,
        status=row.status,
        response_note=row.response_note,
        created_at=row.created_at,
        responded_at=row.responded_at,
    )


def _clean(note: Optional[str]) -> Optional[str]:
    return note.strip() if note and note.strip() else None


class CloseoutService:
    def _load(self, session: Session, requirement_id: int) -> Tuple[Requirement, Quotation]:
        req = repo.get_requirement(session, requirement_id)
        if not req:
            raise RequirementNotFound()
        quotation = repo.get_quotation(session, req.awarded_quotation_id) if req.awarded_quotation_id else None
        if req.status != "awarded" or not quotation:
            raise _conflict("Only an awarded requirement has a transaction to close out")
        return req, quotation

    @staticmethod
    def _role(req: Requirement, quotation: Quotation, user_id: int) -> Optional[str]:
        if user_id == req.owner_id:
            return "buyer"
        if user_id == quotation.business_id:
            return "supplier"
        return None

    @staticmethod
    def _rows(session: Session, requirement_id: int) -> List[TransactionCloseout]:
        return list(session.exec(
            select(TransactionCloseout)
            .where(TransactionCloseout.requirement_id == requirement_id)
            .order_by(TransactionCloseout.created_at.asc(), TransactionCloseout.id.asc())
        ).all())

    def _view(self, session: Session, req: Requirement, quotation: Quotation, viewer_role: str) -> CloseoutOut:
        rows = self._rows(session, req.id)
        final = next((r for r in rows if r.status == "confirmed"), None)
        pending = next((r for r in rows if r.status == "pending"), None)
        state = final.outcome if final else "pending" if pending else "open"
        return CloseoutOut(
            requirement_id=req.id,
            state=state,
            viewer_role=viewer_role,
            pending=_out(pending) if pending else None,
            awaiting_viewer=bool(pending and viewer_role in ("buyer", "supplier") and pending.proposed_by_role != viewer_role),
            final=_out(final) if final else None,
            history=[_out(r) for r in rows if r.status in ("rejected", "withdrawn")],
        )

    def _party_or_raise(self, req: Requirement, quotation: Quotation, user_id: int) -> str:
        role = self._role(req, quotation, user_id)
        if not role:
            raise NotOwner()
        return role

    def _announce(self, session: Session, req: Requirement, quotation: Quotation, actor_id: int, body: str,
                  notify_user_id: int, title: str) -> None:
        """TrustLink message in the award thread (sent as the actor, so it reads
        as unread for the other party) plus an alert. Never fails the action —
        the close-out itself is already committed."""
        try:
            thread = msg_repo.get_thread_for_business(session, req.id, quotation.business_id)
            if not thread:
                requirement_service._open_award_thread(session, req, quotation)
                thread = msg_repo.get_thread_for_business(session, req.id, quotation.business_id)
            if thread:
                msg_repo.create_message(session, thread.id, actor_id, body, is_system=True)
        except Exception:
            session.rollback()
            logger.exception("Could not post the close-out message for requirement %s", req.id)
        notif_repo.create_if_allowed(
            session,
            user_id=notify_user_id,
            type_="DECISION",
            category="activity",
            title=title,
            detail=f"{req.ref_code} · {req.title}",
            urgent=True,
            related_requirement_id=req.id,
        )

    def get(self, requirement_id: int, viewer_id: int) -> CloseoutOut:
        with Session(engine) as session:
            req, quotation = self._load(session, requirement_id)
            role = self._role(req, quotation, viewer_id)
            if not role:
                viewer = session.get(User, viewer_id)
                if not (viewer and viewer.is_admin):
                    raise NotOwner()
                role = "admin"
            return self._view(session, req, quotation, role)

    def propose(self, requirement_id: int, actor_id: int, outcome: str, note: Optional[str]) -> CloseoutOut:
        with Session(engine) as session:
            req, quotation = self._load(session, requirement_id)
            role = self._party_or_raise(req, quotation, actor_id)
            rows = self._rows(session, req.id)
            if any(r.status == "confirmed" for r in rows):
                raise _conflict("This transaction is already closed out")
            if any(r.status == "pending" for r in rows):
                raise _conflict("There's already a close-out waiting for a response")
            if outcome not in OUTCOME_LABELS:
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unknown outcome")
            note = _clean(note)
            if outcome == "not_pushed_through" and (not note or len(note) < 5):
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                                    detail="Say briefly why the transaction did not push through")

            row = TransactionCloseout(requirement_id=req.id, outcome=outcome, proposed_by=actor_id,
                                      proposed_by_role=role, note=note)
            session.add(row)
            session.commit()
            session.refresh(row)

            _log(session, "CLOSEOUT_PROPOSED", req.id, quotation.id, actor_id, {
                "requirement_id": req.id, "closeout_id": row.id, "outcome": outcome, "proposed_by_role": role,
            })

            other_role = "supplier" if role == "buyer" else "buyer"
            body = (
                f"The {role} marked this transaction as {OUTCOME_LABELS[outcome]}."
                + (f"\nNote: {note}" if note else "")
                + f"\n\nWaiting for the {other_role} to confirm here in this conversation. "
                "It only becomes final once both parties agree."
            )
            other_id = quotation.business_id if role == "buyer" else req.owner_id
            self._announce(session, req, quotation, actor_id, body, other_id,
                           f"Please confirm: transaction {OUTCOME_LABELS[outcome]}")
            return self._view(session, req, quotation, role)

    def respond(self, requirement_id: int, actor_id: int, confirm: bool, note: Optional[str]) -> CloseoutOut:
        with Session(engine) as session:
            req, quotation = self._load(session, requirement_id)
            role = self._party_or_raise(req, quotation, actor_id)
            pending = next((r for r in self._rows(session, req.id) if r.status == "pending"), None)
            if not pending:
                raise _conflict("There's no close-out waiting for a response")
            if pending.proposed_by_role == role:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                                    detail="The other party has to confirm your close-out")
            note = _clean(note)
            if not confirm and (not note or len(note) < 5):
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                                    detail="Say briefly why it isn't done yet")

            pending.status = "confirmed" if confirm else "rejected"
            pending.responded_by = actor_id
            pending.response_note = note
            pending.responded_at = now_ph()
            session.add(pending)
            if confirm:
                # The order timeline ends here too (fulfillment_service).
                req.fulfillment_status = pending.outcome
                req.fulfillment_updated_at = now_ph()
                session.add(req)
                session.add(OrderUpdate(requirement_id=req.id, status=pending.outcome, actor_id=actor_id,
                                        actor_role=role, note=pending.note))
            session.commit()
            session.refresh(pending)

            _log(session, "CLOSEOUT_CONFIRMED" if confirm else "CLOSEOUT_REJECTED", req.id, quotation.id, actor_id, {
                "requirement_id": req.id, "closeout_id": pending.id, "outcome": pending.outcome,
            })

            label = OUTCOME_LABELS[pending.outcome]
            if confirm:
                body = (f"Both parties confirmed: this transaction {label}." if pending.outcome == "not_pushed_through"
                        else "Both parties confirmed: this transaction is completed. Thank you for using TrustLink.")
                title = f"Transaction {label} — confirmed by both parties"
            else:
                body = (f"The {role} said the transaction is not {label} yet."
                        f"\nReason: {note}\n\nEither party can mark it again once it's settled.")
                title = f"Close-out not confirmed by the {role}"
            self._announce(session, req, quotation, actor_id, body, pending.proposed_by, title)
            return self._view(session, req, quotation, role)

    def withdraw(self, requirement_id: int, actor_id: int) -> CloseoutOut:
        with Session(engine) as session:
            req, quotation = self._load(session, requirement_id)
            role = self._party_or_raise(req, quotation, actor_id)
            pending = next((r for r in self._rows(session, req.id) if r.status == "pending"), None)
            if not pending or pending.proposed_by != actor_id:
                raise _conflict("You have no pending close-out to withdraw")

            pending.status = "withdrawn"
            pending.responded_at = now_ph()
            session.add(pending)
            session.commit()

            _log(session, "CLOSEOUT_WITHDRAWN", req.id, quotation.id, actor_id, {
                "requirement_id": req.id, "closeout_id": pending.id,
            })
            other_id = quotation.business_id if role == "buyer" else req.owner_id
            self._announce(session, req, quotation, actor_id,
                           f"The {role} withdrew their close-out. The transaction stays open.",
                           other_id, "Close-out withdrawn")
            return self._view(session, req, quotation, role)


closeout_service = CloseoutService()
