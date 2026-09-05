from sqlmodel import SQLModel, Session, create_engine
from app.core.config import settings

# For MySQL use a URL like: mysql+pymysql://user:password@host:port/dbname
# SQLModel is synchronous here; ensure pymysql is installed.
engine = create_engine(settings.DATABASE_URL, echo=settings.DB_ECHO, pool_pre_ping=True)


def create_db_and_tables():
    SQLModel.metadata.create_all(engine)


def get_session():
    with Session(engine) as session:
        yield session
