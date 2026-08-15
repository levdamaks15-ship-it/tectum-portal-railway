import os
import json
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload
from dotenv import load_dotenv

load_dotenv()

SCOPES = ["https://www.googleapis.com/auth/drive"]

def get_drive_service():
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
        
    folder_id = os.getenv("GOOGLE_DRIVE_FOLDER_ID")
    if folder_id:
        file_metadata['parents'] = [folder_id]
        
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

def create_google_file(title: str, doc_type: str = "document") -> dict:
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
    
    folder_id = os.getenv("GOOGLE_DRIVE_FOLDER_ID")
    if folder_id:
        file_metadata['parents'] = [folder_id]
        
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
