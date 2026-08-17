import os
import urllib.request
import json
import uuid
import logging
from typing import Optional

logger = logging.getLogger(__name__)

DOCSPACE_URL = os.getenv("ONLYOFFICE_DOCSPACE_URL", "https://docspace-edxqm0.onlyoffice.com").rstrip("/")
DOCSPACE_API_KEY = os.getenv("ONLYOFFICE_API_KEY", "sk-e606e9a780644a3c3d237df4ee38562bf80f65ba9330cd6032607a3efa9fae38")


def get_headers(content_type: Optional[str] = None) -> dict:
    headers = {
        "Authorization": f"Bearer {DOCSPACE_API_KEY}",
        "Accept": "application/json"
    }
    if content_type:
        headers["Content-Type"] = content_type
    return headers


def upload_file_to_docspace(file_bytes: bytes, filename: str, folder_id: str = "@my") -> Optional[int]:
    """Uploads a file to DocSpace and returns the internal DocSpace file ID."""
    try:
        url = f"{DOCSPACE_URL}/api/2.0/files/{folder_id}/upload"
        boundary = "----WebKitFormBoundary" + uuid.uuid4().hex
        
        # Clean filename
        clean_name = filename.replace('"', '').replace("'", "")
        
        body = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="{clean_name}"\r\n'
            f"Content-Type: application/octet-stream\r\n\r\n"
        ).encode("utf-8") + file_bytes + f"\r\n--{boundary}--\r\n".encode("utf-8")
        
        req = urllib.request.Request(
            url,
            data=body,
            headers={
                "Authorization": f"Bearer {DOCSPACE_API_KEY}",
                "Content-Type": f"multipart/form-data; boundary={boundary}",
                "Accept": "application/json"
            },
            method="POST"
        )
        
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            res = data.get("response")
            if isinstance(res, list) and len(res) > 0:
                return res[0].get("id")
            elif isinstance(res, dict):
                return res.get("id")
    except Exception as e:
        logger.error(f"DocSpace upload error for {filename}: {e}")
    return None


def download_file_from_docspace(file_id: int) -> Optional[bytes]:
    """Downloads the latest content of a file from DocSpace."""
    try:
        url = f"{DOCSPACE_URL}/filehandler.ashx?action=download&fileid={file_id}"
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {DOCSPACE_API_KEY}"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.read()
    except Exception as e:
        logger.error(f"DocSpace download error for file_id {file_id}: {e}")
    return None


def check_file_in_docspace(file_id: int) -> bool:
    """Checks if the file exists and is accessible in DocSpace."""
    try:
        url = f"{DOCSPACE_URL}/api/2.0/files/file/{file_id}"
        req = urllib.request.Request(url, headers=get_headers())
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status == 200
    except Exception:
        return False
