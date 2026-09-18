from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings


def _fernet() -> Fernet:
    if not settings.FILE_ENCRYPTION_KEY:
        raise RuntimeError(
            "FILE_ENCRYPTION_KEY is not set — see backend/.env.example. "
            "Generate one with: python -c \"from cryptography.fernet import Fernet; "
            "print(Fernet.generate_key().decode())\""
        )
    return Fernet(settings.FILE_ENCRYPTION_KEY.encode())


def encrypt_bytes(data: bytes) -> bytes:
    """Every uploaded business document is encrypted with this before it
    touches disk (business_service._save_file) — satisfies the "encrypted at
    rest" safeguard the study claims."""
    return _fernet().encrypt(data)


def decrypt_bytes(data: bytes) -> bytes:
    """Raises cryptography.fernet.InvalidToken if `data` isn't a Fernet token
    encrypted with the current key — see decrypt_bytes_lenient for a version
    that tolerates that (legacy files saved before this existed)."""
    return _fernet().decrypt(data)


def decrypt_bytes_lenient(data: bytes) -> bytes:
    """Same as decrypt_bytes, but falls back to returning `data` unchanged if
    it isn't a valid Fernet token — covers documents uploaded before file
    encryption was added, so they still open instead of erroring out."""
    try:
        return decrypt_bytes(data)
    except InvalidToken:
        return data
