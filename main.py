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
    Base.metadata.create_all(bind=engine)
    
    # SQLite alter table hack to auto-add columns if they don't exist
    import sqlite3
    try:
        conn = sqlite3.connect("tectum.db")
        conn.execute("ALTER TABLE raw_material_receipts ADD COLUMN master_id INTEGER;")
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
            db.commit()
        db.close()
    except Exception as e:
        print(f"Warning: could not create document indexes: {e}")

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

    # Data migration: clean up document titles containing relative paths
    try:
        db = SessionLocal()
        docs = db.query(models.Document).all()
        cleaned_count = 0
        for doc in docs:
            if doc.title and ("/" in doc.title or "\\" in doc.title):
                doc.title = os.path.basename(doc.title.replace("\\", "/"))
                cleaned_count += 1
        if cleaned_count > 0:
            db.commit()
            print(f"Cleaned {cleaned_count} document titles.")
        db.close()
    except Exception as e:
        print(f"Warning: could not clean document titles: {e}")

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
        conn.execute("ALTER TABLE shifts ADD COLUMN export_type VARCHAR(50) DEFAULT 'Эталон'")
        conn.commit()
        conn.close()
    except: pass
    try:
        conn = sqlite3.connect("tectum.db")
        conn.execute("ALTER TABLE lfm_reports ADD COLUMN export_type VARCHAR(50) DEFAULT 'Эталон'")
        conn.commit()
        conn.close()
    except: pass
    try:
        conn = sqlite3.connect("tectum.db")
        conn.execute("ALTER TABLE batches ADD COLUMN export_type VARCHAR(50) DEFAULT 'Эталон'")
        conn.commit()
        conn.close()
    except: pass
    
    # Batches previous shift defects migration (SQLite)
    for col in [
        "prev_first_grade", "prev_defect", "prev_defect_scratch", "prev_defect_bad_cut",
        "prev_defect_stick_top", "prev_defect_broken", "prev_defect_fell_box",
        "prev_defect_thickness", "prev_defect_edge"
    ]:
        try:
            conn = sqlite3.connect("tectum.db")
            conn.execute(f"ALTER TABLE batches ADD COLUMN {col} INTEGER DEFAULT 0")
            conn.commit()
            conn.close()
        except: pass

    # AuditLog state_snapshot migration (SQLite)
    try:
        conn = sqlite3.connect("tectum.db")
        conn.execute("ALTER TABLE audit_logs ADD COLUMN state_snapshot TEXT")
        conn.commit()
        conn.close()
    except: pass
    
    # RawMaterialReceipt autonomous columns migration (SQLite)
    for col_def in [
        ("date", "DATE"), ("shift_name", "VARCHAR(50)"), ("line", "VARCHAR(50)")
    ]:
        try:
            conn = sqlite3.connect("tectum.db")
            conn.execute(f"ALTER TABLE raw_material_receipts ADD COLUMN {col_def[0]} {col_def[1]}")
            conn.commit()
            conn.close()
        except: pass

    # Downtimes autonomous columns migration (SQLite)
    for col_def in [
        ("date", "DATE"), ("shift_name", "VARCHAR(50)"), ("line", "VARCHAR(50)"), ("master_id", "INTEGER")
    ]:
        try:
            conn = sqlite3.connect("tectum.db")
            conn.execute(f"ALTER TABLE downtimes ADD COLUMN {col_def[0]} {col_def[1]}")
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

    try:
        conn = sqlite3.connect("tectum.db")
        conn.execute("ALTER TABLE downtimes ADD COLUMN comment TEXT")
        conn.commit()
        conn.close()
    except: pass

    try:
        conn = sqlite3.connect("tectum.db")
        conn.execute("ALTER TABLE downtimes ADD COLUMN breakdowns VARCHAR")
        conn.commit()
        conn.close()
    except: pass

    # PostgreSQL schema parity for downtimes & downtime_directory (TEXT unlimited lengths)
    try:
        db_pg = SessionLocal()
        driver_pg = db_pg.bind.dialect.name if db_pg.bind else 'unknown'
        if driver_pg == 'postgresql':
            from sqlalchemy import text
            db_pg.execute(text("ALTER TABLE downtimes ADD COLUMN IF NOT EXISTS department VARCHAR(255);"))
            db_pg.execute(text("ALTER TABLE downtimes ADD COLUMN IF NOT EXISTS is_equipment_downtime BOOLEAN DEFAULT TRUE;"))
            db_pg.execute(text("ALTER TABLE downtimes ADD COLUMN IF NOT EXISTS comment TEXT;"))
            db_pg.execute(text("ALTER TABLE downtimes ADD COLUMN IF NOT EXISTS breakdowns TEXT;"))
            db_pg.execute(text("ALTER TABLE downtimes ALTER COLUMN comment TYPE TEXT;"))
            db_pg.execute(text("ALTER TABLE downtimes ALTER COLUMN description TYPE TEXT;"))
            
            db_pg.execute(text("ALTER TABLE downtime_directory ADD COLUMN IF NOT EXISTS category VARCHAR(255);"))
            db_pg.execute(text("ALTER TABLE downtime_directory ADD COLUMN IF NOT EXISTS comment TEXT;"))
            db_pg.execute(text("ALTER TABLE downtime_directory ALTER COLUMN comment TYPE TEXT;"))
            
            # Autonomous journals: date, shift_name, line, master_id
            db_pg.execute(text("ALTER TABLE raw_material_receipts ADD COLUMN IF NOT EXISTS date DATE;"))
            db_pg.execute(text("ALTER TABLE raw_material_receipts ADD COLUMN IF NOT EXISTS shift_name VARCHAR(50);"))
            db_pg.execute(text("ALTER TABLE raw_material_receipts ADD COLUMN IF NOT EXISTS line VARCHAR(50);"))
            db_pg.execute(text("ALTER TABLE raw_material_receipts ALTER COLUMN shift_id DROP NOT NULL;"))
            
            db_pg.execute(text("ALTER TABLE downtimes ADD COLUMN IF NOT EXISTS date DATE;"))
            db_pg.execute(text("ALTER TABLE downtimes ADD COLUMN IF NOT EXISTS shift_name VARCHAR(50);"))
            db_pg.execute(text("ALTER TABLE downtimes ADD COLUMN IF NOT EXISTS line VARCHAR(50);"))
            db_pg.execute(text("ALTER TABLE downtimes ADD COLUMN IF NOT EXISTS master_id INTEGER REFERENCES masters(id);"))
            db_pg.execute(text("ALTER TABLE downtimes ALTER COLUMN shift_id DROP NOT NULL;"))
            
            # Batches: prev defects
            for b_col in [
                "prev_first_grade", "prev_defect", "prev_defect_scratch", "prev_defect_bad_cut",
                "prev_defect_stick_top", "prev_defect_broken", "prev_defect_fell_box",
                "prev_defect_thickness", "prev_defect_edge"
            ]:
                db_pg.execute(text(f"ALTER TABLE batches ADD COLUMN IF NOT EXISTS {b_col} INTEGER DEFAULT 0;"))
            
            # AuditLog: state_snapshot TEXT for snapshot rollback
            db_pg.execute(text("ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS state_snapshot TEXT;"))
            db_pg.commit()
    except Exception as dt_pg_err:
        print(f"Warning: could not migrate PostgreSQL downtimes schema: {dt_pg_err}")
        if 'db_pg' in locals() and db_pg:
            db_pg.rollback()
    finally:
        if 'db_pg' in locals() and db_pg:
            db_pg.close()
    
    # DocumentCategory password_hash migration
    try:
        conn = sqlite3.connect("tectum.db")
        conn.execute("ALTER TABLE document_categories ADD COLUMN password_hash VARCHAR(255)")
        conn.commit()
        conn.close()
    except: pass

    try:
        db = SessionLocal()
        driver = db.bind.dialect.name if db.bind else 'unknown'
        if driver == 'postgresql':
            from sqlalchemy import text
            col_exists = db.execute(text(
                "SELECT column_name FROM information_schema.columns WHERE table_name='document_categories' AND column_name='password_hash'"
            )).fetchone()
            if not col_exists:
                db.execute(text("ALTER TABLE document_categories ADD COLUMN password_hash VARCHAR(255);"))
                db.commit()
                
        # Set default password for "Бережливое производство"
        bp_folder = db.query(models.DocumentCategory).filter(models.DocumentCategory.name == "Бережливое производство").first()
        if bp_folder and not bp_folder.password_hash:
            bp_folder.password_hash = hashlib.sha256("6282".encode()).hexdigest()
            db.commit()
    except Exception as e:
        print(f"Warning: could not migrate document_categories password_hash: {e}")
        db.rollback()
    finally:
        if 'db' in locals():
            db.close()

    # Document Google Drive, R2 and DocSpace columns migration
    try:
        db = SessionLocal()
        driver = db.bind.dialect.name if db.bind else 'unknown'
        if driver == 'postgresql':
            from sqlalchemy import text
            for tbl in ["shifts", "lfm_reports", "batches"]:
                try:
                    db.execute(text(f"ALTER TABLE {tbl} ADD COLUMN IF NOT EXISTS export_type VARCHAR(50) DEFAULT 'Эталон';"))
                    db.commit()
                except Exception:
                    db.rollback()
            for col, col_type in [
                ("r2_key", "VARCHAR(512)"), 
                ("docspace_file_id", "INTEGER"), 
                ("google_drive_id", "VARCHAR(255)"), 
                ("google_drive_url", "TEXT"), 
                ("koofr_path", "VARCHAR(512)"), 
                ("koofr_link", "TEXT"), 
                ("yandex_path", "VARCHAR(512)"), 
                ("yandex_url", "TEXT"),
                ("external_url", "TEXT"),
                ("version_number", "INTEGER DEFAULT 1"),
                ("locked_by_user", "VARCHAR(255)"),
                ("locked_at", "TIMESTAMP"),
                ("last_modified_by", "VARCHAR(255)"),
                ("created_by", "VARCHAR(255)")
            ]:
                try:
                    db.execute(text(f"ALTER TABLE documents ADD COLUMN IF NOT EXISTS {col} {col_type};"))
                    db.commit()
                except Exception:
                    db.rollback()
            try:
                db.execute(text("ALTER TABLE document_categories ADD COLUMN IF NOT EXISTS created_by VARCHAR(255);"))
                db.commit()
            except Exception:
                db.rollback()
            try:
                models.DocumentVersion.__table__.create(bind=engine, checkfirst=True)
            except Exception: pass
        elif driver == 'sqlite':
            conn = sqlite3.connect("tectum.db")
            for col, col_type in [
                ("r2_key", "VARCHAR(512)"), 
                ("docspace_file_id", "INTEGER"), 
                ("google_drive_id", "VARCHAR(255)"), 
                ("google_drive_url", "TEXT"), 
                ("koofr_path", "VARCHAR(512)"), 
                ("koofr_link", "TEXT"), 
                ("yandex_path", "VARCHAR(512)"), 
                ("yandex_url", "TEXT"),
                ("external_url", "TEXT"),
                ("version_number", "INTEGER DEFAULT 1"),
                ("locked_by_user", "VARCHAR(255)"),
                ("locked_at", "TIMESTAMP"),
                ("last_modified_by", "VARCHAR(255)"),
                ("created_by", "VARCHAR(255)")
            ]:
                try:
                    conn.execute(f"ALTER TABLE documents ADD COLUMN {col} {col_type}")
                    conn.commit()
                except Exception:
                    pass
            try:
                conn.execute("ALTER TABLE document_categories ADD COLUMN google_drive_folder_id VARCHAR(255)")
                conn.commit()
            except Exception: pass
            try:
                conn.execute("ALTER TABLE document_categories ADD COLUMN created_by VARCHAR(255)")
                conn.commit()
            except Exception: pass
            
            # Create document_versions table if not exists
            try:
                models.DocumentVersion.__table__.create(bind=engine, checkfirst=True)
            except Exception: pass
            
            conn.close()
    except Exception as e:
        pass
    finally:
        if 'db' in locals() and db:
            db.close()

    # Shift silos columns migration for PostgreSQL and SQLite
    try:
        db = SessionLocal()
        driver = db.bind.dialect.name if db.bind else 'unknown'
        shift_cols = [
            ("zo_chrysotile_4_20_silo1", "DOUBLE PRECISION DEFAULT 0" if driver == 'postgresql' else "REAL DEFAULT 0"),
            ("zo_chrysotile_4_20_silo2", "DOUBLE PRECISION DEFAULT 0" if driver == 'postgresql' else "REAL DEFAULT 0"),
            ("zo_chrysotile_4_20_silo3", "DOUBLE PRECISION DEFAULT 0" if driver == 'postgresql' else "REAL DEFAULT 0"),
            ("zo_chrysotile_4_20_silo4", "DOUBLE PRECISION DEFAULT 0" if driver == 'postgresql' else "REAL DEFAULT 0"),
            ("zo_chrysotile_5_65_silo1", "DOUBLE PRECISION DEFAULT 0" if driver == 'postgresql' else "REAL DEFAULT 0"),
            ("zo_chrysotile_5_65_silo2", "DOUBLE PRECISION DEFAULT 0" if driver == 'postgresql' else "REAL DEFAULT 0"),
            ("zo_chrysotile_5_65_silo3", "DOUBLE PRECISION DEFAULT 0" if driver == 'postgresql' else "REAL DEFAULT 0"),
            ("zo_chrysotile_5_65_silo4", "DOUBLE PRECISION DEFAULT 0" if driver == 'postgresql' else "REAL DEFAULT 0"),
            ("zo_chrysotile_6_40_silo1", "DOUBLE PRECISION DEFAULT 0" if driver == 'postgresql' else "REAL DEFAULT 0"),
            ("zo_chrysotile_6_40_silo2", "DOUBLE PRECISION DEFAULT 0" if driver == 'postgresql' else "REAL DEFAULT 0"),
            ("zo_chrysotile_6_40_silo3", "DOUBLE PRECISION DEFAULT 0" if driver == 'postgresql' else "REAL DEFAULT 0"),
            ("zo_chrysotile_6_40_silo4", "DOUBLE PRECISION DEFAULT 0" if driver == 'postgresql' else "REAL DEFAULT 0"),
            ("zo_cement_silo1", "DOUBLE PRECISION DEFAULT 0" if driver == 'postgresql' else "REAL DEFAULT 0"),
            ("zo_cement_silo2", "DOUBLE PRECISION DEFAULT 0" if driver == 'postgresql' else "REAL DEFAULT 0"),
            ("zo_cement_silo3", "DOUBLE PRECISION DEFAULT 0" if driver == 'postgresql' else "REAL DEFAULT 0"),
            ("zo_cement_silo4", "DOUBLE PRECISION DEFAULT 0" if driver == 'postgresql' else "REAL DEFAULT 0"),
            ("zo_cellulose_silo1", "DOUBLE PRECISION DEFAULT 0" if driver == 'postgresql' else "REAL DEFAULT 0"),
            ("zo_cellulose_silo2", "DOUBLE PRECISION DEFAULT 0" if driver == 'postgresql' else "REAL DEFAULT 0"),
            ("zo_cellulose_silo3", "DOUBLE PRECISION DEFAULT 0" if driver == 'postgresql' else "REAL DEFAULT 0"),
            ("zo_cellulose_silo4", "DOUBLE PRECISION DEFAULT 0" if driver == 'postgresql' else "REAL DEFAULT 0"),
            ("zo_crushed_slate_silo1", "DOUBLE PRECISION DEFAULT 0" if driver == 'postgresql' else "REAL DEFAULT 0"),
            ("zo_crushed_slate_silo2", "DOUBLE PRECISION DEFAULT 0" if driver == 'postgresql' else "REAL DEFAULT 0"),
            ("zo_crushed_slate_silo3", "DOUBLE PRECISION DEFAULT 0" if driver == 'postgresql' else "REAL DEFAULT 0"),
            ("zo_crushed_slate_silo4", "DOUBLE PRECISION DEFAULT 0" if driver == 'postgresql' else "REAL DEFAULT 0"),
            ("zo_asbozurit_silo1", "DOUBLE PRECISION DEFAULT 0" if driver == 'postgresql' else "REAL DEFAULT 0"),
            ("zo_asbozurit_silo2", "DOUBLE PRECISION DEFAULT 0" if driver == 'postgresql' else "REAL DEFAULT 0"),
            ("zo_asbozurit_silo3", "DOUBLE PRECISION DEFAULT 0" if driver == 'postgresql' else "REAL DEFAULT 0"),
            ("zo_asbozurit_silo4", "DOUBLE PRECISION DEFAULT 0" if driver == 'postgresql' else "REAL DEFAULT 0"),
            ("zo_fiberglass_silo1", "DOUBLE PRECISION DEFAULT 0" if driver == 'postgresql' else "REAL DEFAULT 0"),
            ("zo_fiberglass_silo2", "DOUBLE PRECISION DEFAULT 0" if driver == 'postgresql' else "REAL DEFAULT 0"),
            ("zo_fiberglass_silo3", "DOUBLE PRECISION DEFAULT 0" if driver == 'postgresql' else "REAL DEFAULT 0"),
            ("zo_fiberglass_silo4", "DOUBLE PRECISION DEFAULT 0" if driver == 'postgresql' else "REAL DEFAULT 0"),
            ("zo_laprol_silo1", "DOUBLE PRECISION DEFAULT 0" if driver == 'postgresql' else "REAL DEFAULT 0"),
            ("zo_laprol_silo2", "DOUBLE PRECISION DEFAULT 0" if driver == 'postgresql' else "REAL DEFAULT 0"),
            ("zo_laprol_silo3", "DOUBLE PRECISION DEFAULT 0" if driver == 'postgresql' else "REAL DEFAULT 0"),
            ("zo_laprol_silo4", "DOUBLE PRECISION DEFAULT 0" if driver == 'postgresql' else "REAL DEFAULT 0"),
            ("zo_asbocarton_silo1", "DOUBLE PRECISION DEFAULT 0" if driver == 'postgresql' else "REAL DEFAULT 0"),
            ("zo_asbocarton_silo2", "DOUBLE PRECISION DEFAULT 0" if driver == 'postgresql' else "REAL DEFAULT 0"),
            ("zo_asbocarton_silo3", "DOUBLE PRECISION DEFAULT 0" if driver == 'postgresql' else "REAL DEFAULT 0"),
            ("zo_asbocarton_silo4", "DOUBLE PRECISION DEFAULT 0" if driver == 'postgresql' else "REAL DEFAULT 0"),
            ("zo_asb_drain", "DOUBLE PRECISION DEFAULT 0" if driver == 'postgresql' else "REAL DEFAULT 0"),
            ("zo_cem_drain", "DOUBLE PRECISION DEFAULT 0" if driver == 'postgresql' else "REAL DEFAULT 0"),
            ("lfm_asb_drain", "DOUBLE PRECISION DEFAULT 0" if driver == 'postgresql' else "REAL DEFAULT 0"),
            ("lfm_cem_drain", "DOUBLE PRECISION DEFAULT 0" if driver == 'postgresql' else "REAL DEFAULT 0"),
            ("zo_submitted", "BOOLEAN DEFAULT FALSE")
        ]
        if driver == 'postgresql':
            from sqlalchemy import text
            for col_name, col_type in shift_cols:
                try:
                    db.execute(text(f"ALTER TABLE shifts ADD COLUMN IF NOT EXISTS {col_name} {col_type};"))
                    db.commit()
                except Exception:
                    db.rollback()
        elif driver == 'sqlite':
            conn = sqlite3.connect("tectum.db")
            for col_name, col_type in shift_cols:
                try:
                    conn.execute(f"ALTER TABLE shifts ADD COLUMN {col_name} {col_type}")
                    conn.commit()
                except Exception:
                    pass
            conn.close()
    except Exception as e:
        print(f"Shifts silos migration note: {e}")
    finally:
        if 'db' in locals() and db:
            db.close()

    # Batch previous shift defect columns migration
    try:
        db = SessionLocal()
        driver = db.bind.dialect.name if db.bind else 'unknown'
        cols = [
            ("prev_first_grade", "INTEGER DEFAULT 0"),
            ("prev_defect", "INTEGER DEFAULT 0"),
            ("prev_defect_scratch", "INTEGER DEFAULT 0"),
            ("prev_defect_bad_cut", "INTEGER DEFAULT 0"),
            ("prev_defect_stick_top", "INTEGER DEFAULT 0"),
            ("prev_defect_broken", "INTEGER DEFAULT 0"),
            ("prev_defect_fell_box", "INTEGER DEFAULT 0"),
            ("prev_defect_thickness", "INTEGER DEFAULT 0"),
            ("prev_defect_edge", "INTEGER DEFAULT 0")
        ]
        if driver == 'postgresql':
            from sqlalchemy import text
            for col_name, col_type in cols:
                try:
                    db.execute(text(f"ALTER TABLE batches ADD COLUMN IF NOT EXISTS {col_name} {col_type};"))
                    db.commit()
                except Exception:
                    db.rollback()
        elif driver == 'sqlite':
            conn = sqlite3.connect("tectum.db")
            for col_name, col_type in cols:
                try:
                    conn.execute(f"ALTER TABLE batches ADD COLUMN {col_name} {col_type}")
                    conn.commit()
                except Exception:
                    pass
            conn.close()
    except Exception as e:
        print(f"Batch prev defect migration note: {e}")
    finally:
        if 'db' in locals() and db:
            db.close()

    # PlannerEmployee pin_code column migration
    try:
        db = SessionLocal()
        driver = db.bind.dialect.name if db.bind else 'unknown'
        if driver == 'postgresql':
            from sqlalchemy import text
            try:
                db.execute(text("ALTER TABLE planner_employees ADD COLUMN IF NOT EXISTS pin_code VARCHAR(10);"))
                db.commit()
            except Exception:
                db.rollback()
        elif driver == 'sqlite':
            conn = sqlite3.connect("tectum.db")
            try:
                conn.execute("ALTER TABLE planner_employees ADD COLUMN pin_code VARCHAR(10)")
                conn.commit()
            except Exception: pass
            conn.close()
    except Exception as e:
        print(f"Planner pin_code migration note: {e}")
    finally:
        if 'db' in locals() and db:
            db.close()

    # Automatic deduplication of duplicate document folders on startup
    try:
        db = SessionLocal()
        all_folders = db.query(models.DocumentCategory).order_by(models.DocumentCategory.id.asc()).all()
        seen = {}
        duplicates = []
        for f in all_folders:
            key = (f.name.strip().lower(), f.parent_id)
            if key in seen:
                primary = seen[key]
                db.query(models.Document).filter(models.Document.category_id == f.id).update(
                    {models.Document.category_id: primary.id}, synchronize_session=False
                )
                db.query(models.DocumentCategory).filter(models.DocumentCategory.parent_id == f.id).update(
                    {models.DocumentCategory.parent_id: primary.id}, synchronize_session=False
                )
                duplicates.append(f)
            else:
                seen[key] = f

        for dup in duplicates:
            db.delete(dup)
        if duplicates:
            db.commit()
    except Exception as e:
        print(f"Startup duplicate folder cleanup note: {e}")
        if 'db' in locals() and db:
            db.rollback()
    finally:
        if 'db' in locals() and db:
            db.close()


    # Migrations for Raw Material Silos Breakdown
    silo_materials = [
        'chrysotile_4_20', 'chrysotile_5_65', 'chrysotile_6_40',
        'cellulose', 'crushed_slate', 'asbozurit', 'fiberglass', 'laprol', 'asbocarton'
    ]
    
    # 1. SQLite Migrations
    try:
        conn = sqlite3.connect("tectum.db")
        for mat in silo_materials:
            for s in range(1, 5):
                col_name = f"zo_{mat}_silo{s}"
                try:
                    conn.execute(f"ALTER TABLE shifts ADD COLUMN {col_name} FLOAT DEFAULT 0.0")
                except:
                    pass
        conn.commit()
        conn.close()
    except:
        pass
        
    # 2. PG Migrations
    try:
        db = SessionLocal()
        driver = db.bind.dialect.name if db.bind else 'unknown'
        if driver == 'postgresql':
            from sqlalchemy import text
            for mat in silo_materials:
                for s in range(1, 5):
                    col_name = f"zo_{mat}_silo{s}"
                    try:
                        db.execute(text(f"ALTER TABLE shifts ADD COLUMN IF NOT EXISTS {col_name} FLOAT DEFAULT 0.0"))
                    except Exception as pg_err:
                        pass
            db.commit()
    except Exception as e:
        print(f"Warning: could not run PG migrations for silo columns: {e}")
        if 'db' in locals(): db.rollback()
    finally:
        if 'db' in locals() and db: db.close()

    # Migrations for created_at on shifts, downtimes, raw_material_receipts
    try:
        conn = sqlite3.connect("tectum.db")
        for tbl in ["shifts", "downtimes", "raw_material_receipts"]:
            try:
                conn.execute(f"ALTER TABLE {tbl} ADD COLUMN created_at DATETIME")
            except: pass
        conn.commit()
        conn.close()
    except: pass

    try:
        db = SessionLocal()
        driver = db.bind.dialect.name if db.bind else 'unknown'
        if driver == 'postgresql':
            from sqlalchemy import text
            for tbl in ["shifts", "downtimes", "raw_material_receipts"]:
                try:
                    db.execute(text(f"ALTER TABLE {tbl} ADD COLUMN IF NOT EXISTS created_at TIMESTAMP"))
                except Exception as pg_err: pass
            
            # One-time cleanup for historical records: clear automatically assigned timestamps
            try:
                db.execute(text("UPDATE shifts SET created_at = NULL WHERE created_at IS NOT NULL;"))
                db.execute(text("UPDATE downtimes SET created_at = NULL WHERE created_at IS NOT NULL;"))
                db.execute(text("UPDATE raw_material_receipts SET created_at = NULL WHERE created_at IS NOT NULL;"))
                db.commit()
            except Exception as cl_err:
                print(f"Warning clearing created_at for historical shifts: {cl_err}")
                db.rollback()
        else:
            try:
                from sqlalchemy import text
                db.execute(text("UPDATE shifts SET created_at = NULL"))
                db.commit()
            except: pass
    except Exception as e:
        print(f"Warning: could not run PG migrations for created_at: {e}")
        if 'db' in locals() and db: db.rollback()
    finally:
        if 'db' in locals() and db: db.close()

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
        
    # SQLite migrations for batches qcd columns
    sqlite_batches_cols = [
        ("qcd_sorted_packs", "INTEGER DEFAULT 0"),
        ("qcd_first_grade_note", "VARCHAR(500)"),
        ("qcd_defect_note", "VARCHAR(500)"),
        ("qcd_defect_chip", "INTEGER DEFAULT 0"),
        ("qcd_defect_scratch", "INTEGER DEFAULT 0"),
        ("qcd_defect_bad_cut", "INTEGER DEFAULT 0"),
        ("qcd_defect_stick_bottom", "INTEGER DEFAULT 0"),
        ("qcd_defect_stick_top", "INTEGER DEFAULT 0"),
        ("qcd_defect_broken", "INTEGER DEFAULT 0"),
        ("qcd_defect_fell_box", "INTEGER DEFAULT 0"),
        ("qcd_defect_dent", "INTEGER DEFAULT 0"),
        ("qcd_defect_thickness", "INTEGER DEFAULT 0"),
        ("qcd_defect_delamination", "INTEGER DEFAULT 0"),
        ("qcd_defect_edge", "INTEGER DEFAULT 0")
    ]
    for col, col_def in sqlite_batches_cols:
        try:
            conn = sqlite3.connect("tectum.db")
            conn.execute(f"ALTER TABLE batches ADD COLUMN {col} {col_def}")
            conn.commit()
            conn.close()
        except: pass

    # PostgreSQL auto-migration for missing columns (single batch check)
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
            ("downtimes", "comment", "VARCHAR(255)"),
            ("downtimes", "breakdowns", "TEXT"),
            ("shifts", "zo_asbocarton", "DOUBLE PRECISION DEFAULT 0.0"),
            ("shifts", "lfm_asb_drain", "DOUBLE PRECISION DEFAULT 0.0"),
            ("shifts", "lfm_cem_drain", "DOUBLE PRECISION DEFAULT 0.0"),
            ("shifts", "receipt_asbocarton", "DOUBLE PRECISION DEFAULT 0.0"),
            ("shifts", "receipt_pallets", "DOUBLE PRECISION DEFAULT 0.0"),
            ("shifts", "sharepoint_url", "VARCHAR(500)"),
            ("batches", "qcd_sorted_packs", "INTEGER DEFAULT 0"),
            ("batches", "qcd_first_grade_note", "VARCHAR(500)"),
            ("batches", "qcd_defect_note", "VARCHAR(500)"),
            ("batches", "qcd_defect_chip", "INTEGER DEFAULT 0"),
            ("batches", "qcd_defect_scratch", "INTEGER DEFAULT 0"),
            ("batches", "qcd_defect_bad_cut", "INTEGER DEFAULT 0"),
            ("batches", "qcd_defect_stick_bottom", "INTEGER DEFAULT 0"),
            ("batches", "qcd_defect_stick_top", "INTEGER DEFAULT 0"),
            ("batches", "qcd_defect_broken", "INTEGER DEFAULT 0"),
            ("batches", "qcd_defect_fell_box", "INTEGER DEFAULT 0"),
            ("batches", "qcd_defect_dent", "INTEGER DEFAULT 0"),
            ("batches", "qcd_defect_thickness", "INTEGER DEFAULT 0"),
            ("batches", "qcd_defect_delamination", "INTEGER DEFAULT 0"),
            ("batches", "qcd_defect_edge", "INTEGER DEFAULT 0"),
            ("checklist_employees", "department", "VARCHAR(255)"),
            ("tasks", "code", "VARCHAR(50)"),
            ("tasks", "zone", "VARCHAR(255)"),
            ("tasks", "title_kz", "TEXT"),
            ("tasks", "photo_link", "TEXT"),
            ("tasks", "author_name", "VARCHAR(255)"),
            ("tasks", "assignee_name", "VARCHAR(255)"),
            ("tasks", "due_date_str", "VARCHAR(100)"),
            ("tasks", "comment", "TEXT"),
            ("tasks", "month_label", "VARCHAR(100)"),
            ("tasks", "is_archived", "BOOLEAN DEFAULT FALSE"),
            ("tasks", "attached_document_id", "INTEGER"),
            ("tasks", "google_doc_url", "VARCHAR(500)"),
            ("tasks", "task_type", "VARCHAR(50) DEFAULT 'weekly'"),
            ("tasks", "department_service", "VARCHAR(100)"),
            ("tasks", "parent_id", "INTEGER"),
            ("tasks", "depends_on_id", "INTEGER"),
            ("tasks", "tags", "TEXT"),
            ("tasks", "target_quarter", "VARCHAR(50)"),
            ("tasks", "progress", "INTEGER DEFAULT 0")
        ]
        try:
            with engine.connect() as conn:
                existing_cols = {
                    (row[0], row[1]) for row in conn.execute(text(
                        "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public';"
                    )).fetchall()
                }
                for table, col, col_def in pg_cols_to_add:
                    if (table, col) not in existing_cols:
                        try:
                            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {col_def};"))
                            print(f"Added column '{col}' to table '{table}' in PostgreSQL.")
                        except Exception:
                            pass
                
                # Очистка некорректно проставленного department_service = 'Общий'
                try:
                    conn.execute(text("UPDATE tasks SET department_service = NULL WHERE department_service = 'Общий' OR (task_type = 'weekly' AND zone = 'Бережливое производство' AND department_service = 'Общий');"))
                except Exception:
                    pass
                conn.commit()
        except Exception as pg_err:
            print(f"Error checking PG columns: {pg_err}")

    # SQLite migration for tasks table
    try:
        conn = sqlite3.connect("tectum.db")
        sqlite_task_cols = [
            ("code", "VARCHAR(50)"),
            ("zone", "VARCHAR(255)"),
            ("title_kz", "TEXT"),
            ("photo_link", "TEXT"),
            ("author_name", "VARCHAR(255)"),
            ("assignee_name", "VARCHAR(255)"),
            ("due_date_str", "VARCHAR(100)"),
            ("comment", "TEXT"),
            ("month_label", "VARCHAR(100)"),
            ("is_archived", "BOOLEAN DEFAULT 0"),
            ("attached_document_id", "INTEGER"),
            ("google_doc_url", "VARCHAR(500)"),
            ("task_type", "VARCHAR(50) DEFAULT 'weekly'"),
            ("department_service", "VARCHAR(100)"),
            ("parent_id", "INTEGER"),
            ("depends_on_id", "INTEGER"),
            ("tags", "TEXT"),
            ("target_quarter", "VARCHAR(50)"),
            ("progress", "INTEGER DEFAULT 0")
        ]
        for col, col_def in sqlite_task_cols:
            try:
                conn.execute(f"ALTER TABLE tasks ADD COLUMN {col} {col_def}")
            except:
                pass
        conn.commit()
        conn.close()
    except:
        pass


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

        # Создание индексов для ускорения Базы Знаний
        try:
            from sqlalchemy import text
            db.execute(text("CREATE INDEX IF NOT EXISTS idx_documents_category_id ON documents(category_id);"))
            db.execute(text("CREATE INDEX IF NOT EXISTS idx_documents_uploaded_at ON documents(uploaded_at);"))
            db.execute(text("CREATE INDEX IF NOT EXISTS idx_document_versions_doc_id ON document_versions(document_id);"))
            db.commit()
        except Exception as idx_e:
            db.rollback()
            print(f"Index creation note: {idx_e}")

        # Автоматическое распределение участков для всех сотрудников в БД (в фоне)
        def bg_sync_checklist_employees():
            db_sync = SessionLocal()
            try:
                import google_sheets_integration
                google_sheets_integration.sync_employees_from_google_sheets(db_sync)
            except Exception as sync_e:
                print(f"Startup checklist employees sync warning: {sync_e}")
            finally:
                db_sync.close()
        threading.Thread(target=bg_sync_checklist_employees, daemon=True).start()

        if not db.query(models.Master).filter(models.Master.role == "director").first():
            db.add(models.Master(name="Технический директор", pin="7777", role="director"))
            db.commit()
        if not db.query(models.Master).filter(models.Master.role == "technologist").first():
            db.add(models.Master(name="Главный технолог", pin="9999", role="technologist"))
            db.commit()
        
        # Очистка устаревших тестовых задач планнера с невалидными лейблами недель
        try:
            valid_weeks_prefix = ("Неделя 1 (", "Неделя 2 (", "Неделя 3 (", "Неделя 4 (", "Неделя 5 (")
            invalid_tasks = db.query(models.Task).all()
            deleted_test_count = 0
            for it in invalid_tasks:
                w_lbl = it.week_label or ""
                # Если лейбл недели старый тестовый (например "Неделя 1", "Неделя 1 (01 - 07)", "Неделя 4 (22 - 28)", "Тестируем", "Привет")
                if not any(w_lbl.startswith(pref) for pref in valid_weeks_prefix) or it.title in ["Привет", "Тестируем", "тест"]:
                    db.delete(it)
                    deleted_test_count += 1
            if deleted_test_count > 0:
                db.commit()
                print(f"[Tasks Cleanup] Deleted {deleted_test_count} obsolete test tasks.")

            # Убеждаемся, что все задачи активны и доступны в своих неделях (концепция архива упразднена)
            archived_tasks = db.query(models.Task).filter(models.Task.is_archived == True).all()
            if archived_tasks:
                for at in archived_tasks:
                    at.is_archived = False
                db.commit()
            # Миграция статусов: исключение устаревшего статуса '⚪ В очереди' в пользу '🟡 В работе'
            queue_tasks = db.query(models.Task).filter(models.Task.status.ilike("%В очереди%")).all()
            if queue_tasks:
                for qt in queue_tasks:
                    qt.status = "🟡 В работе"
                db.commit()
                print(f"[Tasks Migration] Migrated {len(queue_tasks)} tasks from 'В очереди' to '🟡 В работе'.")
        except Exception as task_cl_err:
            print(f"Warning cleaning test tasks: {task_cl_err}")
            db.rollback()

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

        # Seed / update Levda M. and Bulekhanov K., clean up obsolete Tectum admin profile
        tectum_entries = db.query(models.Master).filter(models.Master.name.like("%Tectum%")).all()
        for t_adm in tectum_entries:
            db.delete(t_adm)

        levda = db.query(models.Master).filter(models.Master.name.like("%Левда%")).first()
        if not levda:
            db.add(models.Master(name="Левда М.", pin="6282", role="admin"))
        else:
            levda.name = "Левда М."
            levda.pin = "6282"
            levda.role = "admin"
            levda.email = None

        bulekhanov = db.query(models.Master).filter(or_(models.Master.name.like("%Булеханов%"), models.Master.name.like("%Булекпаев%"))).first()
        if not bulekhanov:
            db.add(models.Master(name="Булеханов К.", pin="2026", role="director"))
        else:
            bulekhanov.name = "Булеханов К."
            bulekhanov.pin = "2026"
            bulekhanov.role = "director"
        db.commit()
        print("Successfully seeded/updated 'Левда М.' and 'Булеханов К.' profiles, removed duplicate Tectum admin.")
    except Exception as e:
        print(f"Error seeding users: {e}")
        db.rollback()
    finally:
        db.close()


    # SharePoint directories bootstrap/sync check (run safely in background thread to not block server startup)
    def bg_sharepoint_init():
        db = SessionLocal()
        try:
            if not os.getenv("M365_TENANT_ID"):
                return
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
    
    threading.Thread(target=bg_sharepoint_init, daemon=True).start()


    def bg_cleanups_init():
        db = SessionLocal()
        try:
            boards = db.query(models.MonthlyPlanBoard).filter(models.MonthlyPlanBoard.plan_sheets == 0).all()
            updated_count = 0
            for pb in boards:
                date_val = pb.date
                is_monday = False
                if isinstance(date_val, str):
                    try:
                        dt_obj = datetime.datetime.strptime(date_val, "%Y-%m-%d").date()
                        is_monday = dt_obj.weekday() == 0
                    except:
                        pass
                else:
                    try:
                        is_monday = date_val.weekday() == 0
                    except:
                        pass
                        
                if is_monday and pb.shift_name == "День":
                    continue
                    
                correct_plan = 2700 if pb.shift_name == "День" else 3300
                pb.plan_sheets = correct_plan
                updated_count += 1
                
            if updated_count > 0:
                db.commit()
                print(f"Auto-fixed {updated_count} plan_boards with 0 plan_sheets.")
        except Exception as e:
            print(f"Error auto-fixing plan boards: {e}")
        finally:
            db.close()

        # Clean up historical NULL values in database (Rule 5.8)
        db = SessionLocal()
        try:
            from sqlalchemy import text
            cleanup_queries = [
                "UPDATE lfm_reports SET lfm_wind_resets = 0 WHERE lfm_wind_resets IS NULL",
                "UPDATE lfm_reports SET formed_1st_grade = 0 WHERE formed_1st_grade IS NULL",
                "UPDATE lfm_reports SET formed_defect = 0 WHERE formed_defect IS NULL",
                "UPDATE lfm_reports SET transferred_to_warehouse = 0 WHERE transferred_to_warehouse IS NULL",
                "UPDATE batches SET ds_condition = 0 WHERE ds_condition IS NULL",
                "UPDATE batches SET ds_first_grade = 0 WHERE ds_first_grade IS NULL",
                "UPDATE batches SET ds_defect = 0 WHERE ds_defect IS NULL",
                "UPDATE batches SET qcd_condition = 0 WHERE qcd_condition IS NULL",
                "UPDATE batches SET qcd_first_grade = 0 WHERE qcd_first_grade IS NULL",
                "UPDATE batches SET qcd_defect = 0 WHERE qcd_defect IS NULL",
                "UPDATE batches SET qcd_condition = ds_condition WHERE qcd_condition = 0 AND ds_condition > 0",
                "UPDATE batches SET qcd_first_grade = ds_first_grade WHERE qcd_first_grade = 0 AND ds_first_grade > 0",
                "UPDATE batches SET qcd_defect = ds_defect WHERE qcd_defect = 0 AND ds_defect > 0",
                "UPDATE shifts SET batch_number = '' WHERE batch_number IS NULL",
                "UPDATE shifts SET product_name = '' WHERE product_name IS NULL",
                "UPDATE shifts SET export_type = 'Эталон' WHERE export_type IS NULL OR export_type = ''",
                "UPDATE lfm_reports SET export_type = 'Эталон' WHERE export_type IS NULL OR export_type = ''",
                "UPDATE batches SET export_type = 'Эталон' WHERE export_type IS NULL OR export_type = ''",
                "UPDATE shifts SET status = 'active' WHERE status IS NULL"
            ]
            for q in cleanup_queries:
                try:
                    db.execute(text(q))
                except Exception:
                    pass
            db.commit()
            print("Historical NULL values cleaned up successfully.")
        except Exception as e:
            print(f"Error cleaning up historical NULLs: {e}")
            db.rollback()
        finally:
            db.close()



        # Background auto-sync of folder structure and missing Google Drive URLs for existing documents
        try:
            from routers.documents import get_or_create_google_drive_folder_for_category
            db_docs = SessionLocal()
            try:
                # 1. Sync all folder categories to Google Drive
                all_categories = db_docs.query(models.DocumentCategory).all()
                print(f"[STARTUP] Starting auto-sync for {len(all_categories)} categories to Google Drive...")
                for cat in all_categories:
                    try:
                        f_id = get_or_create_google_drive_folder_for_category(db_docs, cat.id)
                        print(f"[STARTUP] Synced category #{cat.id} ('{cat.name}') -> Drive ID: {f_id}")
                    except Exception as cat_sync_err:
                        print(f"[STARTUP ERROR] Could not auto-sync folder category #{cat.id} ('{cat.name}') to Google Drive: {cat_sync_err}")

                # 2. Sync all documents missing Google Drive URLs
                unmigrated_docs = db_docs.query(models.Document).filter(
                    (models.Document.google_drive_url == None) | (models.Document.google_drive_url == "")
                ).all()
                print(f"[STARTUP] Found {len(unmigrated_docs)} unmigrated documents.")
                if unmigrated_docs:
                    import google_drive_integration
                    for u_doc in unmigrated_docs:
                        if u_doc.file_path and os.path.exists(u_doc.file_path):
                            try:
                                clean_t = u_doc.title or os.path.basename(u_doc.file_path)
                                parent_drive_id = get_or_create_google_drive_folder_for_category(db_docs, u_doc.category_id)
                                d_info = google_drive_integration.upload_file_to_drive(u_doc.file_path, clean_t, parent_drive_id=parent_drive_id)
                                if d_info and d_info.get("id"):
                                    u_doc.google_drive_id = d_info["id"]
                                    u_doc.google_drive_url = d_info["url"]
                                    db_docs.commit()
                                    print(f"Auto-synced doc #{u_doc.id} ('{clean_t}') to Google Drive.")
                            except Exception as sync_err:
                                print(f"Could not auto-sync doc #{u_doc.id} on startup: {sync_err}")
            finally:
                db_docs.close()
        except Exception as doc_mig_err:
            print(f"Docs startup sync error: {doc_mig_err}")

    threading.Thread(target=bg_cleanups_init, daemon=True).start()


    # Rename master
    db = SessionLocal()
    try:
        master = db.query(models.Master).filter(models.Master.name == "Рожков П.").first()
        if master:
            master.name = "Рожко П."
            db.commit()
    except Exception as e:
        db.rollback()
    finally:
        db.close()

    # Seed Planner Employees & Zones if empty
    db = SessionLocal()
    try:
        if db.query(models.PlannerEmployee).count() == 0:
            initial_employees = [
                {"name": "Левда М.", "email": "levdamaks15@gmail.com", "sort_order": 1},
                {"name": "Булеханов К.", "email": "", "sort_order": 2},
                {"name": "Курилова С.", "email": "", "sort_order": 3},
                {"name": "Сазонов С.", "email": "", "sort_order": 4},
                {"name": "Носиков Е.", "email": "", "sort_order": 5},
                {"name": "Хохлов К.", "email": "", "sort_order": 6},
                {"name": "Батырбекова Г.", "email": "", "sort_order": 7},
                {"name": "Герлинг С.", "email": "", "sort_order": 8},
                {"name": "Косумов Р.", "email": "", "sort_order": 9},
                {"name": "Мастера цеха", "email": "", "sort_order": 10},
                {"name": "Туматов Д.", "email": "", "sort_order": 11},
                {"name": "ОГЭ", "email": "", "sort_order": 12},
                {"name": "ОГМ", "email": "", "sort_order": 13}
            ]
            for emp_data in initial_employees:
                db.add(models.PlannerEmployee(**emp_data))
            db.commit()
            print("Successfully seeded initial Planner Employees.")

        if db.query(models.PlannerZone).count() == 0:
            initial_zones = [
                {"name": "Бережливое производство", "sort_order": 1},
                {"name": "Ремонт", "sort_order": 2},
                {"name": "Уборка", "sort_order": 3},
                {"name": "Производство", "sort_order": 4},
                {"name": "Отчетность", "sort_order": 5},
                {"name": "Документация", "sort_order": 6},
                {"name": "Цифровизация", "sort_order": 7},
                {"name": "Обучение", "sort_order": 8},
                {"name": "ОГЭ", "sort_order": 9},
                {"name": "ОГМ", "sort_order": 10}
            ]
            for zone_data in initial_zones:
                db.add(models.PlannerZone(**zone_data))
            db.commit()
            print("Successfully seeded initial Planner Zones.")
    except Exception as e:
        print(f"Error seeding planner settings: {e}")
        db.rollback()
    finally:
        db.close()

    def bg_google_sync_init():
        db = SessionLocal()
        try:
            if os.getenv("GOOGLE_SPREADSHEET_ID") and not os.getenv("GOOGLE_SPREADSHEET_ID").startswith("1_mock"):
                google_sheets_integration.sync_report_to_google_sheets(db)
                google_sheets_integration.export_receipt_to_google_sheets(db)
                google_sheets_integration.export_downtimes_to_google_sheets(db)
                google_sheets_integration.sync_qcd_reports_to_google_sheets(db)
                google_sheets_integration.export_norms_to_google_sheets(db)
                print("Initial Google Sheets full sync (all 5 sheets) completed on startup.")
        except Exception as e:
            print(f"Error running initial Google Sheets sync on startup: {e}")
        finally:
            db.close()

    # Регистрация Telegram Webhook
    def bg_setup_telegram_webhook():
        try:
            tg_token = os.getenv("TELEGRAM_BOT_TOKEN", "8980370531:AAGGhgbRH04LT_KOMUHr02ms1X4wZ0b3LwY").strip()
            webhook_url = "https://tectum-portal-railway-production.up.railway.app/api/telegram/webhook"
            r = requests.post(f"https://api.telegram.org/bot{tg_token}/setWebhook", json={"url": webhook_url}, timeout=10)
            print(f"[Telegram Startup] Webhook setup status: {r.json()}")
        except Exception as tg_err:
            print(f"[Telegram Startup] Error setting webhook: {tg_err}")

    threading.Thread(target=bg_setup_telegram_webhook, daemon=True).start()

    yield

app = FastAPI(title="Tectum Enterprise Portal", lifespan=lifespan)

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
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
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

app.include_router(auth_router)
app.include_router(shifts_router)
app.include_router(analytics_router)
app.include_router(downtimes_router)
app.include_router(planner_router)
app.include_router(checklists_router)
app.include_router(documents_router)
app.include_router(admin_router)
app.include_router(webhooks_router)

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

@app.get("/api/system/env")
def get_system_env():
    return {"is_sandbox": os.environ.get("IS_SANDBOX", "false").lower() == "true"}

@app.get("/")
def read_root():
    return FileResponse("static/index.html")

@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return FileResponse("static/img/Logo.png")

@app.get("/admin")
def serve_admin():
    return FileResponse("static/admin.html")

@app.get("/analytics")
def read_analytics():
    return FileResponse("static/analytics.html")

@app.get("/tasks")
def serve_tasks():
    return FileResponse("static/tasks.html")

@app.get("/planner")
def serve_planner():
    return FileResponse("static/tasks.html")


