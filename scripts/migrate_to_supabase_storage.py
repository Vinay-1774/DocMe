"""
scripts/migrate_to_supabase_storage.py
Utility script to migrate existing local uploaded document files to Supabase Storage.
Useful when transitioning from local/ephemeral disk storage to persistent Supabase Storage,
or when recovering missing files after a deployment.
"""

import logging
import os
import sys
from pathlib import Path

# Add project root to sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from sqlalchemy import select
from backend.app.database import SessionLocal
from backend.app.models import Document
from backend.app.storage import storage_manager
from backend.app.config import UPLOAD_DIR

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("storage_migrator")


def migrate_documents_to_supabase():
    if not storage_manager.is_supabase_storage_enabled():
        logger.error(
            "Supabase Storage is not configured. "
            "Please ensure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in your environment or .env"
        )
        sys.exit(1)

    logger.info("Connecting to database...")
    db = SessionLocal()
    try:
        docs = db.scalars(select(Document).order_by(Document.id.asc())).all()
        logger.info("Found %d total document records in database.", len(docs))

        migrated_count = 0
        already_present_count = 0
        missing_count = 0

        for doc in docs:
            storage_key = storage_manager.get_storage_key(doc.file_path)
            if not storage_key:
                logger.warning("Doc #%d has empty or invalid file_path: '%s'", doc.id, doc.file_path)
                missing_count += 1
                continue

            # 1. Check if already in Supabase Storage
            remote_bytes = storage_manager.download_from_supabase(storage_key)
            if remote_bytes:
                logger.info("Doc #%d ('%s') already present in Supabase Storage (key: %s).", doc.id, doc.title, storage_key)
                already_present_count += 1
                continue

            # 2. Check local disk
            local_path = None
            candidate_paths = [
                Path(doc.file_path),
                UPLOAD_DIR / storage_key,
                PROJECT_ROOT / "backend" / "uploads" / storage_key,
            ]
            for p in candidate_paths:
                try:
                    if p.is_file():
                        local_path = p
                        break
                except Exception:
                    pass

            if local_path and local_path.is_file():
                logger.info("Uploading Doc #%d ('%s') from local file %s to Supabase Storage...", doc.id, doc.title, local_path)
                with open(local_path, "rb") as f:
                    content = f.read()

                is_pdf = (doc.file_type or "").lower() == "pdf"
                media_type = "application/pdf" if is_pdf else "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

                success = storage_manager.upload_to_supabase(storage_key, content, media_type)
                if success:
                    migrated_count += 1
                    logger.info("Successfully migrated Doc #%d to Supabase Storage.", doc.id)
                else:
                    logger.error("Failed to upload Doc #%d to Supabase Storage.", doc.id)
            else:
                logger.warning(
                    "Doc #%d ('%s') file was NOT found on local disk (path: %s). "
                    "This document was likely uploaded prior to cloud storage configuration and its ephemeral container file was lost. "
                    "Please re-upload this document.",
                    doc.id,
                    doc.title,
                    doc.file_path,
                )
                missing_count += 1

        logger.info("\n=== Migration Summary ===")
        logger.info("Total documents: %d", len(docs))
        logger.info("Newly uploaded to Supabase Storage: %d", migrated_count)
        logger.info("Already in Supabase Storage: %d", already_present_count)
        logger.info("Missing files requiring re-upload: %d", missing_count)

    finally:
        db.close()


if __name__ == "__main__":
    migrate_documents_to_supabase()
