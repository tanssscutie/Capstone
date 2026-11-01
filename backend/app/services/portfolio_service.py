"""Seller portfolio: a few photos of past work on the business profile.

A trust signal that needs no ratings (Panel Suggestion #7). Only sellers who
finished onboarding can add photos — verification isn't required, so a new
supplier can fill in their profile while their documents are reviewed. A
photo that misrepresents the business is handled through "Report this
business" (reason: misleading profile).
"""
import io
import os
import uuid
from typing import List, Optional, Tuple

from fastapi import HTTPException, UploadFile, status
from sqlmodel import Session, select

from app.core.file_validation import check_contents, validate_upload
from app.core import file_crypto
from app.core.categories import find_item, item_name
from app.core.database import engine
from app.models.portfolio_item import PortfolioItem
from app.models.quotation import Quotation
from app.models.requirement import Requirement
from app.models.transaction_closeout import TransactionCloseout
from app.models.user import User
from app.schemas.business import CompletedWorkOut, PortfolioItemOut

UPLOAD_ROOT = os.path.join("uploads", "portfolio")
MAX_ITEMS = 8
MAX_FILE_BYTES = 5 * 1024 * 1024
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
MAX_IMAGE_EDGE_PX = 1600  # plenty for a profile gallery; keeps files small


def _shrink(contents: bytes, ext: str) -> Tuple[bytes, str]:
    """Downscales big photos and re-encodes them as JPEG — which also drops
    the photo's EXIF metadata (GPS location, device). Anything Pillow can't
    read is refused rather than stored."""
    try:
        from PIL import Image, ImageOps

        image = ImageOps.exif_transpose(Image.open(io.BytesIO(contents)))
        image.thumbnail((MAX_IMAGE_EDGE_PX, MAX_IMAGE_EDGE_PX))
        out = io.BytesIO()
        image.convert("RGB").save(out, "JPEG", quality=85)
        return out.getvalue(), ".jpg"
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="That file isn't a readable image")


def _to_out(item: PortfolioItem, category: Optional[str]) -> PortfolioItemOut:
    return PortfolioItemOut(
        id=item.id,
        caption=item.caption,
        item_code=item.item_code,
        item_name=item_name(category, item.item_code) if category and item.item_code else None,
        created_at=item.created_at,
    )


class PortfolioService:
    def list(self, business_id: int) -> List[PortfolioItemOut]:
        with Session(engine) as session:
            business = session.get(User, business_id)
            if not business or business.is_admin or not business.is_active:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Business not found")
            rows = session.exec(
                select(PortfolioItem).where(PortfolioItem.business_id == business_id)
                .order_by(PortfolioItem.created_at.desc())
            ).all()
            return [_to_out(r, business.industry_category) for r in rows]

    async def add(self, user_id: int, file: UploadFile, caption: str, item_code: Optional[str]) -> PortfolioItemOut:
        caption = (caption or "").strip()
        if not 3 <= len(caption) <= 140:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                                detail="Add a short caption (3 to 140 characters)")
        ext = os.path.splitext(file.filename or "")[1].lower()
        if ext not in ALLOWED_EXTENSIONS:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Upload a JPG, PNG or WebP photo")
        contents = await file.read()
        if not contents:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="That file is empty")
        if len(contents) > MAX_FILE_BYTES:
            raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Photos can be up to 5 MB")
        check_contents(ext, contents)

        with Session(engine) as session:
            user = session.get(User, user_id)
            if not user or user.role != "seller" or not user.onboarding_completed:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                                    detail="Only seller accounts that finished onboarding can add portfolio photos")
            code = (item_code or "").strip() or None
            if code and not find_item(user.industry_category or "", code):
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                                    detail=f"Pick an item from {user.industry_category}")
            count = len(session.exec(select(PortfolioItem.id).where(PortfolioItem.business_id == user_id)).all())
            if count >= MAX_ITEMS:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                    detail=f"Your portfolio holds up to {MAX_ITEMS} photos — remove one first")

            image, ext = _shrink(contents, ext)
            folder = os.path.join(UPLOAD_ROOT, str(user_id))
            os.makedirs(folder, exist_ok=True)
            path = os.path.join(folder, f"{uuid.uuid4().hex}{ext}")
            with open(path, "wb") as f:
                f.write(file_crypto.encrypt_bytes(image))

            item = PortfolioItem(business_id=user_id, file_path=path, original_filename=os.path.basename(file.filename or "photo")[:255],
                                 caption=caption, item_code=code)
            session.add(item)
            session.commit()
            session.refresh(item)
            return _to_out(item, user.industry_category)

    def remove(self, user_id: int, item_id: int) -> None:
        with Session(engine) as session:
            item = session.get(PortfolioItem, item_id)
            if not item or item.business_id != user_id:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Photo not found")
            path = item.file_path
            session.delete(item)
            session.commit()
        if path and os.path.exists(path):
            os.remove(path)

    def image(self, business_id: int, item_id: int) -> bytes:
        with Session(engine) as session:
            item = session.get(PortfolioItem, item_id)
            if not item or item.business_id != business_id or not os.path.exists(item.file_path):
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Photo not found")
            with open(item.file_path, "rb") as f:
                return file_crypto.decrypt_bytes(f.read())


    # ---------- completed TrustLink orders ("Completed on TrustLink") ----------

    @staticmethod
    def _completed_rows(session: Session, business_id: int):
        """(requirement, closeout) for every order this business delivered as the
        awarded supplier and the buyer confirmed (or that auto-confirmed)."""
        return session.exec(
            select(Requirement, TransactionCloseout)
            .join(Quotation, Quotation.id == Requirement.awarded_quotation_id)
            .join(TransactionCloseout, TransactionCloseout.requirement_id == Requirement.id)
            .where(
                Requirement.status == "awarded", Quotation.business_id == business_id,
                TransactionCloseout.status == "confirmed", TransactionCloseout.outcome == "completed",
            )
            .order_by(TransactionCloseout.responded_at.desc())
        ).all()

    def completed_work(self, business_id: int, *, showcased: bool) -> List[CompletedWorkOut]:
        """showcased=True: what the profile shows. False: the owner's suggestions."""
        with Session(engine) as session:
            out = []
            for req, closeout in self._completed_rows(session, business_id):
                if bool(req.supplier_showcase) != showcased:
                    continue
                buyer = session.get(User, req.owner_id)
                out.append(CompletedWorkOut(
                    requirement_id=req.id, ref_code=req.ref_code, title=req.title, category=req.category,
                    item_name=item_name(req.category, req.item_code) if req.item_code else None,
                    quantity=req.quantity or "", city=req.city or "",
                    buyer_name=(buyer.display_name or buyer.registered_name or buyer.business_name) if buyer else "A buyer",
                    completed_at=closeout.responded_at or closeout.created_at, showcased=bool(req.supplier_showcase),
                ))
            return out

    def set_showcase(self, user_id: int, requirement_id: int, show: bool) -> None:
        with Session(engine) as session:
            if not any(req.id == requirement_id for req, _ in self._completed_rows(session, user_id)):
                raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                    detail="Only a completed order you delivered can be shown on your profile")
            req = session.get(Requirement, requirement_id)
            req.supplier_showcase = show
            session.add(req)
            session.commit()


portfolio_service = PortfolioService()
