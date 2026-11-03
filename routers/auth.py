import os
import secrets
import datetime
import requests
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session, selectinload
from sqlalchemy import func, or_

import models
import schemas
from routers.common import (
    get_primary_role,
    ROLE_PRIORITY,
    resolve_tenant_context,
    get_authenticated_user_from_request
)
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


# ==========================================
# SESSION HELPERS (SERVER-SIDE SESSIONS)
# ==========================================

SESSION_TTL_DAYS = 30
COOKIE_HOST_KEY = "__Host-tectum_session"
COOKIE_DEV_KEY = "tectum_session"

def create_user_session(db: Session, user_id: int, request: Request, last_visited_scope: str = "/p/shymkent/w/xci/shifts") -> models.UserSession:
    """Создает защищенную серверную сессию с криптографическим токеном."""
    token = secrets.token_urlsafe(32)
    now = datetime.datetime.utcnow()
    expires = now + datetime.timedelta(days=SESSION_TTL_DAYS)

    ua = request.headers.get("user-agent", "")[:500]
    client_ip = request.headers.get("x-forwarded-for", "")
    if not client_ip and request.client:
        client_ip = request.client.host
    client_ip = client_ip.split(",")[0].strip() if client_ip else ""

    session_rec = models.UserSession(
        id=token,
        user_id=user_id,
        user_agent=ua,
        ip_address=client_ip,
        created_at=now,
        expires_at=expires,
        revoked_at=None,
        last_visited_scope=last_visited_scope
    )
    db.add(session_rec)
    db.commit()
    db.refresh(session_rec)
    return session_rec

def attach_session_cookies(response: Response, token: str, request: Optional[Request] = None):
    """
    Выдает защищенную куку. Выставляются как __Host- кука (для HTTPS/PWA),
    так и стандартная кука для локальной разработки.
    """
    max_age = SESSION_TTL_DAYS * 24 * 3600
    # 1. Строгая Host-кука по стандарту безопасности
    response.set_cookie(
        key=COOKIE_HOST_KEY,
        value=token,
        max_age=max_age,
        path="/",
        secure=True,
        httponly=True,
        samesite="lax"
    )
    # 2. Совместимая кука (для localhost без HTTPS)
    response.set_cookie(
        key=COOKIE_DEV_KEY,
        value=token,
        max_age=max_age,
        path="/",
        secure=False,
        httponly=True,
        samesite="lax"
    )

def clear_session_cookies(response: Response):
    """Сбрасывает все возможные сессионные куки со строгими атрибутами RFC 6265bis во всех вариациях."""
    # 1. Host-кука строго требует Secure флаг
    response.delete_cookie(key=COOKIE_HOST_KEY, path="/", secure=True, httponly=True, samesite="lax")
    response.headers.append("Set-Cookie", f'{COOKIE_HOST_KEY}=""; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=lax; Secure')

    # 2. Dev-кука tectum_session
    response.delete_cookie(key=COOKIE_DEV_KEY, path="/", secure=True, httponly=True, samesite="lax")
    response.delete_cookie(key=COOKIE_DEV_KEY, path="/", secure=False, httponly=True, samesite="lax")
    response.headers.append("Set-Cookie", f'{COOKIE_DEV_KEY}=""; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=lax; Secure')
    response.headers.append("Set-Cookie", f'{COOKIE_DEV_KEY}=""; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=lax')

    # 3. Starlette session кука (удаляем во всех вариациях Secure и HttpOnly)
    response.delete_cookie(key="session", path="/", secure=True, httponly=True, samesite="lax")
    response.delete_cookie(key="session", path="/", secure=False, httponly=True, samesite="lax")
    response.delete_cookie(key="session", path="/", secure=False, samesite="lax")
    response.headers.append("Set-Cookie", 'session=""; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=lax; Secure')
    response.headers.append("Set-Cookie", 'session=""; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=lax')

def get_session_token_from_request(request: Request) -> Optional[str]:
    """Извлекает токен сессии из кук или заголовка авторизации."""
    return (
        request.cookies.get(COOKIE_HOST_KEY)
        or request.cookies.get(COOKIE_DEV_KEY)
        or request.headers.get("x-session-token")
    )


# ==========================================
# DTO REQUEST SCHEMAS
# ==========================================

class LoginRequest(BaseModel):
    name: str
    pin: str

class AdminLoginRequest(BaseModel):
    pin: str


# ==========================================
# AUTH ENDPOINTS
# ==========================================

