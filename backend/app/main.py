import logging
import os
import shutil
from contextlib import asynccontextmanager
from uuid import uuid4
from typing import List, Literal, Optional

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, Request, Response, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import func, select
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# Centralized configuration
from . import config
from .config import (
    COOKIE_SAMESITE,
    COOKIE_SECURE,
    CORS_ORIGINS,
    MAX_UPLOAD_SIZE_BYTES,
    MAX_UPLOAD_SIZE_MB,
    REFRESH_TOKEN_EXPIRE_DAYS,
    UPLOAD_DIR,
)

# Database dependency and models
from .database import get_db, init_db
from .models import Comment, Document, DocumentChunk, User
from .schema import (
    ChatRequest,
    ChatResponse,
    ChatSource,
    CommentCreate,
    CommentResponse,
    DocumentResponse,
    DocumentUpdate,
    PopularDocumentResponse,
    TokenResponse,
    UserCreate,
    UserLogin,
    UserRankingResponse,
    UserResponse,
    OTPRequest,
    OTPVerifyRequest,
    OTPResponse,
    MessageResponse,
)
from .auth import (
    create_access_token,
    create_refresh_token,
    get_current_user,
    get_optional_current_user,
    login_oauth2,
    login_user,
    register_user,
    verify_refresh_token,
)
from .otp import (
    cancel_otp_challenge,
    create_otp_challenge,
    verify_otp,
    OTPCooldownError,
    OTPRateLimitError,
)
from .email import send_otp_email, EmailDeliveryError
from .ingestion import compute_file_hash, ingest_document, SUPPORTED_EXTENSIONS
from .retrieval import retrieve_documents
from .chat import stream_response
from .workflow import qa_workflow

