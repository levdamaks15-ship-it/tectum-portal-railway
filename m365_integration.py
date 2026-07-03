import os
import msal
import requests
from dotenv import load_dotenv

load_dotenv()

TENANT_ID = os.getenv("M365_TENANT_ID")
CLIENT_ID = os.getenv("M365_DAEMON_CLIENT_ID") or os.getenv("M365_CLIENT_ID")
CLIENT_SECRET = os.getenv("M365_DAEMON_CLIENT_SECRET") or os.getenv("M365_CLIENT_SECRET")
SHAREPOINT_SITE_URL = os.getenv("M365_SHAREPOINT_SITE_URL")

AUTHORITY = f"https://login.microsoftonline.com/{TENANT_ID}"
SCOPE = ["https://graph.microsoft.com/.default"]

def get_access_token():
    app = msal.ConfidentialClientApplication(
        CLIENT_ID, authority=AUTHORITY, client_credential=CLIENT_SECRET
    )
    result = app.acquire_token_silent(SCOPE, account=None)
    if not result:
        result = app.acquire_token_for_client(scopes=SCOPE)
    
    if "access_token" in result:
        return result["access_token"]
    else:
        raise Exception(f"Не удалось получить токен: {result.get('error_description')}")

def get_site_id(access_token):
    # Extracts hostname and path from site URL, e.g. https://company.sharepoint.com/sites/MySite
    # URL format for Graph API: hostname:/sites/MySite
    if not SHAREPOINT_SITE_URL:
        raise ValueError("M365_SHAREPOINT_SITE_URL не задан в .env")
        
    parts = SHAREPOINT_SITE_URL.replace("https://", "").split("/")
    hostname = parts[0]
    site_path = "/" + "/".join(parts[1:])
    
    headers = {"Authorization": f"Bearer {access_token}"}
    resp = requests.get(f"https://graph.microsoft.com/v1.0/sites/{hostname}:{site_path}", headers=headers)
    resp.raise_for_status()
    return resp.json()["id"]

def get_drive_id(access_token, site_id):
    headers = {"Authorization": f"Bearer {access_token}"}
    resp = requests.get(f"https://graph.microsoft.com/v1.0/sites/{site_id}/drive", headers=headers)
    resp.raise_for_status()
    return resp.json()["id"]

def upload_file_to_sharepoint(file_bytes: bytes, filename: str, folder: str = "Downtimes") -> str:
    access_token = get_access_token()
    site_id = get_site_id(access_token)
    drive_id = get_drive_id(access_token, site_id)
    
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/octet-stream"
    }
    
    import datetime
    now = datetime.datetime.now()
    if folder == "Shifts_Passport":
        # Shifts go into Shifts/YYYY-MM folder
        folder_path = f"Shifts/{now.strftime('%Y-%m')}"
    elif folder == "Downtimes":
        folder_path = f"Downtimes/{now.strftime('%Y-%m')}"
    else:
        # Static folders or base directory
        folder_path = folder
        
    # Загружаем файл (Graph API автоматически создаст папки, если их нет)
    url = f"https://graph.microsoft.com/v1.0/drives/{drive_id}/root:/{folder_path}/{filename}:/content"
    resp = requests.put(url, headers=headers, data=file_bytes)
    resp.raise_for_status()
    
    file_data = resp.json()
    return file_data.get("webUrl") # Возвращает ссылку на просмотр файла

def download_file_from_sharepoint(filename: str, folder: str = "Shifts") -> bytes:
    access_token = get_access_token()
    site_id = get_site_id(access_token)
    drive_id = get_drive_id(access_token, site_id)
    
    headers = {
        "Authorization": f"Bearer {access_token}"
    }
    
    url = f"https://graph.microsoft.com/v1.0/drives/{drive_id}/root:/{folder}/{filename}:/content"
    resp = requests.get(url, headers=headers)
    resp.raise_for_status()
    return resp.content

def check_file_exists_on_sharepoint(filename: str, folder: str = "Shifts") -> bool:
    try:
        access_token = get_access_token()
        site_id = get_site_id(access_token)
        drive_id = get_drive_id(access_token, site_id)
        
        headers = {
            "Authorization": f"Bearer {access_token}"
        }
        url = f"https://graph.microsoft.com/v1.0/drives/{drive_id}/root:/{folder}/{filename}"
        resp = requests.get(url, headers=headers)
        return resp.status_code == 200
    except Exception:
        return False
