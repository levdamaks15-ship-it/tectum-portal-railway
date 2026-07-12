from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Request, BackgroundTasks
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, RedirectResponse
from sqlalchemy.orm import Session
from database import SessionLocal, engine, Base
import models, schemas
import os
import asyncio
import m365_integration
import excel_exporter
import import_aci_excel
from datetime import datetime
from pydantic import BaseModel
from sqlalchemy import or_, func
from contextlib import asynccontextmanager
import seed_norms
import calendar
from datetime import timedelta
import openpyxl
from openpyxl.chart import BarChart, Reference
import io
from fastapi import Response
from urllib.parse import quote
import msal
import requests
from starlette.middleware.sessions import SessionMiddleware

@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    
    # SQLite alter table hack to auto-add columns if they don't exist
    import sqlite3
    try:
        conn = sqlite3.connect("tectum.db")
        conn.execute("ALTER TABLE shifts ADD COLUMN batch_number VARCHAR(255)")
        conn.commit()
        conn.close()
    except: pass
    try:
        conn = sqlite3.connect("tectum.db")
        conn.execute("ALTER TABLE shifts ADD COLUMN product_name VARCHAR(255)")
        conn.commit()
        conn.close()
    except: pass
    
    try:
        conn = sqlite3.connect("tectum.db")
        conn.execute("ALTER TABLE monthly_plan_board ADD COLUMN first_grade INTEGER DEFAULT 0")
        conn.commit()
        conn.close()
    except: pass
    
    try:
        conn = sqlite3.connect("tectum.db")
        conn.execute("ALTER TABLE monthly_plan_board ADD COLUMN defect INTEGER DEFAULT 0")
        conn.commit()
        conn.close()
    except: pass
    
    try:
        conn = sqlite3.connect("tectum.db")
        conn.execute("ALTER TABLE masters ADD COLUMN email VARCHAR(255)")
        conn.commit()
        conn.close()
    except: pass

    try:
        conn = sqlite3.connect("tectum.db")
        conn.execute("ALTER TABLE downtimes ADD COLUMN department VARCHAR(255)")
        conn.commit()
        conn.close()
    except: pass

    try:
        conn = sqlite3.connect("tectum.db")
        conn.execute("ALTER TABLE downtime_directory ADD COLUMN category VARCHAR(255)")
        conn.commit()
        conn.close()
    except: pass

    try:
        conn = sqlite3.connect("tectum.db")
        conn.execute("ALTER TABLE downtimes ADD COLUMN is_equipment_downtime BOOLEAN DEFAULT 1")
        conn.commit()
        conn.close()
    except: pass

    # Migrations for Shift (Asbocarton & Drains)
    try:
        conn = sqlite3.connect("tectum.db")
        conn.execute("ALTER TABLE shifts ADD COLUMN zo_asbocarton FLOAT DEFAULT 0.0")
        conn.commit()
        conn.close()
    except: pass

    try:
        conn = sqlite3.connect("tectum.db")
        conn.execute("ALTER TABLE shifts ADD COLUMN lfm_asb_drain FLOAT DEFAULT 0.0")
        conn.commit()
        conn.close()
    except: pass

    try:
        conn = sqlite3.connect("tectum.db")
        conn.execute("ALTER TABLE shifts ADD COLUMN lfm_cem_drain FLOAT DEFAULT 0.0")
        conn.commit()
        conn.close()
    except: pass

    try:
        conn = sqlite3.connect("tectum.db")
        conn.execute("ALTER TABLE shifts ADD COLUMN receipt_asbocarton FLOAT DEFAULT 0.0")
        conn.commit()
        conn.close()
    except: pass

    try:
        conn = sqlite3.connect("tectum.db")
        conn.execute("ALTER TABLE shifts ADD COLUMN receipt_pallets FLOAT DEFAULT 0.0")
        conn.commit()
        conn.close()
    except: pass

    try:
        conn = sqlite3.connect("tectum.db")
        conn.execute("ALTER TABLE shifts ADD COLUMN sharepoint_url VARCHAR(500)")
        conn.commit()
        conn.close()
    except: pass

    # SQLite migrations for monthly_plan_board columns
    for col, col_def in [("first_grade", "INTEGER DEFAULT 0"), ("defect", "INTEGER DEFAULT 0"), ("line", "VARCHAR(255) DEFAULT 'LFM-1'")]:
        try:
            conn = sqlite3.connect("tectum.db")
            conn.execute(f"ALTER TABLE monthly_plan_board ADD COLUMN {col} {col_def}")
            conn.commit()
            conn.close()
        except: pass

    # PostgreSQL auto-migration for missing columns
    if "postgresql" in engine.url.drivername or "postgres" in engine.url.drivername:
        from sqlalchemy import text
        pg_cols_to_add = [
            ("monthly_plan_board", "first_grade", "INTEGER DEFAULT 0"),
            ("monthly_plan_board", "defect", "INTEGER DEFAULT 0"),
            ("monthly_plan_board", "line", "VARCHAR(255) DEFAULT 'LFM-1'"),
            ("masters", "email", "VARCHAR(255)"),
            ("downtimes", "department", "VARCHAR(255)"),
            ("downtime_directory", "category", "VARCHAR(255)"),
            ("downtimes", "is_equipment_downtime", "BOOLEAN DEFAULT TRUE"),
            ("shifts", "zo_asbocarton", "DOUBLE PRECISION DEFAULT 0.0"),
            ("shifts", "lfm_asb_drain", "DOUBLE PRECISION DEFAULT 0.0"),
            ("shifts", "lfm_cem_drain", "DOUBLE PRECISION DEFAULT 0.0"),
            ("shifts", "receipt_asbocarton", "DOUBLE PRECISION DEFAULT 0.0"),
            ("shifts", "receipt_pallets", "DOUBLE PRECISION DEFAULT 0.0"),
            ("shifts", "sharepoint_url", "VARCHAR(500)")
        ]
        for table, col, col_def in pg_cols_to_add:
            try:
                with engine.connect() as conn:
                    res = conn.execute(text(f"""
                        SELECT column_name 
                        FROM information_schema.columns 
                        WHERE table_name='{table}' AND column_name='{col}';
                    """)).fetchone()
                    if not res:
                        print(f"Adding column '{col}' to table '{table}' in PostgreSQL...")
                        conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {col_def};"))
                        conn.commit()
                        print(f"Column '{col}' added successfully.")
            except Exception as pg_err:
                print(f"Error adding column '{col}' to table '{table}' in PostgreSQL: {pg_err}")

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
        if not db.query(models.Master).filter(models.Master.role == "director").first():
            db.add(models.Master(name="Технический директор", pin="7777", role="director"))
            db.commit()
        if not db.query(models.Master).filter(models.Master.role == "technologist").first():
            db.add(models.Master(name="Главный технолог", pin="9999", role="technologist"))
            db.commit()
        if not db.query(models.Master).filter(models.Master.email == "admin@TectumEngineering.onmicrosoft.com").first():
            db.add(models.Master(name="Tectum Engineering", pin="0000", role="admin", email="admin@TectumEngineering.onmicrosoft.com"))
            db.commit()
        
        # Auto-import downtimes directory if empty
        try:
            from import_downtimes import import_downtimes
            if db.query(models.DowntimeDirectory).count() == 0:
                print("Downtime directory is empty. Importing automatically...")
                import_downtimes()
        except Exception as e:
            print(f"Auto-importing downtimes failed: {e}")
    finally:
        db.close()
    
    seed_norms.seed_norms()

    # Seed generic master profile 'Мастер смены'
    db = SessionLocal()
    try:
        generic_master = db.query(models.Master).filter(models.Master.name == "Мастер смены").first()
        if not generic_master:
            generic_master = models.Master(name="Мастер смены", pin="1234", role="master")
            db.add(generic_master)
            db.commit()
            print("Successfully seeded 'Мастер смены' profile.")
    except Exception as e:
        print(f"Error seeding generic master: {e}")
    finally:
        db.close()

    # SharePoint directories bootstrap/sync check
    db = SessionLocal()
    try:
        if not m365_integration.check_file_exists_on_sharepoint("Справочники_Tectum.xlsx", folder="Shifts"):
            print("Справочники_Tectum.xlsx is missing on SharePoint, uploading initial template...")
            template_bytes = excel_exporter.create_initial_directories_xlsx(db)
            m365_integration.upload_file_to_sharepoint(template_bytes, "Справочники_Tectum.xlsx", folder="Shifts")
            print("Template uploaded successfully.")
        else:
            print("Справочники_Tectum.xlsx exists on SharePoint, syncing directories...")
            file_bytes = m365_integration.download_file_from_sharepoint("Справочники_Tectum.xlsx", folder="Shifts")
            excel_exporter.sync_directories_from_excel_bytes(file_bytes, db)
            print("Directories auto-synced from SharePoint successfully.")
    except Exception as e:
        print(f"Error checking/syncing directories with SharePoint on startup: {e}")
    finally:
        db.close()

    yield

app = FastAPI(title="Tectum Enterprise Portal", lifespan=lifespan)
app.add_middleware(
    SessionMiddleware, 
    secret_key=os.getenv("SESSION_SECRET_KEY", "super-secret-key-for-tectum-portal"),
    max_age=86400 * 30  # 30 days
)

