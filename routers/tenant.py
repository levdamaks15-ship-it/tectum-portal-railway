import os
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse, RedirectResponse, JSONResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session
from database import SessionLocal
import models
from routers.common import (
    resolve_tenant_context,
    get_authenticated_user_from_request,
    TenantContext
)

router = APIRouter(tags=["tenant"])

templates_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "templates")
templates = Jinja2Templates(directory=templates_dir)

def get_db():

    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

ROLE_LABELS = {
    "admin": "ADMIN",
    "director": "Директор",
    "tech_director": "Технический директор",
    "production_head": "Начальник производства",
    "workshop_master": "Мастер смены",
    "qcd_inspector": "Инспектор СКК",
    "mechanic": "Механик",
    "technologist": "Технолог",
    "itr": "Специалист ИТР",
    "operator": "Оператор",
}

HTML_NO_CACHE_HEADERS = {
    "Cache-Control": "no-store, no-cache, must-revalidate, private, max-age=0",
    "Pragma": "no-cache",
    "Expires": "0"
}

@router.get("/p/{plant_slug}/w/{workshop_slug}")
def redirect_to_default_module(plant_slug: str, workshop_slug: str):
    """Редирект на модуль смен по умолчанию."""
    return RedirectResponse(url=f"/p/{plant_slug}/w/{workshop_slug}/shifts", status_code=302)

