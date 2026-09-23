from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    PROJECT_NAME: str = "TrustLink"
    SECRET_KEY: str = "please-change-me"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    # Example MySQL URL: mysql+pymysql://user:password@localhost:3306/trustlink
    DATABASE_URL: str = "mysql+pymysql://root:akositanpogi@127.0.0.1:3306/trustlink"
    DB_ECHO: bool = False

    # Google OAuth ("Sign in with Google") — set these in backend/.env,
    # never commit real values. See backend/.env.example.
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    GOOGLE_REDIRECT_URI: str = "http://localhost:8000/auth/google/callback"
    # Where the backend sends the browser after a Google login completes.
    FRONTEND_URL: str = "http://localhost:8081"

    # Email OTP verification — mobile+password sign-ups must enter a 6-digit
    # code sent here before they can log in (see auth_service.verify_email).
    # SMTP works with any provider; for Gmail use smtp.gmail.com:587 with an
    # App Password (Google Account > Security > 2-Step Verification > App
    # passwords), never the account's real password. Set in backend/.env.
    # Blank SMTP_HOST means "dev mode": the code is printed to the backend
    # console instead of emailed — see email_service.send_email.
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USERNAME: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = ""  # falls back to SMTP_USERNAME when blank
    OTP_EXPIRE_MINUTES: int = 10
    OTP_MAX_ATTEMPTS: int = 5
    OTP_RESEND_COOLDOWN_SECONDS: int = 60

    # Symmetric key (Fernet) uploaded business documents are encrypted with
    # before they touch disk — see business_service._save_file. Set in
    # backend/.env, never commit a real value. Generate one with:
    #   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    FILE_ENCRYPTION_KEY: str = ""

    # Gemini API key (Google AI Studio, aistudio.google.com — has a free tier)
    # for Assistive Document Extraction — pre-filling a DTI/SEC/BIR/Mayor's
    # Permit certificate number from the uploaded image so the business
    # doesn't have to retype it. Purely a convenience: it never determines
    # verification status, trust tier, release, or awards (see
    # document_extraction_service.py), and the onboarding form stays fully
    # editable either way. Set in backend/.env, never commit a real value.
    # Blank means the feature quietly no-ops — see extract_id_number's guard.
    GEMINI_API_KEY: str = ""


settings = Settings()
