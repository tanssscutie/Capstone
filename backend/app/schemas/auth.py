from pydantic import BaseModel, Field
from typing import Optional


class UserCreate(BaseModel):
    business_name: str = Field(min_length=2, max_length=120)
    mobile_number: str = Field(min_length=7, max_length=20)
    password: str = Field(min_length=8, max_length=72)


class UserRead(BaseModel):
    id: int
    business_name: str
    mobile_number: str
    is_admin: bool = False
    notify_messages: bool = True
    notify_activity: bool = True


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class TokenData(BaseModel):
    sub: Optional[str] = None


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=8, max_length=72)
    new_password: str = Field(min_length=8, max_length=72)


class MobileNumberChange(BaseModel):
    new_mobile_number: str = Field(min_length=7, max_length=20)
    current_password: str = Field(min_length=8, max_length=72)


class NotificationPreferences(BaseModel):
    notify_messages: bool
    notify_activity: bool