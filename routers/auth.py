import os
import requests
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func

import models
from database import SessionLocal

try:
    import msal
except ImportError:
    msal = None

router = APIRouter(tags=["auth"])

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

class LoginRequest(BaseModel):
    name: str
    pin: str

class AdminLoginRequest(BaseModel):
    pin: str

@router.post("/api/login/")
def login(data: LoginRequest, request: Request, db: Session = Depends(get_db)):
    master = db.query(models.Master).filter(models.Master.name == data.name, models.Master.pin == data.pin).first()
    if not master:
        raise HTTPException(status_code=400, detail="Неверное имя или ПИН-код")
    request.session["user_id"] = master.id
    request.session["user_name"] = master.name
    request.session["user_role"] = master.role
    return {"id": master.id, "name": master.name, "role": master.role}

@router.post("/api/admin/login")
def admin_login(data: AdminLoginRequest, request: Request, db: Session = Depends(get_db)):
    admin = db.query(models.Master).filter(models.Master.pin == data.pin, models.Master.role.in_(["admin", "director", "technologist"])).first()
    if not admin:
        raise HTTPException(status_code=400, detail="Неверный ПИН-код или нет прав администратора")
    request.session["user_id"] = admin.id
    request.session["user_name"] = admin.name
    request.session["user_role"] = admin.role
    return {"id": admin.id, "name": admin.name, "role": admin.role}

@router.get("/api/me/")
def get_current_user(request: Request, db: Session = Depends(get_db)):
    sso_enabled = bool(os.getenv("M365_CLIENT_ID") and os.getenv("M365_TENANT_ID") and os.getenv("M365_CLIENT_SECRET"))
    user_id = request.session.get("user_id")
    if not user_id:
        return {"authenticated": False, "sso_enabled": sso_enabled}
    master = db.query(models.Master).get(user_id)
    if not master:
        request.session.clear()
        return {"authenticated": False, "sso_enabled": sso_enabled}
    return {
        "authenticated": True,
        "sso_enabled": sso_enabled,
        "user": {"id": master.id, "name": master.name, "role": master.role, "email": master.email}
    }

@router.post("/api/logout")
@router.get("/api/logout")
def logout(request: Request):
    request.session.clear()
    return {"status": "ok", "message": "Logged out successfully"}

# --- MICROSOFT ENTRA ID (SSO) AUTHENTICATION ---
TENANT_ID = os.getenv("M365_TENANT_ID")
CLIENT_ID = os.getenv("M365_CLIENT_ID")
CLIENT_SECRET = os.getenv("M365_CLIENT_SECRET")

AUTHORITY = f"https://login.microsoftonline.com/{TENANT_ID}" if TENANT_ID else ""
SCOPES = ["User.Read"]

def get_msal_app():
    return msal.ConfidentialClientApplication(
        CLIENT_ID,
        authority=AUTHORITY,
        client_credential=CLIENT_SECRET
    )

@router.get("/api/auth/login")
def auth_login(request: Request):
    if not CLIENT_ID or not TENANT_ID or not CLIENT_SECRET:
        raise HTTPException(status_code=400, detail="Microsoft SSO is not configured on the server")
        
    scheme = request.headers.get("x-forwarded-proto", request.url.scheme)
    host = request.headers.get("x-forwarded-host", request.url.netloc)
    redirect_uri = f"{scheme}://{host}/api/auth/callback"
    request.session["redirect_uri"] = redirect_uri
    
    msal_app = get_msal_app()
    auth_url = msal_app.get_authorization_request_url(
        scopes=SCOPES,
        redirect_uri=redirect_uri
    )
    return RedirectResponse(auth_url)

@router.get("/api/auth/callback")
def auth_callback(request: Request, code: str = None, error: str = None, error_description: str = None, db: Session = Depends(get_db)):
    if not CLIENT_ID or not TENANT_ID or not CLIENT_SECRET:
        raise HTTPException(status_code=400, detail="Microsoft SSO is not configured on the server")
        
    if error:
        raise HTTPException(status_code=400, detail=f"Microsoft Auth Error: {error_description or error}")
    if not code:
        raise HTTPException(status_code=400, detail="Missing authorization code")
        
    redirect_uri = request.session.get("redirect_uri")
    if not redirect_uri:
        scheme = request.headers.get("x-forwarded-proto", request.url.scheme)
        host = request.headers.get("x-forwarded-host", request.url.netloc)
        redirect_uri = f"{scheme}://{host}/api/auth/callback"
        
    msal_app = get_msal_app()
    result = msal_app.acquire_token_by_authorization_code(
        code,
        scopes=SCOPES,
        redirect_uri=redirect_uri
    )
    
    if "error" in result:
        raise HTTPException(
            status_code=400,
            detail=f"Token acquisition failed: {result.get('error_description') or result.get('error')}"
        )
        
    access_token = result.get("access_token")
    if not access_token:
        raise HTTPException(status_code=400, detail="No access token in response")
        
    # Call Graph /me to get user details
    headers = {"Authorization": f"Bearer {access_token}"}
    me_resp = requests.get("https://graph.microsoft.com/v1.0/me", headers=headers)
    if not me_resp.ok:
        raise HTTPException(status_code=400, detail="Failed to retrieve user profile from Microsoft Graph")
        
    me_data = me_resp.json()
    email = me_data.get("mail") or me_data.get("userPrincipalName")
    name = me_data.get("displayName")
    
    if not email:
        raise HTTPException(status_code=400, detail="Microsoft account email not found")
        
    master = db.query(models.Master).filter(models.Master.email == email).first()
    
    if not master:
        # Fallback search by displayName in masters list with no email associated yet
        master = db.query(models.Master).filter(
            func.lower(models.Master.name) == name.lower(),
            models.Master.email == None
        ).first()
        if master:
            master.email = email
            db.commit()
            db.refresh(master)
            
    if not master:
        # Automatically create master
        master = models.Master(name=name, email=email, pin="0000", role="master")
        db.add(master)
        db.commit()
        db.refresh(master)
        
    request.session["user_id"] = master.id
    request.session["user_name"] = master.name
    request.session["user_role"] = master.role
    
    return RedirectResponse(url="/")

@router.get("/api/auth/logout")
def auth_logout(request: Request):
    request.session.clear()
    return RedirectResponse(url="/")

@router.get("/api/masters/")
def get_masters(db: Session = Depends(get_db)):
    try:
        masters = db.query(models.Master).all()
        return sorted(masters, key=lambda m: (m.name != "Дауылбай М.", m.name))
    except Exception as e:
        import traceback
        print(f"Error in get_masters: {str(e)}\n{traceback.format_exc()}")
        return []
