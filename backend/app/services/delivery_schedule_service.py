"""Delivery date of an awarded order, agreed after the award.

The buyer proposes a date. The awarded supplier confirms it, or declines with
a reason and, optionally, a date they can make instead — which the buyer can
propose back in one tap. Only one proposal waits at a time; the buyer can
withdraw it. A confirmed date can be changed later by proposing a new one.
Every step goes on the ledger and into the award thread as a TrustLink
message, with an alert to the other party.

The agreed date replaces the posted delivery window when the order status
check decides an order has gone quiet (fulfillment_service._run_one).
"""
from datetime import date
from typing import List, Optional, Tuple

from fastapi import HTTPException, status
from sqlmodel import Session, select

from app.core.clock import now_ph
from app.core.database import engine
from app.models.delivery_schedule import DeliverySchedule
from app.models.order_update import OrderUpdate
from app.models.quotation import Quotation
from app.models.requirement import Requirement
from app.models.user import User
from app.repositories import requirement_repository as repo
from app.schemas.requirement import DeliveryOut, DeliveryProposalOut
from app.services.closeout_service import closeout_service
from app.services.requirement_service import NotOwner, RequirementNotFound, _log

ORDER_CLOSED = ("completed", "not_pushed_through", "unconfirmed")


def _conflict(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


def _unprocessable(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=detail)


def _clean(text: Optional[str]) -> Optional[str]:
    return text.strip() if text and text.strip() else None


def _day(d: date) -> str:
    return f"{d.strftime('%b')} {d.day}, {d.year}"


def _out(row: DeliverySchedule) -> DeliveryProposalOut:
    return DeliveryProposalOut(
        id=row.id,
        delivery_date=row.delivery_date,
        note=row.note,
        status=row.status,
        decline_reason=row.decline_reason,
        suggested_date=row.suggested_date,
        created_at=row.created_at,
        responded_at=row.responded_at,
    )


def rows_for(session: Session, requirement_id: int) -> List[DeliverySchedule]:
    return list(session.exec(
        select(DeliverySchedule)
        .where(DeliverySchedule.requirement_id == requirement_id)
        .order_by(DeliverySchedule.created_at.asc(), DeliverySchedule.id.asc())
    ).all())


def agreed_date(session: Session, requirement_id: int) -> Optional[date]:
    """The latest confirmed delivery date, or None if none was agreed."""
    confirmed = [r for r in rows_for(session, requirement_id) if r.status == "confirmed"]
    return confirmed[-1].delivery_date if confirmed else None


class DeliveryScheduleService:
    def _load(self, session: Session, requirement_id: int) -> Tuple[Requirement, Quotation]:
        req = repo.get_requirement(session, requirement_id)
        if not req:
            raise RequirementNotFound()
        quotation = repo.get_quotation(session, req.awarded_quotation_id) if req.awarded_quotation_id else None
        if req.status != "awarded" or not quotation:
            raise _conflict("Only an awarded requirement has a delivery date to agree")
        return req, quotation

    @staticmethod
    def _role(req: Requirement, quotation: Quotation, user_id: int) -> Optional[str]:
        if user_id == req.owner_id:
            return "buyer"
        if user_id == quotation.business_id:
            return "supplier"
        return None

    def _open_order_or_raise(self, session: Session, req: Requirement) -> None:
        from app.services.fulfillment_service import effective_status
        if effective_status(session, req) in ORDER_CLOSED:
            raise _conflict("This order is already closed")

    def view(self, session: Session, req: Requirement, role: str) -> DeliveryOut:
        rows = rows_for(session, req.id)
        pending = next((r for r in rows if r.status == "pending"), None)
        confirmed = [r for r in rows if r.status == "confirmed"]
        latest = rows[-1] if rows else None
        return DeliveryOut(
            requirement_id=req.id,
            viewer_role=role,
            agreed_date=confirmed[-1].delivery_date if confirmed else None,
            pending=_out(pending) if pending else None,
            awaiting_viewer=bool(pending and role == "supplier"),
            last_declined=_out(latest) if latest and latest.status == "declined" else None,
            history=[_out(r) for r in rows if r.status != "pending"],
        )

    def propose(self, requirement_id: int, actor_id: int, delivery_date: date, note: Optional[str]) -> DeliveryOut:
        with Session(engine) as session:
            req, quotation = self._load(session, requirement_id)
            role = self._role(req, quotation, actor_id)
            if role != "buyer":
                if role == "supplier":
                    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                                        detail="The buyer sets the delivery date — you can confirm or decline it")
                raise NotOwner()
            self._open_order_or_raise(session, req)
            if any(r.status == "pending" for r in rows_for(session, req.id)):
                raise _conflict("A delivery date is already waiting for the supplier")
            if delivery_date < now_ph().date():
                raise _unprocessable("Pick a delivery date that hasn't passed")

            note = _clean(note)
            row = DeliverySchedule(requirement_id=req.id, delivery_date=delivery_date, proposed_by=actor_id, note=note)
            session.add(row)
            session.commit()
            session.refresh(row)
            _log(session, "DELIVERY_DATE_PROPOSED", req.id, quotation.id, actor_id, {
                "requirement_id": req.id, "delivery_id": row.id, "delivery_date": delivery_date.isoformat(),
            })
            body = (f"The buyer set the delivery date: {_day(delivery_date)}."
                    + (f"\nNote: {note}" if note else "")
                    + "\n\nSupplier: confirm it, or decline with a reason (you can suggest another date).")
            closeout_service._announce(session, req, quotation, actor_id, body, quotation.business_id,
                                       f"Please confirm the delivery date: {_day(delivery_date)}")
            return self.view(session, req, role)

    def respond(self, requirement_id: int, actor_id: int, confirm: bool, reason: Optional[str],
                suggested_date: Optional[date]) -> DeliveryOut:
        with Session(engine) as session:
            req, quotation = self._load(session, requirement_id)
            role = self._role(req, quotation, actor_id)
            if role != "supplier":
                if role == "buyer":
                    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                                        detail="The supplier confirms or declines the delivery date")
                raise NotOwner()
            pending = next((r for r in rows_for(session, req.id) if r.status == "pending"), None)
            if not pending:
                raise _conflict("There's no delivery date waiting for you")
            reason = _clean(reason)
            if not confirm:
                if not reason or len(reason) < 5:
                    raise _unprocessable("Say briefly why you can't deliver on that date")
                if suggested_date and suggested_date < now_ph().date():
                    raise _unprocessable("Suggest a date that hasn't passed")

            pending.status = "confirmed" if confirm else "declined"
            pending.responded_by = actor_id
            pending.responded_at = now_ph()
            if not confirm:
                pending.decline_reason = reason
                pending.suggested_date = suggested_date
            session.add(pending)
            if confirm:
                session.add(OrderUpdate(requirement_id=req.id, status="delivery_scheduled", actor_id=actor_id,
                                        actor_role="supplier", note=f"Delivery on {_day(pending.delivery_date)}"))
            session.commit()
            session.refresh(pending)

            payload = {"requirement_id": req.id, "delivery_id": pending.id,
                       "delivery_date": pending.delivery_date.isoformat()}
            if not confirm and suggested_date:
                payload["suggested_date"] = suggested_date.isoformat()
            _log(session, "DELIVERY_DATE_CONFIRMED" if confirm else "DELIVERY_DATE_DECLINED",
                 req.id, quotation.id, actor_id, payload)

            when = _day(pending.delivery_date)
            if confirm:
                body = f"The supplier confirmed the delivery date: {when}."
                title = f"Delivery date confirmed: {when}"
            else:
                body = (f"The supplier can't deliver on {when}.\nReason: {reason}"
                        + (f"\nSuggested date: {_day(suggested_date)}" if suggested_date else "")
                        + "\n\nBuyer: set another date"
                        + (" — or use the suggested one." if suggested_date else "."))
                title = f"Delivery date declined: {when}"
            closeout_service._announce(session, req, quotation, actor_id, body, req.owner_id, title)
            return self.view(session, req, role)

    def withdraw(self, requirement_id: int, actor_id: int) -> DeliveryOut:
        with Session(engine) as session:
            req, quotation = self._load(session, requirement_id)
            role = self._role(req, quotation, actor_id)
            if not role:
                raise NotOwner()
            pending = next((r for r in rows_for(session, req.id) if r.status == "pending"), None)
            if not pending or pending.proposed_by != actor_id:
                raise _conflict("You have no pending delivery date to withdraw")

            pending.status = "withdrawn"
            pending.responded_at = now_ph()
            session.add(pending)
            session.commit()
            _log(session, "DELIVERY_DATE_WITHDRAWN", req.id, quotation.id, actor_id, {
                "requirement_id": req.id, "delivery_id": pending.id,
            })
            closeout_service._announce(session, req, quotation, actor_id,
                                       f"The buyer withdrew the delivery date ({_day(pending.delivery_date)}).",
                                       quotation.business_id, "Delivery date withdrawn")
            return self.view(session, req, role)


delivery_schedule_service = DeliveryScheduleService()
