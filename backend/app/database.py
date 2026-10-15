import logging
from typing import Generator
from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from backend.app.config import DATABASE_URL, DB_MAX_OVERFLOW, DB_POOL_RECYCLE, DB_POOL_SIZE

logger = logging.getLogger(__name__)


# Create the SQLAlchemy engine with production connection pool settings
engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_size=DB_POOL_SIZE,
    max_overflow=DB_MAX_OVERFLOW,
    pool_recycle=DB_POOL_RECYCLE,
)

# Session factory for creating database sessions
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
)


# Declarative base class for defining database models
class Base(DeclarativeBase):
    pass


# Reusable database session dependency for FastAPI routes
def get_db() -> Generator[Session, None, None]:
    """Provides a transactional database session scoped to a single request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """
    Initializes the database schema by enabling pgvector and creating missing tables.
    Safe to run repeatedly; does not destroy existing data.
    """
    # Import all models so that Base.metadata is fully populated
    from backend.app import models  # noqa: F401

    with engine.connect() as conn:
        try:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector;"))
            conn.commit()
        except Exception as e:
            logger.warning("CREATE EXTENSION IF NOT EXISTS vector skipped or non-fatal: %s", e)

    Base.metadata.create_all(bind=engine)


if __name__ == "__main__":
    init_db()
    print("Database initialized successfully!")
