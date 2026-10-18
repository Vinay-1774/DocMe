"""
backend/app/storage.py
Modular storage manager supporting local disk storage and persistent Supabase Storage.
Ensures files survive container restarts and deployments on ephemeral cloud hosts (e.g., Render).
"""

import logging
import os
from pathlib import Path
from typing import Optional
from uuid import uuid4

import httpx
from fastapi import HTTPException, status
from fastapi.responses import FileResponse

from .config import (
    STORAGE_BACKEND,
    SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_STORAGE_BUCKET,
    SUPABASE_URL,
    UPLOAD_DIR,
)

logger = logging.getLogger(__name__)


class StorageManager:
    """
    Manages document file storage across local filesystem and cloud providers (Supabase Storage).
    - In local development or testing: uses local filesystem storage (UPLOAD_DIR).
    - In production (Render): integrates with Supabase Storage (private bucket) to persist original
      document files permanently across service restarts, redeployments, and container recreations.
    - Resolves files transparently from local cache or cloud storage without breaking existing records.
    """

    def __init__(
        self,
        upload_dir: Path = UPLOAD_DIR,
        supabase_url: Optional[str] = SUPABASE_URL,
        supabase_key: Optional[str] = SUPABASE_SERVICE_ROLE_KEY,
        bucket_name: str = SUPABASE_STORAGE_BUCKET,
        backend_mode: str = STORAGE_BACKEND,
    ):
        self.upload_dir = upload_dir
        self.supabase_url = supabase_url.rstrip("/") if supabase_url else None
        self.supabase_key = supabase_key
        self.bucket_name = bucket_name or "documents"
        self.backend_mode = (backend_mode or "auto").strip().lower()
        self._bucket_checked = False
        self.upload_dir.mkdir(parents=True, exist_ok=True)

    def is_supabase_storage_enabled(self) -> bool:
        """Returns True if Supabase Storage credentials are configured and not explicitly disabled."""
        if self.backend_mode == "local":
            return False
        return bool(self.supabase_url and self.supabase_key)

    def get_storage_key(self, file_path_or_key: str) -> str:
        """
        Extracts a clean, safe storage key or filename from a path or key.
        Guards against directory traversal attacks.
        """
        if not file_path_or_key:
            return ""
        # Extract filename component only to strip directories and traversal tokens
        basename = os.path.basename(str(file_path_or_key).replace("\\", "/"))
        # Sanitize against hidden traversal tokens
        clean_name = Path(basename).name.strip()
        return clean_name

    def ensure_bucket_exists(self) -> bool:
        """
        Verifies the Supabase storage bucket exists.
        If missing, creates it with private-by-default access (public=False).
        """
        if not self.is_supabase_storage_enabled():
            return False
        if self._bucket_checked:
            return True

        headers = {
            "Authorization": f"Bearer {self.supabase_key}",
            "apikey": self.supabase_key,
        }

        try:
            with httpx.Client(timeout=10.0) as client:
                bucket_url = f"{self.supabase_url}/storage/v1/bucket/{self.bucket_name}"
                res = client.get(bucket_url, headers=headers)
                if res.status_code == 200:
                    self._bucket_checked = True
                    return True

                if res.status_code == 404:
                    create_url = f"{self.supabase_url}/storage/v1/bucket"
                    create_res = client.post(
                        create_url,
                        json={"id": self.bucket_name, "name": self.bucket_name, "public": False},
                        headers={**headers, "Content-Type": "application/json"},
                    )
                    if create_res.status_code in (200, 201) or "already exists" in create_res.text.lower():
                        self._bucket_checked = True
                        logger.info("Created private Supabase Storage bucket '%s'.", self.bucket_name)
                        return True
                    logger.error("Failed to create Supabase bucket '%s': %s", self.bucket_name, create_res.text)
                    return False

                # If status is not 404, assume bucket exists or will be verified on operation
                self._bucket_checked = True
                return True
        except Exception as e:
            logger.warning("Could not verify Supabase bucket '%s': %s", self.bucket_name, e)
            return False

    def upload_to_supabase(self, storage_key: str, content: bytes, media_type: Optional[str] = None) -> bool:
        """Uploads file content to the private Supabase Storage bucket."""
        if not self.is_supabase_storage_enabled():
            return False

        self.ensure_bucket_exists()
        url = f"{self.supabase_url}/storage/v1/object/{self.bucket_name}/{storage_key}"
        headers = {
            "Authorization": f"Bearer {self.supabase_key}",
            "apikey": self.supabase_key,
            "Content-Type": media_type or "application/octet-stream",
            "x-upsert": "true",
        }

        try:
            with httpx.Client(timeout=45.0) as client:
                res = client.post(url, content=content, headers=headers)
                if res.status_code in (200, 201):
                    logger.info("Successfully uploaded object '%s' to Supabase Storage bucket '%s'.", storage_key, self.bucket_name)
                    return True
                logger.error("Failed to upload '%s' to Supabase Storage: HTTP %s: %s", storage_key, res.status_code, res.text)
                return False
        except Exception as e:
            logger.error("Exception during Supabase Storage upload for '%s': %s", storage_key, e, exc_info=True)
            return False

    def download_from_supabase(self, storage_key: str) -> Optional[bytes]:
        """
        Downloads file content from Supabase Storage bucket.
        Supports both private (authenticated) and public buckets.
        """
        if not self.is_supabase_storage_enabled():
            return None

        clean_key = self.get_storage_key(storage_key)
        if not clean_key:
            return None

        headers = {
            "Authorization": f"Bearer {self.supabase_key}",
            "apikey": self.supabase_key,
        }

        candidate_keys = [clean_key]
        if storage_key and storage_key != clean_key:
            candidate_keys.append(storage_key)

        try:
            with httpx.Client(timeout=45.0) as client:
                for key_to_try in candidate_keys:
                    # 1. Try authenticated endpoint (private bucket default)
                    auth_url = f"{self.supabase_url}/storage/v1/object/authenticated/{self.bucket_name}/{key_to_try}"
                    res = client.get(auth_url, headers=headers)
                    if res.status_code == 200:
                        return res.content

                    # 2. Try public endpoint (in case bucket was created as public in Supabase)
                    pub_url = f"{self.supabase_url}/storage/v1/object/public/{self.bucket_name}/{key_to_try}"
                    res_pub = client.get(pub_url, headers=headers)
                    if res_pub.status_code == 200:
                        return res_pub.content

                logger.warning("Object '%s' not found in Supabase Storage bucket '%s'.", clean_key, self.bucket_name)
                return None
        except Exception as e:
            logger.warning("Exception downloading '%s' from Supabase Storage: %s", clean_key, e)
            return None

    def delete_from_supabase(self, storage_key: str) -> bool:
        """Deletes an object from the Supabase Storage bucket."""
        if not self.is_supabase_storage_enabled():
            return False

        clean_key = self.get_storage_key(storage_key)
        if not clean_key:
            return False

        url = f"{self.supabase_url}/storage/v1/object/{self.bucket_name}"
        headers = {
            "Authorization": f"Bearer {self.supabase_key}",
            "apikey": self.supabase_key,
            "Content-Type": "application/json",
        }

        try:
            with httpx.Client(timeout=15.0) as client:
                res = client.request("DELETE", url, json={"prefixes": [clean_key]}, headers=headers)
                return res.status_code == 200
        except Exception as e:
            logger.warning("Failed to delete '%s' from Supabase Storage: %s", clean_key, e)
            return False

    def create_signed_url(self, file_path_or_key: str, expires_in: int = 60) -> Optional[str]:
        """
        Generates a short-lived signed URL for direct authorized access to a private document.
        Defaults to 60 seconds validity.
        """
        if not self.is_supabase_storage_enabled():
            return None

        clean_key = self.get_storage_key(file_path_or_key)
        if not clean_key:
            return None

        url = f"{self.supabase_url}/storage/v1/object/sign/{self.bucket_name}/{clean_key}"
        headers = {
            "Authorization": f"Bearer {self.supabase_key}",
            "apikey": self.supabase_key,
            "Content-Type": "application/json",
        }

        try:
            with httpx.Client(timeout=10.0) as client:
                res = client.post(url, json={"expiresIn": expires_in}, headers=headers)
                if res.status_code == 200:
                    data = res.json()
                    signed_path = data.get("signedURL")
                    if signed_path:
                        return f"{self.supabase_url}{signed_path}"
        except Exception as e:
            logger.warning("Failed to generate signed URL for '%s': %s", clean_key, e)
        return None

    def resolve_local_file_path(self, file_path_or_key: str) -> Optional[Path]:
        """
        Resolves a file to a valid Path on local disk.
        1. Checks direct filesystem path.
        2. Checks UPLOAD_DIR using the sanitized storage key.
        3. If missing from disk and Supabase Storage is configured, downloads and caches the file locally.
        Returns Path if found and accessible, or None.
        """
        if not file_path_or_key:
            return None

        # 1. Check direct path
        try:
            direct_path = Path(file_path_or_key)
            if direct_path.is_file():
                return direct_path
        except Exception:
            pass

        clean_key = self.get_storage_key(file_path_or_key)
        if not clean_key:
            return None

        # 2. Check UPLOAD_DIR
        local_cached_path = self.upload_dir / clean_key
        if local_cached_path.is_file():
            return local_cached_path

        # 3. Check Supabase Storage and cache locally
        if self.is_supabase_storage_enabled():
            remote_bytes = self.download_from_supabase(clean_key)
            if remote_bytes:
                try:
                    with open(local_cached_path, "wb") as f:
                        f.write(remote_bytes)
                    logger.info("Retrieved and locally cached '%s' from Supabase Storage.", clean_key)
                    return local_cached_path
                except Exception as cache_err:
                    logger.warning("Could not write local cache file '%s': %s", local_cached_path, cache_err)

        return None

    def delete_file(self, file_path_or_key: str) -> bool:
        """
        Safely deletes a file from both local storage cache and persistent Supabase Storage.
        """
        if not file_path_or_key:
            return False

        clean_key = self.get_storage_key(file_path_or_key)
        deleted = False

        # Remove local file if present
        try:
            p = Path(file_path_or_key)
            if p.is_file():
                p.unlink(missing_ok=True)
                deleted = True
        except Exception:
            pass

        if clean_key:
            cached_file = self.upload_dir / clean_key
            if cached_file.is_file():
                cached_file.unlink(missing_ok=True)
                deleted = True

            if self.is_supabase_storage_enabled():
                supabase_deleted = self.delete_from_supabase(clean_key)
                deleted = deleted or supabase_deleted

        return deleted

    def get_file_response(self, doc, inline: bool = False):
        """
        Streams or serves the requested document file:
        - Resolves local path or fetches from persistent Supabase Storage.
        - Sets correct filename, media type, and content disposition.
        - Supports inline rendering (PDF viewer) and attachment downloads.
        - Raises HTTP 404 if the document file cannot be found in server or cloud storage.
        """
        local_path = self.resolve_local_file_path(doc.file_path)
        if not local_path or not local_path.is_file():
            logger.error("Document ID %s (file_path: %s) not found in local or cloud storage.", doc.id, doc.file_path)
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Document file was not found on the server storage. This document may have been uploaded prior to persistent cloud storage setup. Please re-upload the document.",
            )

        download_name = f"{doc.title}.{doc.file_type}"
        is_pdf = (doc.file_type or "").lower() == "pdf"
        media_type = "application/pdf" if is_pdf else "application/octet-stream"

        return FileResponse(
            path=str(local_path),
            filename=download_name,
            media_type=media_type,
            content_disposition_type="inline" if inline else "attachment",
        )


# Global storage manager instance
storage_manager = StorageManager()