@router.get("/p/{plant_slug}/w/{workshop_slug}/{module}")
def serve_tenant_module(
    plant_slug: str,
    workshop_slug: str,
    module: str,
    request: Request,
    db: Session = Depends(get_db)
):
    """
    Единая точка входа для рабочих экранов с изоляцией контекста цеха и завода.
    Исключает Multi-Tab Context Bleed и гарантирует сохранение рабочей области.
    """
    # 1. Проверяем валидность завода и цеха
    plant = db.query(models.Plant).filter(models.Plant.id == plant_slug.lower()).first()
    if not plant:
        plant_slug = "shymkent"

    if workshop_slug.lower() != "all":
        workshop = db.query(models.Workshop).filter(models.Workshop.id == workshop_slug.lower()).first()
        if not workshop:
            workshop_slug = "xci"

    # 2. Проверяем авторизацию и доступ
    try:
        ctx = resolve_tenant_context(plant_slug, workshop_slug, request, db)
    except HTTPException as auth_err:
        if auth_err.status_code == 401:
            req_path = request.url.path
            return RedirectResponse(url=f"/?unauthorized=true&redirect={req_path}", status_code=302)
        raise auth_err

    # 3. Проверяем наличие прогрессивного Jinja2 SSR шаблона
    clean_module = module.lower()

    # Защита привилегированных кабинетов (Fail-Closed Invariant)
    if clean_module == "admin" and not ctx.is_admin:
        raise HTTPException(status_code=403, detail="Доступ в панель администратора запрещен")

    # Модули с широкой табличной сеткой и автономной навигацией (без сплющивания до 1360px и без дублирующих вкладок)
    base_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static")
    if clean_module in ("tasks", "planner"):
        resp = FileResponse(os.path.join(base_dir, "tasks.html"), headers=HTML_NO_CACHE_HEADERS)
        resp.headers["X-Plant-ID"] = plant_slug
        resp.headers["X-Workshop-ID"] = workshop_slug
        return resp

    if clean_module in ("docs", "kb", "knowledge"):
        resp = FileResponse(os.path.join(base_dir, "docs.html"), headers=HTML_NO_CACHE_HEADERS)
        resp.headers["X-Plant-ID"] = plant_slug
        resp.headers["X-Workshop-ID"] = workshop_slug
        return resp

    template_relative = f"modules/{clean_module}/index.html"
    template_full = os.path.join(templates_dir, "modules", clean_module, "index.html")

    # Специализированные цеха (ЛКЦ - раскрой, СКК - переборка) имеют собственный сменный кабинет
    if clean_module in ("shifts", "production") and workshop_slug.lower() in ("lkc", "skk", "qcd"):
        target_ws = "qcd" if workshop_slug.lower() == "skk" else workshop_slug.lower()
        special_rel = f"modules/{target_ws}/index.html"
        special_full = os.path.join(templates_dir, "modules", target_ws, "index.html")
        if os.path.exists(special_full):
            template_relative = special_rel
            template_full = special_full

    if os.path.exists(template_full):
        context_data = {
            "request": request,
            "plant_id": plant_slug,
            "workshop_id": workshop_slug,
            "current_module": clean_module,
            "user_name": ctx.user_name,
            "role_name": ROLE_LABELS.get(ctx.role_code, ctx.role_code),
            "is_admin": ctx.is_admin,
            "can_switch_workshops": ctx.can_switch_workshops,
            "accessible_workshops": ctx.accessible_workshops,
            "current_workshop": ctx.current_workshop
        }
        resp = templates.TemplateResponse(
            request=request,
            name=template_relative,
            context=context_data,
            headers=HTML_NO_CACHE_HEADERS
        )
        resp.headers["X-Plant-ID"] = plant_slug
        resp.headers["X-Workshop-ID"] = workshop_slug
        return resp

    # 4. Fallback на статические HTML-модули
    base_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static")


    if clean_module in ("shifts", "production"):
        if ctx.role_code == "technologist" or "технолог" in (ctx.user_name or "").lower():
            return RedirectResponse(url=f"/p/{plant_slug}/w/{workshop_slug}/technologist", status_code=302)
        if workshop_slug.lower() == "lkc":
            target_file = os.path.join(base_dir, "lkc.html")
        elif workshop_slug.lower() == "skk":
            target_file = os.path.join(base_dir, "qcd.html")
        else:
            target_file = os.path.join(base_dir, "index.html")
    elif clean_module in ("tasks", "planner"):
        target_file = os.path.join(base_dir, "tasks.html")
    elif clean_module in ("docs", "kb", "knowledge"):
        target_file = os.path.join(base_dir, "docs.html")
    elif clean_module == "analytics":
        target_file = os.path.join(base_dir, "analytics.html")
    elif clean_module == "checklists":
        target_file = os.path.join(base_dir, "checklists.html")
    elif clean_module == "admin":
        if not ctx.is_admin:
            raise HTTPException(status_code=403, detail="Доступ в панель администратора запрещен")
        target_file = os.path.join(base_dir, "admin.html")
    elif clean_module in ("qcd", "quality"):
        target_file = os.path.join(base_dir, "qcd.html")
    elif clean_module in ("technologist", "tech", "downtimes_base"):
        target_file = os.path.join(base_dir, "technologist.html")
    else:
        target_file = os.path.join(base_dir, "index.html")

    if not os.path.exists(target_file):
        target_file = os.path.join(base_dir, "index.html")

    resp = FileResponse(target_file, headers=HTML_NO_CACHE_HEADERS)
    # Передаем data-атрибуты через заголовки для безопасного считывания клиентом
    resp.headers["X-Plant-ID"] = plant_slug
    resp.headers["X-Workshop-ID"] = workshop_slug
    return resp

@router.get("/api/tenant/current-context")
def get_current_tenant_context(request: Request, db: Session = Depends(get_db)):
    """Возвращает информацию о текущем авторизованном пользователе и его цехах."""
    user = get_authenticated_user_from_request(request, db)
    if not user:
        return {"authenticated": False}

    scopes_list = [
        {"role_code": s.role_code, "plant_id": s.plant_id, "workshop_id": s.workshop_id}
        for s in user.scopes if s.is_active
    ]
    is_admin = any(s["role_code"] == "admin" for s in scopes_list)

    token = (
        request.cookies.get("__Host-tectum_session")
        or request.cookies.get("tectum_session")
        or request.headers.get("x-session-token")
    )
    last_scope = "/p/shymkent/w/xci/shifts"
    if token:
        sess = db.query(models.UserSession).filter(models.UserSession.id == token).first()
        if sess and sess.last_visited_scope:
            last_scope = sess.last_visited_scope

    return {
        "authenticated": True,
        "user_id": user.id,
        "user_name": user.name,
        "is_admin": is_admin,
        "scopes": scopes_list,
        "last_visited_scope": last_scope
    }

