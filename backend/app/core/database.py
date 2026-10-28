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
    _migrate_user_years_in_business()
    _migrate_user_offered_items()
    _migrate_requirement_item_code()
    _migrate_quotation_spec_responses()
    _migrate_message_is_system()
    _migrate_message_body_text()
    _migrate_message_attachment()
    _migrate_requirement_address_parts()
    _add_column_if_missing("user", "notify_email", "BOOLEAN NOT NULL DEFAULT 1")
    _add_column_if_missing("user", "privacy_consent_at", "DATETIME NULL")
    _add_column_if_missing("user", "privacy_policy_version", "VARCHAR(20) NULL")
    _add_column_if_missing("user", "suspended_until", "DATETIME NULL")
    _add_column_if_missing("requirement", "auto_extended_at", "DATETIME NULL")
    _add_column_if_missing("user", "banned_at", "DATETIME NULL")
    _add_column_if_missing("requirement", "fulfillment_status", "VARCHAR(30) NOT NULL DEFAULT 'awarded'")
    _add_column_if_missing("requirement", "fulfillment_updated_at", "DATETIME NULL")
    _add_column_if_missing("requirement", "fulfillment_reminders", "INTEGER NOT NULL DEFAULT 0")
    _add_column_if_missing("user", "avatar_path", "VARCHAR(500) NULL")
    _add_column_if_missing("user", "cover_path", "VARCHAR(500) NULL")
    _add_column_if_missing("user", "headline", "VARCHAR(100) NULL")
    _add_column_if_missing("user", "website_url", "VARCHAR(300) NULL")
    _add_column_if_missing("user", "facebook_url", "VARCHAR(300) NULL")
    _add_column_if_missing("requirement", "supplier_showcase", "BOOLEAN NOT NULL DEFAULT 0")
    _add_column_if_missing("user", "password_changed_at", "DATETIME NULL")
    _add_column_if_missing("user", "email_changed_at", "DATETIME NULL")
    _add_column_if_missing("user", "mobile_changed_at", "DATETIME NULL")
    _add_column_if_missing("user", "theme", "VARCHAR(10) NOT NULL DEFAULT 'system'")
    _add_column_if_missing("requirement", "strict_budget", "BOOLEAN NOT NULL DEFAULT 0")
    _add_column_if_missing("quotation", "over_budget_reason", "VARCHAR(300) NULL")
    _migrate_withdrawal_strike_reasons()
    _add_column_if_missing("businessreport", "recommended_action", "VARCHAR(20) NULL")


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


def _migrate_user_years_in_business():
    """Adds User.years_in_business to a database created before sign-up
    asked sellers for it. Existing accounts stay null — nothing to backfill."""
    columns = {c["name"] for c in inspect(engine).get_columns("user")}
    if "years_in_business" in columns:
        return

    user_table = engine.dialect.identifier_preparer.quote("user")
    with engine.begin() as conn:
        conn.execute(text(f"ALTER TABLE {user_table} ADD COLUMN years_in_business VARCHAR(20) NULL"))
    logger.info("Added user.years_in_business column.")


def _migrate_user_offered_items():
    """Adds User.offered_items (seller's items, see app/core/categories.py).
    Existing sellers stay null and are asked for items on their next onboarding edit."""
    _add_column_if_missing("user", "offered_items", "TEXT NULL")


def _migrate_requirement_item_code():
    """Adds Requirement.item_code. Requirements posted before items existed
    stay null — they still load, just without an item."""
    _add_column_if_missing("requirement", "item_code", "VARCHAR(60) NULL")


def _migrate_quotation_spec_responses():
    """Adds Quotation.spec_responses. Quotations submitted before it existed
    stay null — shown as "not confirmed" in the buyer's comparison."""
    _add_column_if_missing("quotation", "spec_responses", "TEXT NULL")


def _migrate_message_is_system():
    """Adds Message.is_system. Every existing message was typed by a person."""
    _add_column_if_missing("message", "is_system", "BOOLEAN NOT NULL DEFAULT 0")


def _migrate_message_body_text():
    """Widens Message.body from VARCHAR(255) to TEXT on databases created before
    the model said so — anything longer than 255 characters failed to save."""
    column = next((c for c in inspect(engine).get_columns("message") if c["name"] == "body"), None)
    if column is None or "CHAR" not in str(column["type"]).upper():
        return
    if engine.dialect.name != "mysql":
        return  # SQLite doesn't enforce VARCHAR length; nothing to widen.
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE message MODIFY body TEXT NOT NULL"))
    logger.info("Widened message.body to TEXT.")


def _migrate_message_attachment():
    """Adds Message's attachment columns. Existing messages have no file."""
    _add_column_if_missing("message", "attachment_path", "VARCHAR(500) NULL")
    _add_column_if_missing("message", "attachment_filename", "VARCHAR(255) NULL")
    _add_column_if_missing("message", "attachment_size", "INTEGER NULL")
    _add_column_if_missing("message", "attachment_sha256", "VARCHAR(64) NULL")


def _migrate_requirement_address_parts():
    """Adds Requirement.barangay and zip_code. Older requirements stay null."""
    _add_column_if_missing("requirement", "barangay", "VARCHAR(120) NULL")
    _add_column_if_missing("requirement", "zip_code", "VARCHAR(4) NULL")


def _migrate_withdrawal_strike_reasons():
    """Withdrawal strikes now count every withdrawal, with its reason: the
    one-per-requirement unique key goes (a supplier can withdraw twice on the
    same requirement) and the reason/proof columns come in. Older strikes keep
    reason_code "unspecified"."""
    insp = inspect(engine)
    if "withdrawalstrike" not in insp.get_table_names():
        return
    _add_column_if_missing("withdrawalstrike", "quotation_id", "INTEGER NULL")
    _add_column_if_missing("withdrawalstrike", "reason_code", "VARCHAR(30) NOT NULL DEFAULT 'unspecified'")
    _add_column_if_missing("withdrawalstrike", "reason_details", "TEXT NULL")
    _add_column_if_missing("withdrawalstrike", "proof_path", "VARCHAR(500) NULL")
    _add_column_if_missing("withdrawalstrike", "proof_filename", "VARCHAR(255) NULL")
    names = {u["name"] for u in insp.get_unique_constraints("withdrawalstrike")} | {
        i["name"] for i in insp.get_indexes("withdrawalstrike") if i.get("unique")}
    if "uq_strike_user_requirement" in names and engine.dialect.name == "mysql":
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE withdrawalstrike DROP INDEX uq_strike_user_requirement"))
        logger.info("Dropped withdrawalstrike.uq_strike_user_requirement.")


def _add_column_if_missing(table: str, column: str, ddl: str):
    columns = {c["name"] for c in inspect(engine).get_columns(table)}
    if column in columns:
        return

    quoted = engine.dialect.identifier_preparer.quote(table)
    with engine.begin() as conn:
        conn.execute(text(f"ALTER TABLE {quoted} ADD COLUMN {column} {ddl}"))
    logger.info("Added %s.%s column.", table, column)


def get_session():
    with Session(engine) as session:
        yield session
