"""Business reports: any verified business can report another for an
administrator to review — fake or impersonated businesses, scams, an award
that wasn't honored, abusive behavior. Complements document verification
(Panel Suggestion #7's trust signals) with a way to flag what documents
can't show.

Guards against the reporting tool itself being abused:
- only verified, active accounts can report, and never themselves or an admin;
- one open report per reporter against the same business;
- at most MAX_REPORTS_PER_DAY reports per reporter in a rolling 24 hours.

Confidential: nothing here is ever shown to, or sent to, the reported business.
"""
from datetime import timedelta
from typing import List, Optional

from fastapi import HTTPException, status
from sqlmodel import Session, func, select

from app.core.clock import now_ph
from app.core.database import engine
from app.models.business_report import BusinessReport
from app.models.requirement import Requirement
from app.models.user import User
from app.repositories import notification_repository as notif_repo
from app.models.quotation import Quotation
from app.schemas.business import (
    AdminReportOut, BusinessSearchOut, MyReportOut, ReportCreate, ReportReview, ReportSuggestionOut,
    WithdrawalStrikeOut,
)
from app.services import moderation_service as moderation_module
from app.services import withdrawal_policy
from app.services.moderation_service import moderation_service

REASONS = {
    "FAKE_BUSINESS": "Fake or impersonated business",
    "FRAUD": "Scam or fraud",
    "NOT_HONORED": "Didn't honor an award or agreement",
    "MISLEADING": "Misleading profile or documents",
    "SPAM": "Spam or fake requirements/quotations",
    "MANIPULATION": "Bid manipulation or collusion",
    "ABUSIVE": "Abusive or harassing behavior",
    "OTHER": "Something else",
    # Filed by the system only (withdrawal_policy), never from the report form.
    "WITHDRAWALS": "Withdrawal policy",
}
MAX_REPORTS_PER_DAY = 5


def _name(user: Optional[User]) -> str:
    if not user:
        return "—"
    return user.display_name or user.registered_name or user.business_name


