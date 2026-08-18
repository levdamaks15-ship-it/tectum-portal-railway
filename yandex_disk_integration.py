import os
import logging
import requests
from typing import Optional, Dict, Any
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

YANDEX_DISK_TOKEN = os.getenv("YANDEX_DISK_TOKEN", "y0__wgBEIGRpnoYks5HIKWg89kYrmCsNa8ekPCH_x31jEz56HvLPsU")
API_BASE = "https://cloud-api.yandex.net/v1/disk"

def _get_headers() -> Dict[str, str]:
    return {
        "Authorization": f"OAuth {YANDEX_DISK_TOKEN}",
        "Accept": "application/json"
    }

def ensure_yandex_folder(remote_path: str) -> bool:
    """Recursively ensures a folder path exists in Yandex Disk (e.g. 'disk:/Tectum/Folder_1')"""
    if not YANDEX_DISK_TOKEN:
        return False
    
    clean_path = remote_path.replace("\\", "/")
    if clean_path.startswith("disk:"):
        clean_path = clean_path[5:]
    
    parts = [p for p in clean_path.split("/") if p]
    cur = ""
    for part in parts:
        cur += f"/{part}"
        url = f"{API_BASE}/resources?path={cur}"
        try:
            res = requests.put(url, headers=_get_headers(), timeout=10)
            if res.status_code in [201, 409]: # 201 Created, 409 Already exists
                pass
            else:
                logger.warning(f"Create folder {cur} status: {res.status_code} {res.text}")
        except Exception as e:
            logger.error(f"Error creating Yandex folder {cur}: {e}")
            return False
    return True

def upload_file_to_yandex_disk(file_bytes: bytes, remote_path: str) -> Optional[str]:
    """
    Uploads file to Yandex Disk, publishes it, and returns the direct web edit/view URL.
    """
    if not YANDEX_DISK_TOKEN:
        return None

    clean_path = remote_path.replace("\\", "/")
    if not clean_path.startswith("disk:"):
        if not clean_path.startswith("/"):
            clean_path = "/" + clean_path
        clean_path = f"disk:{clean_path}"

    # Ensure parent dir
    parent_dir = "/".join(clean_path.split("/")[:-1])
    ensure_yandex_folder(parent_dir)

    try:
        # 1. Get upload URL
        upload_url_endpoint = f"{API_BASE}/resources/upload?path={clean_path}&overwrite=true"
        res = requests.get(upload_url_endpoint, headers=_get_headers(), timeout=10)
        if res.status_code != 200:
            logger.error(f"Failed to get Yandex upload URL for {clean_path}: {res.status_code} {res.text}")
            return None
        
        href = res.json().get("href")
        if not href:
            return None

        # 2. Upload binary
        put_res = requests.put(href, data=file_bytes, timeout=60)
        if put_res.status_code not in [201, 202, 200]:
            logger.error(f"Failed to upload binary to Yandex for {clean_path}: {put_res.status_code}")
            return None

        # 3. Publish file to get public URL with built-in online editor
        pub_url = f"{API_BASE}/resources/publish?path={clean_path}"
        requests.put(pub_url, headers=_get_headers(), timeout=10)

        # 4. Get metadata for public_url
        meta_url = f"{API_BASE}/resources?path={clean_path}"
        meta_res = requests.get(meta_url, headers=_get_headers(), timeout=10)
        if meta_res.status_code == 200:
            meta = meta_res.json()
            public_url = meta.get("public_url")
            logger.info(f"Successfully uploaded to Yandex Disk: {clean_path} -> {public_url}")
            return public_url

        return None
    except Exception as e:
        logger.error(f"Error in upload_file_to_yandex_disk: {e}")
        return None

def download_file_from_yandex_disk(remote_path: str) -> Optional[bytes]:
    """Downloads binary file from Yandex Disk"""
    if not YANDEX_DISK_TOKEN:
        return None

    clean_path = remote_path.replace("\\", "/")
    if not clean_path.startswith("disk:"):
        if not clean_path.startswith("/"):
            clean_path = "/" + clean_path
        clean_path = f"disk:{clean_path}"

    try:
        url = f"{API_BASE}/resources/download?path={clean_path}"
        res = requests.get(url, headers=_get_headers(), timeout=10)
        if res.status_code != 200:
            return None
        
        href = res.json().get("href")
        if not href:
            return None

        down_res = requests.get(href, timeout=60)
        if down_res.status_code == 200:
            return down_res.content
        return None
    except Exception as e:
        logger.error(f"Error downloading from Yandex Disk: {e}")
        return None

def delete_file_from_yandex_disk(remote_path: str) -> bool:
    """Deletes resource from Yandex Disk"""
    if not YANDEX_DISK_TOKEN:
        return False

    clean_path = remote_path.replace("\\", "/")
    if not clean_path.startswith("disk:"):
        if not clean_path.startswith("/"):
            clean_path = "/" + clean_path
        clean_path = f"disk:{clean_path}"

    try:
        url = f"{API_BASE}/resources?path={clean_path}&permanently=true"
        res = requests.delete(url, headers=_get_headers(), timeout=10)
        return res.status_code in [200, 202, 204]
    except Exception as e:
        logger.error(f"Error deleting from Yandex Disk: {e}")
        return False
