"""Order status of an awarded requirement: Awarded → Completed.

The awarded supplier marks the order as completed (stored as "delivered", so
older rows need no migration). The buyer then confirms it, which records a
confirmed "completed" TransactionCloseout — the same record the trust profile
already counts. TrustLink does not track production or delivery; rows from
the old In production / Out for delivery steps read as Awarded.
"Did not push through" stays with closeout_service (propose, then the other
party confirms).

When nobody updates (run_due, from the scheduler):
- a reminder at 3 and at 7 days without a step, to whoever acts next;
- marked completed and the buyer silent for 14 days → auto-confirmed
  (the buyer can still say it did not push through, or report, until then);
- no step for 14 days and 14 days past the delivery date (the one agreed
  after the award, else the posted delivery window) → "unconfirmed":
  counted as neither completed nor failed.

Every step goes on the ledger, into the award chat as a TrustLink notice,
and out as an alert.
"""
import logging
from datetime import datetime, time, timedelta
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
from app.repositories import notification_repository as notif_repo
from app.repositories import requirement_repository as repo
from app.schemas.requirement import FulfillmentOut, OrderUpdateOut
from app.services.closeout_service import closeout_service
from app.services import delivery_schedule_service as delivery
from app.services.requirement_service import RequirementNotFound, _log

logger = logging.getLogger("trustlink.fulfillment")

# The supplier's steps, in order. "delivered" = marked completed by the supplier,
# waiting for the buyer to confirm.
STEPS = ("awarded", "delivered")
# Steps that no longer exist; such orders read as "awarded".
LEGACY_STEPS = ("in_production", "out_for_delivery")
LABELS = {
    "awarded": "Awarded",
    "in_production": "In production",
    "out_for_delivery": "Out for delivery",
    "delivered": "Marked completed",
    "completed": "Completed",
    "not_pushed_through": "Did not push through",
    "unconfirmed": "Unconfirmed",
}
FINAL = ("completed", "not_pushed_through", "unconfirmed")
REMINDER_DAYS = (3, 7)
AUTO_CONFIRM_DAYS = 14
UNCONFIRMED_DAYS = 14