@router.post("/api/login/")
def login(data: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    clean_name = data.name.strip()
    clean_pin = data.pin.strip()
    
    # 1. Сначала сверяем по новой единой таблице User
    unified_user = db.query(models.User).options(selectinload(models.User.scopes)).filter(
        func.lower(models.User.name) == clean_name.lower()
    ).first()

    matched = False
    user_id = 0
    user_name = clean_name
    user_role = "itr"
    is_super_admin = (clean_pin == "6282" and clean_name.startswith("Левда"))

    if unified_user:
        # Проверяем, является ли пользователь администратором
        is_user_admin = any(s.role_code == "admin" for s in (unified_user.scopes or [])) or clean_name.startswith("Левда")
        is_admin_login = (clean_pin == "6282" and is_user_admin)

        pin_valid = is_admin_login or (unified_user.pin_code and unified_user.pin_code.strip() == clean_pin)
        if pin_valid:
            matched = True
            user_id = unified_user.id
            user_name = unified_user.name
            # Определяем роль с учетом канонического приоритета
            if is_admin_login:
                user_role = "admin"
            else:
                user_role = get_primary_role(unified_user)

    # 2. Если не совпало — fallback на легаси таблицы Master и PlannerEmployee
    if not matched:
        master = db.query(models.Master).filter(models.Master.name == clean_name).first()
        planner_emp = db.query(models.PlannerEmployee).filter(models.PlannerEmployee.name == clean_name).first()

        master_pin_ok = False
        if master:
            if master.pin == clean_pin or (clean_pin == "6282" and master.role == "admin"):
                master_pin_ok = True

        planner_pin_ok = False
        if planner_emp:
            # Мастер-PIN 6282 не может использоваться для входа под другими сотрудниками!
            if planner_emp.pin_code and planner_emp.pin_code.strip() == clean_pin:
                planner_pin_ok = True
            elif not planner_emp.pin_code or not planner_emp.pin_code.strip():
                if clean_pin in ("0000", "1234"):
                    planner_pin_ok = True

        if master_pin_ok:
            matched = True
            user_id = master.id
            user_name = master.name
            user_role = master.role
        elif planner_pin_ok:
            matched = True
            if master:
                user_id = master.id
                user_name = master.name
                user_role = master.role
            else:
                user_id = 10000 + planner_emp.id
                user_name = planner_emp.name
                user_role = getattr(planner_emp, "role", None) or ("admin" if (clean_name.startswith("Л") and clean_pin == "6282") else "portal")

        # Если аутентификация прошла через легаси — гарантируем синхронизацию в User
        if matched:
            if not unified_user:
                unified_user = models.User(name=user_name, pin_code=clean_pin, is_active=True)
                db.add(unified_user)
                db.commit()
                db.refresh(unified_user)
                scope = models.UserRoleScope(user_id=unified_user.id, role_code=user_role, plant_id="shymkent", is_active=True)
                db.add(scope)
                db.commit()
            user_id = unified_user.id

    if not matched:
        raise HTTPException(status_code=400, detail="Неверное имя сотрудника или ПИН-код")

    # Создаем долгоживущую серверную сессию (30 дней)
    if "лкц" in user_role.lower():
        target_scope = "/p/shymkent/w/lkc/production"
    elif user_role == "technologist" or "технолог" in user_role.lower():
        target_scope = "/p/shymkent/w/xci/technologist"
    else:
        target_scope = "/p/shymkent/w/xci/shifts"
    sess = create_user_session(db, user_id=user_id, request=request, last_visited_scope=target_scope)
    attach_session_cookies(response, sess.id, request)

    # Заполняем legacy session для полной обратной совместимости старых эндпоинтов
    request.session["user_id"] = user_id
    request.session["user_name"] = user_name
    request.session["user_role"] = user_role

    return {
        "id": user_id,
        "name": user_name,
        "role": user_role,
        "scope": target_scope,
        "session_id": sess.id
    }


@router.post("/api/auth/login-by-pin")
def login_by_pin(data: schemas.LoginByPinRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    """Вход по выбору завода, цеха и сотрудника (для личных смартфонов и PWA)."""
    user = db.query(models.User).options(selectinload(models.User.scopes)).filter(models.User.id == data.user_id).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=404, detail="Сотрудник не найден или деактивирован")

    clean_pin = data.pin.strip()
    is_user_admin = user.name.startswith("Левда") or any(s.role_code == "admin" for s in (user.scopes or []))
    is_admin_pin = (clean_pin == "6282" and is_user_admin)

    pin_valid = is_admin_pin or (user.pin_code and user.pin_code.strip() == clean_pin)
    if not pin_valid:
        raise HTTPException(status_code=400, detail="Неверный ПИН-код")

    # Определение роли с учетом канонического приоритета
    if is_admin_pin:
        role_code = "admin"
    else:
        role_code = get_primary_role(user)

    workshop_slug = data.workshop_id or (user.scopes[0].workshop_id if user.scopes and user.scopes[0].workshop_id else "xci")
    plant_slug = data.plant_id or "shymkent"
    if role_code == "technologist":
        target_scope = f"/p/{plant_slug}/w/{workshop_slug}/technologist"
    elif "лкц" in role_code or role_code == "lkc_master":
        target_scope = f"/p/{plant_slug}/w/{workshop_slug}/production"
    else:
        target_scope = f"/p/{plant_slug}/w/{workshop_slug}/shifts"

    sess = create_user_session(db, user_id=user.id, request=request, last_visited_scope=target_scope)
    attach_session_cookies(response, sess.id, request)

    request.session["user_id"] = user.id
    request.session["user_name"] = user.name
    request.session["user_role"] = role_code

    return {
        "id": user.id,
        "name": user.name,
        "role": role_code,
        "plant_id": plant_slug,
        "workshop_id": workshop_slug,
        "scope": target_scope,
        "session_id": sess.id
    }


@router.post("/api/admin/login")
def admin_login(data: AdminLoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    clean_pin = data.pin.strip()

    # СТРОГАЯ ЗАЩИТА: Вход в панель администратора разрешен исключительно по мастер-PIN 6282
    if clean_pin != "6282":
        raise HTTPException(status_code=403, detail="Доступ запрещен. Неверный ключ администратора.")

    admin_user = db.query(models.User).filter(models.User.name.like("%Левда%")).first()
    if not admin_user:
        admin_user = db.query(models.User).filter(models.User.pin_code == "6282").first()

    # Fallback на таблицу Master
    if not admin_user:
        master_admin = db.query(models.Master).filter(models.Master.role == "admin").first()
        if master_admin:
            admin_user = db.query(models.User).filter(models.User.name == master_admin.name).first()

    if not admin_user:
        raise HTTPException(status_code=403, detail="Доступ запрещен. Вход в панель управления разрешен только системному администратору (Левда М.).")

    sess = create_user_session(db, user_id=admin_user.id, request=request, last_visited_scope="/p/shymkent/w/all/admin")
    attach_session_cookies(response, sess.id, request)

    request.session["user_id"] = admin_user.id
    request.session["user_name"] = admin_user.name
    request.session["user_role"] = "admin"

    return {"id": admin_user.id, "name": admin_user.name, "role": "admin", "session_id": sess.id}


@router.get("/api/me/")
def get_current_user(request: Request, response: Response, db: Session = Depends(get_db)):
    sso_enabled = bool(os.getenv("M365_CLIENT_ID") and os.getenv("M365_TENANT_ID") and os.getenv("M365_CLIENT_SECRET"))
    token = get_session_token_from_request(request)
    now = datetime.datetime.utcnow()

    # 1. Проверка серверной сессии в user_sessions
    if token:
        sess = db.query(models.UserSession).filter(
            models.UserSession.id == token,
            models.UserSession.expires_at > now,
            models.UserSession.revoked_at.is_(None)
        ).first()

        if sess:
            user = db.query(models.User).options(selectinload(models.User.scopes)).filter(models.User.id == sess.user_id).first()
            if user and user.is_active:
                scopes_list = [
                    {"role_code": s.role_code, "plant_id": s.plant_id, "workshop_id": s.workshop_id}
                    for s in user.scopes if s.is_active
                ]
                primary_role = get_primary_role(user)

                # Синхронизируем legacy session
                request.session["user_id"] = user.id
                request.session["user_name"] = user.name
                request.session["user_role"] = primary_role

                return {
                    "authenticated": True,
                    "sso_enabled": sso_enabled,
                    "user": {
                        "id": user.id,
                        "name": user.name,
                        "email": user.email,
                        "phone": user.phone,
                        "role": primary_role,
                        "scopes": scopes_list
                    },
                    "last_visited_scope": sess.last_visited_scope or "/p/shymkent/w/xci/shifts"
                }

    # Если серверная сессия не найдена или отозвана, гарантированно сбрасываем всё
    request.session.clear()
    clear_session_cookies(response)
    return {"authenticated": False, "sso_enabled": sso_enabled}


@router.post("/api/logout")
@router.get("/api/logout")
@router.post("/api/auth/logout")
@router.get("/api/auth/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    """
    Атомарный логаут:
    1. Инвалидация сессии в БД (revoked_at = NOW()).
    2. Очистка серверного хранилища Starlette.
    3. Полный сброс кук __Host-tectum_session и tectum_session.
    4. Заголовок W3C Clear-Site-Data для гарантированной очистки на клиенте.
    5. Запрет кэширования ответов логаута.
    """
    tokens_to_revoke = set()
    for cookie_name in (COOKIE_HOST_KEY, COOKIE_DEV_KEY):
        c_val = request.cookies.get(cookie_name)
        if c_val and c_val.strip():
            tokens_to_revoke.add(c_val.strip())
    
    header_val = request.headers.get("x-session-token")
    if header_val and header_val.strip():
        tokens_to_revoke.add(header_val.strip())

    user_id = None
    if tokens_to_revoke:
        sess = db.query(models.UserSession).filter(models.UserSession.id.in_(tokens_to_revoke)).first()
        if sess:
            user_id = sess.user_id
    if not user_id:
        user_id = request.session.get("user_id")

    now = datetime.datetime.utcnow()
    # Инвалидируем ВСЕ сессии пользователя, исключая эффект фантомного логина
    if user_id:
        db.query(models.UserSession).filter(
            models.UserSession.user_id == user_id,
            models.UserSession.revoked_at.is_(None)
        ).update({"revoked_at": now}, synchronize_session=False)
        db.commit()
    elif tokens_to_revoke:
        db.query(models.UserSession).filter(
            models.UserSession.id.in_(tokens_to_revoke),
            models.UserSession.revoked_at.is_(None)
        ).update({"revoked_at": now}, synchronize_session=False)
        db.commit()

    request.session.clear()
    clear_session_cookies(response)

    # W3C Clear-Site-Data гарантирует, что браузер вычистит кэш и хранилища
    response.headers["Clear-Site-Data"] = '"cookies", "storage", "executionContexts"'
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, private, max-age=0"
    response.headers["Pragma"] = "no-cache"

    return {"status": "ok", "message": "Logged out successfully and session destroyed."}


# ==========================================
# DISCOVERY ENDPOINTS (PLANTS & WORKSHOPS)
# ==========================================

@router.get("/api/auth/plants", response_model=List[schemas.PlantOut])
def get_plants(db: Session = Depends(get_db)):
    """Возвращает список активных заводов."""
    return db.query(models.Plant).filter(models.Plant.is_active == True).all()

@router.get("/api/auth/workshops", response_model=List[schemas.WorkshopOut])
def get_workshops(plant_id: str = "shymkent", db: Session = Depends(get_db)):
    """Возвращает список цехов завода (ХЦИ, АГБ, ЛКЦ, СТМО, СКК)."""
    return db.query(models.Workshop).filter(
        models.Workshop.plant_id == plant_id,
        models.Workshop.is_active == True
    ).order_by(models.Workshop.id).all()

@router.get("/api/auth/users-by-workshop", response_model=List[schemas.UserOut])
def get_users_by_workshop(workshop_id: Optional[str] = None, plant_id: str = "shymkent", db: Session = Depends(get_db)):
    """Возвращает список сотрудников для селектора смены."""
    query = db.query(models.User).options(selectinload(models.User.scopes)).filter(models.User.is_active == True)
    if workshop_id:
        query = query.join(models.UserRoleScope).filter(
            or_(
                models.UserRoleScope.workshop_id == workshop_id,
                models.UserRoleScope.workshop_id.is_(None)
            )
        )
    users = query.all()
    # Сортировка: сначала мастера, затем по имени
    return sorted(users, key=lambda u: u.name)


# ==========================================
# MICROSOFT ENTRA ID (SSO)
# ==========================================

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
    if not CLIENT_ID or not TENANT_ID or not CLIENT_SECRET or not msal:
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
def auth_callback(request: Request, response: Response, code: str = None, error: str = None, error_description: str = None, db: Session = Depends(get_db)):
    if not CLIENT_ID or not TENANT_ID or not CLIENT_SECRET or not msal:
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
        
    user = db.query(models.User).filter(func.lower(models.User.email) == email.lower()).first()
    if not user:
        user = models.User(name=name, email=email, pin_code="0000", is_active=True)
        db.add(user)
        db.commit()
        db.refresh(user)
        scope = models.UserRoleScope(user_id=user.id, role_code="itr", plant_id="shymkent", is_active=True)
        db.add(scope)
        db.commit()

    sess = create_user_session(db, user_id=user.id, request=request, last_visited_scope="/p/shymkent/w/xci/shifts")
    redirect_resp = RedirectResponse(url="/", status_code=302)
    attach_session_cookies(redirect_resp, sess.id, request)

    request.session["user_id"] = user.id
    request.session["user_name"] = user.name
    request.session["user_role"] = "itr"
    
    return redirect_resp


@router.get("/api/masters/")
def get_masters(db: Session = Depends(get_db)):
    """Легаси эндпоинт для обратной совместимости старых экранов."""
    try:
        masters = db.query(models.Master).all()
        return sorted(masters, key=lambda m: (m.name != "Дауылбай М.", m.name))
    except Exception as e:
        import traceback
        print(f"Error in get_masters: {str(e)}\n{traceback.format_exc()}")
        return []