from .semantic_search import generate_embedding, perform_semantic_search


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    FastAPI lifespan context manager for application startup and shutdown.
    Ensures required database tables and extensions are initialized once at startup.
    Fails startup with an explicit error if the database connection or table creation fails.
    """
    logger.info("Initializing database schema on startup...")
    try:
        init_db()
        logger.info("Database schema initialized successfully.")
    except Exception as exc:
        logger.critical("Fatal: Failed to initialize database schema: %s", exc, exc_info=True)
        raise RuntimeError(f"Database initialization failed: {exc}") from exc
    yield


# Initialize FastAPI application
app = FastAPI(
    title="Research Platform API",
    description="Backend API for research document management, Q&A, and discussion platform.",
    version="1.0.0",
    lifespan=lifespan,
)

# Configure CORS using centralized project settings
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:[0-9]+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Root Status Endpoint ---
@app.get("/")
def root():
    """Confirms that the Research Platform API is running."""
    return {
        "status": "online",
        "message": "Research Platform API is running",
    }


# =====================================================================
# Authentication Endpoints
# =====================================================================

@app.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def register(user_data: UserCreate, db: Session = Depends(get_db)):
    """Registers a new user."""
    return register_user(user_data, db)


@app.post("/auth/otp/request", response_model=OTPResponse)
def request_otp(
    payload: OTPRequest,
    db: Session = Depends(get_db),
):
    """
    Requests a single-use 6-digit email OTP for registration or verification.
    Enforces resend cooldown (30s) and hourly limits in PostgreSQL.
    Never reveals whether the email is registered or not (prevents enumeration).
    """
    clean_email = payload.email.strip().lower()
    existing_user = db.scalar(select(User).where(User.email == clean_email))

    # For registration, if user already exists and is verified, do not reveal user existence
    if payload.purpose == "registration" and existing_user and existing_user.is_verified:
        return OTPResponse(
            status="success",
            message="If this email is eligible, a verification code has been sent.",
        )

    user_id = existing_user.id if existing_user else None

    try:
        challenge, plaintext_otp = create_otp_challenge(
            db=db,
            email=clean_email,
            purpose=payload.purpose,
            user_id=user_id,
        )
    except OTPCooldownError as e:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=str(e),
            headers={"Retry-After": str(e.retry_after_seconds)},
        )
    except OTPRateLimitError as e:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=str(e),
        )

    try:
        send_otp_email(to_email=clean_email, otp=plaintext_otp, purpose=payload.purpose)
    except EmailDeliveryError:
        cancel_otp_challenge(db, challenge)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unable to deliver verification email at this time. Please check mail configuration.",
        )

    return OTPResponse(
        status="success",
        message="If this email is eligible, a verification code has been sent.",
    )


@app.post("/auth/otp/verify", response_model=OTPResponse)
def verify_otp_endpoint(
    payload: OTPVerifyRequest,
    db: Session = Depends(get_db),
):
    """
    Verifies a 6-digit email OTP code against active challenges.
    Enforces server-side 30-second expiry, max 5 attempts, and atomic single-use consumption.
    """
    result = verify_otp(
        db=db,
        email=payload.email,
        otp=payload.otp,
        purpose=payload.purpose,
    )
    if not result.success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=result.message,
        )

    # Mark user as verified in DB for registration and email_verification purposes
    if payload.purpose in ("email_verification", "registration"):
        clean_email = payload.email.strip().lower()
        user = db.scalar(select(User).where(User.email == clean_email))
        if user:
            user.is_verified = True
            db.commit()

    return OTPResponse(
        status="success",
        message=result.message,
    )




def _clear_refresh_cookie_headers() -> dict[str, str]:
    """Generates headers dictionary to wipe out the refresh token cookie, safe for HTTPException."""
    temp_resp = Response()
    temp_resp.delete_cookie(
        key="rp_refresh_token",
        path="/",
        secure=config.COOKIE_SECURE,
        samesite=config.COOKIE_SAMESITE,
        httponly=True,
    )
    cookie_val = temp_resp.headers.get("set-cookie")
    return {"Set-Cookie": cookie_val} if cookie_val else {}


def _set_refresh_cookie(response: Response, user_id: int) -> str:
    """Sets a secure HttpOnly refresh token cookie for persistent login sessions."""
    refresh_token = create_refresh_token(subject=user_id)
    response.set_cookie(
        key="rp_refresh_token",
        value=refresh_token,
        httponly=True,
        samesite=config.COOKIE_SAMESITE,
        secure=config.COOKIE_SECURE,
        max_age=REFRESH_TOKEN_EXPIRE_DAYS * 86400,
        path="/",
    )
    return refresh_token


@app.post("/token", response_model=TokenResponse)
def oauth2_token(
    response: Response,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    """
    OAuth2 password login endpoint for Swagger UI and form-based clients.
    Accepts application/x-www-form-urlencoded form fields 'username' and 'password'.
    Interprets 'username' as the user's email address.
    Sets HttpOnly refresh token cookie for session persistence.
    """
    token_res = login_oauth2(form_data, db)
    user = db.scalar(select(User).where(User.email == form_data.username))
    if user:
        _set_refresh_cookie(response, user.id)
    return token_res


@app.post("/login", response_model=TokenResponse)
def login(
    login_data: UserLogin,
    response: Response,
    db: Session = Depends(get_db),
):
    """
    Authenticates a user via JSON payload (email and password) and returns a JWT access token.
    Sets HttpOnly refresh token cookie for persistent sessions without unexpected logout.
    """
    token_res = login_user(login_data, db)
    user = db.scalar(select(User).where(User.email == login_data.email))
    if user:
        _set_refresh_cookie(response, user.id)
    return token_res


@app.post("/refresh", response_model=TokenResponse)
def refresh_session(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    """
    Refreshes an expired short-lived access token using the persistent HttpOnly refresh token.
    Avoids unexpected user logout when access tokens expire.
    """
    token = request.cookies.get("rp_refresh_token")
    if not token:
        # Fallback to custom header if client or test passes it explicitly
        token = request.headers.get("X-Refresh-Token")

    clear_cookie_headers = _clear_refresh_cookie_headers()

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token missing. Please log in again.",
            headers=clear_cookie_headers,
        )

    try:
        user_id = verify_refresh_token(token)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token. Please log in again.",
            headers=clear_cookie_headers,
        )

    user = db.scalar(select(User).where(User.id == user_id))
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account associated with this session no longer exists.",
            headers=clear_cookie_headers,
        )

    new_access_token = create_access_token(subject=user.id)
    _set_refresh_cookie(response, user.id)

    return TokenResponse(
        access_token=new_access_token,
        token_type="bearer",
    )


@app.post("/logout")
def logout(response: Response):
    """Revokes the persistent session by clearing the HttpOnly refresh token cookie."""
    response.delete_cookie(
        key="rp_refresh_token",
        path="/",
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
    )
    return {"message": "Logged out successfully"}


@app.get("/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    """Returns the authenticated user's profile."""
    return current_user



