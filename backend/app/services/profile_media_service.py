"""Profile picture, cover photo and the "About" details of a business profile.

Images follow the portfolio pattern (portfolio_service): resized, re-encoded
as JPEG (which drops EXIF — GPS location, device), encrypted on disk, and
served only to signed-in users. Avatar: 512×512 square. Cover: 1600×400.
Links must be plain http(s) URLs — no javascript: or other schemes.
"""
import io
import os
import uuid
from typing import Optional, Tuple
from urllib.parse import urlparse

from fastapi import HTTPException, UploadFile, status
from sqlmodel import Session

from app.core.file_validation import check_contents, validate_upload
from app.core import file_crypto
from app.core.database import engine
from app.models.user import User

UPLOAD_ROOT = os.path.join("uploads", "profile")
MAX_FILE_BYTES = 5 * 1024 * 1024
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
SIZES = {"avatar": (512, 512), "cover": (1600, 400)}
FIELDS = {"avatar": "avatar_path", "cover": "cover_path"}


def _fit(contents: bytes, size: Tuple[int, int]) -> bytes:
    """Center-crops to the target shape and re-encodes as JPEG (drops EXIF)."""
    try:
        from PIL import Image, ImageOps

        image = ImageOps.exif_transpose(Image.open(io.BytesIO(contents)))
        image = ImageOps.fit(image.convert("RGB"), size)
        out = io.BytesIO()
        image.save(out, "JPEG", quality=85)
        return out.getvalue()
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="That file isn't a readable image")


def clean_url(value: Optional[str], label: str) -> Optional[str]:
    value = (value or "").strip()
    if not value:
        return None
    if "://" not in value:
        if ":" in value.split("/")[0]:  # another scheme, e.g. javascript:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                                detail=f"{label} must be a web address starting with http:// or https://")
        value = f"https://{value}"
    parsed = urlparse(value)
    if parsed.scheme not in ("http", "https") or not parsed.netloc or " " in value or len(value) > 300:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail=f"{label} must be a web address starting with http:// or https://")
    return value


def _kind_or_404(kind: str) -> str:
    if kind not in SIZES:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return kind


class ProfileMediaService:
    async def set_image(self, user_id: int, kind: str, file: UploadFile) -> None:
        kind = _kind_or_404(kind)
        ext = os.path.splitext(file.filename or "")[1].lower()
        if ext not in ALLOWED_EXTENSIONS:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Upload a JPG, PNG or WebP photo")
        contents = await file.read()
        if not contents:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="That file is empty")
        if len(contents) > MAX_FILE_BYTES:
            raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Photos can be up to 5 MB")
        check_contents(ext, contents)
        image = _fit(contents, SIZES[kind])

        with Session(engine) as session:
            user = session.get(User, user_id)
            if not user or user.is_admin:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Business accounts only")
            folder = os.path.join(UPLOAD_ROOT, str(user_id))
            os.makedirs(folder, exist_ok=True)
            path = os.path.join(folder, f"{kind}-{uuid.uuid4().hex}.jpg")
            with open(path, "wb") as f:
                f.write(file_crypto.encrypt_bytes(image))
            old = getattr(user, FIELDS[kind])
            setattr(user, FIELDS[kind], path)
            session.add(user)
            session.commit()
        if old and old != path and os.path.exists(old):
            os.remove(old)

    def remove_image(self, user_id: int, kind: str) -> None:
        kind = _kind_or_404(kind)
        with Session(engine) as session:
            user = session.get(User, user_id)
            old = getattr(user, FIELDS[kind]) if user else None
            if user:
                setattr(user, FIELDS[kind], None)
                session.add(user)
                session.commit()
        if old and os.path.exists(old):
            os.remove(old)

    def image(self, business_id: int, kind: str) -> bytes:
        kind = _kind_or_404(kind)
        with Session(engine) as session:
            user = session.get(User, business_id)
            path = getattr(user, FIELDS[kind]) if user and user.is_active and not user.is_admin else None
            if not path or not os.path.exists(path):
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No photo")
            with open(path, "rb") as f:
                return file_crypto.decrypt_bytes(f.read())

    def update_details(self, user_id: int, headline: Optional[str], about: Optional[str],
                       website_url: Optional[str], facebook_url: Optional[str]) -> None:
        headline = (headline or "").strip() or None
        about = (about or "").strip() or None
        website = clean_url(website_url, "Website")
        facebook = clean_url(facebook_url, "Facebook link")
        with Session(engine) as session:
            user = session.get(User, user_id)
            if not user or user.is_admin:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Business accounts only")
            user.headline = headline
            user.business_description = about
            user.website_url = website
            user.facebook_url = facebook
            session.add(user)
            session.commit()


profile_media_service = ProfileMediaService()
