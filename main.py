from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Request, BackgroundTasks, Query, Body
from typing import Optional
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, RedirectResponse, HTMLResponse
from sqlalchemy.orm import Session
from database import SessionLocal, engine, Base
import models, schemas
import os
import re
import asyncio
import threading
import json
import hashlib
import html
try:
    import m365_integration
except ImportError:
    m365_integration = None
import requests
import excel_exporter
import import_aci_excel
from datetime import datetime, date
from pydantic import BaseModel
from sqlalchemy import or_, and_, func
from sqlalchemy.orm import selectinload, joinedload
from contextlib import asynccontextmanager
import seed_norms
import calendar
from datetime import timedelta
import openpyxl
from openpyxl.chart import BarChart, Reference
import io
from fastapi import Response
from urllib.parse import quote
try:
    import msal
except ImportError:
    msal = None
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
    def bg_startup_all():
        try:
            Base.metadata.create_all(bind=engine)
            
            # SQLite alter table hack to auto-add columns if they don't exist
            import sqlite3
            try:
                conn = sqlite3.connect("tectum.db")
                try:
                    conn.execute("ALTER TABLE raw_material_receipts ADD COLUMN master_id INTEGER;")
                except: pass
                for col_name, col_def in [
                    ("google_synced", "BOOLEAN DEFAULT 0"),
                    ("google_synced_at", "TIMESTAMP"),
                    ("google_sync_error", "TEXT")
                ]:
                    try:
                        conn.execute(f"ALTER TABLE shifts ADD COLUMN {col_name} {col_def};")
                    except: pass
                conn.commit()
                conn.close()
            except: pass
            
            # Ensure indexes for documents & document_categories
            try:
                db = SessionLocal()
                from sqlalchemy import text
                driver = db.bind.dialect.name if db.bind else 'unknown'
                if driver == 'postgresql':
                    db.execute(text("CREATE INDEX IF NOT EXISTS idx_documents_category_id ON documents (category_id);"))
                    db.execute(text("CREATE INDEX IF NOT EXISTS idx_doc_categories_parent_id ON document_categories (parent_id);"))
                    db.execute(text("ALTER TABLE shifts ADD COLUMN IF NOT EXISTS google_synced BOOLEAN DEFAULT FALSE;"))
                    db.execute(text("ALTER TABLE shifts ADD COLUMN IF NOT EXISTS google_synced_at TIMESTAMP;"))
                    db.execute(text("ALTER TABLE shifts ADD COLUMN IF NOT EXISTS google_sync_error TEXT;"))
                    db.execute(text("UPDATE monthly_plan_board SET plan_sheets = 800 WHERE line = 'ЛФМ-1' AND date >= '2026-09-07' AND shift_name = 'День' AND plan_sheets IN (2700, 0);"))
                    db.execute(text("UPDATE monthly_plan_board SET plan_sheets = 1200 WHERE line = 'ЛФМ-1' AND date >= '2026-09-07' AND shift_name = 'Ночь' AND plan_sheets IN (3300, 0);"))
                    db.commit()
                elif driver == 'sqlite':
                    db.execute(text("UPDATE monthly_plan_board SET plan_sheets = 800 WHERE line = 'ЛФМ-1' AND date >= '2026-09-07' AND shift_name = 'День' AND plan_sheets IN (2700, 0);"))
                    db.execute(text("UPDATE monthly_plan_board SET plan_sheets = 1200 WHERE line = 'ЛФМ-1' AND date >= '2026-09-07' AND shift_name = 'Ночь' AND plan_sheets IN (3300, 0);"))
                    db.commit()
            except Exception as e:
                print(f"Warning: could not update plan_board norms or indexes: {e}")
            finally:
                db.close()

            # PG version - ensure master_id column exists
            try:
                db = SessionLocal()
                driver = db.bind.dialect.name if db.bind else 'unknown'
                if driver == 'postgresql':
                    from sqlalchemy import text
                    col_exists = db.execute(text(
                        "SELECT column_name FROM information_schema.columns WHERE table_name='raw_material_receipts' AND column_name='master_id'"
                    )).fetchone()
                    if not col_exists:
                        print("Adding master_id column to raw_material_receipts on PostgreSQL...")
                        db.execute(text("ALTER TABLE raw_material_receipts ADD COLUMN master_id INTEGER REFERENCES masters(id);"))
                        db.commit()
                        print("master_id column added successfully.")
            except Exception as e:
                print(f"Warning: could not add master_id column: {e}")
                db.rollback()
            finally:
                db.close()

            # Clean up document titles in background
            try:
                db_c = SessionLocal()
                docs = db_c.query(models.Document).all()
                cleaned_count = 0
                from routers.documents import detect_external_mime_type
                for doc in docs:
                    changed = False
                    if doc.title and ("/" in doc.title or "\\" in doc.title):
                        doc.title = os.path.basename(doc.title.replace("\\", "/"))
                        changed = True
                    if doc.title:
                        t = doc.title
                        for suffix in [
                            " – Google Диск", " — Google Диск", " - Google Диск",
                            " – Google Таблицы", " — Google Таблицы", " - Google Таблицы",
                            " – Google Документы", " — Google Документы", " - Google Документы",
                            " – Google Презентации", " — Google Презентации", " - Google Презентации",
                            " – Google Формы", " — Google Формы", " - Google Формы",
                            " – Google Drive", " — Google Drive", " - Google Drive",
                            " – Google Sheets", " — Google Sheets", " - Google Sheets",
                            " – Google Docs", " — Google Docs", " - Google Docs",
                            " – OneDrive", " — OneDrive", " - OneDrive"
                        ]:
                            if t.endswith(suffix):
                                t = t[:-len(suffix)].strip()
                                changed = True
                        doc.title = t
                    if doc.external_url:
                        correct_mime = detect_external_mime_type(doc.external_url)
                        if correct_mime and doc.mime_type != correct_mime:
                            doc.mime_type = correct_mime
                            changed = True
                    if changed:
                        cleaned_count += 1
                if cleaned_count > 0:
                    db_c.commit()
                    print(f"Cleaned/updated {cleaned_count} document titles and mime types.")
            except Exception as e:
                print(f"Warning: could not clean document titles: {e}")
            finally:
                db_c.close()

            # Masters & Roles Seed
            db = SessionLocal()
            try:
                if not db.query(models.Master).filter(models.Master.role == "master").first():
                    db.add(models.Master(name="Бекбосынов Р.", pin="1234", role="master"))
                    db.add(models.Master(name="Монаев С.", pin="1234", role="master"))
                    db.add(models.Master(name="Султанулы С.", pin="1234", role="master"))
                    db.add(models.Master(name="Дауылбай М.", pin="1234", role="master"))
                    db.add(models.Master(name="Оператор ЗО", pin="2222", role="zo"))
                    db.add(models.Master(name="Машинист ЛФМ", pin="3333", role="lfm"))
                    db.add(models.Master(name="Стакер", pin="4444", role="stacker"))
                    db.add(models.Master(name="Дестакер", pin="5555", role="destacker"))
                    db.add(models.Master(name="Инспектор СКК", pin="6666", role="qcd"))
                    db.add(models.Master(name="Главный механик", pin="8888", role="mechanic"))
                    db.commit()

                generic_master = db.query(models.Master).filter(models.Master.name == "Мастер смены").first()
                if not generic_master:
                    db.add(models.Master(name="Мастер смены", pin="1234", role="master"))
                    db.commit()

                levda = db.query(models.Master).filter(models.Master.name.like("%Левда%")).first()
                if not levda:
                    db.add(models.Master(name="Левда М.", pin="6282", role="admin"))
                else:
                    levda.name = "Левда М."
                    levda.pin = "6282"
                    levda.role = "admin"

                bulekhanov = db.query(models.Master).filter(or_(models.Master.name.like("%Булеханов%"), models.Master.name.like("%Булекпаев%"))).first()
                if not bulekhanov:
                    db.add(models.Master(name="Булеханов К.", pin="2026", role="director"))
                else:
                    bulekhanov.name = "Булеханов К."
                    bulekhanov.pin = "2026"
                    bulekhanov.role = "director"

                musailova = db.query(models.Master).filter(or_(models.Master.name.like("%Мусаилова%"), models.Master.name == "Зарина", models.Master.id == 25)).first()
                if not musailova:
                    db.add(models.Master(name="Мусаилова З.", pin="0000", role="qcd"))
                else:
                    musailova.name = "Мусаилова З."
                    musailova.pin = "0000"
                    musailova.role = "qcd"

                mirkasimov = db.query(models.Master).filter(or_(models.Master.name.like("%Миркасимов%"), models.Master.name == "Мастер ЛКЦ", models.Master.role == "lkc_master")).first()
                if not mirkasimov:
                    db.add(models.Master(name="Миркасимов И.М.", pin="4321", role="lkc_master"))
                else:
                    mirkasimov.name = "Миркасимов И.М."
                    mirkasimov.pin = "4321"
                    mirkasimov.role = "lkc_master"

                # Гарантия создания таблиц СКК и ЛКЦ
                models.QcdSortingReport.__table__.create(bind=engine, checkfirst=True)
                models.QcdMonthlySpreadsheet.__table__.create(bind=engine, checkfirst=True)
                models.QcdLabAnalysis.__table__.create(bind=engine, checkfirst=True)
                models.LKCShiftReport.__table__.create(bind=engine, checkfirst=True)
                models.LKCReportItem.__table__.create(bind=engine, checkfirst=True)
                models.LKCDowntime.__table__.create(bind=engine, checkfirst=True)
                db.commit()
                print("Seeded core master profiles (Левда М., Булеханов К., Мусаилова З., Миркасимов И.М. PIN 4321).")
            except Exception as e:
                print(f"Error seeding users: {e}")
                db.rollback()
            finally:
                db.close()

            seed_norms.seed_norms()

            # Telegram Webhook
            try:
                tg_token = os.getenv("TELEGRAM_BOT_TOKEN", "8980370531:AAGGhgbRH04LT_KOMUHr02ms1X4wZ0b3LwY").strip()
                webhook_url = "https://tectum-portal-railway-production.up.railway.app/api/telegram/webhook"
                r = requests.post(f"https://api.telegram.org/bot{tg_token}/setWebhook", json={"url": webhook_url}, timeout=5)
                print(f"[Telegram Startup] Webhook setup status: {r.json()}")
            except Exception as tg_err:
                pass

        except Exception as startup_err:
            print(f"Background startup error: {startup_err}")

    threading.Thread(target=bg_startup_all, daemon=True).start()

    yield