def _conflict(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


def _forbidden(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


def _clean(note: Optional[str]) -> Optional[str]:
    return note.strip() if note and note.strip() else None


def _closeouts(session: Session, requirement_id: int) -> List[TransactionCloseout]:
    return list(session.exec(
        select(TransactionCloseout).where(TransactionCloseout.requirement_id == requirement_id)
    ).all())


def effective_status(session: Session, req: Requirement) -> str:
    """A confirmed close-out (incl. one confirmed before order status existed)
    wins over the stored step."""
    final = next((r for r in _closeouts(session, req.id) if r.status == "confirmed"), None)
    if final:
        return final.outcome
    stored = req.fulfillment_status or "awarded"
    return "awarded" if stored in LEGACY_STEPS else stored


def _last_step_at(req: Requirement) -> datetime:
    return req.fulfillment_updated_at or req.released_at or req.created_at


def next_action(status_: str, pending_closeout: bool) -> Tuple[Optional[str], Optional[str]]:
    """(action, who) — what moves this order forward, and whose turn it is."""
    if status_ in FINAL or pending_closeout:
        return None, None
    if status_ == "delivered":
        return "buyer_confirm", "buyer"
    return "seller_update", "supplier"


class FulfillmentService:
    def _load(self, session: Session, requirement_id: int) -> Tuple[Requirement, Quotation]:
        req = repo.get_requirement(session, requirement_id)
        if not req:
            raise RequirementNotFound()
        quotation = repo.get_quotation(session, req.awarded_quotation_id) if req.awarded_quotation_id else None
        if req.status != "awarded" or not quotation:
            raise _conflict("Only an awarded requirement has an order to track")
        return req, quotation

    @staticmethod
    def _role(req: Requirement, quotation: Quotation, user_id: int) -> Optional[str]:
        if user_id == req.owner_id:
            return "buyer"
        if user_id == quotation.business_id:
            return "supplier"
        return None

    def _view(self, session: Session, req: Requirement, quotation: Quotation, role: str) -> FulfillmentOut:
        status_ = effective_status(session, req)
        rows = _closeouts(session, req.id)
        pending = any(r.status == "pending" for r in rows)
        action, by = next_action(status_, pending)
        timeline = session.exec(
            select(OrderUpdate).where(OrderUpdate.requirement_id == req.id)
            .order_by(OrderUpdate.created_at.asc(), OrderUpdate.id.asc())
        ).all()
        return FulfillmentOut(
            requirement_id=req.id,
            status=status_,
            viewer_role=role,
            next_action=action,
            next_action_by=by,
            next_status="delivered" if action == "seller_update" else None,
            auto_confirm_at=(_last_step_at(req) + timedelta(days=AUTO_CONFIRM_DAYS)) if status_ == "delivered" else None,
            auto_confirmed=any(u.status == "completed" and u.actor_role == "system" for u in timeline),
            timeline=[OrderUpdateOut(status=u.status, actor_role=u.actor_role, note=u.note, created_at=u.created_at)
                      for u in timeline],
            closeout=closeout_service._view(session, req, quotation, role),
            delivery=delivery.delivery_schedule_service.view(session, req, role),
        )

    def _step(self, session: Session, req: Requirement, quotation: Quotation, new_status: str,
              actor_id: Optional[int], actor_role: str, note: Optional[str]) -> None:
        req.fulfillment_status = new_status
        req.fulfillment_updated_at = now_ph()
        req.fulfillment_reminders = 0
        session.add(req)
        session.add(OrderUpdate(requirement_id=req.id, status=new_status, actor_id=actor_id,
                                actor_role=actor_role, note=note))
        session.commit()
        session.refresh(req)

    def _notice(self, session: Session, req: Requirement, quotation: Quotation, actor_id: int, body: str,
                notify_user_ids: List[int], title: str) -> None:
        """TrustLink notice in the award chat plus alerts — never fails the step."""
        closeout_service._announce(session, req, quotation, actor_id, body, notify_user_ids[0], title)
        for uid in notify_user_ids[1:]:
            notif_repo.create_if_allowed(session, user_id=uid, type_="DECISION", category="activity", title=title,
                                         detail=f"{req.ref_code} · {req.title}", urgent=True,
                                         related_requirement_id=req.id)

    def get(self, requirement_id: int, viewer_id: int) -> FulfillmentOut:
        with Session(engine) as session:
            req, quotation = self._load(session, requirement_id)
            role = self._role(req, quotation, viewer_id)
            if not role:
                viewer = session.get(User, viewer_id)
                if not (viewer and viewer.is_admin):
                    raise _forbidden("Only the buyer and the awarded supplier can see this order")
                role = "admin"
            return self._view(session, req, quotation, role)

    def update(self, requirement_id: int, actor_id: int, new_status: str, note: Optional[str]) -> FulfillmentOut:
        with Session(engine) as session:
            req, quotation = self._load(session, requirement_id)
            if self._role(req, quotation, actor_id) != "supplier":
                raise _forbidden("Only the awarded supplier marks the order as completed")
            current = effective_status(session, req)
            if current in FINAL:
                raise _conflict("This order is already closed")
            if any(r.status == "pending" for r in _closeouts(session, req.id)):
                raise _conflict("A \"did not push through\" is waiting for a response")
            if new_status not in STEPS[1:]:
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unknown status")
            if STEPS.index(new_status) <= STEPS.index(current):
                raise _conflict("The order status only moves forward")

            note = _clean(note)
            self._step(session, req, quotation, new_status, actor_id, "supplier", note)
            _log(session, "FULFILLMENT_UPDATED", req.id, quotation.id, actor_id, {
                "requirement_id": req.id, "status": new_status,
            })
            body = ("The supplier marked this order as completed." + (f"\nNote: {note}" if note else "")
                    + "\n\nBuyer: please confirm it in My Requirements. "
                    f"It confirms automatically after {AUTO_CONFIRM_DAYS} days.")
            self._notice(session, req, quotation, actor_id, body, [req.owner_id],
                         "Order marked as completed — please confirm")
            return self._view(session, req, quotation, "supplier")

    def confirm_received(self, requirement_id: int, actor_id: int, note: Optional[str]) -> FulfillmentOut:
        with Session(engine) as session:
            req, quotation = self._load(session, requirement_id)
            if self._role(req, quotation, actor_id) != "buyer":
                raise _forbidden("Only the buyer confirms the order is completed")
            if effective_status(session, req) != "delivered":
                raise _conflict("You can confirm once the supplier marks the order as completed")
            if any(r.status == "pending" for r in _closeouts(session, req.id)):
                raise _conflict("A \"did not push through\" is waiting for a response")
            note = _clean(note)
            self._complete(session, req, quotation, actor_id, "buyer", note)
            _log(session, "ORDER_RECEIVED", req.id, quotation.id, actor_id, {"requirement_id": req.id})
            self._notice(session, req, quotation, actor_id,
                         "The buyer confirmed the order. This transaction is completed. Thank you for using TrustLink.",
                         [quotation.business_id], "Order completed — the buyer confirmed")
            return self._view(session, req, quotation, "buyer")

    def _complete(self, session: Session, req: Requirement, quotation: Quotation, actor_id: Optional[int],
                  actor_role: str, note: Optional[str]) -> None:
        """Marked completed + confirmed = both parties agree, so a confirmed close-out."""
        now = now_ph()
        session.add(TransactionCloseout(
            requirement_id=req.id, outcome="completed", proposed_by=quotation.business_id,
            proposed_by_role="supplier", note="Marked as completed", status="confirmed",
            responded_by=req.owner_id if actor_role == "buyer" else None,
            response_note=note if actor_role == "buyer" else "Auto-confirmed: no response from the buyer",
            responded_at=now,
        ))
        session.commit()
        self._step(session, req, quotation, "completed", actor_id, actor_role, note)

    # ---------- scheduler ----------

    def run_due(self, now: Optional[datetime] = None) -> dict:
        """Reminders, auto-confirm and Unconfirmed for every open order."""
        now = now or now_ph()
        done = {"reminded": 0, "auto_confirmed": 0, "unconfirmed": 0}
        with Session(engine) as session:
            reqs = session.exec(select(Requirement).where(
                Requirement.status == "awarded", Requirement.fulfillment_status.in_(STEPS + LEGACY_STEPS),
            )).all()
            for req in reqs:
                try:
                    self._run_one(session, req, now, done)
                except Exception:
                    session.rollback()
                    logger.exception("Order status check failed for requirement %s", req.id)
        return done

    def _run_one(self, session: Session, req: Requirement, now: datetime, done: dict) -> None:
        quotation = repo.get_quotation(session, req.awarded_quotation_id) if req.awarded_quotation_id else None
        if not quotation:
            return
        rows = _closeouts(session, req.id)
        if any(r.status in ("confirmed", "pending") for r in rows):
            return  # closed out already, or a "did not push through" is being answered
        last = _last_step_at(req)
        idle = now - last
        delivered = req.fulfillment_status == "delivered"

        if delivered and idle >= timedelta(days=AUTO_CONFIRM_DAYS):
            self._complete(session, req, quotation, None, "system", None)
            _log(session, "ORDER_AUTO_CONFIRMED", req.id, quotation.id, None, {"requirement_id": req.id})
            self._notice(session, req, quotation, quotation.business_id,
                         f"No response from the buyer {AUTO_CONFIRM_DAYS} days after the supplier marked it completed, so TrustLink "
                         "auto-confirmed this order as completed.",
                         [req.owner_id, quotation.business_id], "Order auto-confirmed as completed")
            done["auto_confirmed"] += 1
            return

        agreed = delivery.agreed_date(session, req.id)
        due = datetime.combine(agreed, time(23, 59)) if agreed else req.delivery_end
        window_end = max(due or last, last)
        if not delivered and idle >= timedelta(days=UNCONFIRMED_DAYS) and now >= window_end + timedelta(days=UNCONFIRMED_DAYS):
            self._step(session, req, quotation, "unconfirmed", None, "system", None)
            _log(session, "ORDER_UNCONFIRMED", req.id, quotation.id, None, {"requirement_id": req.id})
            self._notice(session, req, quotation, quotation.business_id,
                         "No order updates, so TrustLink marked this order as Unconfirmed. "
                         "It counts as neither completed nor failed on either profile.",
                         [req.owner_id, quotation.business_id], "Order marked as Unconfirmed")
            done["unconfirmed"] += 1
            return

        level = next((i + 1 for i, d in reversed(list(enumerate(REMINDER_DAYS))) if idle >= timedelta(days=d)), 0)
        if level > (req.fulfillment_reminders or 0):
            days = REMINDER_DAYS[level - 1]
            if delivered:
                to, title = req.owner_id, f"Please confirm: marked completed {days} days ago"
                detail = (f"{req.ref_code} · {req.title} — confirm it in My Requirements. "
                          f"It auto-confirms {AUTO_CONFIRM_DAYS} days after the supplier marked it completed.")
            else:
                to, title = quotation.business_id, f"No order update for {days} days"
                detail = f"{req.ref_code} · {req.title} — mark it as completed in My Quotations once it's done."
            notif_repo.create_if_allowed(session, user_id=to, type_="DECISION", category="activity",
                                         title=title, detail=detail, related_requirement_id=req.id)
            req.fulfillment_reminders = level
            session.add(req)
            session.commit()
            done["reminded"] += 1


fulfillment_service = FulfillmentService()
