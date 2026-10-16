from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, EmailStr


# --- User Schemas ---

class UserCreate(BaseModel):
    username: str
    email: EmailStr
    password: str
    otp: Optional[str] = None


class UserResponse(BaseModel):
    id: int
    username: str
    email: EmailStr
    is_verified: bool = True
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


# --- OTP Schemas ---

class OTPRequest(BaseModel):
    email: EmailStr
    purpose: str = "registration"


class OTPVerifyRequest(BaseModel):
    email: EmailStr
    otp: str
    purpose: str = "registration"


class OTPResponse(BaseModel):
    status: str
    message: str



# --- Document Schemas ---

class DocumentCreate(BaseModel):
    title: str
    description: Optional[str] = None
    visibility: Literal["public", "private"] = "public"


class DocumentResponse(BaseModel):
    id: int
    user_id: int
    title: str
    description: Optional[str] = None
    file_type: str
    visibility: Literal["public", "private"]
    created_at: datetime
    uploader_name: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class DocumentUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    visibility: Optional[Literal["public", "private"]] = None


# --- Comment Schemas ---

class CommentCreate(BaseModel):
    content: str


class CommentResponse(BaseModel):
    id: int
    user_id: int
    document_id: int
    content: str
    created_at: datetime
    author_name: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


# --- Document Chat Schemas ---

class ChatRequest(BaseModel):
    question: str
    stream: Optional[bool] = None


class ChatSource(BaseModel):
    document_id: int
    document_title: Optional[str] = None
    chunk_index: Optional[int] = None
    page_number: Optional[int] = None


class ChatResponse(BaseModel):
    answer: str
    sources: List[ChatSource] = []


# --- Feed & Discovery Schemas ---

class PopularDocumentResponse(BaseModel):
    id: int
    user_id: int
    title: str
    visibility: str
    comment_count: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class UserRankingResponse(BaseModel):
    user_id: int
    username: str
    document_count: int

    model_config = ConfigDict(from_attributes=True)


class MessageResponse(BaseModel):
    message: str
    id: Optional[int] = None
