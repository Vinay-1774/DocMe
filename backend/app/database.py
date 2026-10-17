import logging
from typing import Generator
from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import DATABASE_URL, DB_MAX_OVERFLOW, DB_POOL_RECYCLE, DB_POOL_SIZE

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


def sync_db_sequences(bind_engine=None) -> list[dict]:
    """
    Inspects all tables in the public schema with auto-incrementing sequences.
    Synchronizes out-of-sync sequences to MAX(id) so future inserts generate unique IDs.
    Safe and idempotent; does not delete, alter data, or reset in-sync sequences.
    """
    target_engine = bind_engine or engine
    if target_engine.dialect.name != "postgresql":
        return []

    results = []
    seq_discovery_sql = text("""
        SELECT c.relname AS table_name, a.attname AS column_name, s.relname AS sequence_name
        FROM pg_class s
        JOIN pg_depend d ON d.objid = s.oid AND d.classid = 'pg_class'::regclass AND d.refclassid = 'pg_class'::regclass
        JOIN pg_class c ON c.oid = d.refobjid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = d.refobjsubid
        WHERE s.relkind = 'S' AND n.nspname = 'public';
    """)

    with target_engine.connect() as conn:
        try:
            seq_records = conn.execute(seq_discovery_sql).fetchall()
        except Exception as e:
            logger.warning("Could not query pg_class sequences: %s", e)
            seq_records = []

        if not seq_records:
            app_tables = [
                ("users", "id"),
                ("documents", "id"),
                ("document_chunks", "id"),
                ("comments", "id"),
                ("otp_challenges", "id"),
            ]
            for t_name, c_name in app_tables:
                try:
                    s_name = conn.execute(text(f"SELECT pg_get_serial_sequence('public.{t_name}', '{c_name}');")).scalar()
                    if s_name:
                        clean_seq = s_name.split(".")[-1]
                        seq_records.append((t_name, c_name, clean_seq))
                except Exception:
                    pass

        for table_name, col_name, seq_name in seq_records:
            try:
                max_val = conn.execute(text(f"SELECT MAX({col_name}) FROM public.{table_name};")).scalar()
                seq_info = conn.execute(text(f"SELECT last_value, is_called FROM {seq_name};")).fetchone()
                if not seq_info:
                    continue
                last_val, is_called = seq_info
                next_val = (last_val + 1) if is_called else last_val

                # If the sequence's next value would collide with an existing row, synchronize it
                if max_val is not None and next_val <= max_val:
                    logger.warning(
                        "Sequence '%s' on public.%s.%s is out of sync (MAX=%s, next_val=%s). Synchronizing...",
                        seq_name, table_name, col_name, max_val, next_val,
                    )
                    conn.execute(
                        text(f"SELECT setval('{seq_name}', :max_val, true);"),
                        {"max_val": max_val},
                    )
                    conn.commit()
                    results.append({
                        "table": table_name,
                        "column": col_name,
                        "sequence": seq_name,
                        "previous_next": next_val,
                        "synchronized_to": max_val,
                        "status": "synchronized",
                    })
                else:
                    results.append({
                        "table": table_name,
                        "column": col_name,
                        "sequence": seq_name,
                        "max_id": max_val,
                        "next_val": next_val,
                        "status": "in_sync",
                    })
            except Exception as exc:
                logger.warning("Error inspecting sequence '%s' for table '%s': %s", seq_name, table_name, exc)

    return results


def init_db() -> None:
    """
    Initializes the database schema by enabling pgvector and creating missing tables.
    Safe to run repeatedly; does not destroy existing data.
    """
    # Import all models so that Base.metadata is fully populated
    from . import models  # noqa: F401

    with engine.connect() as conn:
        try:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector;"))
            conn.commit()
        except Exception as e:
            logger.warning("CREATE EXTENSION IF NOT EXISTS vector skipped or non-fatal: %s", e)

    Base.metadata.create_all(bind=engine)

    # Ensure is_verified exists on existing users table without requiring Alembic
    with engine.connect() as conn:
        try:
            conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT TRUE;"))
            conn.commit()
        except Exception as e:
            logger.warning("ALTER TABLE users ADD COLUMN is_verified non-fatal: %s", e)

    # Synchronize primary key sequences with existing table data
    sync_db_sequences(bind_engine=engine)



if __name__ == "__main__":
    init_db()
    print("Database initialized and sequences synchronized successfully!")

