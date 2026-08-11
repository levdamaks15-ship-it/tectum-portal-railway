import os
import json
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseUpload
import io
from dotenv import load_dotenv

load_dotenv()

DRIVE_ROOT_FOLDER_ID = os.getenv("GOOGLE_DRIVE_ROOT_FOLDER_ID")
CREDENTIALS_PATH = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "google_credentials.json")

def get_drive_service():
    # 1. Сначала пробуем загрузить из переменной окружения (для Railway/Render)
    creds_json = os.getenv("GOOGLE_CREDENTIALS_JSON")
    if creds_json:
        try:
            info = json.loads(creds_json)
            if "private_key" in info:
                info["private_key"] = info["private_key"].replace("\\n", "\n")
            creds = service_account.Credentials.from_service_account_info(
                info,
                scopes=["https://www.googleapis.com/auth/drive"]
            )
            return build("drive", "v3", credentials=creds)
        except Exception as env_err:
            print(f"Ошибка парсинга GOOGLE_CREDENTIALS_JSON из переменных окружения: {env_err}")

    # 2. Если переменной нет, считываем локальный файл
    if not os.path.exists(CREDENTIALS_PATH):
        raise FileNotFoundError(f"Файл ключа Google не найден по пути: {CREDENTIALS_PATH}")
    
    with open(CREDENTIALS_PATH, "r", encoding="utf-8") as f:
        info = json.load(f)
    
    if "private_key" in info:
        info["private_key"] = info["private_key"].replace("\\n", "\n")
        
    creds = service_account.Credentials.from_service_account_info(
        info,
        scopes=["https://www.googleapis.com/auth/drive"]
    )
    return build("drive", "v3", credentials=creds)

def list_files_and_folders(parent_id: str = None):
    if not parent_id:
        parent_id = DRIVE_ROOT_FOLDER_ID
        
    if not parent_id:
        raise ValueError("Root folder ID is not defined in environment variables.")

    service = get_drive_service()
    
    # Запрос ищет все файлы и папки внутри указанной parent_id
    # Не удаленные (trashed=false)
    query = f"'{parent_id}' in parents and trashed=false"
    
    results = service.files().list(
        q=query,
        fields="files(id, name, mimeType, modifiedTime, size, webViewLink, webContentLink, iconLink)",
        orderBy="folder, name"
    ).execute()
    
    items = results.get("files", [])
    
    folders = [item for item in items if item["mimeType"] == "application/vnd.google-apps.folder"]
    files = [item for item in items if item["mimeType"] != "application/vnd.google-apps.folder"]
    
    return {"folders": folders, "files": files, "parent_id": parent_id}

def upload_file(filename: str, mime_type: str, file_bytes: bytes, parent_id: str = None):
    if not parent_id:
        parent_id = DRIVE_ROOT_FOLDER_ID
        
    if not parent_id:
        raise ValueError("Root folder ID is not defined in environment variables.")

    service = get_drive_service()
    
    file_metadata = {
        'name': filename,
        'parents': [parent_id]
    }
    
    media = MediaIoBaseUpload(io.BytesIO(file_bytes), mimetype=mime_type, resumable=True)
    
    file = service.files().create(
        body=file_metadata,
        media_body=media,
        fields='id, name, webViewLink, webContentLink'
    ).execute()
    
    return file

def create_folder(folder_name: str, parent_id: str = None):
    if not parent_id:
        parent_id = DRIVE_ROOT_FOLDER_ID
        
    if not parent_id:
        raise ValueError("Root folder ID is not defined in environment variables.")

    service = get_drive_service()
    
    file_metadata = {
        'name': folder_name,
        'mimeType': 'application/vnd.google-apps.folder',
        'parents': [parent_id]
    }
    
    file = service.files().create(
        body=file_metadata,
        fields='id, name'
    ).execute()
    
    return file

def delete_file(file_id: str):
    service = get_drive_service()
    service.files().update(fileId=file_id, body={'trashed': True}).execute()
    return True
