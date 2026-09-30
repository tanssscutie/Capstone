import logging

from sqlalchemy import inspect, text
from sqlmodel import SQLModel, Session, create_engine
from app.core.config import settings

logger = logging.getLogger("trustlink.startup")

# For MySQL use a URL like: mysql+pymysql://user:password@host:port/dbname
# SQLModel is synchronous here; ensure pymysql is installed.
engine = create_engine(settings.DATABASE_URL, echo=settings.DB_ECHO, pool_pre_ping=True)


def create_db_and_tables():
    SQLModel.metadata.create_all(engine)
    _migrate_user_role()


def _migrate_user_role():
    """Adds User.role to a database created before buyer/seller accounts were
    split — create_all only creates missing tables, never missing columns.

    Runs once: the backfill only happens in the same call that adds the
    column, so it never overwrites a role someone picked afterward. Each
    existing business gets the side it said it was here for at onboarding
    (signup_intent); a "BOTH" business becomes a seller only if it has
    quoted but never posted, otherwise a buyer. Admins, and Google sign-ups
    that never finished their profile (no mobile number yet), stay null —
    the latter pick a role on the complete-profile screen like any new one."""
    columns = {c["name"] for c in inspect(engine).get_columns("user")}
    if "role" in columns:
        return

    user_table = engine.dialect.identifier_preparer.quote("user")
    with engine.begin() as conn:
        conn.execute(text(f"ALTER TABLE {user_table} ADD COLUMN role VARCHAR(10) NULL"))
        conn.execute(text(f"""
            UPDATE {user_table} u SET role = CASE
                WHEN u.signup_intent = 'FIND_WORK' THEN 'seller'
                WHEN u.signup_intent = 'FIND_SUPPLIERS' THEN 'buyer'
                WHEN EXISTS (SELECT 1 FROM quotation q WHERE q.business_id = u.id)
                     AND NOT EXISTS (SELECT 1 FROM requirement r WHERE r.owner_id = u.id)
                    THEN 'seller'
                ELSE 'buyer'
            END
            WHERE u.is_admin = 0 AND u.mobile_number IS NOT NULL
        """))
    logger.info("Added user.role column and backfilled existing businesses.")


def get_session():
    with Session(engine) as session:
        yield session
