import os
import threading
from datetime import datetime
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, RedirectResponse, JSONResponse
from sqlalchemy.orm import Session
from database import SessionLocal
import models
try:
    from starlette.middleware.sessions import SessionMiddleware
except ImportError:
    import base64, json
    from starlette.types import ASGIApp, Receive, Scope, Send
    class FallbackSessionMiddleware:
        def __init__(self, app: ASGIApp, secret_key: str = "", **kwargs):
            self.app = app
        async def __call__(self, scope: Scope, receive: Receive, send: Send):
            if scope["type"] not in ("http", "websocket"):
                await self.app(scope, receive, send)
                return
            scope["session"] = {}
            headers = dict(scope.get("headers", []))
            cookie_header = headers.get(b"cookie", b"").decode("latin-1")
            for item in cookie_header.split(";"):
                item = item.strip()
                if item.startswith("session="):
                    val = item[len("session="):]
                    try:
                        scope["session"] = json.loads(base64.b64decode(val.encode()).decode())
                    except Exception:
                        pass
            
            async def send_wrapper(message):
                if message["type"] == "http.response.start":
                    try:
                        sess_json = json.dumps(scope.get("session", {}))
                        b64 = base64.b64encode(sess_json.encode()).decode()
                        cookie = f"session={b64}; Path=/; SameSite=lax"
                        headers_list = list(message.get("headers", []))
                        headers_list.append((b"set-cookie", cookie.encode()))
                        message["headers"] = headers_list
                    except Exception:
                        pass
                await send(message)
            await self.app(scope, receive, send_wrapper)
    SessionMiddleware = FallbackSessionMiddleware

@asynccontextmanager
async def lifespan(app: FastAPI):
    from core.db_migrations import run_startup_migrations
    threading.Thread(target=run_startup_migrations, daemon=True).start()
    yield

app = FastAPI(title="Tectum Enterprise Portal", lifespan=lifespan, docs_url="/api/docs", redoc_url=None)

from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

import traceback as _tb
from fastapi.responses import JSONResponse as _JSONResponse

@app.exception_handler(Exception)
async def global_exception_handler(request, exc: Exception):
    return _JSONResponse(
        status_code=500,
        content={"detail": str(exc), "traceback": _tb.format_exc()}
    )


app.add_middleware(
    SessionMiddleware, 
    secret_key=os.getenv("SESSION_SECRET_KEY", "super-secret-key-for-tectum-portal"),
    max_age=86400 * 30,  # 30 days
    same_site="lax",
    https_only=False
)

@app.middleware("http")
async def add_no_cache_headers(request: Request, call_next):
    response = await call_next(request)
    path = request.url.path
    if path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    elif path.endswith(".html") or path in ("/", "/admin", "/analytics", "/tasks", "/planner", "/docs", "/knowledge", "/base", "/checklists", "/qcd"):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    elif path.startswith("/static/"):
        if path.endswith((".js", ".css")):
            response.headers["Cache-Control"] = "no-cache, must-revalidate, max-age=0"
            response.headers["Pragma"] = "no-cache"
    return response

# ==========================================
# ROUTERS MOUNTING
# ==========================================
from routers.auth import router as auth_router
from routers.shifts import router as shifts_router
from routers.analytics import router as analytics_router
from routers.downtimes import router as downtimes_router
from routers.planner import router as planner_router
from routers.checklists import router as checklists_router
from routers.documents import router as documents_router
from routers.admin import router as admin_router
from routers.webhooks import router as webhooks_router
from routers.system import router as system_router
from routers.qcd_sorting import router as qcd_sorting_router
from routers.ai_assistant import router as ai_assistant_router
from routers.qcd_lab import router as qcd_lab_router
from routers.lkc import router as lkc_router
from routers.tenant import router as tenant_router

app.include_router(auth_router)
app.include_router(shifts_router)
app.include_router(analytics_router)
app.include_router(downtimes_router)
app.include_router(planner_router)
app.include_router(checklists_router)
app.include_router(documents_router)
app.include_router(admin_router)
app.include_router(webhooks_router)
app.include_router(system_router)
app.include_router(qcd_sorting_router)
app.include_router(ai_assistant_router)
app.include_router(qcd_lab_router)
app.include_router(lkc_router)
app.include_router(tenant_router)

# ==========================================
# STATIC FILES & WEB PAGES
# ==========================================
if not os.path.exists("uploads"):
    os.makedirs("uploads", exist_ok=True)
