# TrustLink Backend
fastapi
uvicorn[standard]
sqlmodel
python-jose[cryptography]
passlib[bcrypt]
pymysql
pydantic-settings
email-validator
python-multipart

Quick start:

1. Create a virtual environment and install dependencies:

```bash
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

2. Configure MySQL connection (set environment variable `DATABASE_URL` or edit `app/core/config.py`).

Example `DATABASE_URL` for MySQL using `pymysql`:

```text
mysql+pymysql://db_user:db_password@127.0.0.1:3306/trustlink
```

Make sure the database exists and the user has privileges.

3. Run the app:

```bash
uvicorn app.main:app --reload --port 8000
cd C:\Users\repos\Downloads\newAUTH
.\venv\Scripts\Activate.ps1
```

Endpoints:
- `GET /` health
- `POST /auth/register` register user (JSON `{ "email": "", "password": "" }`)
- `POST /auth/login` login using form data (`username`, `password`) returns `access_token`
- `GET /auth/me` get current user (bearer token)

admin login
http://localhost:8081/admin-login