# =====================================================================
# Public Feed & Discovery Endpoints (Registered before dynamic {id} routes)
# =====================================================================

@app.get("/feed", response_model=List[DocumentResponse])
@app.get("/documents/feed", response_model=List[DocumentResponse])
def public_feed(db: Session = Depends(get_db)):
    """Public document feed displaying public research documents."""
    stmt = (
        select(Document)
        .where(Document.visibility == "public")
        .order_by(Document.created_at.desc())
    )
    return db.scalars(stmt).all()


@app.get("/documents/search", response_model=List[DocumentResponse])
def search_documents(
    q: str = Query(..., min_length=1, description="Search query string"),
    limit: int = Query(10, ge=1, le=50),
    current_user: Optional[User] = Depends(get_optional_current_user),
    db: Session = Depends(get_db),
):
    """
    Searches for related documents by title/description and semantic vector similarity.
    Enforces strict access control:
    - Public documents are searchable by anyone.
    - An authenticated user can also search their own private documents.
    - Private documents of other users are never returned.

    Delegates directly to app/semantic-search.py without duplicating logic.
    """
    user_id = current_user.id if current_user is not None else None
    return perform_semantic_search(
        query=q,
        db=db,
        user_id=user_id,
        limit=limit,
    )


@app.get("/documents/popular", response_model=List[PopularDocumentResponse])
def popular_documents(db: Session = Depends(get_db)):
    """Lists public documents sorted by engagement (number of comments)."""
    stmt = (
        select(
            Document.id,
            Document.user_id,
            Document.title,
            Document.visibility,
            Document.created_at,
            func.count(Comment.id).label("comment_count"),
        )
        .outerjoin(Comment, Document.id == Comment.document_id)
        .where(Document.visibility == "public")
        .group_by(Document.id)
        .order_by(func.count(Comment.id).desc(), Document.created_at.desc())
    )
    results = db.execute(stmt).all()

    return [
        PopularDocumentResponse(
            id=row.id,
            user_id=row.user_id,
            title=row.title,
            visibility=row.visibility,
            comment_count=row.comment_count,
            created_at=row.created_at,
        )
        for row in results
    ]


@app.get("/users/ranking", response_model=List[UserRankingResponse])
def user_ranking(db: Session = Depends(get_db)):
    """User leaderboard based on the number of uploaded documents."""
    stmt = (
        select(
            User.id.label("user_id"),
            User.username,
            func.count(Document.id).label("document_count"),
        )
        .outerjoin(Document, User.id == Document.user_id)
        .group_by(User.id)
        .order_by(func.count(Document.id).desc(), User.id.asc())
    )
    results = db.execute(stmt).all()

    return [
        UserRankingResponse(
            user_id=row.user_id,
            username=row.username,
            document_count=row.document_count,
        )
        for row in results
    ]


@app.get("/users/{user_id}", response_model=UserResponse)
def get_user_profile(user_id: int, db: Session = Depends(get_db)):
    """
    Returns public profile details of a contributor by user ID.
    Enables viewing contributor profiles from leaderboard and document cards.
    """
    user = db.scalar(select(User).where(User.id == user_id))
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Contributor profile not found.",
        )
    return user


@app.get("/users/{user_id}/documents", response_model=List[DocumentResponse])
def get_contributor_documents(
    user_id: int,
    current_user: Optional[User] = Depends(get_optional_current_user),
    db: Session = Depends(get_db),
):
    """
    Retrieves documents uploaded by a specific contributor:
    - If current_user is the owner, returns all their documents (public and private).
    - If another user or visitor, returns only their public documents.
    """
    user = db.scalar(select(User).where(User.id == user_id))
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Contributor not found.",
        )

    if current_user and current_user.id == user_id:
        stmt = select(Document).where(Document.user_id == user_id)
    else:
        stmt = select(Document).where(
            Document.user_id == user_id,
            Document.visibility == "public",
        )

    stmt = stmt.order_by(Document.created_at.desc())
    return db.scalars(stmt).all()