class ReportService:
    def create(self, reporter_id: int, reported_id: int, data: ReportCreate) -> None:
        with Session(engine) as session:
            reporter = session.get(User, reporter_id)
            reported = session.get(User, reported_id)
            if not reported or reported.is_admin or not reported.is_active:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Business not found")
            if reported_id == reporter_id:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You can't report your own business")
            if not reporter or not reporter.is_active:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Active account required")

            already_open = session.exec(
                select(BusinessReport).where(
                    BusinessReport.reporter_id == reporter_id,
                    BusinessReport.reported_id == reported_id,
                    BusinessReport.status == "open",
                )
            ).first()
            if already_open:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                    detail="You already reported this business — our team is reviewing it")

            since = now_ph() - timedelta(hours=24)
            recent = session.exec(
                select(func.count()).select_from(BusinessReport).where(
                    BusinessReport.reporter_id == reporter_id, BusinessReport.created_at >= since,
                )
            ).one()
            if recent >= MAX_REPORTS_PER_DAY:
                raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                                    detail=f"You can send up to {MAX_REPORTS_PER_DAY} reports a day. Try again tomorrow.")

            if data.related_requirement_id and not session.get(Requirement, data.related_requirement_id):
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Requirement not found")

            session.add(BusinessReport(
                reporter_id=reporter_id,
                reported_id=reported_id,
                reason=data.reason,
                details=data.details.strip(),
                related_requirement_id=data.related_requirement_id,
            ))
            session.commit()

    def list_for_admin(self) -> List[AdminReportOut]:
        with Session(engine) as session:
            reports = session.exec(select(BusinessReport).order_by(BusinessReport.created_at.desc())).all()
            open_counts = dict(session.exec(
                select(BusinessReport.reported_id, func.count())
                .where(BusinessReport.status == "open")
                .group_by(BusinessReport.reported_id)
            ).all())
            users = {u.id: u for u in session.exec(select(User).where(
                User.id.in_({r.reporter_id for r in reports} | {r.reported_id for r in reports})
            )).all()} if reports else {}
            req_refs = {r.id: r.ref_code for r in session.exec(select(Requirement).where(
                Requirement.id.in_({r.related_requirement_id for r in reports if r.related_requirement_id})
            )).all()} if any(r.related_requirement_id for r in reports) else {}
            out = []
            for r in reports:
                reported = users.get(r.reported_id)
                out.append(AdminReportOut(
                    id=r.id,
                    reason=r.reason,
                    reason_label=REASONS.get(r.reason, r.reason),
                    details=r.details,
                    status=r.status,
                    admin_notes=r.admin_notes,
                    created_at=r.created_at,
                    reviewed_at=r.reviewed_at,
                    reporter_id=r.reporter_id,
                    reporter_name=_name(users.get(r.reporter_id)),
                    reported_id=r.reported_id,
                    reported_name=_name(reported),
                    reported_role=reported.role if reported else None,
                    reported_verification_status=reported.verification_status if reported else None,
                    reported_open_reports=open_counts.get(r.reported_id, 0),
                    related_requirement_id=r.related_requirement_id,
                    related_requirement_ref=req_refs.get(r.related_requirement_id),
                    reported_suspended_until=reported.suspended_until if reported else None,
                    reported_banned=bool(reported and reported.banned_at),
                    reported_history=moderation_module.history(session, r.reported_id),
                    recommended_action=r.recommended_action if r.status == "open" else None,
                    withdrawals=self._withdrawals(session, r.reported_id) if r.reason == withdrawal_policy.REPORT_REASON else [],
                ))
            return out

    @staticmethod
    def _withdrawals(session: Session, user_id: int) -> List[WithdrawalStrikeOut]:
        strikes = withdrawal_policy.recent_strikes(session, user_id)
        reqs = {r.id: r for r in session.exec(select(Requirement).where(
            Requirement.id.in_({s.requirement_id for s in strikes}))).all()} if strikes else {}
        return [WithdrawalStrikeOut(
            id=s.id,
            requirement_ref=reqs[s.requirement_id].ref_code if s.requirement_id in reqs else None,
            requirement_title=reqs[s.requirement_id].title if s.requirement_id in reqs else None,
            created_at=s.created_at,
            reason_label=withdrawal_policy.reason_label(s.reason_code),
            reason_details=s.reason_details,
            has_proof=bool(s.proof_path),
        ) for s in strikes]

    def list_mine(self, reporter_id: int) -> List[MyReportOut]:
        with Session(engine) as session:
            reports = session.exec(select(BusinessReport).where(BusinessReport.reporter_id == reporter_id)
                                   .order_by(BusinessReport.created_at.desc())).all()
            return [MyReportOut(id=r.id, reported_name=_name(session.get(User, r.reported_id)),
                                reason_label=REASONS.get(r.reason, r.reason), status=r.status,
                                created_at=r.created_at, reviewed_at=r.reviewed_at) for r in reports]

    def search(self, viewer_id: int, q: str) -> List[BusinessSearchOut]:
        """Businesses to report, by name — active, not admins, not yourself."""
        q = (q or "").strip()
        if len(q) < 2:
            return []
        like = f"%{q}%"
        with Session(engine) as session:
            users = session.exec(select(User).where(
                User.is_admin == False, User.is_active == True, User.id != viewer_id,  # noqa: E712
                (User.business_name.ilike(like)) | (User.registered_name.ilike(like)) | (User.display_name.ilike(like)),
            ).limit(10)).all()
            return [BusinessSearchOut(id=u.id, name=_name(u), role=u.role, category=u.industry_category, city=u.city)
                    for u in users]

    def suggestions(self, viewer_id: int, limit: int = 8) -> List[ReportSuggestionOut]:
        """Businesses the viewer has actually transacted with, newest first:
        suppliers whose quotations released on the viewer's requirements, and
        owners of requirements where the viewer's quotation released."""
        with Session(engine) as session:
            as_buyer = session.exec(
                select(Quotation, Requirement).join(Requirement, Requirement.id == Quotation.requirement_id)
                .where(Requirement.owner_id == viewer_id, Quotation.released_at != None)  # noqa: E711
            ).all()
            as_seller = session.exec(
                select(Quotation, Requirement).join(Requirement, Requirement.id == Quotation.requirement_id)
                .where(Quotation.business_id == viewer_id, Quotation.released_at != None)  # noqa: E711
            ).all()
            seen: dict = {}
            for q, r, other_id, relation in (
                [(q, r, q.business_id, "supplier") for q, r in as_buyer]
                + [(q, r, r.owner_id, "buyer") for q, r in as_seller]
            ):
                if other_id == viewer_id:
                    continue
                prev = seen.get(other_id)
                if prev is None or (q.released_at) > prev[0]:
                    seen[other_id] = (q.released_at, r, relation)
            out = []
            for other_id, (dealt_at, r, relation) in sorted(seen.items(), key=lambda kv: kv[1][0], reverse=True):
                u = session.get(User, other_id)
                if not u or u.is_admin or not u.is_active:
                    continue
                out.append(ReportSuggestionOut(
                    id=u.id, name=_name(u), role=u.role, category=u.industry_category, city=u.city,
                    relation=relation, context=f"{r.ref_code} · {r.title}", dealt_at=dealt_at,
                ))
                if len(out) >= limit:
                    break
            return out

    def review(self, report_id: int, admin_id: int, data: ReportReview) -> None:
        with Session(engine) as session:
            report = session.get(BusinessReport, report_id)
            if not report:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found")
            if report.status != "open":
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This report was already reviewed")
            if data.action != "dismiss":
                moderation_service.apply(session, admin_id, report.reported_id, data.action, data.notes, report_id=report.id)
            report.status = "dismissed" if data.action == "dismiss" else "resolved"
            report.admin_notes = data.notes or None
            report.reviewed_by = admin_id
            report.reviewed_at = now_ph()
            session.add(report)
            session.commit()
            reported = session.get(User, report.reported_id)
            notif_repo.create_if_allowed(
                session, user_id=report.reporter_id, type_="VERIFICATION", category="activity",
                title="Your report was reviewed",
                detail=(f"About {_name(reported)}: "
                        + ("no violation was found." if data.action == "dismiss" else "an administrator took action. Thank you for reporting.")),
            )

    def count_open(self, session: Session) -> int:
        return session.exec(
            select(func.count()).select_from(BusinessReport).where(BusinessReport.status == "open")
        ).one()


report_service = ReportService()
