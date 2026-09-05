from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    PROJECT_NAME: str = "TrustLink"
    SECRET_KEY: str = "please-change-me"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    # Example MySQL URL: mysql+pymysql://user:password@localhost:3306/trustlink
    DATABASE_URL: str = "mysql+pymysql://root:akositanpogi@127.0.0.1:3306/trustlink"
    DB_ECHO: bool = False


settings = Settings()
