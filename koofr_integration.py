import os
import urllib.request
import urllib.parse
import json
import base64
import logging
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)

KOOFR_USER = os.getenv("KOOFR_USER", "levdamaks15@gmail.com")
KOOFR_PASSWORD = os.getenv("KOOFR_PASSWORD", "o0qbqqpceb2spbu1")
KOOFR_WEBDAV_BASE = "https://app.koofr.net/dav/Koofr"
KOOFR_API_BASE = "https://app.koofr.net/api/v2"

_cached_mount_id = None


def get_auth_header() -> str:
    cred = f"{KOOFR_USER}:{KOOFR_PASSWORD}"
    return "Basic " + base64.b64encode(cred.encode("utf-8")).decode("ascii")


def get_primary_mount_id() -> str:
    global _cached_mount_id
    if _cached_mount_id:
        return _cached_mount_id
    try:
        url = f"{KOOFR_API_BASE}/mounts"
        req = urllib.request.Request(url, headers={"Authorization": get_auth_header(), "Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            for m in data.get("mounts", []):
                if m.get("isPrimary"):
                    _cached_mount_id = m.get("id")
                    return _cached_mount_id
            if data.get("mounts"):
                _cached_mount_id = data["mounts"][0].get("id")
                return _cached_mount_id
    except Exception as e:
        logger.error(f"Error fetching Koofr mounts: {e}")
    return "2dafc82b-d594-425e-8a7d-e0c805248856"


def ensure_directory(remote_dir: str):
    """Ensures nested directories exist in Koofr via WebDAV MKCOL."""
    clean_dir = remote_dir.strip("/")
    if not clean_dir:
        return
    parts = clean_dir.split("/")
    cur_path = ""
    for p in parts:
        cur_path += "/" + urllib.parse.quote(p)
        url = f"{KOOFR_WEBDAV_BASE}{cur_path}"
        req = urllib.request.Request(url, headers={"Authorization": get_auth_header()}, method="MKCOL")
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                pass
        except Exception:
            pass  # Directory likely exists


def upload_file_to_koofr(file_bytes: bytes, remote_path: str) -> bool:
    """Uploads file content to Koofr WebDAV."""
    try:
        clean_path = "/" + remote_path.lstrip("/")
        # Ensure parent folder exists
        parent_dir = os.path.dirname(clean_path)
        if parent_dir and parent_dir != "/":
            ensure_directory(parent_dir)

        url = f"{KOOFR_WEBDAV_BASE}{clean_path}"
        req = urllib.request.Request(
            url,
            data=file_bytes,
            headers={
                "Authorization": get_auth_header(),
                "Content-Type": "application/octet-stream"
            },
            method="PUT"
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status in [200, 201, 204]
    except Exception as e:
        logger.error(f"Koofr upload error for {remote_path}: {e}")
        return False


def download_file_from_koofr(remote_path: str) -> Optional[bytes]:
    """Downloads file content from Koofr WebDAV."""
    try:
        clean_path = "/" + remote_path.lstrip("/")
        url = f"{KOOFR_WEBDAV_BASE}{clean_path}"
        req = urllib.request.Request(url, headers={"Authorization": get_auth_header()})
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.read()
    except Exception as e:
        logger.error(f"Koofr download error for {remote_path}: {e}")
        return None


def delete_file_from_koofr(remote_path: str) -> bool:
    """Deletes file from Koofr WebDAV."""
    try:
        clean_path = "/" + remote_path.lstrip("/")
        url = f"{KOOFR_WEBDAV_BASE}{clean_path}"
        req = urllib.request.Request(url, headers={"Authorization": get_auth_header()}, method="DELETE")
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status in [200, 204]
    except Exception as e:
        logger.error(f"Koofr delete error for {remote_path}: {e}")
        return False


def create_share_link(remote_path: str) -> Optional[str]:
    """Creates a public sharing link for a file in Koofr."""
    try:
        mount_id = get_primary_mount_id()
        clean_path = "/" + remote_path.lstrip("/")
        url = f"{KOOFR_API_BASE}/mounts/{mount_id}/links"
        payload = json.dumps({"path": clean_path}).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=payload,
            headers={
                "Authorization": get_auth_header(),
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data.get("url") or data.get("shortUrl")
    except Exception as e:
        logger.error(f"Koofr share link error for {remote_path}: {e}")
        return None