@app.middleware("http")
async def add_no_cache_headers(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

TONS_PER_HOUR = 5.0
PRICE_PER_TON = 100000.0

if not os.path.exists("static"):
    os.makedirs("static")
app.mount("/static", StaticFiles(directory="static"), name="static")

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@app.get("/")
def read_root():
    return FileResponse("static/index.html")

@app.post("/api/setup_demo_data/")
def setup_demo_data(db: Session = Depends(get_db)):
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
    
    if not db.query(models.Master).filter(models.Master.role == "director").first():
        db.add(models.Master(name="Технический директор", pin="7777", role="director"))
        db.commit()

    if not db.query(models.Master).filter(models.Master.role == "technologist").first():
        db.add(models.Master(name="Главный технолог", pin="9999", role="technologist"))
        db.commit()

    return {"message": "Demo data loaded"}

class LoginRequest(BaseModel):
    name: str
    pin: str

@app.post("/api/login/")
def login(data: LoginRequest, request: Request, db: Session = Depends(get_db)):
    master = db.query(models.Master).filter(models.Master.name == data.name, models.Master.pin == data.pin).first()
    if not master:
        raise HTTPException(status_code=400, detail="Неверное имя или ПИН-код")
    request.session["user_id"] = master.id
    request.session["user_name"] = master.name
    request.session["user_role"] = master.role
    return {"id": master.id, "name": master.name, "role": master.role}

@app.get("/api/me/")
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

@app.get("/api/auth/login")
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

@app.get("/api/auth/callback")
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

@app.get("/api/auth/logout")
def auth_logout(request: Request):
    request.session.clear()
    return RedirectResponse(url="/")

@app.get("/api/masters/")
def get_masters(db: Session = Depends(get_db)):
    return db.query(models.Master).all()

# --- УПРАВЛЕНИЕ СМЕНОЙ ---
@app.post("/api/shifts/", response_model=schemas.Shift)
def create_shift(shift: schemas.ShiftCreate, request: Request, db: Session = Depends(get_db)):
    user_id = request.session.get("user_id")
    user_role = request.session.get("user_role")
    if user_role not in ["master", "admin"]:
        raise HTTPException(status_code=403, detail="Доступ запрещен. Только мастер смены или администратор могут открывать смены.")
        
    active = db.query(models.Shift).filter(models.Shift.status == "active").first()
    if active:
        if user_role != "admin" and active.master_id != user_id:
            master_name = active.master.name if active.master else "другим мастером"
            raise HTTPException(status_code=403, detail=f"Уже есть активная смена, открытая мастером {master_name}. Вы не можете начать новую смену.")
        
    db_shift = models.Shift(**shift.model_dump())
    db.add(db_shift)
    db.commit()
    db.refresh(db_shift)
    return db_shift

@app.get("/api/shifts/active", response_model=list[schemas.Shift])
def get_active_shifts(db: Session = Depends(get_db)):
    return db.query(models.Shift).filter(models.Shift.status == "active").all()

@app.get("/api/shifts/all", response_model=list[schemas.Shift])
def get_all_shifts(db: Session = Depends(get_db)):
    return db.query(models.Shift).order_by(models.Shift.date.desc(), models.Shift.id.desc()).all()

@app.get("/api/shifts/{shift_id}", response_model=schemas.Shift)
def get_single_shift(shift_id: int, db: Session = Depends(get_db)):
    shift = db.query(models.Shift).get(shift_id)
    if not shift: raise HTTPException(404, "Смена не найдена")
    return shift

async def upload_sharepoint_report_retry(file_bytes: bytes, filename: str, folder: str, retries: int = 5, delay: int = 60):
    for i in range(retries):
        await asyncio.sleep(delay)
        try:
            print(f"Background task: Attempting to upload {filename} to SharePoint (attempt {i+1})...")
            m365_integration.upload_file_to_sharepoint(file_bytes, filename, folder=folder)
            print(f"Background task: Successfully uploaded {filename} to SharePoint on attempt {i+1}")
            
            db = SessionLocal()
            try:
                db.add(models.AuditLog(
                    user_name="system_background",
                    action="UPDATE",
                    target_table="shifts",
                    target_id=0,
                    details=f"Фоновая автосинхронизация: отчет {filename} успешно обновлен на SharePoint после освобождения файла."
                ))
                db.commit()
            except Exception as audit_err:
                print(f"Error logging background sync success: {audit_err}")
            finally:
                db.close()
            break
        except Exception as e:
            print(f"Background task: Attempt {i+1} failed to upload {filename}: {e}")
            delay = delay * 2

@app.put("/api/shifts/{shift_id}/close")
def close_shift(shift_id: int, request: Request, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    user_id = request.session.get("user_id")
    user_role = request.session.get("user_role")
    
    if not user_id:
        raise HTTPException(status_code=401, detail="Вы не авторизованы")
        
    if user_role not in ["master", "admin"]:
        raise HTTPException(status_code=403, detail="Доступ запрещен. Только мастер смены или администратор могут закрывать смены.")
        
    shift = db.query(models.Shift).get(shift_id)
    if not shift:
        raise HTTPException(404, "Смена не найдена")
        
    if user_role != "admin" and shift.master_id != user_id:
        raise HTTPException(
            status_code=403,
            detail="Доступ запрещен. Только мастер, открывший смену, или администратор могут закрыть её."
        )
        
    shift.status = "closed"
    db.commit()
    
    # Generate unified Excel flat report in memory and upload to SharePoint
    try:
        file_bytes = excel_exporter.generate_flat_report(db)
        filename = "Сводный_отчет_Tectum.xlsx"
        
        # Save locally to static folder as well
        local_path = os.path.join("static", "Сводный_отчет_Tectum.xlsx")
        try:
            with open(local_path, "wb") as f:
                f.write(file_bytes)
        except Exception as local_err:
            print(f"Error saving local excel file: {local_err}")
            
        web_url = m365_integration.upload_file_to_sharepoint(file_bytes, filename, folder="Reports")
        shift.sharepoint_url = web_url
        db.commit()
        
        # Log to AuditLog
        audit_detail = f"Смена {shift_id} закрыта. Сводный отчет сгенерирован и загружен в SharePoint: {web_url}"
        db.add(models.AuditLog(
            user_name=request.session.get("user_email") or f"user_{user_id}",
            action="UPDATE",
            target_table="shifts",
            target_id=shift_id,
            details=audit_detail
        ))
        db.commit()
        return {"message": "Смена закрыта"}
    except Exception as e:
        print(f"Error generating/uploading unified report Excel: {e}")
        error_msg = str(e)
        warning_text = None
        if "423" in error_msg or "Locked" in error_msg:
            warning_text = "Сводный отчет заблокирован в SharePoint (кто-то открыл его в Excel Online). Смена успешно закрыта, но облачный отчет не обновился. Запущена фоновая автосинхронизация, локальная копия сохранена на сервере."
        else:
            warning_text = f"Смена закрыта, но произошла ошибка при загрузке отчета на SharePoint: {error_msg}. Запущена фоновая автосинхронизация, локальная копия сохранена на сервере."
            
        # Queue background task to retry upload
        try:
            file_bytes = excel_exporter.generate_flat_report(db)
            background_tasks.add_task(upload_sharepoint_report_retry, file_bytes, "Сводный_отчет_Tectum.xlsx", "Reports")
        except Exception as gen_err:
            print(f"Failed to queue background sync: {gen_err}")
            
        audit_detail = f"Смена {shift_id} закрыта. Предупреждение по SharePoint: {warning_text}"
        try:
            db.add(models.AuditLog(
                user_name=request.session.get("user_email") or f"user_{user_id}",
                action="UPDATE",
                target_table="shifts",
                target_id=shift_id,
                details=audit_detail
            ))
            db.commit()
        except: pass
        return {"message": "Смена закрыта", "warning": warning_text}

@app.get("/api/shifts/{shift_id}/download_passport")
def download_shift_passport(shift_id: int, request: Request, db: Session = Depends(get_db)):
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Вы не авторизованы")
        
    shift = db.query(models.Shift).get(shift_id)
    if not shift:
        raise HTTPException(404, "Смена не найдена")
        
    # If sharepoint_url is already available, redirect to it
    if shift.sharepoint_url:
        return RedirectResponse(url=shift.sharepoint_url)
        
    # If not available (e.g. upload failed initially or it's an old shift), generate and upload now
    try:
        file_bytes = excel_exporter.generate_flat_report(db)
        filename = "Сводный_отчет_Tectum.xlsx"
        web_url = m365_integration.upload_file_to_sharepoint(file_bytes, filename, folder="Reports")
        shift.sharepoint_url = web_url
        db.commit()
        return RedirectResponse(url=web_url)
    except Exception as e:
        print(f"SharePoint upload failed in download_passport fallback: {e}")
        # Fallback to local on-the-fly download if SharePoint is totally failing
        try:
            file_bytes = excel_exporter.generate_flat_report(db)
            from fastapi import Response
            from urllib.parse import quote
            safe_filename = quote("Сводный_отчет_Tectum.xlsx")
            return Response(
                content=file_bytes, 
                media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", 
                headers={'Content-Disposition': f'attachment; filename="{safe_filename}"; filename*=UTF-8\'\'{safe_filename}'}
            )
        except Exception as inner_e:
            raise HTTPException(500, f"Не удалось сгенерировать сводный отчет: {str(e)} | fallback error: {str(inner_e)}")

@app.post("/api/admin/sync_directories_sharepoint")
def sync_directories_sharepoint(request: Request, db: Session = Depends(get_db)):
    user_id = request.session.get("user_id")
    user_role = request.session.get("user_role")
    if not user_id:
        raise HTTPException(status_code=401, detail="Вы не авторизованы")
    if user_role != "admin":
        raise HTTPException(status_code=403, detail="Доступ разрешен только администраторам")
        
    try:
        # Check if directories file exists
        if not m365_integration.check_file_exists_on_sharepoint("Справочники_Tectum.xlsx", folder="Shifts"):
            # Create a template and upload it
            template_bytes = excel_exporter.create_initial_directories_xlsx(db)
            m365_integration.upload_file_to_sharepoint(template_bytes, "Справочники_Tectum.xlsx", folder="Shifts")
            return {"status": "ok", "message": "Файл Справочники_Tectum.xlsx отсутствовал на SharePoint. Создан шаблон и загружен в облако."}
            
        file_bytes = m365_integration.download_file_from_sharepoint("Справочники_Tectum.xlsx", folder="Shifts")
        excel_exporter.sync_directories_from_excel_bytes(file_bytes, db)
        
        # Log to AuditLog
        db.add(models.AuditLog(
            user_name=request.session.get("user_email") or f"admin_{user_id}",
            action="IMPORT",
            target_table="product_norms/downtime_directory",
            details="Синхронизация технологических норм и справочника простоев из файла Справочники_Tectum.xlsx в SharePoint."
        ))
        db.commit()
        return {"status": "ok", "message": "Справочники успешно синхронизированы из SharePoint!"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка синхронизации: {str(e)}")

@app.post("/api/admin/upload_aci_report")
async def upload_aci_report(request: Request, file: UploadFile = File(...), db: Session = Depends(get_db)):
    user_id = request.session.get("user_id")
    user_role = request.session.get("user_role")
    if not user_id:
        raise HTTPException(status_code=401, detail="Вы не авторизованы")
    if user_role != "admin":
        raise HTTPException(status_code=403, detail="Доступ разрешен только администраторам")
        
    try:
        # Импортируем данные
        res = import_aci_excel.import_aci_excel_data(file.file, db)
        
        # Логируем действие в AuditLog
        db.add(models.AuditLog(
            user_name=request.session.get("user_email") or f"admin_{user_id}",
            action="IMPORT",
            target_table="shifts/batches/lfm_reports",
            details=f"Импорт рапорта АЦИ из файла {file.filename}. Успешно: смен: {res['shifts']}, партий: {res['batches']}, ЛФМ: {res['lfm_reports']}"
        ))
        db.commit()
        
        # Автоматически перегенерируем сводный отчет в SharePoint
        try:
            file_bytes = excel_exporter.generate_flat_report(db)
            filename = "Сводный_отчет_Tectum.xlsx"
            
            # Локальная копия
            local_path = os.path.join("static", "Сводный_отчет_Tectum.xlsx")
            try:
                with open(local_path, "wb") as f:
                    f.write(file_bytes)
            except Exception as local_err:
                print(f"Error saving local excel file: {local_err}")
                
            web_url = m365_integration.upload_file_to_sharepoint(file_bytes, filename, folder="Reports")
            
            # Обновим sharepoint_url у всех импортированных смен, чтобы они вели на этот отчет
            shifts = db.query(models.Shift).all()
            for s in shifts:
                s.sharepoint_url = web_url
            db.commit()
            
            res["sharepoint_url"] = web_url
        except Exception as sp_err:
            print(f"SharePoint update failed during ACI import: {sp_err}")
            res["sharepoint_url"] = None
            res["sharepoint_error"] = str(sp_err)
            
        return res
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Ошибка обработки рапорта АЦИ: {str(e)}")




# --- ПРИХОД И ЗО ---
class UpdateReceiptZO(BaseModel):
    chrysotile_4_20: float = 0
    chrysotile_5_65: float = 0
    chrysotile_6_40: float = 0
    cement: float = 0
    cement_silo1: float = 0
    cement_silo2: float = 0
    cement_silo3: float = 0
    cement_silo4: float = 0
    cellulose: float = 0
    crushed_slate: float = 0
    asbozurit: float = 0
    fiberglass: float = 0
    laprol: float = 0
    asbocarton: float = 0
    pallets: float = 0
    asb_drain: float = 0
    cem_drain: float = 0
    batches: int = 0
    submitted: bool = False

class LFMDrainsUpdate(BaseModel):
    asb_drain: float = 0
    cem_drain: float = 0

@app.post("/api/shifts/{shift_id}/receipt")
def update_receipt(shift_id: int, data: UpdateReceiptZO, request: Request, db: Session = Depends(get_db)):
    user_id = request.session.get("user_id")
    user_role = request.session.get("user_role")
    if not user_id:
        raise HTTPException(status_code=401, detail="Вы не авторизованы")
        
    shift = db.query(models.Shift).get(shift_id)
    if not shift: raise HTTPException(404, "Смена не найдена")
    
    if user_role == "master" and shift.master_id != user_id:
        master_name = shift.master.name if shift.master else "другим мастером"
        raise HTTPException(status_code=403, detail=f"Вы не можете редактировать рецепт этой смены, так как она была открыта мастером {master_name}.")
        
    if user_role not in ["master", "admin", "director", "technologist"]:
        raise HTTPException(status_code=403, detail="Недостаточно прав")
        
    shift.receipt_chrysotile_4_20 = data.chrysotile_4_20
    shift.receipt_chrysotile_5_65 = data.chrysotile_5_65
    shift.receipt_chrysotile_6_40 = data.chrysotile_6_40
    shift.receipt_cement = data.cement
    shift.receipt_cellulose = data.cellulose
    shift.receipt_crushed_slate = data.crushed_slate
    shift.receipt_asbozurit = data.asbozurit
    shift.receipt_asbocarton = data.asbocarton
    shift.receipt_pallets = data.pallets
    shift.receipt_fiberglass = data.fiberglass
    shift.receipt_laprol = data.laprol
    db.commit()
    return {"status": "ok"}

@app.post("/api/shifts/{shift_id}/zo")
def update_zo(shift_id: int, data: UpdateReceiptZO, request: Request, db: Session = Depends(get_db)):
    user_id = request.session.get("user_id")
    user_role = request.session.get("user_role")
    if not user_id:
        raise HTTPException(status_code=401, detail="Вы не авторизованы")
        
    shift = db.query(models.Shift).get(shift_id)
    if not shift: raise HTTPException(404, "Смена не найдена")
    
    if user_role == "master" and shift.master_id != user_id:
        master_name = shift.master.name if shift.master else "другим мастером"
        raise HTTPException(status_code=403, detail=f"Вы не можете редактировать данные ЗО этой смены, так как она была открыта мастером {master_name}.")
        
    if user_role not in ["master", "admin", "zo"]:
        raise HTTPException(status_code=403, detail="Недостаточно прав")
        
    shift.zo_chrysotile_4_20 = data.chrysotile_4_20
    shift.zo_chrysotile_5_65 = data.chrysotile_5_65
    shift.zo_chrysotile_6_40 = data.chrysotile_6_40
    
    # Сохраняем силосы
    shift.zo_cement_silo1 = data.cement_silo1
    shift.zo_cement_silo2 = data.cement_silo2
    shift.zo_cement_silo3 = data.cement_silo3
    shift.zo_cement_silo4 = data.cement_silo4
    # И суммируем в zo_cement (legacy, для расчета отклонений)
    shift.zo_cement = data.cement_silo1 + data.cement_silo2 + data.cement_silo3 + data.cement_silo4
    
    shift.zo_cellulose = data.cellulose
    shift.zo_crushed_slate = data.crushed_slate
    shift.zo_asbozurit = data.asbozurit
    shift.zo_fiberglass = data.fiberglass
    shift.zo_laprol = data.laprol
    shift.zo_asbocarton = data.asbocarton
    shift.zo_asb_drain = data.asb_drain
    shift.zo_cem_drain = data.cem_drain
    shift.zo_batches = data.batches
    shift.zo_submitted = data.submitted
    
    db.commit()
    return {"message": "ZO updated"}

@app.post("/api/shifts/{shift_id}/lfm_drains")
def update_lfm_drains(shift_id: int, data: LFMDrainsUpdate, request: Request, db: Session = Depends(get_db)):
    user_id = request.session.get("user_id")
    user_role = request.session.get("user_role")
    if not user_id:
        raise HTTPException(status_code=401, detail="Вы не авторизованы")
        
    shift = db.query(models.Shift).get(shift_id)
    if not shift: raise HTTPException(404, "Смена не найдена")
    
    if user_role == "master" and shift.master_id != user_id:
        master_name = shift.master.name if shift.master else "другим мастером"
        raise HTTPException(status_code=403, detail=f"Вы не можете редактировать сливы ЛФМ этой смены, так как она была открыта мастером {master_name}.")
        
    if user_role not in ["master", "admin", "lfm"]:
        raise HTTPException(status_code=403, detail="Недостаточно прав")
        
    shift.lfm_asb_drain = data.asb_drain
    shift.lfm_cem_drain = data.cem_drain
    db.commit()
    return {"message": "LFM drains updated"}

@app.get("/api/shifts/by_params", response_model=schemas.Shift)
def get_shift_by_params(date: str, shift_name: str, line: str, request: Request, db: Session = Depends(get_db)):
    user_id = request.session.get("user_id")
    user_role = request.session.get("user_role")
    if not user_id:
        raise HTTPException(status_code=401, detail="Не авторизован")
    if user_role not in ["master", "admin", "director", "technologist"]:
        raise HTTPException(status_code=403, detail="Доступ запрещен")
        
    try:
        parsed_date = datetime.strptime(date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(400, "Неверный формат даты. Ожидается YYYY-MM-DD")
        
    shift = db.query(models.Shift).filter(
        models.Shift.date == parsed_date,
        models.Shift.shift_name == shift_name,
        models.Shift.line == line
    ).first()
    
    if not shift:
        # Автоматически создаем закрытую смену с master_id текущего пользователя (или первого мастера в БД)
        master_id = user_id
        if user_role not in ["master"]:
            first_master = db.query(models.Master).filter(models.Master.role == "master").first()
            if first_master:
                master_id = first_master.id
                
        shift = models.Shift(
            date=parsed_date,
            shift_name=shift_name,
            line=line,
            master_id=master_id,
            status="closed",
            plan_sheets=0,
            plan_tons=0.0
        )
        db.add(shift)
        db.commit()
        db.refresh(shift)
        
    return shift

@app.post("/api/shifts/{shift_id}/raw_materials_bulk")
def update_raw_materials_bulk(shift_id: int, data: schemas.RawMaterialsBulkUpdate, request: Request, db: Session = Depends(get_db)):
    user_id = request.session.get("user_id")
    user_role = request.session.get("user_role")
    if not user_id:
        raise HTTPException(status_code=401, detail="Не авторизован")
    if user_role not in ["master", "admin", "director", "technologist"]:
        raise HTTPException(status_code=403, detail="Доступ запрещен")
        
    shift = db.query(models.Shift).get(shift_id)
    if not shift:
        raise HTTPException(404, "Смена не найдена")
        
    # Изоляция данных разных мастеров (для роли master):
    if user_role == "master" and shift.master_id != user_id:
        raise HTTPException(status_code=403, detail="Вы не можете редактировать смену другого мастера")
        
    # Записываем приход
    shift.receipt_chrysotile_4_20 = data.receipt_chrysotile_4_20
    shift.receipt_chrysotile_5_65 = data.receipt_chrysotile_5_65
    shift.receipt_chrysotile_6_40 = data.receipt_chrysotile_6_40
    shift.receipt_cement = data.receipt_cement
    shift.receipt_cellulose = data.receipt_cellulose
    shift.receipt_crushed_slate = data.receipt_crushed_slate
    shift.receipt_asbocarton = data.receipt_asbocarton
    shift.receipt_pallets = data.receipt_pallets
    shift.receipt_fiberglass = data.receipt_fiberglass
    shift.receipt_laprol = data.receipt_laprol
    
    # Записываем расход ЗО
    shift.zo_chrysotile_4_20 = data.zo_chrysotile_4_20
    shift.zo_chrysotile_5_65 = data.zo_chrysotile_5_65
    shift.zo_chrysotile_6_40 = data.zo_chrysotile_6_40
    shift.zo_cement_silo1 = data.zo_cement_silo1
    shift.zo_cement_silo2 = data.zo_cement_silo2
    shift.zo_cement_silo3 = data.zo_cement_silo3
    shift.zo_cement_silo4 = data.zo_cement_silo4
    
    # Суммируем в legacy zo_cement
    shift.zo_cement = (data.zo_cement_silo1 or 0) + (data.zo_cement_silo2 or 0) + (data.zo_cement_silo3 or 0) + (data.zo_cement_silo4 or 0)
    
    shift.zo_cellulose = data.zo_cellulose
    shift.zo_crushed_slate = data.zo_crushed_slate
    shift.zo_asbozurit = data.zo_asbozurit
    shift.zo_fiberglass = data.zo_fiberglass
    shift.zo_laprol = data.zo_laprol
    shift.zo_asbocarton = data.zo_asbocarton
    shift.zo_asb_drain = data.zo_asb_drain
    shift.zo_cem_drain = data.zo_cem_drain
    shift.zo_batches = data.zo_batches
    shift.zo_submitted = True
    
    db.commit()
    return {"status": "success"}



def calculate_shift_deviations(db: Session, shift: models.Shift):
    # Find LFM reports for the shift
    lfm_reports = db.query(models.LFMReport).filter(models.LFMReport.shift_id == shift.id).all()
    product_counts = {}
    for r in lfm_reports:
        product_counts[r.product_name] = product_counts.get(r.product_name, 0) + r.lfm_sheets
        
    theoretical = {
        "chrysotile_4_20": 0.0,
        "chrysotile_5_65": 0.0,
        "chrysotile_6_40": 0.0,
        "cement": 0.0,
        "cellulose": 0.0,
        "crushed_slate": 0.0,
        "asbozurit": 0.0,
        "fiberglass": 0.0,
        "asbocarton": 0.0,
        "laprol": 0.0
    }
    
    for prod_name, sheets in product_counts.items():
        norm = db.query(models.ProductNorm).filter(models.ProductNorm.product_name == prod_name).first()
        if norm:
            theoretical["chrysotile_4_20"] += sheets * (norm.norm_chrysotile_4_20 or 0.0)
            theoretical["chrysotile_5_65"] += sheets * (norm.norm_chrysotile_5_65 or 0.0)
            theoretical["chrysotile_6_40"] += sheets * (norm.norm_chrysotile_6_40 or 0.0)
            theoretical["cement"] += sheets * (norm.norm_cement or 0.0)
            theoretical["cellulose"] += sheets * (norm.norm_cellulose or 0.0)
            theoretical["crushed_slate"] += sheets * (norm.norm_crushed_slate or 0.0)
            theoretical["asbozurit"] += sheets * (norm.norm_asbozurit or 0.0)
            theoretical["fiberglass"] += sheets * (norm.norm_fiberglass or 0.0)
            
    actual = {
        "chrysotile_4_20": shift.zo_chrysotile_4_20 or 0.0,
        "chrysotile_5_65": shift.zo_chrysotile_5_65 or 0.0,
        "chrysotile_6_40": shift.zo_chrysotile_6_40 or 0.0,
        "cement": shift.zo_cement or 0.0,
        "cellulose": shift.zo_cellulose or 0.0,
        "crushed_slate": shift.zo_crushed_slate or 0.0,
        "asbozurit": shift.zo_asbozurit or 0.0,
        "fiberglass": shift.zo_fiberglass or 0.0,
        "asbocarton": shift.zo_asbocarton or 0.0,
        "laprol": shift.zo_laprol or 0.0
    }
    
    deviations = {}
    for mat in theoretical.keys():
        deviations[mat] = round(actual[mat] - theoretical[mat], 2)
        
    return {
        "theoretical": theoretical,
        "actual": actual,
        "deviations": deviations
    }


def save_report_internal(db: Session, shift: models.Shift, data: schemas.ShiftReportCreate, user_name: str, is_new: bool):
    # Old values logging
    old_values = {}
    if not is_new:
        old_values = {
            "master_id": shift.master_id,
            "batch_number": shift.batch_number,
            "product_name": shift.product_name,
            "zo_batches": shift.zo_batches,
            "zo_chrysotile_4_20": shift.zo_chrysotile_4_20,
            "zo_chrysotile_5_65": shift.zo_chrysotile_5_65,
            "zo_chrysotile_6_40": shift.zo_chrysotile_6_40,
            "zo_cement_silo1": shift.zo_cement_silo1,
            "zo_cement_silo2": shift.zo_cement_silo2,
            "zo_cement_silo3": shift.zo_cement_silo3,
            "zo_cement_silo4": shift.zo_cement_silo4,
            "zo_cellulose": shift.zo_cellulose,
            "zo_crushed_slate": shift.zo_crushed_slate,
            "zo_asbozurit": shift.zo_asbozurit,
            "zo_fiberglass": shift.zo_fiberglass,
            "zo_laprol": shift.zo_laprol,
            "zo_asbocarton": shift.zo_asbocarton,
            "zo_asb_drain": shift.zo_asb_drain,
            "zo_cem_drain": shift.zo_cem_drain,
            "receipt_chrysotile_4_20": shift.receipt_chrysotile_4_20,
            "receipt_chrysotile_5_65": shift.receipt_chrysotile_5_65,
            "receipt_chrysotile_6_40": shift.receipt_chrysotile_6_40,
            "receipt_cement": shift.receipt_cement,
            "receipt_cellulose": shift.receipt_cellulose,
            "receipt_crushed_slate": shift.receipt_crushed_slate,
            "receipt_asbozurit": shift.receipt_asbozurit,
            "receipt_asbocarton": shift.receipt_asbocarton,
            "receipt_pallets": shift.receipt_pallets,
            "receipt_fiberglass": shift.receipt_fiberglass,
            "receipt_laprol": shift.receipt_laprol
        }

    # Update Shift fields
    shift.master_id = data.master_id
    shift.batch_number = data.batch_number
    shift.product_name = data.product_name
    
    # Расход сырья
    shift.zo_chrysotile_4_20 = data.zo_chrysotile_4_20
    shift.zo_chrysotile_5_65 = data.zo_chrysotile_5_65
    shift.zo_chrysotile_6_40 = data.zo_chrysotile_6_40
    shift.zo_cement_silo1 = data.zo_cement_silo1
    shift.zo_cement_silo2 = data.zo_cement_silo2
    shift.zo_cement_silo3 = data.zo_cement_silo3
    shift.zo_cement_silo4 = data.zo_cement_silo4
    shift.zo_cement = (data.zo_cement_silo1 or 0) + (data.zo_cement_silo2 or 0) + (data.zo_cement_silo3 or 0) + (data.zo_cement_silo4 or 0)
    shift.zo_cellulose = data.zo_cellulose
    shift.zo_crushed_slate = data.zo_crushed_slate
    shift.zo_asbozurit = data.zo_asbozurit
    shift.zo_fiberglass = data.zo_fiberglass
    shift.zo_laprol = data.zo_laprol
    shift.zo_asbocarton = data.zo_asbocarton
    shift.zo_asb_drain = data.zo_asb_drain
    shift.zo_cem_drain = data.zo_cem_drain
    shift.zo_batches = data.zo_batches
    shift.zo_submitted = True

    # Приход сырья
    shift.receipt_chrysotile_4_20 = data.receipt_chrysotile_4_20
    shift.receipt_chrysotile_5_65 = data.receipt_chrysotile_5_65
    shift.receipt_chrysotile_6_40 = data.receipt_chrysotile_6_40
    shift.receipt_cement = data.receipt_cement
    shift.receipt_cellulose = data.receipt_cellulose
    shift.receipt_crushed_slate = data.receipt_crushed_slate
    shift.receipt_asbozurit = data.receipt_asbozurit
    shift.receipt_asbocarton = data.receipt_asbocarton
    shift.receipt_pallets = data.receipt_pallets
    shift.receipt_fiberglass = data.receipt_fiberglass
    shift.receipt_laprol = data.receipt_laprol

    # Update LFM report
    lfm_report = db.query(models.LFMReport).filter(models.LFMReport.shift_id == shift.id).first()
    if not lfm_report:
        lfm_report = models.LFMReport(shift_id=shift.id)
        db.add(lfm_report)
    lfm_report.product_name = data.product_name
    lfm_report.lfm_sheets = data.lfm_sheets
    lfm_report.lfm_wind_resets = data.lfm_wind_resets
    lfm_report.formed_1st_grade = data.first_grade
    lfm_report.formed_defect = data.qcd_defect
    lfm_report.transferred_to_warehouse = data.warehouse_gp

    # Update Batch
    batch = db.query(models.Batch).filter(models.Batch.shift_id == shift.id).first()
    if not batch:
        batch = models.Batch(shift_id=shift.id)
        db.add(batch)
    batch.batch_number = data.batch_number
    batch.product_name = data.product_name
    batch.status = "qcd_checked"
    batch.stacked_stacks = data.lfm_sheets
    batch.ds_condition = data.warehouse_gp
    batch.ds_first_grade = data.first_grade
    
    # Calculate defect sum
    ds_defect_sum = (
        data.ds_defect_chip + data.ds_defect_scratch + data.ds_defect_bad_cut +
        data.ds_defect_stick_bottom + data.ds_defect_stick_top + data.ds_defect_broken +
        data.ds_defect_fell_box + data.ds_defect_dent + data.ds_defect_thickness +
        data.ds_defect_delamination + data.ds_defect_edge
    )
    batch.ds_defect = ds_defect_sum
    batch.ds_defect_chip = data.ds_defect_chip
    batch.ds_defect_scratch = data.ds_defect_scratch
    batch.ds_defect_bad_cut = data.ds_defect_bad_cut
    batch.ds_defect_stick_bottom = data.ds_defect_stick_bottom
    batch.ds_defect_stick_top = data.ds_defect_stick_top
    batch.ds_defect_broken = data.ds_defect_broken
    batch.ds_defect_fell_box = data.ds_defect_fell_box
    batch.ds_defect_dent = data.ds_defect_dent
    batch.ds_defect_thickness = data.ds_defect_thickness
    batch.ds_defect_delamination = data.ds_defect_delamination
    batch.ds_defect_edge = data.ds_defect_edge

    batch.qcd_condition = data.warehouse_gp
    batch.qcd_first_grade = data.first_grade
    batch.qcd_defect = data.qcd_defect

    db.commit()

    # Sync to MonthlyPlanBoard (which also writes AuditLog)
    sync_lfm_to_plan_board(shift.id, db)

    # Write AuditLog for the shift update
    if is_new:
        db.add(models.AuditLog(
            user_name=user_name,
            action="CREATE",
            target_table="shifts",
            target_id=shift.id,
            details=f"Создан новый единый рапорт мастера для смены {shift.id} ({data.date} {data.shift_name} {data.line})"
        ))
    else:
        new_values = {
            "master_id": shift.master_id,
            "batch_number": shift.batch_number,
            "product_name": shift.product_name,
            "zo_batches": shift.zo_batches,
            "zo_chrysotile_4_20": shift.zo_chrysotile_4_20,
            "zo_chrysotile_5_65": shift.zo_chrysotile_5_65,
            "zo_chrysotile_6_40": shift.zo_chrysotile_6_40,
            "zo_cement_silo1": shift.zo_cement_silo1,
            "zo_cement_silo2": shift.zo_cement_silo2,
            "zo_cement_silo3": shift.zo_cement_silo3,
            "zo_cement_silo4": shift.zo_cement_silo4,
            "zo_cellulose": shift.zo_cellulose,
            "zo_crushed_slate": shift.zo_crushed_slate,
            "zo_asbozurit": shift.zo_asbozurit,
            "zo_fiberglass": shift.zo_fiberglass,
            "zo_laprol": shift.zo_laprol,
            "zo_asbocarton": shift.zo_asbocarton,
            "zo_asb_drain": shift.zo_asb_drain,
            "zo_cem_drain": shift.zo_cem_drain,
            "receipt_chrysotile_4_20": shift.receipt_chrysotile_4_20,
            "receipt_chrysotile_5_65": shift.receipt_chrysotile_5_65,
            "receipt_chrysotile_6_40": shift.receipt_chrysotile_6_40,
            "receipt_cement": shift.receipt_cement,
            "receipt_cellulose": shift.receipt_cellulose,
            "receipt_crushed_slate": shift.receipt_crushed_slate,
            "receipt_asbozurit": shift.receipt_asbozurit,
            "receipt_asbocarton": shift.receipt_asbocarton,
            "receipt_pallets": shift.receipt_pallets,
            "receipt_fiberglass": shift.receipt_fiberglass,
            "receipt_laprol": shift.receipt_laprol
        }
        changes = []
        for k, old_v in old_values.items():
            new_v = new_values.get(k)
            if old_v != new_v:
                changes.append(f"{k}: {old_v} -> {new_v}")
        if changes:
            db.add(models.AuditLog(
                user_name=user_name,
                action="UPDATE",
                target_table="shifts",
                target_id=shift.id,
                details=f"Обновлен рапорт мастера смены {shift.id}. Изменения: " + ", ".join(changes)
            ))
    db.commit()


@app.post("/api/report")
def save_shift_report(data: schemas.ShiftReportCreate, request: Request, db: Session = Depends(get_db)):
    user_id = request.session.get("user_id") or 9999
    user_role = request.session.get("user_role") or "admin"
    user_name = request.session.get("user_name") or "Админ"
        
    if user_role not in ["master", "admin"]:
        raise HTTPException(status_code=403, detail="Доступ запрещен. Только мастера или администраторы могут сохранять рапорты.")
        
    # Check if shift exists or create it
    shift = db.query(models.Shift).filter(
        models.Shift.date == data.date,
        models.Shift.shift_name == data.shift_name,
        models.Shift.line == data.line
    ).first()
    
    is_new = False
    if not shift:
        is_new = True
        shift = models.Shift(
            date=data.date,
            shift_name=data.shift_name,
            line=data.line,
            master_id=data.master_id,
            status="active"
        )
        db.add(shift)
        db.flush()
    else:
        if shift.status == "closed" and user_role != "admin":
            raise HTTPException(status_code=403, detail="Смена уже закрыта. Только администратор может редактировать закрытые смены.")
        # If active, master can edit it. But if role is master, check if they own it
        if user_role == "master" and shift.master_id != user_id:
            raise HTTPException(status_code=403, detail="Смена открыта другим мастером. Вы не можете ее редактировать.")

    save_report_internal(db, shift, data, user_name, is_new)
    return {"status": "success", "shift_id": shift.id}


@app.put("/api/report/{shift_id}")
def update_shift_report_endpoint(shift_id: int, data: schemas.ShiftReportCreate, request: Request, db: Session = Depends(get_db)):
    user_id = request.session.get("user_id")
    user_role = request.session.get("user_role")
    user_name = request.session.get("user_name", "Unknown")
    if not user_id or not user_role:
        raise HTTPException(status_code=401, detail="Не авторизован")
        
    shift = db.query(models.Shift).get(shift_id)
    if not shift:
        raise HTTPException(status_code=404, detail="Смена не найдена")
        
    if user_role == "master" and shift.master_id != user_id:
        raise HTTPException(status_code=403, detail="Вы не можете редактировать смену другого мастера")
        
    if shift.status == "closed" and user_role != "admin":
        raise HTTPException(status_code=403, detail="Смена закрыта. Только администратор может редактировать закрытую смену.")
        
    save_report_internal(db, shift, data, user_name, False)
    return {"status": "success", "shift_id": shift.id}


@app.get("/api/report/summary")
def get_report_summary(
    request: Request,
    from_date: str = None,
    to_date: str = None,
    line: str = None,
    master_id: int = None,
    db: Session = Depends(get_db)
):
    user_id = request.session.get("user_id")
    user_role = request.session.get("user_role")
    if not user_id:
        raise HTTPException(status_code=401, detail="Не авторизован")
        
    query = db.query(models.Shift)
    
    if from_date:
        query = query.filter(models.Shift.date >= datetime.strptime(from_date, "%Y-%m-%d").date())
    if to_date:
        query = query.filter(models.Shift.date <= datetime.strptime(to_date, "%Y-%m-%d").date())
    if line:
        query = query.filter(models.Shift.line == line)
    if master_id:
        query = query.filter(models.Shift.master_id == master_id)
        
    shifts = query.order_by(models.Shift.date.desc(), models.Shift.id.desc()).all()
    
    result = []
    for shift in shifts:
        is_other_master = False
        
        lfm = db.query(models.LFMReport).filter(models.LFMReport.shift_id == shift.id).first()
        lfm_sheets = lfm.lfm_sheets if (lfm and not is_other_master) else 0
        lfm_resets = lfm.lfm_wind_resets if (lfm and not is_other_master) else 0
        
        batch = db.query(models.Batch).filter(models.Batch.shift_id == shift.id).first()
        warehouse_gp = batch.ds_condition if (batch and not is_other_master) else 0
        first_grade = batch.ds_first_grade if (batch and not is_other_master) else 0
        qcd_defect = batch.qcd_defect if (batch and not is_other_master) else 0
        
        ds_defects = {
            "ds_defect_chip": batch.ds_defect_chip if (batch and not is_other_master) else 0,
            "ds_defect_scratch": batch.ds_defect_scratch if (batch and not is_other_master) else 0,
            "ds_defect_bad_cut": batch.ds_defect_bad_cut if (batch and not is_other_master) else 0,
            "ds_defect_stick_bottom": batch.ds_defect_stick_bottom if (batch and not is_other_master) else 0,
            "ds_defect_stick_top": batch.ds_defect_stick_top if (batch and not is_other_master) else 0,
            "ds_defect_broken": batch.ds_defect_broken if (batch and not is_other_master) else 0,
            "ds_defect_fell_box": batch.ds_defect_fell_box if (batch and not is_other_master) else 0,
            "ds_defect_dent": batch.ds_defect_dent if (batch and not is_other_master) else 0,
            "ds_defect_thickness": batch.ds_defect_thickness if (batch and not is_other_master) else 0,
            "ds_defect_delamination": batch.ds_defect_delamination if (batch and not is_other_master) else 0,
            "ds_defect_edge": batch.ds_defect_edge if (batch and not is_other_master) else 0,
        }
        
        product_name = shift.product_name if not is_other_master else "Скрыто"
        batch_number = shift.batch_number if not is_other_master else "Скрыто"
        master_name = "Смена другого мастера" if is_other_master else (shift.master.name if shift.master else "Н/Д")
        
        lfm_tons = round(lfm_sheets * get_product_finished_weight_kg(db, product_name) / 1000.0, 2) if (lfm_sheets and not is_other_master) else 0.0
        
        dev_data = {"theoretical": {}, "actual": {}, "deviations": {}}
        if not is_other_master:
            dev_data = calculate_shift_deviations(db, shift)
            
        result.append({
            "shift_id": shift.id,
            "date": shift.date.strftime("%Y-%m-%d") if shift.date else "Н/Д",
            "shift_name": shift.shift_name,
            "line": shift.line,
            "master_id": shift.master_id,
            "master_name": master_name,
            "batch_number": batch_number,
            "product_name": product_name,
            "status": shift.status,
            
            "plan_sheets": shift.plan_sheets or 0,
            "plan_tons": shift.plan_tons or 0.0,
            
            "lfm_sheets": lfm_sheets,
            "lfm_wind_resets": lfm_resets,
            "lfm_tons": lfm_tons,
            "zo_batches": shift.zo_batches if not is_other_master else 0,
            
            "warehouse_gp": warehouse_gp,
            "first_grade": first_grade,
            "defect": qcd_defect,
            "ds_defects": ds_defects,
            
            "receipts": {
                "chrysotile_4_20": shift.receipt_chrysotile_4_20 if not is_other_master else 0.0,
                "chrysotile_5_65": shift.receipt_chrysotile_5_65 if not is_other_master else 0.0,
                "chrysotile_6_40": shift.receipt_chrysotile_6_40 if not is_other_master else 0.0,
                "cement": shift.receipt_cement if not is_other_master else 0.0,
                "cellulose": shift.receipt_cellulose if not is_other_master else 0.0,
                "crushed_slate": shift.receipt_crushed_slate if not is_other_master else 0.0,
                "asbozurit": shift.receipt_asbozurit if not is_other_master else 0.0,
                "asbocarton": shift.receipt_asbocarton if not is_other_master else 0.0,
                "pallets": shift.receipt_pallets if not is_other_master else 0.0,
                "fiberglass": shift.receipt_fiberglass if not is_other_master else 0.0,
                "laprol": shift.receipt_laprol if not is_other_master else 0.0
            },
            "zo_usage": {
                "chrysotile_4_20": shift.zo_chrysotile_4_20 if not is_other_master else 0.0,
                "chrysotile_5_65": shift.zo_chrysotile_5_65 if not is_other_master else 0.0,
                "chrysotile_6_40": shift.zo_chrysotile_6_40 if not is_other_master else 0.0,
                "cement_silo1": shift.zo_cement_silo1 if not is_other_master else 0.0,
                "cement_silo2": shift.zo_cement_silo2 if not is_other_master else 0.0,
                "cement_silo3": shift.zo_cement_silo3 if not is_other_master else 0.0,
                "cement_silo4": shift.zo_cement_silo4 if not is_other_master else 0.0,
                "cellulose": shift.zo_cellulose if not is_other_master else 0.0,
                "crushed_slate": shift.zo_crushed_slate if not is_other_master else 0.0,
                "asbozurit": shift.zo_asbozurit if not is_other_master else 0.0,
                "fiberglass": shift.zo_fiberglass if not is_other_master else 0.0,
                "laprol": shift.zo_laprol if not is_other_master else 0.0,
                "asbocarton": shift.zo_asbocarton if not is_other_master else 0.0,
                "asb_drain": shift.zo_asb_drain if not is_other_master else 0.0,
                "cem_drain": shift.zo_cem_drain if not is_other_master else 0.0
            },
            "deviations": dev_data
        })
        
    return result


@app.get("/api/report/materials_summary")
def get_materials_summary(
    request: Request,
    start_date: str = None,
    end_date: str = None,
    db: Session = Depends(get_db)
):
    user_id = request.session.get("user_id")
    user_role = request.session.get("user_role")
    if not user_id:
        raise HTTPException(status_code=401, detail="Не авторизован")
        
    query = db.query(models.Shift)
    
    if user_role == "master" and user_id:
        query = query.filter(models.Shift.master_id == user_id)
        
    if start_date:
        query = query.filter(models.Shift.date >= datetime.strptime(start_date, "%Y-%m-%d").date())
    if end_date:
        query = query.filter(models.Shift.date <= datetime.strptime(end_date, "%Y-%m-%d").date())
        
    shifts = query.order_by(models.Shift.date.asc()).all()
    
    materials = [
        "chrysotile_4_20", "chrysotile_5_65", "chrysotile_6_40",
        "cement", "cellulose", "crushed_slate", "asbozurit",
        "asbocarton", "fiberglass", "laprol"
    ]
    
    totals = {m: {"receipt": 0.0, "zo": 0.0, "deviation": 0.0} for m in materials}
    daily_breakdown = []
    
    for shift in shifts:
        zo_cem = (shift.zo_cement_silo1 or 0) + (shift.zo_cement_silo2 or 0) + (shift.zo_cement_silo3 or 0) + (shift.zo_cement_silo4 or 0)
        
        shift_mats = {
            "chrysotile_4_20": {"receipt": shift.receipt_chrysotile_4_20 or 0.0, "zo": shift.zo_chrysotile_4_20 or 0.0},
            "chrysotile_5_65": {"receipt": shift.receipt_chrysotile_5_65 or 0.0, "zo": shift.zo_chrysotile_5_65 or 0.0},
            "chrysotile_6_40": {"receipt": shift.receipt_chrysotile_6_40 or 0.0, "zo": shift.zo_chrysotile_6_40 or 0.0},
            "cement": {"receipt": shift.receipt_cement or 0.0, "zo": zo_cem},
            "cellulose": {"receipt": shift.receipt_cellulose or 0.0, "zo": shift.zo_cellulose or 0.0},
            "crushed_slate": {"receipt": shift.receipt_crushed_slate or 0.0, "zo": shift.zo_crushed_slate or 0.0},
            "asbozurit": {"receipt": shift.receipt_asbozurit or 0.0, "zo": shift.zo_asbozurit or 0.0},
            "asbocarton": {"receipt": shift.receipt_asbocarton or 0.0, "zo": shift.zo_asbocarton or 0.0},
            "fiberglass": {"receipt": shift.receipt_fiberglass or 0.0, "zo": shift.zo_fiberglass or 0.0},
            "laprol": {"receipt": shift.receipt_laprol or 0.0, "zo": shift.zo_laprol or 0.0}
        }
        
        dev_info = calculate_shift_deviations(db, shift)
        shift_devs = dev_info["deviations"]
        
        day_entry = {
            "date": shift.date.strftime("%Y-%m-%d") if shift.date else "Н/Д",
            "shift_name": shift.shift_name,
            "line": shift.line,
            "materials": {}
        }
        
        for m in materials:
            r = shift_mats[m]["receipt"]
            z = shift_mats[m]["zo"]
            d = shift_devs.get(m, round(z - r, 2)) if m != "cement" else shift_devs.get("cement", round(z - r, 2))
            
            day_entry["materials"][m] = {
                "receipt": round(r, 2),
                "zo": round(z, 2),
                "deviation": round(d, 2)
            }
            
            totals[m]["receipt"] += r
            totals[m]["zo"] += z
            totals[m]["deviation"] += d
            
        daily_breakdown.append(day_entry)
        
    for m in materials:
        totals[m]["receipt"] = round(totals[m]["receipt"], 2)
        totals[m]["zo"] = round(totals[m]["zo"], 2)
        totals[m]["deviation"] = round(totals[m]["deviation"], 2)
        
    return {
        "totals": totals,
        "daily": daily_breakdown
    }


def sync_lfm_to_plan_board(shift_id: int, db: Session):
    shift = db.query(models.Shift).get(shift_id)
    if not shift:
        return
        
    # Map shift line to plan board line
    pb_line = "ЛФМ-1" if shift.line == "Линия 1" else "ЛФМ-2"
    
    # Calculate sum of sheets, 1st grade, defect from LFM reports for this shift
    lfm_stats = db.query(
        func.sum(models.LFMReport.lfm_sheets).label("total_sheets"),
        func.sum(models.LFMReport.formed_1st_grade).label("total_1st"),
        func.sum(models.LFMReport.formed_defect).label("total_defect")
    ).filter(models.LFMReport.shift_id == shift_id).first()
    
    total_sheets = int(lfm_stats.total_sheets or 0)
    total_1st = int(lfm_stats.total_1st or 0)
    total_defect = int(lfm_stats.total_defect or 0)
    
    # Find corresponding MonthlyPlanBoard row
    pb_row = db.query(models.MonthlyPlanBoard).filter(
        models.MonthlyPlanBoard.date == shift.date,
        models.MonthlyPlanBoard.shift_name == shift.shift_name,
        models.MonthlyPlanBoard.line == pb_line
    ).first()
    
    if pb_row:
        old_fact = pb_row.fact_sheets
        pb_row.fact_sheets = total_sheets
        pb_row.first_grade = total_1st
        pb_row.defect = total_defect
        
        # Log to AuditLog (per rules, plan board changes must be logged to AuditLog)
        log_entry = models.AuditLog(
            timestamp=datetime.utcnow(),
            user_name="System Sync (LFM)",
            action="UPDATE",
            target_table="monthly_plan_board",
            target_id=pb_row.id,
            details=f"Смена {shift_id} LFM sync. Факт обновлен: {old_fact} -> {total_sheets} листов. 1 сорт: {total_1st}, Брак: {total_defect}."
        )
        db.add(log_entry)
    else:
        # Create a new plan board row if it doesn't exist
        pb_row = models.MonthlyPlanBoard(
            date=shift.date,
            shift_name=shift.shift_name,
            line=pb_line,
            master_id=shift.master_id,
            plan_sheets=0,
            fact_sheets=total_sheets,
            first_grade=total_1st,
            defect=total_defect
        )
        db.add(pb_row)
        db.flush() # get the ID
        
        log_entry = models.AuditLog(
            timestamp=datetime.utcnow(),
            user_name="System Sync (LFM)",
            action="CREATE",
            target_table="monthly_plan_board",
            target_id=pb_row.id,
            details=f"Создана новая запись план-борда для смены {shift_id}. Факт: {total_sheets} листов. 1 сорт: {total_1st}, Брак: {total_defect}."
        )
        db.add(log_entry)
        
    db.commit()

# --- ЛФМ ---
@app.post("/api/shifts/{shift_id}/lfm")
def create_lfm_report(shift_id: int, data: schemas.LFMReportCreate, db: Session = Depends(get_db)):
    shift = db.query(models.Shift).get(shift_id)
    if not shift: raise HTTPException(404)
    db_report = models.LFMReport(**data.model_dump(), shift_id=shift_id)
    db.add(db_report)
    db.commit()
    
    # Sync LFM sheets to plan board fact
    sync_lfm_to_plan_board(shift_id, db)
    return {"status": "ok"}

@app.get("/api/downtimes/directory/departments")
def get_downtime_departments(db: Session = Depends(get_db)):
    results = db.query(models.DowntimeDirectory.department).distinct().all()
    return [r[0] for r in results if r[0]]

@app.get("/api/downtimes/directory/nodes")
def get_downtime_nodes(department: str, db: Session = Depends(get_db)):
    results = db.query(models.DowntimeDirectory.node).filter(models.DowntimeDirectory.department == department).distinct().all()
    return [r[0] for r in results if r[0]]

@app.get("/api/downtimes/directory/breakdowns")
def get_downtime_breakdowns(department: str, node: str, db: Session = Depends(get_db)):
    results = db.query(models.DowntimeDirectory.breakdown, models.DowntimeDirectory.comment).filter(
        models.DowntimeDirectory.department == department,
        models.DowntimeDirectory.node == node
    ).all()
    return [{"breakdown": r[0], "comment": r[1]} for r in results if r[0]]

@app.get("/api/downtimes/directory", response_model=list[schemas.DowntimeDirectory])
def get_downtime_directory(db: Session = Depends(get_db)):
    return db.query(models.DowntimeDirectory).order_by(
        models.DowntimeDirectory.department,
        models.DowntimeDirectory.node,
        models.DowntimeDirectory.breakdown
    ).all()

@app.post("/api/downtimes/directory", response_model=schemas.DowntimeDirectory)
def create_downtime_directory_entry(data: schemas.DowntimeDirectoryCreate, request: Request, db: Session = Depends(get_db)):
    admin = check_admin_session(request, db)
    entry = models.DowntimeDirectory(**data.model_dump())
    db.add(entry)
    db.commit()
    db.refresh(entry)
    
    # Log audit
    log = models.AuditLog(
        timestamp=datetime.utcnow(),
        user_name=admin.name,
        action="CREATE",
        target_table="downtime_directory",
        target_id=entry.id,
        details=f"Добавлена запись: {entry.department} -> {entry.node} -> {entry.breakdown} (Категория: {entry.category})"
    )
    db.add(log)
    db.commit()
    return entry

@app.put("/api/downtimes/directory/{entry_id}", response_model=schemas.DowntimeDirectory)
def update_downtime_directory_entry(entry_id: int, data: schemas.DowntimeDirectoryCreate, request: Request, db: Session = Depends(get_db)):
    admin = check_admin_session(request, db)
    entry = db.query(models.DowntimeDirectory).get(entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Запись не найдена")
    
    old_details = f"{entry.department} -> {entry.node} -> {entry.breakdown} (Категория: {entry.category}, Комментарий: {entry.comment})"
    
    entry.department = data.department
    entry.node = data.node
    entry.breakdown = data.breakdown
    entry.category = data.category
    entry.comment = data.comment
    db.commit()
    db.refresh(entry)
    
    new_details = f"{entry.department} -> {entry.node} -> {entry.breakdown} (Категория: {entry.category}, Комментарий: {entry.comment})"
    
    # Log audit
    log = models.AuditLog(
        timestamp=datetime.utcnow(),
        user_name=admin.name,
        action="UPDATE",
        target_table="downtime_directory",
        target_id=entry.id,
        details=f"Изменена запись ID {entry_id}: {old_details} -> {new_details}"
    )
    db.add(log)
    db.commit()
    return entry

@app.delete("/api/downtimes/directory/{entry_id}")
def delete_downtime_directory_entry(entry_id: int, request: Request, db: Session = Depends(get_db)):
    admin = check_admin_session(request, db)
    entry = db.query(models.DowntimeDirectory).get(entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Запись не найдена")
    
    log = models.AuditLog(
        timestamp=datetime.utcnow(),
        user_name=admin.name,
        action="DELETE",
        target_table="downtime_directory",
        target_id=entry.id,
        details=f"Удалена запись ID {entry_id}: {entry.department} -> {entry.node} -> {entry.breakdown}"
    )
    db.add(log)
    db.delete(entry)
    db.commit()
    return {"status": "ok"}


# --- ПРОСТОИ ---
@app.post("/api/upload_media/")
async def upload_media(file: UploadFile = File(...)):
    try:
        file_bytes = await file.read()
        filename = file.filename
        url = m365_integration.upload_file_to_sharepoint(file_bytes, filename)
        return {"url": url}
    except Exception as e:
        print(f"Upload error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/shifts/{shift_id}/downtimes", response_model=schemas.Downtime)
def create_downtime(shift_id: int, data: schemas.DowntimeCreate, db: Session = Depends(get_db)):
    shift = db.query(models.Shift).get(shift_id)
    if not shift: raise HTTPException(404)
    
    duration = 0
    if data.end_time:
        fmt = "%H:%M"
        try:
            t_start = datetime.strptime(data.start_time, fmt)
            t_end = datetime.strptime(data.end_time, fmt)
            if t_end < t_start:
                duration = int((t_end.timestamp() + 24*3600 - t_start.timestamp()) / 60)
            else:
                duration = int((t_end - t_start).total_seconds() / 60)
        except Exception:
            duration = 0
            
    lost_tons = (duration / 60.0) * TONS_PER_HOUR
    lost_tenge = lost_tons * PRICE_PER_TON
    
    status = "resolved" if data.end_time else "pending"
    
    category_val = data.category
    if not category_val and data.department and data.node and data.description:
        dir_entry = db.query(models.DowntimeDirectory).filter(
            models.DowntimeDirectory.department == data.department,
            models.DowntimeDirectory.node == data.node,
            models.DowntimeDirectory.breakdown == data.description
        ).first()
        if dir_entry and dir_entry.category:
            category_val = dir_entry.category
        else:
            from import_downtimes_from_txt import get_category
            category_val = get_category(data.description, data.node, data.department)

    dt_data = data.model_dump(exclude={"status", "category"})
    dt_data["category"] = category_val
    
    db_dt = models.Downtime(
        **dt_data,
        shift_id=shift_id,
        duration=duration,
        lost_tons=lost_tons,
        lost_tenge=lost_tenge,
        status=status
    )
    db.add(db_dt)
    db.commit()
    db.refresh(db_dt)
    return db_dt

@app.put("/api/downtimes/{dt_id}", response_model=schemas.Downtime)
def update_downtime(dt_id: int, data: schemas.DowntimeCreate, db: Session = Depends(get_db)):
    dt = db.query(models.Downtime).get(dt_id)
    if not dt: raise HTTPException(404)
    
    duration = 0
    if data.end_time:
        fmt = "%H:%M"
        try:
            t_start = datetime.strptime(data.start_time, fmt)
            t_end = datetime.strptime(data.end_time, fmt)
            if t_end < t_start:
                duration = int((t_end.timestamp() + 24*3600 - t_start.timestamp()) / 60)
            else:
                duration = int((t_end - t_start).total_seconds() / 60)
        except Exception:
            duration = 0
            
    lost_tons = (duration / 60.0) * TONS_PER_HOUR
    lost_tenge = lost_tons * PRICE_PER_TON
    
    status = "resolved" if data.end_time else "pending"
    
    category_val = data.category
    if not category_val and data.department and data.node and data.description:
        dir_entry = db.query(models.DowntimeDirectory).filter(
            models.DowntimeDirectory.department == data.department,
            models.DowntimeDirectory.node == data.node,
            models.DowntimeDirectory.breakdown == data.description
        ).first()
        if dir_entry and dir_entry.category:
            category_val = dir_entry.category
        else:
            from import_downtimes_from_txt import get_category
            category_val = get_category(data.description, data.node, data.department)
            
    dt.start_time = data.start_time
    dt.end_time = data.end_time
    dt.category = category_val
    dt.department = data.department
    dt.node = data.node
    dt.description = data.description
    dt.media_urls = data.media_urls
    dt.is_equipment_downtime = data.is_equipment_downtime
    dt.duration = duration
    dt.lost_tons = lost_tons
    dt.lost_tenge = lost_tenge
    dt.status = status
    
    db.commit()

    db.refresh(dt)
    return dt

@app.delete("/api/downtimes/{dt_id}")
def delete_downtime(dt_id: int, db: Session = Depends(get_db)):
    dt = db.query(models.Downtime).get(dt_id)
    if not dt: raise HTTPException(404)
    db.delete(dt)
    db.commit()
    return {"status": "ok"}

# --- ПАРТИИ (Стакер) ---
@app.post("/api/batches/")
def create_batch(shift_id: int, data: schemas.BatchCreate, db: Session = Depends(get_db)):
    db_batch = models.Batch(**data.model_dump(exclude={"status"}), shift_id=shift_id, status="stacked")
    db.add(db_batch)
    db.commit()
    db.refresh(db_batch)
    return db_batch

# --- Дестакер и СКК ---
@app.get("/api/batches/pending_destacker", response_model=list[schemas.Batch])
def get_pending_destacker_batches(db: Session = Depends(get_db)):
    # Дестакер видит все партии, которые были уложены (stacked)
    return db.query(models.Batch).filter(models.Batch.status == "stacked").all()

@app.get("/api/batches/pending_qcd", response_model=list[schemas.Batch])
def get_pending_qcd_batches(db: Session = Depends(get_db)):
    # СКК видит партии, которые уложены или разобраны, но еще не проверены СКК
    return db.query(models.Batch).filter(
        or_(models.Batch.status == "stacked", models.Batch.status == "destacked")
    ).all()

class DestackerUpdate(BaseModel):
    ds_condition: int
    ds_first_grade: int
    ds_defect_chip: int = 0
    ds_defect_scratch: int = 0
    ds_defect_bad_cut: int = 0
    ds_defect_stick_bottom: int = 0
    ds_defect_stick_top: int = 0
    ds_defect_broken: int = 0
    ds_defect_fell_box: int = 0
    ds_defect_dent: int = 0
    ds_defect_thickness: int = 0
    ds_defect_delamination: int = 0
    ds_defect_edge: int = 0

@app.post("/api/batches/{batch_id}/destacker")
def update_destacker(batch_id: int, data: DestackerUpdate, db: Session = Depends(get_db)):
    batch = db.query(models.Batch).get(batch_id)
    if not batch: raise HTTPException(404)
    batch.ds_condition = data.ds_condition
    batch.ds_first_grade = data.ds_first_grade
    batch.ds_defect_chip = data.ds_defect_chip
    batch.ds_defect_scratch = data.ds_defect_scratch
    batch.ds_defect_bad_cut = data.ds_defect_bad_cut
    batch.ds_defect_stick_bottom = data.ds_defect_stick_bottom
    batch.ds_defect_stick_top = data.ds_defect_stick_top
    batch.ds_defect_broken = data.ds_defect_broken
    batch.ds_defect_fell_box = data.ds_defect_fell_box
    batch.ds_defect_dent = data.ds_defect_dent
    batch.ds_defect_thickness = data.ds_defect_thickness
    batch.ds_defect_delamination = data.ds_defect_delamination
    batch.ds_defect_edge = data.ds_defect_edge
    
    # Суммируем весь брак
    batch.ds_defect = (
        data.ds_defect_chip + data.ds_defect_scratch + data.ds_defect_bad_cut +
        data.ds_defect_stick_bottom + data.ds_defect_stick_top + data.ds_defect_broken +
        data.ds_defect_fell_box + data.ds_defect_dent + data.ds_defect_thickness +
        data.ds_defect_delamination + data.ds_defect_edge
    )
    batch.status = "destacked"
    db.commit()
    return {"status": "ok"}

class QCDUpdate(BaseModel):
    qcd_condition: int
    qcd_first_grade: int
    qcd_defect: int

@app.post("/api/batches/{batch_id}/qcd")
def update_qcd(batch_id: int, data: QCDUpdate, db: Session = Depends(get_db)):
    batch = db.query(models.Batch).get(batch_id)
    if not batch: raise HTTPException(404)
    batch.qcd_condition = data.qcd_condition
    batch.qcd_first_grade = data.qcd_first_grade
    batch.qcd_defect = data.qcd_defect
    batch.status = "qcd_checked"
    db.commit()
    return {"status": "ok"}

@app.get("/api/dashboard/stats")
def get_dashboard_stats(request: Request, db: Session = Depends(get_db)):
    user_id = request.session.get("user_id")
    user_role = request.session.get("user_role") or "admin"

    prod_query = db.query(
        func.sum(models.Batch.qcd_condition).label('condition'),
        func.sum(models.Batch.qcd_first_grade).label('first_grade'),
        func.sum(models.Batch.qcd_defect).label('defect')
    )

    defects_query = db.query(
        func.sum(models.Batch.ds_defect_chip).label('chip'),
        func.sum(models.Batch.ds_defect_scratch).label('scratch'),
        func.sum(models.Batch.ds_defect_bad_cut).label('bad_cut'),
        func.sum(models.Batch.ds_defect_stick_bottom).label('stick_bottom'),
        func.sum(models.Batch.ds_defect_stick_top).label('stick_top'),
        func.sum(models.Batch.ds_defect_broken).label('broken'),
        func.sum(models.Batch.ds_defect_fell_box).label('fell_box'),
        func.sum(models.Batch.ds_defect_dent).label('dent'),
        func.sum(models.Batch.ds_defect_thickness).label('thickness'),
        func.sum(models.Batch.ds_defect_delamination).label('delamination'),
        func.sum(models.Batch.ds_defect_edge).label('edge'),
    )

    mats_query = db.query(
        func.sum(models.Shift.receipt_chrysotile_4_20).label('r_4_20'),
        func.sum(models.Shift.receipt_chrysotile_5_65).label('r_5_65'),
        func.sum(models.Shift.receipt_chrysotile_6_40).label('r_6_40'),
        func.sum(models.Shift.zo_chrysotile_4_20).label('z_4_20'),
        func.sum(models.Shift.zo_chrysotile_5_65).label('z_5_65'),
        func.sum(models.Shift.zo_chrysotile_6_40).label('z_6_40'),
        func.sum(models.Shift.receipt_cement).label('r_cem'),
        func.sum(models.Shift.zo_cement).label('z_cem'),
        func.sum(models.Shift.receipt_cellulose).label('r_cel'),
        func.sum(models.Shift.zo_cellulose).label('z_cel')
    )

    dt_query = db.query(models.Downtime)

    if user_role == "master" and user_id:
        prod_query = prod_query.join(models.Shift).filter(models.Shift.master_id == user_id)
        defects_query = defects_query.join(models.Shift).filter(models.Shift.master_id == user_id)
        mats_query = mats_query.filter(models.Shift.master_id == user_id)
        dt_query = dt_query.join(models.Shift).filter(models.Shift.master_id == user_id)

    prod_stats = prod_query.first()
    defects = defects_query.first()
    mats = mats_query.first()

    rec_asb = (mats.r_4_20 or 0) + (mats.r_5_65 or 0) + (mats.r_6_40 or 0)
    zo_asb = (mats.z_4_20 or 0) + (mats.z_5_65 or 0) + (mats.z_6_40 or 0)

    # --- DOWNTIME AGGREGATION ---
    downtimes = dt_query.all()
    total_downtime_minutes = sum((d.duration or 0) for d in downtimes)
    total_lost_tons = sum((d.lost_tons or 0) for d in downtimes)
    total_lost_tenge = sum((d.lost_tenge or 0) for d in downtimes)
    
    dt_by_cat = {}
    node_counts = {}
    for d in downtimes:
        if d.category:
            dt_by_cat[d.category] = dt_by_cat.get(d.category, 0) + (d.duration or 0)
        if d.node:
            node_counts[d.node] = node_counts.get(d.node, 0) + 1
            
    top_reasons = sorted([{"node": k, "count": v} for k, v in node_counts.items()], key=lambda x: x['count'], reverse=True)[:5]

    return {
        "production": {
            "condition": prod_stats.condition or 0,
            "first_grade": prod_stats.first_grade or 0,
            "defect": prod_stats.defect or 0
        },
        "defects": {
            "Скол": defects.chip or 0,
            "Сдир": defects.scratch or 0,
            "Плохой рез": defects.bad_cut or 0,
            "Налип снизу": defects.stick_bottom or 0,
            "Налип сверху": defects.stick_top or 0,
            "Сломан": defects.broken or 0,
            "Упал коробки": defects.fell_box or 0,
            "Вмятина": defects.dent or 0,
            "Толщина": defects.thickness or 0,
            "Расслоение": defects.delamination or 0,
            "Кромка": defects.edge or 0
        },
        "materials": {
            "Асбест": {"receipt": rec_asb, "zo": zo_asb},
            "Цемент": {"receipt": mats.r_cem or 0, "zo": mats.z_cem or 0},
            "Целлюлоза": {"receipt": mats.r_cel or 0, "zo": mats.z_cel or 0}
        },
        "downtimes": {
            "total_minutes": total_downtime_minutes,
            "lost_tons": total_lost_tons,
            "lost_tenge": total_lost_tenge,
            "by_category": dt_by_cat,
            "top_reasons": top_reasons
        }
    }

@app.get("/api/dashboard/weekly_report")
def get_weekly_report(request: Request, db: Session = Depends(get_db)):
    user_id = request.session.get("user_id")
    user_role = request.session.get("user_role") or "admin"

    # Берем последние 7 смен (включая текущую)
    query = db.query(models.Shift)
    if user_role == "master" and user_id:
        query = query.filter(models.Shift.master_id == user_id)
    shifts = query.order_by(models.Shift.date.desc(), models.Shift.id.desc()).limit(7).all()
    
    report_data = []
    for shift in shifts:
        # 1. Считаем формовку (ЛФМ)
        lfm_sheets = db.query(func.sum(models.LFMReport.lfm_sheets)).filter(models.LFMReport.shift_id == shift.id).scalar() or 0
        
        # 2. Считаем итог СКК
        qcd_stats = db.query(
            func.sum(models.Batch.qcd_condition).label('condition'),
            func.sum(models.Batch.qcd_first_grade).label('first_grade'),
            func.sum(models.Batch.qcd_defect).label('defect')
        ).filter(models.Batch.shift_id == shift.id).first()
        
        qcd_cond = qcd_stats.condition or 0
        qcd_fg = qcd_stats.first_grade or 0
        qcd_def = qcd_stats.defect or 0
        
        # 3. Считаем отклонение сырья (Факт из ЗО - Теория по нормам)
        lfm_reports = db.query(models.LFMReport).filter(models.LFMReport.shift_id == shift.id).all()
        product_counts = {}
        for r in lfm_reports:
            product_counts[r.product_name] = product_counts.get(r.product_name, 0) + r.lfm_sheets
            
        theoretical = {
            "chrysotile_4_20": 0.0, "chrysotile_5_65": 0.0, "chrysotile_6_40": 0.0,
            "cement": 0.0, "cellulose": 0.0, "crushed_slate": 0.0,
            "asbozurit": 0.0, "fiberglass": 0.0
        }
        
        for prod_name, sheets in product_counts.items():
            norm = db.query(models.ProductNorm).filter(models.ProductNorm.product_name == prod_name).first()
            if norm:
                theoretical["chrysotile_4_20"] += sheets * norm.norm_chrysotile_4_20
                theoretical["chrysotile_5_65"] += sheets * norm.norm_chrysotile_5_65
                theoretical["chrysotile_6_40"] += sheets * norm.norm_chrysotile_6_40
                theoretical["cement"] += sheets * norm.norm_cement
                theoretical["cellulose"] += sheets * norm.norm_cellulose
                theoretical["crushed_slate"] += sheets * norm.norm_crushed_slate
                theoretical["asbozurit"] += sheets * norm.norm_asbozurit
                theoretical["fiberglass"] += sheets * norm.norm_fiberglass

        # Фактический расход сырья из ЗО за смену
        fact_raw = (shift.zo_chrysotile_4_20 or 0.0) + \
                   (shift.zo_chrysotile_5_65 or 0.0) + \
                   (shift.zo_chrysotile_6_40 or 0.0) + \
                   (shift.zo_cement or 0.0) + \
                   (shift.zo_cellulose or 0.0) + \
                   (shift.zo_crushed_slate or 0.0) + \
                   (shift.zo_asbozurit or 0.0) + \
                   (shift.zo_fiberglass or 0.0)

        # Теоретический расход сырья
        theory_raw = sum(theoretical.values())
        
        # Общее отклонение по сырью в кг (Факт - Теория)
        deviation = fact_raw - theory_raw

        # Фактический вес формовки в тоннах
        fact_tons = sum(r.lfm_sheets * get_product_finished_weight_kg(db, r.product_name) / 1000.0 for r in lfm_reports)

        report_data.append({
            "id": shift.id,
            "date": shift.date.strftime("%Y-%m-%d") if shift.date else "Н/Д",
            "shift_name": shift.shift_name,
            "line": shift.line,
            "master_name": shift.master.name if shift.master else "Н/Д",
            "lfm_sheets": lfm_sheets,
            "qcd_condition": qcd_cond,
            "qcd_first_grade": qcd_fg,
            "qcd_defect": qcd_def,
            "raw_deviation": round(deviation, 2),
            "fact_tons": round(fact_tons, 2)
        })
        
    return report_data

@app.get("/api/dashboard/analytics_data")
def get_analytics_data(
    request: Request,
    start_date: str = None,
    end_date: str = None,
    department: str = None,
    db: Session = Depends(get_db)
):
    user_id = request.session.get("user_id")
    user_role = request.session.get("user_role") or "admin"

    query = db.query(models.Downtime).join(models.Shift)
    
    if user_role == "master" and user_id:
        query = query.filter(models.Shift.master_id == user_id)
    
    if start_date:
        try:
            sd = datetime.strptime(start_date, "%Y-%m-%d").date()
            query = query.filter(models.Shift.date >= sd)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid start_date format. Use YYYY-MM-DD")
            
    if end_date:
        try:
            ed = datetime.strptime(end_date, "%Y-%m-%d").date()
            query = query.filter(models.Shift.date <= ed)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid end_date format. Use YYYY-MM-DD")
            
    if department:
        query = query.filter(models.Downtime.department == department)
        
    downtimes = query.all()
    
    duration_with_stop = 0
    duration_without_stop = 0
    lost_tons_with_stop = 0.0
    lost_tons_without_stop = 0.0
    lost_tenge_with_stop = 0.0
    lost_tenge_without_stop = 0.0
    count_with_stop = 0
    count_without_stop = 0
    
    by_category = {}
    node_durations = {}
    trend_data = {}
    
    for dt in downtimes:
        dur = dt.duration or 0
        tons = dt.lost_tons or 0.0
        tenge = dt.lost_tenge or 0.0
        is_stop = bool(dt.is_equipment_downtime)
        
        if is_stop:
            duration_with_stop += dur
            lost_tons_with_stop += tons
            lost_tenge_with_stop += tenge
            count_with_stop += 1
        else:
            duration_without_stop += dur
            lost_tons_without_stop += tons
            lost_tenge_without_stop += tenge
            count_without_stop += 1
            
        cat = dt.category or "Не указана"
        if cat not in by_category:
            by_category[cat] = {"with_stop": 0, "without_stop": 0}
        if is_stop:
            by_category[cat]["with_stop"] += dur
        else:
            by_category[cat]["without_stop"] += dur
            
        if is_stop and dt.node:
            node_durations[dt.node] = node_durations.get(dt.node, 0) + dur
            
        shift_date = dt.shift.date
        date_str = shift_date.strftime("%Y-%m-%d") if shift_date else "Не указана"
        if date_str not in trend_data:
            trend_data[date_str] = {}
        trend_data[date_str][cat] = trend_data[date_str].get(cat, 0) + dur

    bottlenecks = sorted([{"node": k, "duration": v} for k, v in node_durations.items()], key=lambda x: x['duration'], reverse=True)[:10]
    
    sorted_trend = {}
    for d in sorted(trend_data.keys()):
        sorted_trend[d] = trend_data[d]
        
    return {
        "kpis": {
            "with_stop": {
                "duration": duration_with_stop,
                "lost_tons": lost_tons_with_stop,
                "lost_tenge": lost_tenge_with_stop,
                "count": count_with_stop
            },
            "without_stop": {
                "duration": duration_without_stop,
                "lost_tons": lost_tons_without_stop,
                "lost_tenge": lost_tenge_without_stop,
                "count": count_without_stop
            }
        },
        "by_category": by_category,
        "bottlenecks": bottlenecks,
        "trend": sorted_trend
    }

# --- НОРМЫ РАСХОДА И ОТЧЕТ ПО СЫРЬЮ ---
@app.get("/api/norms/", response_model=list[schemas.ProductNorm])
def get_product_norms(db: Session = Depends(get_db)):
    return db.query(models.ProductNorm).all()

def get_product_finished_weight_kg(db: Session, product_name: str) -> float:
    norm = db.query(models.ProductNorm).filter(models.ProductNorm.product_name == product_name).first()
    if not norm or not norm.weight_kg:
        return 19.6 # fallback for 8 волн
    return norm.weight_kg

def get_product_raw_weight_kg(db: Session, product_name: str) -> float:
    norm = db.query(models.ProductNorm).filter(models.ProductNorm.product_name == product_name).first()
    if not norm:
        return 18.2 # fallback
    return (
        (norm.norm_chrysotile_4_20 or 0) +
        (norm.norm_chrysotile_5_65 or 0) +
        (norm.norm_chrysotile_6_40 or 0) +
        (norm.norm_cement or 0) +
        (norm.norm_cellulose or 0) +
        (norm.norm_crushed_slate or 0) +
        (norm.norm_asbozurit or 0) +
        (norm.norm_fiberglass or 0)
    )

def get_shift_plan(db: Session, shift: models.Shift) -> int:
    if shift.plan_sheets is not None and shift.plan_sheets > 0:
        return shift.plan_sheets
    sanitary_downtime = 0
    for dt in shift.downtimes:
        if dt.category == "Санитарный день":
            sanitary_downtime += dt.duration or 0
    if sanitary_downtime > 0:
        return 0
    if getattr(shift, "date", None) and shift.date.weekday() == 0 and shift.shift_name == "День":
        return 0
    return 2700 if shift.shift_name == "День" else 3300

@app.get("/api/dashboard/daily_report")
def get_daily_report(request: Request, start_date: str, end_date: str = None, line: str = None, shift_number: int = None, db: Session = Depends(get_db)):
    user_id = request.session.get("user_id")
    user_role = request.session.get("user_role") or "admin"

    try:
        sd = datetime.strptime(start_date, "%Y-%m-%d").date()
    except:
        raise HTTPException(400, "Invalid start_date format")
        
    if end_date:
        try:
            ed = datetime.strptime(end_date, "%Y-%m-%d").date()
        except:
            raise HTTPException(400, "Invalid end_date format")
    else:
        ed = sd + timedelta(days=6)
        
    num_days = (ed - sd).days + 1

    shifts = db.query(models.Shift).filter(
        models.Shift.date >= sd,
        models.Shift.date <= ed
    ).all()
    
    plan_boards = db.query(models.MonthlyPlanBoard).filter(
        models.MonthlyPlanBoard.date >= sd,
        models.MonthlyPlanBoard.date <= ed
    ).all()
    
    if shift_number is not None:
        # Initialize plans to 0, because we will populate only matching shifts from pb
        data = {
            "line_1": {str(sd + timedelta(days=i)): {"День": {"sheets": 0, "tons": 0.0, "plan_sheets": 0, "plan_tons": 0.0, "first_grade": 0, "defect": 0}, "Ночь": {"sheets": 0, "tons": 0.0, "plan_sheets": 0, "plan_tons": 0.0, "first_grade": 0, "defect": 0}} for i in range(num_days)},
            "line_2": {str(sd + timedelta(days=i)): {"День": {"sheets": 0, "tons": 0.0, "plan_sheets": 0, "plan_tons": 0.0, "first_grade": 0, "defect": 0}, "Ночь": {"sheets": 0, "tons": 0.0, "plan_sheets": 0, "plan_tons": 0.0, "first_grade": 0, "defect": 0}} for i in range(num_days)}
        }
    else:
        # Default initialization with standard norms
        data = {
            "line_1": {str(sd + timedelta(days=i)): {"День": {"sheets": 0, "tons": 0.0, "plan_sheets": (0 if (sd + timedelta(days=i)).weekday() == 0 else 2700), "plan_tons": (0 if (sd + timedelta(days=i)).weekday() == 0 else 2700) * 19.6 / 1000.0, "first_grade": 0, "defect": 0}, "Ночь": {"sheets": 0, "tons": 0.0, "plan_sheets": 3300, "plan_tons": 3300 * 19.6 / 1000.0, "first_grade": 0, "defect": 0}} for i in range(num_days)},
            "line_2": {str(sd + timedelta(days=i)): {"День": {"sheets": 0, "tons": 0.0, "plan_sheets": (0 if (sd + timedelta(days=i)).weekday() == 0 else 2700), "plan_tons": (0 if (sd + timedelta(days=i)).weekday() == 0 else 2700) * 19.6 / 1000.0, "first_grade": 0, "defect": 0}, "Ночь": {"sheets": 0, "tons": 0.0, "plan_sheets": 3300, "plan_tons": 3300 * 19.6 / 1000.0, "first_grade": 0, "defect": 0}} for i in range(num_days)}
        }
    
    pb_map = {}
    for pb in plan_boards:
        pb_map[(pb.date, pb.shift_name, pb.line)] = pb
        
        day_key = str(pb.date)
        line_key = "line_1" if pb.line == "ЛФМ-1" else "line_2"
        s_name = pb.shift_name
        if day_key in data[line_key] and s_name in ["День", "Ночь"]:
            if shift_number is not None and pb.shift_number != shift_number:
                continue
            data[line_key][day_key][s_name]["plan_sheets"] = pb.plan_sheets or 0
            data[line_key][day_key][s_name]["plan_tons"] = (pb.plan_sheets or 0) * 19.6 / 1000.0
            
            # Факт записываем только для текущего мастера (или если роль не master)
            if user_role != "master" or pb.master_id == user_id:
                data[line_key][day_key][s_name]["sheets"] = pb.fact_sheets or 0
                data[line_key][day_key][s_name]["tons"] = (pb.fact_sheets or 0) * 19.6 / 1000.0
                data[line_key][day_key][s_name]["first_grade"] = pb.first_grade or 0
                data[line_key][day_key][s_name]["defect"] = pb.defect or 0
            
    for s in shifts:
        if not s.date: continue
        # Пропускаем смены других мастеров для роли master
        if user_role == "master" and s.master_id != user_id:
            continue
        day_key = str(s.date)
        line_key = "line_1" if "1" in s.line else "line_2"
        s_name = "День" if s.shift_name == "День" else "Ночь"
        
        if day_key not in data[line_key]:
            continue
            
        if shift_number is not None:
            pb_line_name = "ЛФМ-1" if "1" in s.line else "ЛФМ-2"
            pb_entry = pb_map.get((s.date, s.shift_name, pb_line_name))
            if pb_entry is None or pb_entry.shift_number != shift_number:
                continue
            
        total_w = 0
        total_s = 0
        for r in s.lfm_reports:
            w_kg = get_product_finished_weight_kg(db, r.product_name)
            data[line_key][day_key][s_name]["first_grade"] += (r.formed_1st_grade or 0)
            data[line_key][day_key][s_name]["defect"] += (r.formed_defect or 0)
            total_w += w_kg * r.lfm_sheets
            total_s += r.lfm_sheets
            
        if total_s > 0:
            if data[line_key][day_key][s_name]["sheets"] == 0 or shift_number is not None:
                data[line_key][day_key][s_name]["sheets"] = total_s
            avg_w = total_w / total_s
            
            data[line_key][day_key][s_name]["plan_tons"] = data[line_key][day_key][s_name]["plan_sheets"] * avg_w / 1000.0
            data[line_key][day_key][s_name]["tons"] = data[line_key][day_key][s_name]["sheets"] * avg_w / 1000.0
            
    return {
        "days": num_days,
        "start_date": str(sd),
        "data": data
    }

@app.get("/api/dashboard/export_daily_report")
def export_daily_report(request: Request, start_date: str, line: str = None, db: Session = Depends(get_db)):
    user_id = request.session.get("user_id")
    user_role = request.session.get("user_role") or "admin"

    try:
        sd = datetime.strptime(start_date, "%Y-%m-%d").date()
    except:
        raise HTTPException(400, "Invalid date format")
        
    num_days = 14
    ed = sd + timedelta(days=num_days - 1)
    
    shifts = db.query(models.Shift).filter(
        models.Shift.date >= sd,
        models.Shift.date <= ed
    ).all()
    
    plan_boards = db.query(models.MonthlyPlanBoard).filter(
        models.MonthlyPlanBoard.date >= sd,
        models.MonthlyPlanBoard.date <= ed
    ).all()
    
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    
    lines_to_export = [("Линия 1", "ЛФМ-1"), ("Линия 2", "ЛФМ-2")]
    if line == 'lfm1':
        lines_to_export = [("Линия 1", "ЛФМ-1")]
    elif line == 'lfm2':
        lines_to_export = [("Линия 2", "ЛФМ-2")]
        
    for line_id, line_label in lines_to_export:
        ws = wb.create_sheet(title=line_label)
        ws.append(["Дата", "Смена", "План (Листы)", "Факт (Листы)", "План (Тонны)", "Факт (Тонны)", "1-й сорт", "Брак"])
        
        ws.column_dimensions['A'].width = 12
        ws.column_dimensions['B'].width = 8
        ws.column_dimensions['C'].width = 16
        ws.column_dimensions['D'].width = 16
        ws.column_dimensions['E'].width = 16
        ws.column_dimensions['F'].width = 16
        ws.column_dimensions['G'].width = 12
        ws.column_dimensions['H'].width = 12
        
        day_data = {str(sd + timedelta(days=i)): {
            "День": {"sheets": 0, "tons": 0.0, "plan_sheets": (0 if (sd + timedelta(days=i)).weekday() == 0 else 2700), "plan_tons": (0 if (sd + timedelta(days=i)).weekday() == 0 else 2700) * 19.6 / 1000.0, "first_grade": 0, "defect": 0}, 
            "Ночь": {"sheets": 0, "tons": 0.0, "plan_sheets": 3300, "plan_tons": 3300 * 19.6 / 1000.0, "first_grade": 0, "defect": 0}
        } for i in range(num_days)}
        
        for pb in plan_boards:
            if pb.line != line_label: continue
            day_key = str(pb.date)
            s_name = pb.shift_name
            if day_key in day_data and s_name in ["День", "Ночь"]:
                day_data[day_key][s_name]["plan_sheets"] = pb.plan_sheets or 0
                day_data[day_key][s_name]["plan_tons"] = (pb.plan_sheets or 0) * 19.6 / 1000.0
                
                # Факт записываем только для текущего мастера (или если роль не master)
                if user_role != "master" or pb.master_id == user_id:
                    day_data[day_key][s_name]["sheets"] = pb.fact_sheets or 0
                    day_data[day_key][s_name]["tons"] = (pb.fact_sheets or 0) * 19.6 / 1000.0
                    day_data[day_key][s_name]["first_grade"] = pb.first_grade or 0
                    day_data[day_key][s_name]["defect"] = pb.defect or 0
        
        for s in shifts:
            if not s.date or s.line != line_id: continue
            # Пропускаем смены других мастеров для роли master
            if user_role == "master" and s.master_id != user_id:
                continue
            day_key = str(s.date)
            if day_key not in day_data: continue
            
            s_name = "День" if s.shift_name == "День" else "Ночь"
            
            total_w = 0
            total_s = 0
            for r in s.lfm_reports:
                w_kg = get_product_finished_weight_kg(db, r.product_name)
                total_w += w_kg * r.lfm_sheets
                total_s += r.lfm_sheets
                
            if total_s > 0:
                if day_data[day_key][s_name]["sheets"] == 0:
                    day_data[day_key][s_name]["sheets"] = total_s
                avg_w = total_w / total_s
                
                day_data[day_key][s_name]["plan_tons"] = day_data[day_key][s_name]["plan_sheets"] * avg_w / 1000.0
                day_data[day_key][s_name]["tons"] = day_data[day_key][s_name]["sheets"] * avg_w / 1000.0
                
        row_idx = 2
        for i in range(num_days):
            d_str = str(sd + timedelta(days=i))
            ws.append([d_str, "День", day_data[d_str]["День"]["plan_sheets"], day_data[d_str]["День"]["sheets"], round(day_data[d_str]["День"]["plan_tons"], 2), round(day_data[d_str]["День"]["tons"], 2), day_data[d_str]["День"]["first_grade"], day_data[d_str]["День"]["defect"]])
            ws.append([d_str, "Ночь", day_data[d_str]["Ночь"]["plan_sheets"], day_data[d_str]["Ночь"]["sheets"], round(day_data[d_str]["Ночь"]["plan_tons"], 2), round(day_data[d_str]["Ночь"]["tons"], 2), day_data[d_str]["Ночь"]["first_grade"], day_data[d_str]["Ночь"]["defect"]])
            row_idx += 2
            
        chart_sheets = BarChart()
        chart_sheets.type = "col"
        chart_sheets.style = 10
        chart_sheets.title = f"Выработка {line_label} (Листы)"
        chart_sheets.y_axis.title = 'Количество (Листы)'
        chart_sheets.x_axis.title = 'Дата / Смена'
        
        data_sheets = Reference(ws, min_col=3, min_row=1, max_row=row_idx-1, max_col=4)
        cats = Reference(ws, min_col=1, min_row=2, max_row=row_idx-1, max_col=2)
        
        chart_sheets.add_data(data_sheets, titles_from_data=True)
        chart_sheets.set_categories(cats)
        chart_sheets.width = 20
        
        ws.add_chart(chart_sheets, "H2")
        
        chart_tons = BarChart()
        chart_tons.type = "col"
        chart_tons.style = 10
        chart_tons.title = f"Выработка {line_label} (Тонны)"
        chart_tons.y_axis.title = 'Вес (Тонны)'
        chart_tons.x_axis.title = 'Дата / Смена'
        
        data_tons = Reference(ws, min_col=5, min_row=1, max_row=row_idx-1, max_col=6)
        
        chart_tons.add_data(data_tons, titles_from_data=True)
        chart_tons.set_categories(cats)
        chart_tons.width = 20
        
        ws.add_chart(chart_tons, "H18")
        
    out = io.BytesIO()
    wb.save(out)
    
    filename = f"report_{start_date}_{line or 'all'}.xlsx"
    headers = {
        'Content-Disposition': f'attachment; filename="{filename}"'
    }
    return Response(content=out.getvalue(), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers=headers)

@app.get("/api/dashboard/shift_board")
def get_shift_board(month: str, db: Session = Depends(get_db)):
    try:
        y, m = map(int, month.split('-'))
        num_days = calendar.monthrange(y, m)[1]
    except:
        raise HTTPException(400, "Invalid month format")
        
    month_start = datetime(y, m, 1).date()
    month_end = datetime(y, m, num_days).date()
    shifts = db.query(models.Shift).filter(
        models.Shift.date >= month_start,
        models.Shift.date <= month_end
    ).order_by(models.Shift.date, models.Shift.id).all()
    
    board = {}
    for s in shifts:
        if not s.date: continue
        master = s.master_name or "Неизвестный мастер"
        if master not in board:
            board[master] = []
            
        total_s = 0
        total_w = 0
        for r in s.lfm_reports:
            w_kg = get_product_finished_weight_kg(db, r.product_name)
            total_s += r.lfm_sheets
            total_w += r.lfm_sheets * w_kg
            
        plan_sheets = get_shift_plan(db, s)
        plan_tons = (plan_sheets * 19.6) / 1000.0
        if total_s > 0:
            avg_w = total_w / total_s
            plan_tons = (plan_sheets * avg_w) / 1000.0
            
        board[master].append({
            "shift_id": s.id,
            "date": str(s.date),
            "shift_name": s.shift_name,
            "line": s.line,
            "plan_sheets": plan_sheets,
            "fact_sheets": total_s,
            "plan_tons": round(plan_tons, 2),
            "fact_tons": round(total_w / 1000.0, 2),
            "closed": s.status == "closed"
        })
        
    return board

@app.get("/api/dashboard/export_shift")
def export_shift(shift_id: int = None, db: Session = Depends(get_db)):
    file_bytes = excel_exporter.generate_flat_report(db)
    filename = "Сводный_отчет_Tectum.xlsx"
    from urllib.parse import quote
    safe_filename = quote(filename)
    headers = {
        'Content-Disposition': f'attachment; filename="{safe_filename}"; filename*=UTF-8\'\'{safe_filename}'
    }
    return Response(
        content=file_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers
    )

@app.post("/api/dashboard/sync_sharepoint")
def sync_sharepoint_manually(request: Request, db: Session = Depends(get_db)):
    user_id = request.session.get("user_id")
    user_role = request.session.get("user_role")
    
    if not user_id:
        raise HTTPException(status_code=401, detail="Вы не авторизованы")
        
    if user_role not in ["master", "admin"]:
        raise HTTPException(status_code=403, detail="Доступ запрещен. Только мастер смены или администратор могут запускать синхронизацию.")
        
    try:
        file_bytes = excel_exporter.generate_flat_report(db)
        filename = "Сводный_отчет_Tectum.xlsx"
        
        # Save locally to static folder as well
        local_path = os.path.join("static", "Сводный_отчет_Tectum.xlsx")
        try:
            with open(local_path, "wb") as f:
                f.write(file_bytes)
        except Exception as local_err:
            print(f"Error saving local excel file: {local_err}")
            
        web_url = m365_integration.upload_file_to_sharepoint(file_bytes, filename, folder="Reports")
        
        # Log to AuditLog
        db.add(models.AuditLog(
            user_name=request.session.get("user_email") or f"user_{user_id}",
            action="UPDATE",
            target_table="shifts",
            target_id=0,
            details=f"Ручная синхронизация отчета с SharePoint выполнена успешно. Ссылка: {web_url}"
        ))
        db.commit()
        return {"message": "Синхронизация выполнена успешно", "url": web_url}
    except Exception as e:
        error_msg = str(e)
        if "423" in error_msg or "Locked" in error_msg:
            raise HTTPException(status_code=423, detail="Файл отчета все еще заблокирован в SharePoint (кто-то открыл его в Excel Online). Закройте файл и попробуйте снова.")
        else:
            raise HTTPException(status_code=500, detail=f"Ошибка синхронизации: {error_msg}")

@app.get("/api/dashboard/view_archive")
def view_archive():
    try:
        url = m365_integration.get_file_web_url("Сводный_отчет_Tectum.xlsx", folder="Reports")
        return RedirectResponse(url=url)
    except Exception as e:
        print("Ошибка получения ссылки из SharePoint, отдаем локальный файл:", e)
        return RedirectResponse(url="/api/dashboard/export_shift")

@app.get("/api/dashboard/export_week")
def export_week(request: Request, start_date: str, db: Session = Depends(get_db)):
    user_id = request.session.get("user_id")
    user_role = request.session.get("user_role") or "admin"

    try:
        sd = datetime.strptime(start_date, "%Y-%m-%d").date()
    except:
        raise HTTPException(400, "Invalid date format, use YYYY-MM-DD")
        
    ed = sd + timedelta(days=6)
    
    query = db.query(models.Shift).filter(
        models.Shift.date >= sd,
        models.Shift.date <= ed
    )
    if user_role == "master" and user_id:
        query = query.filter(models.Shift.master_id == user_id)
    shifts = query.order_by(models.Shift.date, models.Shift.id).all()
    
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = f"Неделя {sd} - {ed}"
    
    ws.append([f"Отчет за неделю с {sd} по {ed}"])
    ws.append(["Дата", "Смена", "Мастер", "Линия", "План (Листы)", "Факт (Листы)", "План (Тонны)", "Факт (Тонны)"])
    
    ws.column_dimensions['A'].width = 12
    ws.column_dimensions['B'].width = 8
    ws.column_dimensions['C'].width = 20
    ws.column_dimensions['D'].width = 10
    ws.column_dimensions['E'].width = 15
    ws.column_dimensions['F'].width = 15
    ws.column_dimensions['G'].width = 15
    ws.column_dimensions['H'].width = 15
    
    plan_boards = db.query(models.MonthlyPlanBoard).filter(
        models.MonthlyPlanBoard.date >= sd,
        models.MonthlyPlanBoard.date <= ed
    ).all()
    pb_dict = {(pb.date, pb.shift_name, pb.line): pb for pb in plan_boards}

    active_lines = set([s.line.replace("Линия ", "ЛФМ-") for s in shifts if s.line] + [pb.line for pb in plan_boards])
    if not active_lines:
        active_lines = {"ЛФМ-2"}

    for l_key in active_lines:
        for i in range(7):
            d = sd + timedelta(days=i)
            for s_name in ["День", "Ночь"]:
                plan_sheets = 0 if d.weekday() == 0 and s_name == "День" else (2700 if s_name == "День" else 3300)
                
                pb = pb_dict.get((d, s_name, l_key))
                if pb and pb.plan_sheets is not None:
                    plan_sheets = pb.plan_sheets
                    
                s = next((shift for shift in shifts if shift.date == d and shift.shift_name == s_name and (shift.line.replace("Линия ", "ЛФМ-") if shift.line else "ЛФМ-1") == l_key), None)
                
                show_fact = (user_role != "master" or (pb and pb.master_id == user_id) or (s and s.master_id == user_id))
                total_sheets = pb.fact_sheets if (pb and show_fact) else 0
                
                if s and show_fact:
                    sum_lfm_sheets = sum(r.lfm_sheets for r in s.lfm_reports)
                    sum_lfm_tons = sum(r.lfm_sheets * get_product_finished_weight_kg(db, r.product_name) / 1000.0 for r in s.lfm_reports)
                    avg_w = (sum_lfm_tons / sum_lfm_sheets) if sum_lfm_sheets > 0 else (19.6/1000)
                    if total_sheets == 0 and sum_lfm_sheets > 0:
                        total_sheets = sum_lfm_sheets
                    master_name = s.master.name if s.master else "Н/Д"
                else:
                    avg_w = 19.6 / 1000.0
                    master_name = "Н/Д" if show_fact else "Смена др. мастера"
                    total_sheets = pb.fact_sheets if (pb and show_fact) else 0
                    
                plan_tons = plan_sheets * avg_w
                total_tons = total_sheets * avg_w
                
                ws.append([str(d), s_name, master_name, l_key, plan_sheets, total_sheets, round(plan_tons, 2), round(total_tons, 2)])
    out = io.BytesIO()
    wb.save(out)
    
    filename = f"week_{sd}.xlsx"
    return Response(content=out.getvalue(), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={'Content-Disposition': f'attachment; filename="{filename}"'})

@app.get("/api/dashboard/weekly")
def get_weekly_json(request: Request, start_date: str, db: Session = Depends(get_db)):
    user_id = request.session.get("user_id")
    user_role = request.session.get("user_role") or "admin"

    try:
        sd = datetime.strptime(start_date, "%Y-%m-%d").date()
    except:
        raise HTTPException(400, "Invalid date format, use YYYY-MM-DD")
        
    ed = sd + timedelta(days=6)
    
    query = db.query(models.Shift).filter(
        models.Shift.date >= sd,
        models.Shift.date <= ed
    )
    if user_role == "master" and user_id:
        query = query.filter(models.Shift.master_id == user_id)
    shifts = query.order_by(models.Shift.date, models.Shift.id).all()
    
    plan_boards = db.query(models.MonthlyPlanBoard).filter(
        models.MonthlyPlanBoard.date >= sd,
        models.MonthlyPlanBoard.date <= ed
    ).all()
    pb_dict = {(pb.date, pb.shift_name, pb.line): pb for pb in plan_boards}
    
    active_lines = set([s.line.replace("Линия ", "ЛФМ-") for s in shifts if s.line] + [pb.line for pb in plan_boards])
    if not active_lines:
        active_lines = {"ЛФМ-2"}
        
    data = []
    
    for l_key in active_lines:
        for i in range(7):
            d = sd + timedelta(days=i)
            day_str = str(d)
            for s_name in ["День", "Ночь"]:
                plan_sheets = 0 if d.weekday() == 0 and s_name == "День" else (2700 if s_name == "День" else 3300)
                
                pb = pb_dict.get((d, s_name, l_key))
                if pb and pb.plan_sheets is not None:
                    plan_sheets = pb.plan_sheets
                    
                s = next((shift for shift in shifts if shift.date == d and shift.shift_name == s_name and (shift.line.replace("Линия ", "ЛФМ-") if shift.line else "ЛФМ-1") == l_key), None)
                
                show_fact = (user_role != "master" or (pb and pb.master_id == user_id) or (s and s.master_id == user_id))
                total_sheets = pb.fact_sheets if (pb and show_fact) else 0
                
                if s and show_fact:
                    sum_lfm_sheets = sum(r.lfm_sheets for r in s.lfm_reports)
                    sum_lfm_tons = sum(r.lfm_sheets * get_product_finished_weight_kg(db, r.product_name) / 1000.0 for r in s.lfm_reports)
                    avg_w = (sum_lfm_tons / sum_lfm_sheets) if sum_lfm_sheets > 0 else (19.6/1000)
                    if total_sheets == 0 and sum_lfm_sheets > 0:
                        total_sheets = sum_lfm_sheets
                        
                    if pb and (pb.first_grade or pb.defect):
                        ds_first = pb.first_grade
                        ds_defect = pb.defect
                    else:
                        ds_first = sum(b.ds_first_grade for b in s.batches)
                        ds_defect = sum(b.ds_defect for b in s.batches)
                        
                    qcd_first = sum(b.qcd_first_grade for b in s.batches)
                    qcd_defect = sum(b.qcd_defect for b in s.batches)
                    
                    sanitary_note = ""
                    for dt in s.downtimes:
                        if dt.category == "Санитарный день":
                            sanitary_note = "Санитарный день"
                            if dt.duration:
                                sanitary_note += f" ({dt.duration} мин)"
                            break
                    master_name = s.master.name if s.master else "Н/Д"
                    shift_id = s.id
                else:
                    avg_w = 19.6 / 1000.0
                    ds_first = pb.first_grade if (pb and show_fact) else 0
                    ds_defect = pb.defect if (pb and show_fact) else 0
                    qcd_first = 0
                    qcd_defect = 0
                    sanitary_note = "Санитарный день (план 0)" if d.weekday() == 0 and s_name == "День" else ("Нет данных" if show_fact else "Смена другого мастера")
                    master_name = "Н/Д"
                    shift_id = None
                    
                plan_tons = plan_sheets * avg_w
                total_tons = total_sheets * avg_w
                
                data.append({
                    "id": shift_id,
                    "date": day_str,
                    "shift_name": s_name,
                    "master": master_name,
                    "line": l_key,
                    "plan_sheets": plan_sheets,
                    "fact_sheets": total_sheets,
                    "plan_tons": round(plan_tons, 2),
                    "fact_tons": round(total_tons, 2),
                    "ds_first_grade": ds_first,
                    "ds_defect": ds_defect,
                    "qcd_first_grade": qcd_first,
                    "qcd_defect": qcd_defect,
                    "note": sanitary_note
                })
        
    return {
        "start_date": str(sd),
        "end_date": str(ed),
        "data": data
    }


@app.get("/api/shifts/{shift_id}/materials_report", response_model=schemas.RawMaterialReport)
def get_materials_report(shift_id: int, db: Session = Depends(get_db)):
    shift = db.query(models.Shift).get(shift_id)
    if not shift:
        raise HTTPException(404, "Смена не найдена")
    
    # 1. Считаем произведенную продукцию (Формовка)
    lfm_reports = db.query(models.LFMReport).filter(models.LFMReport.shift_id == shift_id).all()
    product_counts = {}
    for r in lfm_reports:
        product_counts[r.product_name] = product_counts.get(r.product_name, 0) + r.lfm_sheets
        
    # 2. Получаем нормы для этих продуктов и считаем теорию
    theoretical = {
        "chrysotile_4_20": 0.0, "chrysotile_5_65": 0.0, "chrysotile_6_40": 0.0,
        "cement": 0.0, "cellulose": 0.0, "crushed_slate": 0.0,
        "asbozurit": 0.0, "fiberglass": 0.0
    }
    
    for prod_name, sheets in product_counts.items():
        norm = db.query(models.ProductNorm).filter(models.ProductNorm.product_name == prod_name).first()
        if norm:
            theoretical["chrysotile_4_20"] += sheets * norm.norm_chrysotile_4_20
            theoretical["chrysotile_5_65"] += sheets * norm.norm_chrysotile_5_65
            theoretical["chrysotile_6_40"] += sheets * norm.norm_chrysotile_6_40
            theoretical["cement"] += sheets * norm.norm_cement
            theoretical["cellulose"] += sheets * norm.norm_cellulose
            theoretical["crushed_slate"] += sheets * norm.norm_crushed_slate
            theoretical["asbozurit"] += sheets * norm.norm_asbozurit
            theoretical["fiberglass"] += sheets * norm.norm_fiberglass

    # 3. Формируем детальный отчет (Факт из ZO - Теория)
    details = []
    total_dev = 0.0
    
    mapping = [
        ("Хризотил 4-20", shift.zo_chrysotile_4_20, theoretical["chrysotile_4_20"]),
        ("Хризотил 5-65", shift.zo_chrysotile_5_65, theoretical["chrysotile_5_65"]),
        ("Хризотил 6-40", shift.zo_chrysotile_6_40, theoretical["chrysotile_6_40"]),
        ("Цемент", shift.zo_cement, theoretical["cement"]),
        ("Целлюлоза", shift.zo_cellulose, theoretical["cellulose"]),
        ("Дробленый шифер", shift.zo_crushed_slate, theoretical["crushed_slate"]),
        ("Асбозурит", shift.zo_asbozurit, theoretical["asbozurit"]),
        ("Стекловолокно", shift.zo_fiberglass, theoretical["fiberglass"]),
        ("Лапрол", shift.zo_laprol, 0.0),
        ("Асбокартон", shift.zo_asbocarton, 0.0)
    ]

    
    total_sheets = sum(product_counts.values())
    
    for mat_name, actual, theory in mapping:
        actual_val = actual or 0.0
        theory_val = theory or 0.0
        dev = actual_val - theory_val
        total_dev += dev
        
        unit_actual = actual_val / total_sheets if total_sheets > 0 else 0.0
        unit_theory = theory_val / total_sheets if total_sheets > 0 else 0.0
        unit_dev = dev / total_sheets if total_sheets > 0 else 0.0
        
        details.append({
            "material": mat_name,
            "actual": round(actual_val, 2),
            "theoretical": round(theory_val, 2),
            "deviation": round(dev, 2),
            "unit_actual": round(unit_actual, 4),
            "unit_theoretical": round(unit_theory, 4),
            "unit_deviation": round(unit_dev, 4)
        })
        
    return {
        "shift_id": shift_id,
        "total_deviation_kg": round(total_dev, 2),
        "details": details
    }


# --- ADMIN PANEL ENDPOINTS ---

@app.get("/admin")
def read_admin():
    return FileResponse("static/admin.html")

@app.post("/api/admin/masters/", response_model=schemas.Master)
def create_master(master: schemas.MasterCreate, db: Session = Depends(get_db)):
    db_master = models.Master(**master.model_dump())
    db.add(db_master)
    db.commit()
    db.refresh(db_master)
    return db_master

@app.put("/api/admin/masters/{master_id}", response_model=schemas.Master)
def update_master(master_id: int, master: schemas.MasterUpdate, db: Session = Depends(get_db)):
    db_master = db.query(models.Master).get(master_id)
    if not db_master: raise HTTPException(404)
    update_data = master.model_dump(exclude_unset=True)
    for key, val in update_data.items():
        setattr(db_master, key, val)
    db.commit()
    db.refresh(db_master)
    return db_master

@app.delete("/api/admin/masters/{master_id}")
def delete_master(master_id: int, request: Request, db: Session = Depends(get_db)):
    check_admin_session(request, db)
    db_master = db.query(models.Master).get(master_id)
    if not db_master: raise HTTPException(404, "Сотрудник не найден")
    
    # Проверяем наличие связанных смен
    has_shifts = db.query(models.Shift).filter(models.Shift.master_id == master_id).first()
    if has_shifts:
        raise HTTPException(status_code=400, detail="Невозможно удалить сотрудника, так как на него записаны смены.")
        
    # Проверяем наличие записей в плане на месяц
    has_plans = db.query(models.MonthlyPlanBoard).filter(models.MonthlyPlanBoard.master_id == master_id).first()
    if has_plans:
        raise HTTPException(status_code=400, detail="Невозможно удалить сотрудника, так как он есть в плане на месяц.")
        
    db.delete(db_master)
    db.commit()
    return {"status": "ok"}

def check_admin_session(request: Request, db: Session):
    role = request.session.get("user_role")
    user_id = request.session.get("user_id")
    if not user_id or role not in ["admin", "director", "technologist"]:
        raise HTTPException(status_code=403, detail="Доступ запрещен. Требуются права администратора.")
    user = db.query(models.Master).get(user_id)
    if not user or user.role not in ["admin", "director", "technologist"]:
        raise HTTPException(status_code=403, detail="Доступ запрещен. Требуются права администратора.")
    return user

@app.get("/api/admin/shifts/{shift_id}/details")
def admin_get_shift_details(shift_id: int, request: Request, db: Session = Depends(get_db)):
    check_admin_session(request, db)
    shift = db.query(models.Shift).get(shift_id)
    if not shift: raise HTTPException(404, "Смена не найдена")
    
    lfm_reports = db.query(models.LFMReport).filter(models.LFMReport.shift_id == shift_id).all()
    batches = db.query(models.Batch).filter(models.Batch.shift_id == shift_id).all()
    downtimes = db.query(models.Downtime).filter(models.Downtime.shift_id == shift_id).all()
    
    return {
        "shift": shift,
        "lfm_reports": lfm_reports,
        "batches": batches,
        "downtimes": downtimes
    }

@app.put("/api/admin/shifts/{shift_id}")
def admin_update_shift(shift_id: int, data: dict, request: Request, db: Session = Depends(get_db)):
    admin = check_admin_session(request, db)
    shift = db.query(models.Shift).get(shift_id)
    if not shift: raise HTTPException(404, "Смена не найдена")
    
    old_values = {}
    new_values = {}
    
    if "date" in data and data["date"]:
        try:
            data["date"] = datetime.strptime(data["date"], "%Y-%m-%d").date()
        except Exception:
            pass
            
    for key, val in data.items():
        if hasattr(shift, key):
            old_val = getattr(shift, key)
            if old_val != val:
                old_values[key] = str(old_val)
                new_values[key] = str(val)
                setattr(shift, key, val)
                
    if old_values:
        log_entry = models.AuditLog(
            timestamp=datetime.utcnow(),
            user_name=admin.name,
            action=f"Редактирование смены ID {shift_id}",
            details=f"Изменено: {old_values} -> {new_values}"
        )
        db.add(log_entry)
        db.commit()
    else:
        db.commit()
    return {"status": "ok"}

@app.delete("/api/admin/shifts/{shift_id}")
def admin_delete_shift(shift_id: int, request: Request, db: Session = Depends(get_db)):
    admin = check_admin_session(request, db)
    shift = db.query(models.Shift).get(shift_id)
    if not shift: raise HTTPException(404, "Смена не найдена")
    
    db.query(models.LFMReport).filter(models.LFMReport.shift_id == shift_id).delete()
    db.query(models.Batch).filter(models.Batch.shift_id == shift_id).delete()
    db.query(models.Downtime).filter(models.Downtime.shift_id == shift_id).delete()
    
    log_entry = models.AuditLog(
        timestamp=datetime.utcnow(),
        user_name=admin.name,
        action=f"Удаление смены ID {shift_id}",
        details=f"Удалена смена за {shift.date} ({shift.shift_name}, Линия {shift.line}) и все связанные с ней отчеты, партии и простои."
    )
    db.add(log_entry)
    db.delete(shift)
    db.commit()
    return {"status": "ok"}

@app.put("/api/admin/lfm/{report_id}")
def admin_update_lfm(report_id: int, data: dict, request: Request, db: Session = Depends(get_db)):
    admin = check_admin_session(request, db)
    report = db.query(models.LFMReport).get(report_id)
    if not report: raise HTTPException(404, "Отчет ЛФМ не найден")
    
    old_values = {}
    new_values = {}
    for key, val in data.items():
        if hasattr(report, key):
            old_val = getattr(report, key)
            if old_val != val:
                old_values[key] = str(old_val)
                new_values[key] = str(val)
                setattr(report, key, val)
                
    if old_values:
        log_entry = models.AuditLog(
            timestamp=datetime.utcnow(),
            user_name=admin.name,
            action=f"Редактирование отчета ЛФМ ID {report_id}",
            details=f"Смена {report.shift_id}. Изменено: {old_values} -> {new_values}"
        )
        db.add(log_entry)
        db.commit()
        # Sync with plan board
        sync_lfm_to_plan_board(report.shift_id, db)
    else:
        db.commit()
    return {"status": "ok"}

@app.delete("/api/admin/lfm/{report_id}")
def admin_delete_lfm(report_id: int, request: Request, db: Session = Depends(get_db)):
    admin = check_admin_session(request, db)
    report = db.query(models.LFMReport).get(report_id)
    if not report: raise HTTPException(404, "Отчет ЛФМ не найден")
    shift_id = report.shift_id
    
    log_entry = models.AuditLog(
        timestamp=datetime.utcnow(),
        user_name=admin.name,
        action=f"Удаление отчета ЛФМ ID {report_id}",
        details=f"Смена {report.shift_id}. Удалена продукция: {report.product_name}, листы: {report.lfm_sheets}."
    )
    db.add(log_entry)
    db.delete(report)
    db.commit()
    # Sync with plan board
    sync_lfm_to_plan_board(shift_id, db)
    return {"status": "ok"}

@app.put("/api/admin/batches/{batch_id}")
def admin_update_batch(batch_id: int, data: dict, request: Request, db: Session = Depends(get_db)):
    admin = check_admin_session(request, db)
    batch = db.query(models.Batch).get(batch_id)
    if not batch: raise HTTPException(404, "Партия не найдена")
    
    old_values = {}
    new_values = {}
    for key, val in data.items():
        if hasattr(batch, key):
            old_val = getattr(batch, key)
            if old_val != val:
                old_values[key] = str(old_val)
                new_values[key] = str(val)
                setattr(batch, key, val)
                
    if old_values:
        log_entry = models.AuditLog(
            timestamp=datetime.utcnow(),
            user_name=admin.name,
            action=f"Редактирование партии ID {batch_id}",
            details=f"Смена {batch.shift_id}. Изменено: {old_values} -> {new_values}"
        )
        db.add(log_entry)
        db.commit()
    else:
        db.commit()
    return {"status": "ok"}

@app.delete("/api/admin/batches/{batch_id}")
def admin_delete_batch(batch_id: int, request: Request, db: Session = Depends(get_db)):
    admin = check_admin_session(request, db)
    batch = db.query(models.Batch).get(batch_id)
    if not batch: raise HTTPException(404, "Партия не найдена")
    
    log_entry = models.AuditLog(
        timestamp=datetime.utcnow(),
        user_name=admin.name,
        action=f"Удаление партии ID {batch_id}",
        details=f"Смена {batch.shift_id}. Удален номер партии: {batch.batch_number}, продукция: {batch.product_name}."
    )
    db.add(log_entry)
    db.delete(batch)
    db.commit()
    return {"status": "ok"}

@app.put("/api/admin/downtimes/{downtime_id}")
def admin_update_downtime(downtime_id: int, data: dict, request: Request, db: Session = Depends(get_db)):
    admin = check_admin_session(request, db)
    dt = db.query(models.Downtime).get(downtime_id)
    if not dt: raise HTTPException(404, "Простой не найден")
    
    old_values = {}
    new_values = {}
    for key, val in data.items():
        if hasattr(dt, key):
            old_val = getattr(dt, key)
            if old_val != val:
                old_values[key] = str(old_val)
                new_values[key] = str(val)
                setattr(dt, key, val)
                
    if old_values:
        log_entry = models.AuditLog(
            timestamp=datetime.utcnow(),
            user_name=admin.name,
            action=f"Редактирование простоя ID {downtime_id}",
            details=f"Смена {dt.shift_id}. Изменено: {old_values} -> {new_values}"
        )
        db.add(log_entry)
        db.commit()
    else:
        db.commit()
    return {"status": "ok"}

@app.delete("/api/admin/downtimes/{downtime_id}")
def admin_delete_downtime(downtime_id: int, request: Request, db: Session = Depends(get_db)):
    admin = check_admin_session(request, db)
    dt = db.query(models.Downtime).get(downtime_id)
    if not dt: raise HTTPException(404, "Простой не найден")
    
    log_entry = models.AuditLog(
        timestamp=datetime.utcnow(),
        user_name=admin.name,
        action=f"Удаление простоя ID {downtime_id}",
        details=f"Смена {dt.shift_id}. Удалено описание: {dt.description}, длительность: {dt.duration} мин."
    )
    db.add(log_entry)
    db.delete(dt)
    db.commit()
    return {"status": "ok"}

@app.post("/api/admin/norms/", response_model=schemas.ProductNorm)
def create_norm(norm: schemas.ProductNormCreate, db: Session = Depends(get_db)):
    db_norm = models.ProductNorm(**norm.model_dump())
    db.add(db_norm)
    db.commit()
    db.refresh(db_norm)
    return db_norm

@app.put("/api/admin/norms/{norm_id}", response_model=schemas.ProductNorm)
def update_norm(norm_id: int, norm: schemas.ProductNormUpdate, db: Session = Depends(get_db)):
    db_norm = db.query(models.ProductNorm).get(norm_id)
    if not db_norm: raise HTTPException(404)
    update_data = norm.model_dump(exclude_unset=True)
    for key, val in update_data.items():
        setattr(db_norm, key, val)
    db.commit()
    db.refresh(db_norm)
    return db_norm

@app.delete("/api/admin/norms/{norm_id}")
def delete_norm(norm_id: int, db: Session = Depends(get_db)):
    db_norm = db.query(models.ProductNorm).get(norm_id)
    if not db_norm: raise HTTPException(404)
    db.delete(db_norm)
    db.commit()
    return {"status": "ok"}

@app.post("/api/admin/clear_data/")
def clear_operational_data(db: Session = Depends(get_db)):
    try:
        deleted_batches = db.query(models.Batch).delete()
        deleted_lfm = db.query(models.LFMReport).delete()
        deleted_downtime = db.query(models.Downtime).delete()
        deleted_shifts = db.query(models.Shift).delete()
        deleted_plan_board = db.query(models.MonthlyPlanBoard).delete()
        db.commit()
        return {
            "status": "ok",
            "deleted": {
                "batches": deleted_batches,
                "lfm_reports": deleted_lfm,
                "downtimes": deleted_downtime,
                "shifts": deleted_shifts,
                "plan_board": deleted_plan_board
            }
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(500, str(e))

# --- MONTHLY PLAN BOARD ---
@app.get("/api/plan_board", response_model=list[schemas.MonthlyPlanBoard])
def get_plan_board(db: Session = Depends(get_db)):
    try:
        return db.query(models.MonthlyPlanBoard).order_by(models.MonthlyPlanBoard.date.desc(), models.MonthlyPlanBoard.shift_number).all()
    except Exception as e:
        import traceback
        driver = db.bind.dialect.name if db.bind else 'unknown'
        err_msg = f"Database error on driver '{driver}': {str(e)}\n{traceback.format_exc()}"
        print(err_msg)
        raise HTTPException(status_code=500, detail=err_msg)

@app.get("/api/admin/audit_logs")
def get_audit_logs(db: Session = Depends(get_db)):
    return db.query(models.AuditLog).order_by(models.AuditLog.timestamp.desc()).limit(100).all()

@app.post("/api/plan_board", response_model=schemas.MonthlyPlanBoard)
def create_or_update_plan_board(data: schemas.MonthlyPlanBoardCreate, user_name: str = None, db: Session = Depends(get_db)):
    existing = db.query(models.MonthlyPlanBoard).filter(
        models.MonthlyPlanBoard.date == data.date,
        models.MonthlyPlanBoard.shift_name == data.shift_name,
        models.MonthlyPlanBoard.line == data.line
    ).first()
    
    if data.date.weekday() == 0 and data.shift_name == "День":
        data.plan_sheets = 0
        
    if existing:
        old_plan = existing.plan_sheets
        old_fact = existing.fact_sheets
        existing.master_id = data.master_id
        existing.shift_number = data.shift_number
        existing.plan_sheets = data.plan_sheets
        existing.fact_sheets = data.fact_sheets
        existing.first_grade = data.first_grade
        existing.defect = data.defect
        db.commit()
        db.refresh(existing)
        
        # Log to AuditLog
        details_str = f"Дата: {data.date}, Смена: {data.shift_name}, Линия: {data.line}. План: {old_plan}->{data.plan_sheets}, Факт: {old_fact}->{data.fact_sheets}, 1-й сорт: {data.first_grade}, Брак: {data.defect}"
        log = models.AuditLog(
            user_name=user_name,
            action="UPDATE",
            target_table="monthly_plan_board",
            target_id=existing.id,
            details=details_str
        )
        db.add(log)
        db.commit()
        
        return existing
    else:
        new_plan = models.MonthlyPlanBoard(**data.model_dump())
        db.add(new_plan)
        db.commit()
        db.refresh(new_plan)
        
        # Log to AuditLog
        details_str = f"Дата: {data.date}, Смена: {data.shift_name}, Линия: {data.line}. План: {data.plan_sheets}, Факт: {data.fact_sheets}"
        log = models.AuditLog(
            user_name=user_name,
            action="CREATE",
            target_table="monthly_plan_board",
            target_id=new_plan.id,
            details=details_str
        )
        db.add(log)
        db.commit()
        
        return new_plan

@app.get("/api/plan_board/{id}", response_model=schemas.MonthlyPlanBoard)
def get_plan_board_row(id: int, db: Session = Depends(get_db)):
    row = db.query(models.MonthlyPlanBoard).get(id)
    if not row: raise HTTPException(404, "Запись не найдена")
    return row

@app.delete("/api/plan_board/{id}")
def delete_plan_board_row(id: int, user_name: str = None, db: Session = Depends(get_db)):
    row = db.query(models.MonthlyPlanBoard).filter(models.MonthlyPlanBoard.id == id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Запись не найдена")
    
    details_str = f"Дата: {row.date}, Смена: {row.shift_name}, Линия: {row.line}. План: {row.plan_sheets}, Факт: {row.fact_sheets}"
    db.delete(row)
    db.commit()
    
    # Log to AuditLog
    log = models.AuditLog(
        user_name=user_name,
        action="DELETE",
        target_table="monthly_plan_board",
        target_id=id,
        details=details_str
    )
    db.add(log)
    db.commit()
    
    return {"status": "ok"}


@app.post("/api/admin/import_plan_board")
def import_plan_board(db: Session = Depends(get_db)):
    file_path = os.path.join("docs", "excel", "monthly_plan_board.xlsx")
    if not os.path.exists(file_path):
        raise HTTPException(404, f"Файл {file_path} не найден в проекте")
    
    try:
        wb = openpyxl.load_workbook(file_path, data_only=True)
        ws = wb["Выработка"] if "Выработка" in wb.sheetnames else wb.active
        
        count_created = 0
        count_updated = 0
        
        # Пропускаем заголовки (первые две строки, например)
        # Ожидаемый формат: Дата (0), Месяц (1), Тип смены (2), Линия (3), Мастер (4), Смена (5), План (6), Факт (7)
        for row in ws.iter_rows(min_row=3, values_only=True):
            if not row[0]: continue # пустая дата
            
            date_val = row[0]
            if isinstance(date_val, datetime):
                date_val = date_val.date()
            elif isinstance(date_val, str):
                try:
                    date_val = datetime.strptime(date_val, "%d.%m.%Y").date()
                except ValueError:
                    try:
                        date_val = datetime.strptime(date_val, "%Y-%m-%d").date()
                    except ValueError:
                        continue
                
            shift_name = str(row[2]) if row[2] else "День"
            
            line_val = str(row[3]).strip() if row[3] else "ЛФМ-1"
            if line_val == "Линия 1":
                line_val = "ЛФМ-1"
            elif line_val == "Линия 2":
                line_val = "ЛФМ-2"
                
            master_name = str(row[4]).strip() if row[4] else ""
            shift_number = int(row[5]) if row[5] else 1
            plan_sheets = int(row[6]) if len(row) > 6 and row[6] else 0
            fact_sheets = int(row[7]) if len(row) > 7 and row[7] else 0
            
            if date_val.weekday() == 0 and shift_name == "День":
                plan_sheets = 0
            
            first_grade = 0
            if len(row) > 8 and row[8] is not None:
                try: first_grade = int(row[8])
                except: pass
                
            defect = 0
            if len(row) > 9 and row[9] is not None:
                try: defect = int(row[9])
                except: pass
            
            # Поиск мастера по имени
            master = db.query(models.Master).filter(models.Master.name == master_name).first()
            if not master:
                # Если мастер не найден, создаем его? Или берем первого попавшегося?
                # Лучше создать, чтобы не терять данные
                master = models.Master(name=master_name, pin="0000", role="master")
                db.add(master)
                db.commit()
                db.refresh(master)
                
            existing = db.query(models.MonthlyPlanBoard).filter(
                models.MonthlyPlanBoard.date == date_val,
                models.MonthlyPlanBoard.shift_number == shift_number,
                models.MonthlyPlanBoard.line == line_val
            ).first()
            
            if existing:
                existing.shift_name = shift_name
                existing.master_id = master.id
                existing.plan_sheets = plan_sheets
                existing.fact_sheets = fact_sheets
                existing.first_grade = first_grade
                existing.defect = defect
                count_updated += 1
            else:
                new_plan = models.MonthlyPlanBoard(
                    date=date_val,
                    shift_name=shift_name,
                    master_id=master.id,
                    shift_number=shift_number,
                    line=line_val,
                    plan_sheets=plan_sheets,
                    fact_sheets=fact_sheets,
                    first_grade=first_grade,
                    defect=defect
                )
                db.add(new_plan)
                count_created += 1
                
        db.commit()
        
        # Log to AuditLog
        log = models.AuditLog(
            user_name="Администратор",
            action="IMPORT",
            target_table="monthly_plan_board",
            details=f"Импорт из Excel. Создано записей: {count_created}, обновлено: {count_updated}"
        )
        db.add(log)
        db.commit()
        
        return {"status": "ok", "created": count_created, "updated": count_updated}
    except Exception as e:
        db.rollback()
        raise HTTPException(500, f"Ошибка импорта: {str(e)}")

@app.post("/api/admin/upload_and_import_plan_board")
def upload_and_import_plan_board(file: UploadFile = File(...), user_name: str = "Администратор", db: Session = Depends(get_db)):
    try:
        contents = file.file.read()
        wb = openpyxl.load_workbook(io.BytesIO(contents), data_only=True)
        ws = wb["Выработка"] if "Выработка" in wb.sheetnames else wb.active
        
        count_created = 0
        count_updated = 0
        
        for row in ws.iter_rows(min_row=3, values_only=True):
            if not row or not row[0]: continue
            
            date_val = row[0]
            if isinstance(date_val, datetime):
                date_val = date_val.date()
            elif isinstance(date_val, str):
                try:
                    date_val = datetime.strptime(date_val, "%d.%m.%Y").date()
                except ValueError:
                    try:
                        date_val = datetime.strptime(date_val, "%Y-%m-%d").date()
                    except ValueError:
                        continue
                
            shift_name = str(row[2]) if row[2] else "День"
            
            line_val = str(row[3]).strip() if row[3] else "ЛФМ-1"
            if line_val == "Линия 1":
                line_val = "ЛФМ-1"
            elif line_val == "Линия 2":
                line_val = "ЛФМ-2"
                
            master_name = str(row[4]).strip() if row[4] else ""
            shift_number = int(row[5]) if row[5] else 1
            plan_sheets = int(row[6]) if len(row) > 6 and row[6] else 0
            fact_sheets = int(row[7]) if len(row) > 7 and row[7] else 0
            
            if date_val.weekday() == 0 and shift_name == "День":
                plan_sheets = 0
            
            first_grade = 0
            if len(row) > 8 and row[8] is not None:
                try: first_grade = int(row[8])
                except: pass
                
            defect = 0
            if len(row) > 9 and row[9] is not None:
                try: defect = int(row[9])
                except: pass
            
            master = db.query(models.Master).filter(models.Master.name == master_name).first()
            if not master:
                master = models.Master(name=master_name, pin="0000", role="master")
                db.add(master)
                db.commit()
                db.refresh(master)
                
            existing = db.query(models.MonthlyPlanBoard).filter(
                models.MonthlyPlanBoard.date == date_val,
                models.MonthlyPlanBoard.shift_number == shift_number,
                models.MonthlyPlanBoard.line == line_val
            ).first()
            
            if existing:
                existing.shift_name = shift_name
                existing.master_id = master.id
                existing.plan_sheets = plan_sheets
                existing.fact_sheets = fact_sheets
                existing.first_grade = first_grade
                existing.defect = defect
                count_updated += 1
            else:
                new_plan = models.MonthlyPlanBoard(
                    date=date_val,
                    shift_name=shift_name,
                    master_id=master.id,
                    shift_number=shift_number,
                    line=line_val,
                    plan_sheets=plan_sheets,
                    fact_sheets=fact_sheets,
                    first_grade=first_grade,
                    defect=defect
                )
                db.add(new_plan)
                count_created += 1
                
        db.commit()
        
        # Log to AuditLog
        log = models.AuditLog(
            user_name=user_name,
            action="IMPORT",
            target_table="monthly_plan_board",
            details=f"Загрузка и импорт файла {file.filename}. Создано: {count_created}, обновлено: {count_updated}"
        )
        db.add(log)
        db.commit()
        
        return {"status": "ok", "created": count_created, "updated": count_updated}
    except Exception as e:
        db.rollback()
        raise HTTPException(500, f"Ошибка импорта: {str(e)}")

@app.delete("/api/admin/clear_plan_board")
def clear_plan_board(user_name: str = "Администратор", db: Session = Depends(get_db)):
    try:
        count = db.query(models.MonthlyPlanBoard).count()
        db.query(models.MonthlyPlanBoard).delete()
        db.commit()
        
        # Log to AuditLog
        log = models.AuditLog(
            user_name=user_name,
            action="DELETE",
            target_table="monthly_plan_board",
            details=f"Полная очистка таблицы. Удалено записей: {count}"
        )
        db.add(log)
        db.commit()
        
        return {"status": "ok", "deleted_count": count}
    except Exception as e:
        db.rollback()
        raise HTTPException(500, f"Ошибка очистки: {str(e)}")