if not os.path.exists(os.path.join("uploads", "tasks")):
    os.makedirs(os.path.join("uploads", "tasks"), exist_ok=True)
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

if not os.path.exists("static"):
    os.makedirs("static", exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")

HTML_NO_CACHE_HEADERS = {
    "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
    "Pragma": "no-cache",
    "Expires": "0"
}

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@app.get("/")
def read_root(request: Request, db: Session = Depends(get_db)):
    """
    Корневая точка входа:
    - При явном логауте (unauthorized=true) показываем экран авторизации без авторедиректа.
    - Если пользователь уже авторизован, автоматически перенаправляем (302)
      в его последний активный цех (last_visited_scope).
    - Если сессии нет, показываем экран авторизации.
    """
    if request.query_params.get("unauthorized") == "true":
        return FileResponse("static/index.html", headers=HTML_NO_CACHE_HEADERS)

    from routers.common import get_authenticated_user_from_request
    user = get_authenticated_user_from_request(request, db)
    if user:
        token = (
            request.cookies.get("__Host-tectum_session")
            or request.cookies.get("tectum_session")
            or request.headers.get("x-session-token")
        )
        if token:
            sess = db.query(models.UserSession).filter(
                models.UserSession.id == token,
                models.UserSession.expires_at > datetime.utcnow(),
                models.UserSession.revoked_at.is_(None)
            ).first()
            if sess and sess.last_visited_scope:
                return RedirectResponse(url=sess.last_visited_scope, status_code=302)
        return RedirectResponse(url="/p/shymkent/w/xci/shifts#production", status_code=302)

    return FileResponse("static/index.html", headers=HTML_NO_CACHE_HEADERS)


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return FileResponse("static/img/Logo.png")

@app.get("/manifest.json", include_in_schema=False)
def serve_manifest():
    manifest_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static", "manifest.json")
    if os.path.exists(manifest_path):
        return FileResponse(manifest_path, media_type="application/manifest+json")
    return JSONResponse({
        "name": "Tectum Enterprise",
        "short_name": "Tectum",
        "description": "Единый мобильный портал завода Tectum",
        "start_url": "/?source=pwa",
        "display": "standalone",
        "background_color": "#ffffff",
        "theme_color": "#950405",
        "orientation": "portrait-primary",
        "scope": "/",
        "lang": "ru",
        "icons": [
            {"src": "/static/img/icons/icon-192x192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
            {"src": "/static/img/icons/icon-512x512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"}
        ]
    }, media_type="application/manifest+json")

@app.get("/service-worker.js", include_in_schema=False)
@app.get("/sw.js", include_in_schema=False)
def serve_service_worker():
    return FileResponse(
        "static/service-worker.js",
        media_type="application/javascript",
        headers={"Service-Worker-Allowed": "/", "Cache-Control": "no-cache"}
    )

# ==========================================
# CANONICAL REDIRECTS TO TENANT SCOPES (ANTI-BLEED)
# ==========================================
@app.get("/admin", include_in_schema=False)
def redirect_admin():
    return RedirectResponse("/p/shymkent/w/xci/admin", status_code=302)

@app.get("/analytics", include_in_schema=False)
def redirect_analytics():
    return RedirectResponse("/p/shymkent/w/xci/technologist", status_code=302)

@app.get("/tasks", include_in_schema=False)
@app.get("/planner", include_in_schema=False)
def redirect_tasks():
    return RedirectResponse("/p/shymkent/w/xci/tasks", status_code=302)

@app.get("/docs", include_in_schema=False)
@app.get("/knowledge", include_in_schema=False)
@app.get("/base", include_in_schema=False)
def redirect_docs():
    return RedirectResponse("/p/shymkent/w/all/docs", status_code=302)

@app.get("/checklists", include_in_schema=False)
def redirect_checklists():
    return RedirectResponse("/p/shymkent/w/xci/checklists", status_code=302)

@app.get("/qcd", include_in_schema=False)
def redirect_qcd():
    return RedirectResponse("/p/shymkent/w/skk/shifts", status_code=302)

@app.get("/lkc", include_in_schema=False)
def redirect_lkc():
    return RedirectResponse("/p/shymkent/w/lkc/shifts", status_code=302)




if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8080))
    uvicorn.run("main:app", host="0.0.0.0", port=port)




