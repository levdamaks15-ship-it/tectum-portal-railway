import os
import json
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload
from dotenv import load_dotenv

load_dotenv()

SCOPES = ["https://www.googleapis.com/auth/drive"]

_drive_service = None

def get_drive_credentials():
    client_id = os.getenv("GOOGLE_CLIENT_ID")
    client_secret = os.getenv("GOOGLE_CLIENT_SECRET")
    refresh_token = os.getenv("GOOGLE_REFRESH_TOKEN")
    
    if not all([client_id, client_secret, refresh_token]):
        raise ValueError("Missing GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET or GOOGLE_REFRESH_TOKEN in .env")
        
    creds = Credentials(
        None,  # Access token can be None, it will refresh automatically
        refresh_token=refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=client_id,
        client_secret=client_secret,
        scopes=SCOPES
    )
    return creds

def get_drive_service():
    global _drive_service
    if _drive_service is not None:
        return _drive_service
        
    creds = get_drive_credentials()
    _drive_service = build("drive", "v3", credentials=creds)
    return _drive_service

def get_drive_access_token() -> str:
    """Returns a valid access token for direct browser uploads"""
    from google.auth.transport.requests import Request
    creds = get_drive_credentials()
    creds.refresh(Request())
    return creds.token

_folder_cache = {}

def get_or_create_drive_folder(folder_name: str, parent_id: str = None) -> str:
    """
    Finds or creates a folder in Google Drive by name under a given parent_id.
    Uses in-memory cache to prevent repetitive Drive API calls.
    """
    base_parent = parent_id or os.getenv("GOOGLE_DRIVE_FOLDER_ID")
    cache_key = (folder_name, base_parent)
    if cache_key in _folder_cache:
        return _folder_cache[cache_key]

    service = get_drive_service()
    
    query = f"mimeType='application/vnd.google-apps.folder' and name='{folder_name}' and trashed=false"
    if base_parent:
        query += f" and '{base_parent}' in parents"
        
    results = service.files().list(
        q=query,
        spaces='drive',
        fields='files(id, name)'
    ).execute()
    files = results.get('files', [])
    
    if files:
        f_id = files[0]['id']
        _folder_cache[cache_key] = f_id
        return f_id
        
    file_metadata = {
        'name': folder_name,
        'mimeType': 'application/vnd.google-apps.folder'
    }
    if base_parent:
        file_metadata['parents'] = [base_parent]
        
    folder = service.files().create(
        body=file_metadata,
        fields='id'
    ).execute()
    
    f_id = folder.get('id')
    if f_id:
        _folder_cache[cache_key] = f_id
    return f_id

def delete_drive_file(file_id: str):
    """Deletes or trashes a file/folder in Google Drive"""
    try:
        service = get_drive_service()
        service.files().delete(fileId=file_id).execute()
    except Exception as e:
        print(f"Error deleting Google Drive item {file_id}: {e}")

def upload_file_to_drive(file_path: str, title: str, parent_drive_id: str = None) -> dict:
    """
    Uploads a file to Google Drive under parent_drive_id or root GOOGLE_DRIVE_FOLDER_ID.
    Automatically converts Word and Excel files to Google native formats.
    Optimized for high-speed direct multipart uploads.
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
        
    target_parent = parent_drive_id or os.getenv("GOOGLE_DRIVE_FOLDER_ID")
    if target_parent:
        file_metadata['parents'] = [target_parent]
        
    file_size = os.path.getsize(file_path) if os.path.exists(file_path) else 0
    
    # Fast direct multipart upload for small/medium files (< 10MB), resumable for larger
    is_resumable = file_size > 10 * 1024 * 1024
    media = MediaFileUpload(file_path, resumable=is_resumable, chunksize=10*1024*1024 if is_resumable else -1)
    
    # Upload file
    file = service.files().create(
        body=file_metadata, 
        media_body=media, 
        fields='id, webViewLink'
    ).execute()
    
    file_id = file.get('id')
    
    # Make it writable by anyone with the link (safely ignoring if already inherited)
    try:
        permission = {
            'type': 'anyone',
            'role': 'writer'
        }
        service.permissions().create(
            fileId=file_id,
            body=permission,
            fields='id'
        ).execute()
    except Exception as perm_err:
        # If folder already has shared permissions, ignore
        pass
    
    return {
        "id": file_id,
        "url": file.get('webViewLink')
    }

def create_google_file(title: str, doc_type: str = "document", parent_drive_id: str = None) -> dict:
    """
    Creates a new empty Google Doc or Google Sheet in Google Drive.
    doc_type: 'document' (Docs) or 'spreadsheet' (Sheets)
    """
    service = get_drive_service()
    
    mime_type = "application/vnd.google-apps.document" if doc_type == "document" else "application/vnd.google-apps.spreadsheet"
    
    file_metadata = {
        'name': title,
        'mimeType': mime_type
    }
    
    target_parent = parent_drive_id or os.getenv("GOOGLE_DRIVE_FOLDER_ID")
    if target_parent:
        file_metadata['parents'] = [target_parent]
        
    file = service.files().create(
        body=file_metadata,
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

def rename_drive_file(file_id: str, new_title: str):
    """
    Renames a file in Google Drive.
    """
    service = get_drive_service()
    service.files().update(
        fileId=file_id,
        body={'name': new_title}
    ).execute()

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
