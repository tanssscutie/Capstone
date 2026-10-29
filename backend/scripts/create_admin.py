"""Create an administrator, or change an existing admin's role.

Run from backend/:
  venv/Scripts/python.exe scripts/create_admin.py --email ana@trustlink.ph --name "Ana Santos"
  venv/Scripts/python.exe scripts/create_admin.py --email ana@trustlink.ph --name "Ana Santos" --super
  venv/Scripts/python.exe scripts/create_admin.py --email ana@trustlink.ph --promote --super
  venv/Scripts/python.exe scripts/create_admin.py --email ana@trustlink.ph --promote          (back to admin)

The password is asked for (twice) and never echoed or put on the command
line. They log in at /admin-login with the email and that password.
"""
import argparse
import getpass
import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)

from sqlmodel import Session, select  # noqa: E402

from app.core.database import create_db_and_tables, engine  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services.admin_accounts import create_admin, promote  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="Create or promote a TrustLink administrator.")
    parser.add_argument("--email", required=True)
    parser.add_argument("--name", help="Display name (required when creating)")
    parser.add_argument("--mobile", help="Optional login mobile number")
    parser.add_argument("--super", action="store_true", help="Super admin (manages admins, rules, audit log, backups)")
    parser.add_argument("--promote", action="store_true", help="Change the role of an existing admin account")
    args = parser.parse_args()
    role = "super_admin" if args.super else "admin"

    create_db_and_tables()  # makes sure the admin_role column exists
    with Session(engine) as session:
        if args.promote:
            user = session.exec(select(User).where(User.email == args.email.strip().lower())).first()
            if not user:
                sys.exit(f"No account with email {args.email}.")
            if user.is_admin and user.admin_role == "super_admin" and role == "admin":
                others = session.exec(select(User).where(User.admin_role == "super_admin", User.is_active == True,  # noqa: E712
                                                         User.id != user.id)).all()
                if not others:
                    sys.exit("That is the last super admin — promote someone else first.")
            try:
                user = promote(session, user, role)
            except Exception as e:
                sys.exit(getattr(e, "detail", str(e)))
            print(f"{user.business_name} <{user.email}> is now {user.admin_role}.")
            return

        if not args.name:
            sys.exit("--name is required when creating an admin.")
        password = getpass.getpass("Password (8+ characters): ")
        if password != getpass.getpass("Repeat password: "):
            sys.exit("The passwords don't match.")
        try:
            user = create_admin(session, args.name, args.email, password, role, args.mobile)
        except Exception as e:
            sys.exit(getattr(e, "detail", str(e)))
        print(f"Created {user.admin_role} {user.business_name} <{user.email}> (#{user.id}). Log in at /admin-login.")


if __name__ == "__main__":
    main()
