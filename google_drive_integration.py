import os
import json
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload
from dotenv import load_dotenv

load_dotenv()

CREDENTIALS_PATH = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "google_credentials.json")
SCOPES = ["https://www.googleapis.com/auth/drive"]

def get_drive_service():
    creds_json = os.getenv("GOOGLE_CREDENTIALS_JSON")
    if creds_json:
        try:
            info = json.loads(creds_json)
            if "private_key" in info:
                info["private_key"] = info["private_key"].replace("\\n", "\n")
            creds = service_account.Credentials.from_service_account_info(info, scopes=SCOPES)
            return build("drive", "v3", credentials=creds)
        except Exception as env_err:
            print(f"Ошибка парсинга GOOGLE_CREDENTIALS_JSON для Drive: {env_err}")

    if not os.path.exists(CREDENTIALS_PATH):
        raise FileNotFoundError(f"Файл ключа Google не найден по пути: {CREDENTIALS_PATH}")
    
    with open(CREDENTIALS_PATH, "r", encoding="utf-8") as f:
        info = json.load(f)
    
    if "private_key" in info:
        info["private_key"] = info["private_key"].replace("\\n", "\n")
        
    creds = service_account.Credentials.from_service_account_info(info, scopes=SCOPES)
    return build("drive", "v3", credentials=creds)

def upload_file_to_drive(file_path: str, title: str) -> dict:
    """
    Uploads a file to Google Drive.
    Automatically converts Word and Excel files to Google native formats.
    Sets 'writer' permission for anyone with the link.
    Returns a dict with 'id' and 'webViewLink'.
    """
    service = get_drive_service()
    
    # Determine the target Google mime type for conversion
    ext = title.split(".")[-1].lower() if "." in title else ""
    target_mime_type = None
    
    if ext in ["docx", "doc", "rtf"]:
        target_mime_type = "application/vnd.google-apps.document"
    elif ext in ["xlsx", "xls", "csv"]:
        target_mime_type = "application/vnd.google-apps.spreadsheet"
    elif ext in ["pptx", "ppt"]:
        target_mime_type = "application/vnd.google-apps.presentation"
        
    file_metadata = {'name': title}
    if target_mime_type:
        file_metadata['mimeType'] = target_mime_type
        
    media = MediaFileUpload(file_path, resumable=True)
    
    # Upload file
    file = service.files().create(
        body=file_metadata, 
        media_body=media, 
        fields='id, webViewLink'
    ).execute()
    
    file_id = file.get('id')
    
    # Make it writable by anyone with the link
    permission = {
        'type': 'anyone',
        'role': 'writer'
    }
    service.permissions().create(
        fileId=file_id,
        body=permission,
        fields='id'
    ).execute()
    
    return {
        "id": file_id,
        "url": file.get('webViewLink')
    }

def get_drive_export_link(file_id: str, original_ext: str) -> str:
    """
    Generates a direct download link from Google Drive.
    """
    ext = original_ext.lower().replace(".", "")
    
    if ext in ["docx", "doc", "rtf"]:
        return f"https://docs.google.com/document/export?format=docx&id={file_id}"
    elif ext in ["xlsx", "xls", "csv"]:
        return f"https://docs.google.com/spreadsheets/export?format=xlsx&id={file_id}"
    elif ext in ["pptx", "ppt"]:
        return f"https://docs.google.com/presentation/export?format=pptx&id={file_id}"
    else:
        # Generic direct download link if not converted
        return f"https://drive.google.com/uc?export=download&id={file_id}"