app = FastAPI(title="Tectum Enterprise Portal", lifespan=lifespan)

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
    elif path.endswith(".html") or path in ("/", "/admin", "/analytics", "/tasks", "/planner", "/docs", "/checklists", "/qcd"):
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

@app.get("/")
def read_root():
    return FileResponse("static/index.html", headers=HTML_NO_CACHE_HEADERS)

@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return FileResponse("static/img/Logo.png")

@app.get("/admin")
def serve_admin():
    return FileResponse("static/admin.html", headers=HTML_NO_CACHE_HEADERS)

@app.get("/analytics")
def read_analytics():
    return FileResponse("static/analytics.html", headers=HTML_NO_CACHE_HEADERS)

@app.get("/tasks")
def serve_tasks():
    return FileResponse("static/tasks.html", headers=HTML_NO_CACHE_HEADERS)

@app.get("/planner")
def serve_planner():
    return FileResponse("static/tasks.html", headers=HTML_NO_CACHE_HEADERS)

@app.get("/docs")
def serve_docs():
    return FileResponse("static/docs.html", headers=HTML_NO_CACHE_HEADERS)

@app.get("/checklists")
def serve_checklists():
    return FileResponse("static/checklists.html", headers=HTML_NO_CACHE_HEADERS)

@app.get("/qcd")
def serve_qcd():
    return FileResponse("static/qcd.html", headers=HTML_NO_CACHE_HEADERS)

@app.get("/lkc")
def serve_lkc():
    return FileResponse("static/lkc.html", headers=HTML_NO_CACHE_HEADERS)


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8080))
    uvicorn.run("main:app", host="0.0.0.0", port=port)




