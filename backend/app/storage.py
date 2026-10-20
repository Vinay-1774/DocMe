"""
backend/app/storage.py
Modular storage manager supporting local disk storage and persistent Supabase Storage.
Ensures files survive container restarts and deployments on ephemeral cloud hosts (e.g., Render).
"""

import logging
import os
from pathlib import Path
from typing import Optional

import httpx
from fastapi import HTTPException, status
from fastapi.responses import FileResponse, Response

from .config import (
    IS_PRODUCTION,
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
        self._last_status_code: Optional[int] = None
        self._last_error: Optional[str] = None
        self.upload_dir.mkdir(parents=True, exist_ok=True)

    def is_supabase_storage_enabled(self) -> bool:
        """Returns True if Supabase Storage credentials are configured and not explicitly disabled."""
        if self.backend_mode == "local":
            return False
        url = self.supabase_url or os.getenv("SUPABASE_URL")
        key = (
            self.supabase_key
            or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
            or os.getenv("SUPABASE_SERVICE_KEY")
            or os.getenv("SUPABASE_KEY")
            or os.getenv("SUPABASE_SECRET_KEY")
        )
        return bool(url and key)

    def is_production_mode(self) -> bool:
        """
        Determines whether the application is running in a production or ephemeral environment
        (e.g., Render, Kubernetes, or explicit ENVIRONMENT=production).
        """
        if self.backend_mode == "supabase":
            return True
        env = (os.getenv("ENVIRONMENT") or "").strip().lower()
        if env == "production":
            return True
        render = (os.getenv("RENDER") or os.getenv("IS_RENDER") or "").strip().lower()
        if render in ("true", "1", "yes"):
            return True
        return bool(IS_PRODUCTION)

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

        key = (
            self.supabase_key
            or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
            or os.getenv("SUPABASE_SERVICE_KEY")
            or os.getenv("SUPABASE_KEY")
            or os.getenv("SUPABASE_SECRET_KEY")
        )
        url = (self.supabase_url or os.getenv("SUPABASE_URL", "")).rstrip("/")
        headers = {
            "Authorization": f"Bearer {key}",
            "apikey": key,
        }

        try:
            with httpx.Client(timeout=10.0) as client:
                bucket_url = f"{url}/storage/v1/bucket/{self.bucket_name}"
                res = client.get(bucket_url, headers=headers)
                if res.status_code == 200:
                    self._bucket_checked = True
                    return True

                if res.status_code in (404, 400) and ("not found" in res.text.lower() or res.status_code == 404):
                    create_url = f"{url}/storage/v1/bucket"
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

                # If status is not 404/400, assume bucket exists or will be verified on operation
                self._bucket_checked = True
                return True
        except Exception as e:
            logger.warning("Could not verify Supabase bucket '%s': %s", self.bucket_name, e)
            return False

    def upload_to_supabase(self, storage_key: str, content: bytes, media_type: Optional[str] = None) -> bool:
        """Uploads file content to the private Supabase Storage bucket."""
        if not self.is_supabase_storage_enabled():
            return False

        clean_key = self.get_storage_key(storage_key)
        if not clean_key:
            logger.error("Cannot upload to Supabase Storage: invalid or empty storage key.")
            return False

        self.ensure_bucket_exists()
        key = (
            self.supabase_key
            or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
            or os.getenv("SUPABASE_SERVICE_KEY")
            or os.getenv("SUPABASE_KEY")
            or os.getenv("SUPABASE_SECRET_KEY")
        )
        url = (self.supabase_url or os.getenv("SUPABASE_URL", "")).rstrip("/")
        obj_url = f"{url}/storage/v1/object/{self.bucket_name}/{clean_key}"
        headers = {
            "Authorization": f"Bearer {key}",
            "apikey": key,
            "Content-Type": media_type or "application/octet-stream",
            "x-upsert": "true",
        }

        try:
            with httpx.Client(timeout=45.0) as client:
                res = client.post(obj_url, content=content, headers=headers)
                if res.status_code in (200, 201):
                    logger.info("Successfully uploaded object '%s' to Supabase Storage bucket '%s'.", clean_key, self.bucket_name)
                    self._last_status_code = res.status_code
                    return True

                # If POST fails with 400/409 duplicate, attempt PUT for upsert compatibility
                if res.status_code in (400, 409):
                    put_res = client.put(obj_url, content=content, headers=headers)
                    if put_res.status_code in (200, 201):
                        logger.info("Successfully upserted object '%s' to Supabase Storage via PUT.", clean_key)
                        self._last_status_code = put_res.status_code
                        return True

                self._last_status_code = res.status_code
                self._last_error = res.text
                if res.status_code in (401, 403):
                    logger.critical("Supabase Storage permission failure for object '%s': HTTP %s: %s", clean_key, res.status_code, res.text)
                else:
                    logger.error("Failed to upload '%s' to Supabase Storage: HTTP %s: %s", clean_key, res.status_code, res.text)
                return False
        except httpx.TimeoutException as exc:
            self._last_status_code = 504
            self._last_error = str(exc)
            logger.error("Timeout uploading '%s' to Supabase Storage: %s", clean_key, exc)
            return False
        except Exception as e:
            self._last_status_code = 500
            self._last_error = str(e)
            logger.error("Exception during Supabase Storage upload for '%s': %s", clean_key, e, exc_info=True)
            return False

    def download_from_supabase(self, storage_key: str) -> Optional[bytes]:
        """
        Downloads file content from Supabase Storage bucket.
        Supports private (authenticated), direct object, signed URL, and public endpoints.
        """
        if not self.is_supabase_storage_enabled():
            return None

        clean_key = self.get_storage_key(storage_key)
        if not clean_key:
            return None

        key = (
            self.supabase_key
            or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
            or os.getenv("SUPABASE_SERVICE_KEY")
            or os.getenv("SUPABASE_KEY")
            or os.getenv("SUPABASE_SECRET_KEY")
        )
        url = (self.supabase_url or os.getenv("SUPABASE_URL", "")).rstrip("/")
        headers = {
            "Authorization": f"Bearer {key}",
            "apikey": key,
        }

        candidate_keys = [clean_key]
        if storage_key and storage_key != clean_key:
            candidate_keys.append(storage_key)

        last_code = 404
        try:
            with httpx.Client(timeout=45.0) as client:
                for key_to_try in candidate_keys:
                    # 1. Try authenticated endpoint (private bucket default)
                    auth_url = f"{url}/storage/v1/object/authenticated/{self.bucket_name}/{key_to_try}"
                    res = client.get(auth_url, headers=headers)
                    if res.status_code == 200 and res.content:
                        self._last_status_code = 200
                        return res.content
                    last_code = res.status_code

                    # 2. Try direct object endpoint
                    obj_url = f"{url}/storage/v1/object/{self.bucket_name}/{key_to_try}"
                    res_obj = client.get(obj_url, headers=headers)
                    if res_obj.status_code == 200 and res_obj.content:
                        self._last_status_code = 200
                        return res_obj.content

                    # 3. Try signed URL fallback
                    signed_url = self.create_signed_url(key_to_try, expires_in=120)
                    if signed_url:
                        res_signed = client.get(signed_url)
                        if res_signed.status_code == 200 and res_signed.content:
                            self._last_status_code = 200
                            return res_signed.content

                    # 4. Try public endpoint (in case bucket was created as public in Supabase)
                    pub_url = f"{url}/storage/v1/object/public/{self.bucket_name}/{key_to_try}"
                    res_pub = client.get(pub_url, headers=headers)
                    if res_pub.status_code == 200 and res_pub.content:
                        self._last_status_code = 200
                        return res_pub.content

                self._last_status_code = last_code
                if last_code in (401, 403):
                    logger.critical("Supabase Storage permission failure for object '%s' in bucket '%s': HTTP %s", clean_key, self.bucket_name, last_code)
                elif last_code == 404:
                    logger.warning("Object '%s' not found in Supabase Storage bucket '%s'.", clean_key, self.bucket_name)
                else:
                    logger.warning("Failed to download object '%s' from Supabase Storage: HTTP %s", clean_key, last_code)
                return None
        except httpx.TimeoutException as exc:
            self._last_status_code = 504
            self._last_error = str(exc)
            logger.error("Timeout downloading '%s' from Supabase Storage: %s", clean_key, exc)
            return None
        except Exception as e:
            self._last_status_code = 500
            self._last_error = str(e)
            logger.warning("Exception downloading '%s' from Supabase Storage: %s", clean_key, e)
            return None

    def delete_from_supabase(self, storage_key: str) -> bool:
        """Deletes an object from the Supabase Storage bucket."""
        if not self.is_supabase_storage_enabled():
            return False

        clean_key = self.get_storage_key(storage_key)
        if not clean_key:
            return False

        key = (
            self.supabase_key
            or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
            or os.getenv("SUPABASE_SERVICE_KEY")
            or os.getenv("SUPABASE_KEY")
            or os.getenv("SUPABASE_SECRET_KEY")
        )
        url = (self.supabase_url or os.getenv("SUPABASE_URL", "")).rstrip("/")
        del_url = f"{url}/storage/v1/object/{self.bucket_name}"
        headers = {
            "Authorization": f"Bearer {key}",
            "apikey": key,
            "Content-Type": "application/json",
        }

        try:
            with httpx.Client(timeout=15.0) as client:
                res = client.request("DELETE", del_url, json={"prefixes": [clean_key]}, headers=headers)
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

        key = (
            self.supabase_key
            or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
            or os.getenv("SUPABASE_SERVICE_KEY")
            or os.getenv("SUPABASE_KEY")
            or os.getenv("SUPABASE_SECRET_KEY")
        )
        url = (self.supabase_url or os.getenv("SUPABASE_URL", "")).rstrip("/")
        sign_url = f"{url}/storage/v1/object/sign/{self.bucket_name}/{clean_key}"
        headers = {
            "Authorization": f"Bearer {key}",
            "apikey": key,
            "Content-Type": "application/json",
        }

        try:
            with httpx.Client(timeout=10.0) as client:
                res = client.post(sign_url, json={"expiresIn": expires_in}, headers=headers)
                if res.status_code == 200:
                    data = res.json()
                    signed_path = data.get("signedURL")
                    if signed_path:
                        if signed_path.startswith("http://") or signed_path.startswith("https://"):
                            return signed_path
                        return f"{url}{signed_path}"
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
                    self.upload_dir.mkdir(parents=True, exist_ok=True)
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
        - Distinguishes missing objects, timeouts, and permission errors with safe, specific status codes.
        """
        download_name = f"{doc.title}.{doc.file_type}"
        is_pdf = (doc.file_type or "").lower() == "pdf"
        media_type = "application/pdf" if is_pdf else "application/octet-stream"
        disposition_type = "inline" if inline else "attachment"

        # 1. Try local resolution (disk or local cache)
        local_path = self.resolve_local_file_path(doc.file_path)
        if local_path and local_path.is_file():
            return FileResponse(
                path=str(local_path),
                filename=download_name,
                media_type=media_type,
                content_disposition_type=disposition_type,
            )

        clean_key = self.get_storage_key(doc.file_path)
        if not clean_key:
            logger.error("Document ID %s has invalid/empty storage key: '%s'", doc.id, doc.file_path)
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Invalid document storage reference. Please re-upload the document.",
            )

        # 2. If not on local disk and Supabase is enabled, attempt direct cloud download
        if self.is_supabase_storage_enabled():
            remote_bytes = self.download_from_supabase(clean_key)
            if remote_bytes:
                # Try writing cache for next request
                try:
                    self.upload_dir.mkdir(parents=True, exist_ok=True)
                    cached_file = self.upload_dir / clean_key
                    with open(cached_file, "wb") as f:
                        f.write(remote_bytes)
                    return FileResponse(
                        path=str(cached_file),
                        filename=download_name,
                        media_type=media_type,
                        content_disposition_type=disposition_type,
                    )
                except Exception as write_err:
                    logger.warning("Could not write cache file '%s' (serving bytes directly): %s", clean_key, write_err)

                # Serve bytes directly if caching failed
                return Response(
                    content=remote_bytes,
                    media_type=media_type,
                    headers={
                        "Content-Disposition": f'{disposition_type}; filename="{download_name}"',
                    },
                )

            # Cloud fetch failed — inspect status code for clear, safe user-facing message
            last_code = getattr(self, "_last_status_code", None)
            if last_code == 504:
                logger.error("Supabase Storage timeout retrieving document %s (key: %s)", doc.id, clean_key)
                raise HTTPException(
                    status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                    detail="Cloud storage request timed out. Please try again shortly.",
                )
            if last_code in (401, 403):
                logger.critical("Supabase Storage permission failure for document %s (key: %s)", doc.id, clean_key)
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail="Storage service authorization failure. Please contact administrator.",
                )
            if last_code in (500, 502, 503):
                logger.error("Supabase Storage temporary error (HTTP %s) for document %s (key: %s)", last_code, doc.id, clean_key)
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Cloud storage service temporarily unavailable. Please try again shortly.",
                )

        logger.error("Document ID %s (file_path: %s, key: %s) not found in local or cloud storage.", doc.id, doc.file_path, clean_key)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document file was not found on the server storage. This document may have been uploaded prior to persistent cloud storage setup. Please re-upload the document.",
        )


# Global storage manager instance
storage_manager = StorageManager()