# =====================================================================
# Document Management Endpoints
# =====================================================================

@app.post("/documents", response_model=DocumentResponse, status_code=status.HTTP_201_CREATED)
def upload_document(
    title: str = Form(...),
    description: Optional[str] = Form(None),
    visibility: Literal["public", "private"] = Form("public"),
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Uploads, stores, and ingests a document (PDF or DOCX).
    Enforces authorization, path traversal protection, and safe rollback on error.
    """
    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No filename provided in uploaded file.",
        )

    _, ext = os.path.splitext(file.filename.lower())
    if ext not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file format '{ext}'. Only PDF (.pdf) and DOCX (.docx) files are supported.",
        )

    # Generate a unique, safe local filename to prevent path traversal
    safe_filename = f"{uuid4().hex}{ext}"
    saved_file_path = UPLOAD_DIR / safe_filename
    file_created = False

    if file.size and file.size > MAX_UPLOAD_SIZE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds maximum allowed size of {MAX_UPLOAD_SIZE_MB}MB.",
        )

    # 1. Save uploaded file contents to disk
    try:
        with open(saved_file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        file_created = True
        if saved_file_path.stat().st_size > MAX_UPLOAD_SIZE_BYTES:
            saved_file_path.unlink(missing_ok=True)
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"File exceeds maximum allowed size of {MAX_UPLOAD_SIZE_MB}MB.",
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to write uploaded file to disk: %s", e, exc_info=True)
        if file_created and saved_file_path.is_file():
            saved_file_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save uploaded file.",
        )

    # Check for re-upload of identical file content by the same user
    file_hash = compute_file_hash(str(saved_file_path))
    user_docs = db.scalars(
        select(Document).where(Document.user_id == current_user.id)
    ).all()
    for existing_doc in user_docs:
        if os.path.isfile(existing_doc.file_path):
            try:
                if (
                    existing_doc.title.strip().lower() == title.strip().lower()
                    and compute_file_hash(existing_doc.file_path) == file_hash
                ):
                    # Verify chunks actually exist in DB for this document
                    chunks_count = db.scalar(
                        select(func.count(DocumentChunk.id)).where(DocumentChunk.document_id == existing_doc.id)
                    ) or 0
                    if chunks_count > 0:
                        # Existing document with persisted chunks and embeddings found!
                        # Clean up the duplicate staged file from disk and reuse existing document
                        if file_created and saved_file_path.is_file():
                            saved_file_path.unlink(missing_ok=True)
                        return existing_doc
            except Exception as hash_err:
                logger.warning("Error checking file hash for doc %s: %s", existing_doc.id, hash_err)

    # 2. Stage Document record and ingest chunks atomically
    new_doc = Document(
        user_id=current_user.id,
        title=title.strip(),
        description=description.strip() if description else None,
        file_path=str(saved_file_path),
        file_type=ext.lstrip("."),
        visibility=visibility,
    )

    try:
        db.add(new_doc)
        db.flush()  # Populates new_doc.id within the active transaction

        # Ingest document text, chunking, embeddings, and chunk persistence
        ingest_document(
            file_path=str(saved_file_path),
            document_id=new_doc.id,
            user_id=current_user.id,
            db=db,
        )
        db.commit()
        db.refresh(new_doc)
    except Exception as e:
        logger.error("Document upload/ingestion failed: %s", e, exc_info=True)
        # Roll back transaction immediately so the session is restored to a clean state
        db.rollback()

        # If a Document row was already committed by a nested operation, clean it up safely
        doc_id = getattr(new_doc, "id", None)
        if doc_id:
            try:
                orphan_doc = db.scalar(select(Document).where(Document.id == doc_id))
                if orphan_doc:
                    db.delete(orphan_doc)
                    db.commit()
            except Exception:
                db.rollback()

        # Clean up the newly created file only without deleting files belonging to other documents
        if file_created and saved_file_path.is_file():
            try:
                referenced_by_other = db.scalar(
                    select(Document.id).where(
                        Document.file_path == str(saved_file_path),
                        Document.id != (doc_id or 0),
                    )
                )
            except Exception:
                db.rollback()
                referenced_by_other = None

            if not referenced_by_other:
                saved_file_path.unlink(missing_ok=True)

        if isinstance(e, HTTPException):
            raise e

        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Document processing failed. Please verify the document format and content.",
        )

    return new_doc


@app.get("/documents", response_model=List[DocumentResponse])
def list_documents(
    filter_by: Optional[Literal["mine", "public"]] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Lists documents accessible to the authenticated user:
    all public documents and the user's own private documents.
    """
    if filter_by == "mine":
        stmt = select(Document).where(Document.user_id == current_user.id)
    elif filter_by == "public":
        stmt = select(Document).where(Document.visibility == "public")
    else:
        stmt = select(Document).where(
            (Document.visibility == "public") | (Document.user_id == current_user.id)
        )

    stmt = stmt.order_by(Document.created_at.desc())
    return db.scalars(stmt).all()


@app.get("/documents/{document_id}", response_model=DocumentResponse)
def get_document(
    document_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Retrieves document metadata if the authenticated user has access."""
    doc = db.scalar(select(Document).where(Document.id == document_id))
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")

    if doc.visibility == "private" and doc.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not authorized to view this private document.",
        )

    return doc


@app.patch("/documents/{document_id}", response_model=DocumentResponse)
def update_document(
    document_id: int,
    update_data: DocumentUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Allows only the document owner to update metadata and visibility."""
    doc = db.scalar(select(Document).where(Document.id == document_id))
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")

    if doc.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the document owner can update this document.",
        )

    if update_data.title is not None:
        doc.title = update_data.title.strip()
    if update_data.description is not None:
        doc.description = update_data.description.strip()
    if update_data.visibility is not None:
        doc.visibility = update_data.visibility

    db.commit()
    db.refresh(doc)
    return doc


@app.delete("/documents/{document_id}", response_model=MessageResponse, status_code=status.HTTP_200_OK)
@app.delete("/api/documents/{document_id}", response_model=MessageResponse, status_code=status.HTTP_200_OK)
def delete_document(
    document_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Deletes a document and its associated data:
    - Requires authentication.
    - Verifies document exists.
    - Verifies authenticated user is the document owner.
    - Returns 404 for nonexistent or private inaccessible documents.
    - Prevents unauthorized deletion of other users' documents (403 for unauthorized).
    - Cascades deletion to DocumentChunk records and pgvector embeddings.
    - Cascades deletion to Comment records.
    - Cleans up the uploaded file from disk storage safely.
    """
    doc = db.scalar(select(Document).where(Document.id == document_id))
    if not doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found.",
        )

    if doc.user_id != current_user.id:
        if doc.visibility == "private":
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Document not found.",
            )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the document owner can delete this document.",
        )

    file_path_str = doc.file_path

    # Check if another document in the database references the same file path (deduplication safeguard)
    other_docs_count = db.scalar(
        select(func.count(Document.id)).where(
            Document.file_path == file_path_str,
            Document.id != doc.id,
        )
    ) or 0

    try:
        db.delete(doc)
        db.commit()
    except Exception as e:
        db.rollback()
        logger.error("Failed to delete document %s from database: %s", document_id, e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete document from database.",
        )

    # Safely remove uploaded file from storage if no other document references it
    if other_docs_count == 0 and file_path_str:
        try:
            if os.path.isfile(file_path_str):
                os.unlink(file_path_str)
        except OSError as e:
            logger.warning("Could not delete file %s from disk after document deletion: %s", file_path_str, e)

    return MessageResponse(
        message="Document deleted successfully.",
        id=document_id,
    )


@app.get("/documents/{document_id}/download")
def download_document(
    document_id: int,
    inline: bool = Query(False, description="Display inline in browser instead of forcing attachment download"),
    current_user: Optional[User] = Depends(get_optional_current_user),
    db: Session = Depends(get_db),
):
    """
    Downloads or renders the original document file if the user has access:
    - Public documents can be downloaded or viewed by any user.
    - Private documents require authentication and can only be accessed by their owner.
    - Supports inline=True for embedded browser PDF rendering.
    """
    doc = db.scalar(select(Document).where(Document.id == document_id))
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")

    if doc.visibility == "private":
        if current_user is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Not authenticated",
            )
        if doc.user_id != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You are not authorized to download this private document.",
            )

    if not os.path.isfile(doc.file_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document file was not found on the server storage.",
        )

    download_name = f"{doc.title}.{doc.file_type}"
    is_pdf = (doc.file_type or "").lower() == "pdf"
    media_type = "application/pdf" if is_pdf else "application/octet-stream"

    return FileResponse(
        path=doc.file_path,
        filename=download_name,
        media_type=media_type,
        content_disposition_type="inline" if inline else "attachment",
    )


# =====================================================================
# Comments Endpoints
# =====================================================================

@app.post("/documents/{document_id}/comments", response_model=CommentResponse, status_code=status.HTTP_201_CREATED)
def create_comment(
    document_id: int,
    comment_data: CommentCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Creates a comment on a document if the user is authorized to access it."""
    doc = db.scalar(select(Document).where(Document.id == document_id))
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")

    if doc.visibility == "private" and doc.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You cannot comment on a private document you do not own.",
        )

    new_comment = Comment(
        user_id=current_user.id,
        document_id=doc.id,
        content=comment_data.content.strip(),
    )
    db.add(new_comment)
    db.commit()
    db.refresh(new_comment)
    return new_comment


@app.get("/documents/{document_id}/comments", response_model=List[CommentResponse])
def get_comments(
    document_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Returns comments for a document if the user is authorized to access it."""
    doc = db.scalar(select(Document).where(Document.id == document_id))
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")

    if doc.visibility == "private" and doc.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You cannot view comments for a private document you do not own.",
        )

    stmt = select(Comment).where(Comment.document_id == document_id).order_by(Comment.created_at.asc())
    return db.scalars(stmt).all()


# =====================================================================
# Document Chat Endpoint (LangGraph RAG Workflow)
# =====================================================================

@app.post("/documents/{document_id}/chat", response_model=None)
def document_chat(
    document_id: int,
    chat_data: ChatRequest,
    stream: bool = Query(False, description="Enable Server-Sent Events (SSE) streaming"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Executes conversational question-answering over a document using LangGraph.
    Enforces server-side authorization: user can only chat with public documents
    or their own private documents.

    Supports Server-Sent Events (SSE) streaming when stream=true (query param or body).
    """
    doc = db.scalar(select(Document).where(Document.id == document_id))
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")

    if doc.visibility == "private" and doc.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not authorized to chat with this private document.",
        )

    question = chat_data.question.strip()
    if not question:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Question cannot be empty.",
        )

    is_streaming = stream or bool(chat_data.stream)

    # Real token streaming via Server-Sent Events (SSE)
    if is_streaming:
        retrieval_res = retrieve_documents(
            question=question,
            user_id=current_user.id,
            document_id=doc.id,
            db=db,
        )
        return StreamingResponse(
            stream_response(
                question=question,
                context=retrieval_res.get("documents", []),
                sources=retrieval_res.get("sources", []),
            ),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    # Standard Q&A through the compiled LangGraph workflow
    workflow_result = qa_workflow.invoke({
        "question": question,
        "user_id": current_user.id,
        "document_id": doc.id,
        "db": db,
    })

    raw_sources = workflow_result.get("sources", [])
    sources_response = [
        ChatSource(
            document_id=s.get("document_id", doc.id),
            document_title=s.get("document_title"),
            chunk_index=s.get("chunk_index"),
            page_number=s.get("page_number"),
        )
        for s in raw_sources
    ]

    return ChatResponse(
        answer=workflow_result.get("answer", ""),
        sources=sources_response,
    )


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("backend.app.main:app", host="0.0.0.0", port=port, reload=True)

