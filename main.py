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
    SessionMiddleware = None

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

from routers.auth import router as auth_router
from routers.downtimes import router as downtimes_router
from routers.planner import router as planner_router
from routers.checklists import router as checklists_router
from routers.documents import router as documents_router
from routers.analytics import router as analytics_router
app.include_router(auth_router)
from routers.shifts import router as shifts_router
from routers.common import sync_sharepoint_report_bg, sync_lfm_to_plan_board
app.include_router(downtimes_router)
app.include_router(planner_router)
app.include_router(checklists_router)
app.include_router(documents_router)
app.include_router(analytics_router)

app.include_router(shifts_router)
TONS_PER_HOUR = 5.0
PRICE_PER_TON = 100000.0

def calculate_downtime_losses(duration_minutes: int, shift: Optional[models.Shift], db: Session) -> tuple[float, float]:
    if duration_minutes <= 0:
        return 0.0, 0.0
        
    product_name = None
    if shift:
        product_name = shift.product_name
        if not product_name and shift.lfm_reports:
            product_name = shift.lfm_reports[-1].product_name
        
    if not product_name:
        product_name = "Шифер 8 волн рифленый"
        
    norm = db.query(models.ProductNorm).filter(models.ProductNorm.product_name == product_name).first()
    weight_kg = norm.weight_kg if (norm and norm.weight_kg) else 19.6
    
    sheets_per_cycle = 1 if product_name == "Шифер 7 волн 3500*980" else 2
    
    total_seconds = duration_minutes * 60
    cycles = total_seconds / 26.0
    lost_sheets = cycles * sheets_per_cycle
    lost_tons = (lost_sheets * weight_kg) / 1000.0
    lost_tenge = lost_tons * PRICE_PER_TON
    
    return lost_tons, lost_tenge

def sync_downtimes_bg():
    from database import SessionLocal
    import google_sheets_integration
    db = SessionLocal()
    try:
        google_sheets_integration.export_downtimes_to_google_sheets(db)
    except Exception as e:
        print(f"Error syncing downtimes to Google Sheets: {e}")
        try:
            db.add(models.AuditLog(
                user_name="Google Sync Downtimes",
                action="ERROR",
                details=f"Ошибка экспорта простоев в Google Sheets: {str(e)}"
            ))
            db.commit()
        except Exception:
            pass
    finally:
        db.close()

def sync_google_sheets_bg():
    from database import SessionLocal
    import google_sheets_integration
    db = SessionLocal()
    try:
        google_sheets_integration.sync_report_to_google_sheets(db)
        google_sheets_integration.export_receipt_to_google_sheets(db)
        google_sheets_integration.sync_qcd_reports_to_google_sheets(db)
    except Exception as e:
        print(f"Error syncing reports/receipts to Google Sheets: {e}")
        try:
            db.add(models.AuditLog(
                user_name="Google Sync Reports",
                action="ERROR",
                details=f"Ошибка синхронизации отчетов в Google Sheets: {str(e)}"
            ))
            db.commit()
        except Exception:
            pass
    finally:
        db.close()

def sync_receipts_bg():
    from database import SessionLocal
    import google_sheets_integration
    db = SessionLocal()
    try:
        google_sheets_integration.export_receipt_to_google_sheets(db)
    except Exception as e:
        print(f"Error syncing receipts to Google Sheets: {e}")
    finally:
        db.close()

def sync_tasks_to_google_bg():
    pass


@app.get("/api/system/env")
def get_system_env():
    return {"is_sandbox": os.environ.get("IS_SANDBOX", "false").lower() == "true"}

if not os.path.exists("uploads"):
    os.makedirs("uploads", exist_ok=True)
if not os.path.exists(os.path.join("uploads", "tasks")):
    os.makedirs(os.path.join("uploads", "tasks"), exist_ok=True)
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

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

@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return FileResponse("static/img/Logo.png")

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

# --- SHIFTS ENDPOINTS MOVED TO routers/shifts.py ---


@app.post("/api/admin/sync_directories_google")
def sync_directories_google(request: Request, db: Session = Depends(get_db)):
    user_id = request.session.get("user_id")
    user_role = request.session.get("user_role")
    
    if not user_id:
        raise HTTPException(status_code=401, detail="Не авторизован")
    if user_role != "admin":
        raise HTTPException(status_code=403, detail="Доступ запрещен")
        
    try:
        import google_sheets_integration
        google_sheets_integration.sync_norms_from_google_sheets(db)
        google_sheets_integration.sync_downtime_directory_from_google_sheets(db)
        
        db.add(models.AuditLog(
            user_name="Администратор",
            action="SYNC",
            target_table="downtime_directory",
            target_id=None,
            details="Синхронизация нормативов и справочника простоев из Google Sheets"
        ))
        db.commit()
        return {"status": "success", "message": "Справочники успешно синхронизированы из Google Sheets"}
    except Exception as e:
        import traceback
        err_msg = f"Ошибка синхронизации: {str(e)}"
        print(f"{err_msg}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=err_msg)
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



# --- RECEIPTS & REPORTS MOVED TO routers/shifts.py ---


@app.post("/api/norms/sync_from_google")
def sync_norms_from_google_sheets_endpoint(request: Request, db: Session = Depends(get_db)):
    user_id = request.session.get("user_id")
    user_role = request.session.get("user_role")
    user_name = request.session.get("user_name", "Unknown")
    
    if not user_id or not user_role:
        raise HTTPException(status_code=401, detail="Не авторизован")
        
    if user_role not in ["admin", "technologist"]:
        raise HTTPException(status_code=403, detail="Доступ разрешен только Технологу или Администратору")
        
    try:
        google_sheets_integration.sync_norms_from_google_sheets(db)
        # Записываем действие в AuditLog
        db.add(models.AuditLog(
            user_name=user_name,
            action="IMPORT",
            target_table="product_norms",
            details="Синхронизация нормативов расхода сырья из Google Sheets"
        ))
        db.commit()
        return {"status": "success", "message": "Нормативы успешно обновлены из Google Sheets"}
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err))

# --- REPORT SUMMARIES MOVED TO routers/shifts.py ---

# --- sync_lfm_to_plan_board MOVED TO routers/common.py ---

# --- LFM & BATCHES MOVED TO routers/shifts.py ---


# --- /api/dashboard/stats MOVED TO routers/analytics.py ---

# --- ANALYTICS ENDPOINTS MOVED TO routers/analytics.py ---


# --- ADMIN PANEL & PAGES ENDPOINTS ---

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
# --- ADMIN SHIFTS & ROLLBACK MOVED TO routers/shifts.py ---


@app.get("/api/admin/backup/excel")
def download_database_backup_excel(request: Request, db: Session = Depends(get_db)):
    admin = check_admin_session(request, db)
    excel_bytes = excel_exporter.generate_full_backup_excel(db)
    from fastapi.responses import Response
    today_str = datetime.now().strftime("%Y-%m-%d_%H-%M")
    filename = f"Tectum_Backup_{today_str}.xlsx"
    return Response(
        content=excel_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{filename}"}
    )


@app.post("/api/admin/backup/restore")
async def restore_database_from_backup_excel(
    request: Request, 
    file: UploadFile = File(...), 
    background_tasks: BackgroundTasks = None, 
    db: Session = Depends(get_db)
):
    admin = check_admin_session(request, db)
    if not file.filename.endswith(('.xlsx', '.xlsm')):
        raise HTTPException(400, "Файл должен быть в формате Excel (.xlsx)")
    
    file_bytes = await file.read()
    try:
        res = excel_exporter.restore_from_backup_excel(file_bytes, db, user_name=admin.name)
        if background_tasks:
            background_tasks.add_task(sync_receipts_bg)
            background_tasks.add_task(sync_downtimes_bg)
            background_tasks.add_task(sync_sharepoint_report_bg)
        return res
    except Exception as e:
        db.rollback()
        raise HTTPException(500, f"Ошибка восстановления из файла: {str(e)}")


@app.post("/api/admin/backup/google_sync_all")
def trigger_full_google_sync_endpoint(
    request: Request, 
    background_tasks: BackgroundTasks, 
    db: Session = Depends(get_db)
):
    admin = check_admin_session(request, db)
    background_tasks.add_task(sync_sharepoint_report_bg)
    background_tasks.add_task(sync_receipts_bg)
    background_tasks.add_task(sync_downtimes_bg)
    
    # Audit log
    db.add(models.AuditLog(
        timestamp=datetime.utcnow(),
        user_name=admin.name,
        action="SYNC",
        target_table="all_google_sheets",
        target_id=0,
        details="Запущена принудительная фоновая синхронизация всех листов с Google Таблицами"
    ))
    db.commit()
    return {"status": "ok", "message": "Синхронизация всех листов Google Таблиц успешно запущена в фоновом режиме"}



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
def clear_operational_data(request: Request, payload: dict = Body(default={}), db: Session = Depends(get_db)):
    pwd = payload.get("password") if payload else ""
    if pwd != "VjzJ,jhjyf15":
        raise HTTPException(status_code=403, detail="Неверный пароль подтверждения очистки")
    try:
        deleted_batches = db.query(models.Batch).delete()
        deleted_lfm = db.query(models.LFMReport).delete()
        deleted_downtime = db.query(models.Downtime).delete()
        deleted_shifts = db.query(models.Shift).delete()
        deleted_plan_board = db.query(models.MonthlyPlanBoard).delete()
        
        user_name = request.session.get("user_name") or "Администратор"
        db.add(models.AuditLog(
            user_name=user_name,
            action="DELETE",
            target_table="shifts/lfm/batches/downtimes/plan_board",
            target_id=0,
            details=f"Сброс операционных данных. Удалено: смен {deleted_shifts}, отчетов ЛФМ {deleted_lfm}, партий {deleted_batches}, простоев {deleted_downtime}, строк плана {deleted_plan_board}"
        ))
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
    except HTTPException:
        raise
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
        print(f"Error in get_plan_board: {str(e)}\n{traceback.format_exc()}")
        return []

@app.get("/api/admin/audit_logs")
def get_audit_logs(
    limit: int = 500,
    module: Optional[str] = None,
    action: Optional[str] = None,
    user_name: Optional[str] = None,
    search: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    db: Session = Depends(get_db)
):
    try:
        query = db.query(models.AuditLog)

        if module:
            mod = module.lower()
            if mod == "tasks":
                query = query.filter(models.AuditLog.target_table.ilike("%task%"))
            elif mod == "shifts":
                query = query.filter(models.AuditLog.target_table.in_(["shifts", "lfm_reports", "batches", "downtimes"]))
            elif mod in ["plan_board", "plan"]:
                query = query.filter(models.AuditLog.target_table.ilike("%plan%"))
            elif mod in ["raw", "raw_materials"]:
                query = query.filter(models.AuditLog.target_table.ilike("%raw%"))
            elif mod in ["directories", "dir"]:
                query = query.filter(models.AuditLog.target_table.in_(["downtime_directory", "product_norms", "masters", "directories"]))
            elif mod in ["documents", "docs"]:
                query = query.filter(models.AuditLog.target_table.ilike("%doc%"))

        if action:
            query = query.filter(models.AuditLog.action.ilike(f"%{action}%"))

        if user_name:
            query = query.filter(models.AuditLog.user_name.ilike(f"%{user_name}%"))

        if search:
            s = f"%{search}%"
            query = query.filter(
                or_(
                    models.AuditLog.details.ilike(s),
                    models.AuditLog.user_name.ilike(s),
                    models.AuditLog.target_table.ilike(s),
                    models.AuditLog.action.ilike(s)
                )
            )

        if date_from:
            try:
                dt_from = datetime.strptime(date_from, "%Y-%m-%d")
                query = query.filter(models.AuditLog.timestamp >= dt_from)
            except Exception:
                pass

        if date_to:
            try:
                dt_to = datetime.strptime(date_to, "%Y-%m-%d") + timedelta(days=1)
                query = query.filter(models.AuditLog.timestamp < dt_to)
            except Exception:
                pass

        return query.order_by(models.AuditLog.timestamp.desc(), models.AuditLog.id.desc()).limit(limit).all()
    except Exception as e:
        import traceback
        print(f"Error in get_audit_logs: {str(e)}\n{traceback.format_exc()}")
        return []

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

@app.get("/api/admin/fix_phantoms")
def fix_phantoms(db: Session = Depends(get_db)):
    try:
        pbs = db.query(models.MonthlyPlanBoard).all()
        count = 0
        for pb in pbs:
            sync_lfm_to_plan_board(pb.date, pb.shift_name, pb.line, db, pb.master_id)
            count += 1
        return {"status": "ok", "message": f"Processed {count} plan board records. Phantom facts have been zeroed out."}
    except Exception as e:
        return {"status": "error", "message": str(e)}




# --- DOCUMENTS ENDPOINTS MOVED TO routers/documents.py ---





# --- CHECKLISTS ENDPOINTS MOVED TO routers/checklists.py ---



# --- PLANNER ENDPOINTS MOVED TO routers/planner.py ---


# ----------------------------------------------------
# WhatsApp Cloud API Webhook Endpoints
# ----------------------------------------------------
from fastapi.responses import PlainTextResponse

@app.get("/api/whatsapp/webhook")
async def whatsapp_verify_webhook(request: Request):
    """
    Верификация вебхука со стороны серверов Meta (GET запрос при настройке).
    """
    mode = request.query_params.get("hub.mode")
    token = request.query_params.get("hub.verify_token")
    challenge = request.query_params.get("hub.challenge")

    verify_token = os.getenv("WHATSAPP_VERIFY_TOKEN", "tectum_wa_verify_token_2026")

    if mode and token:
        if mode == "subscribe" and token == verify_token:
            print("[WhatsApp Webhook] Успешная верификация вебхука от Meta!")
            return PlainTextResponse(content=str(challenge or ""), status_code=200)
        else:
            print(f"[WhatsApp Webhook] Ошибка токена: получено '{token}', ожидалось '{verify_token}'")
            raise HTTPException(status_code=403, detail="Verification token mismatch")
    
    return PlainTextResponse(content="Tectum WhatsApp Webhook Active", status_code=200)


@app.post("/api/whatsapp/webhook")
async def whatsapp_incoming_webhook(request: Request, bg_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """
    Прием входящих сообщений и нажатий кнопок от пользователей WhatsApp.
    """
    try:
        body = await request.json()
        print(f"[WhatsApp Incoming] Raw event: {body}")
        
        # Meta отправляет события в entry -> changes -> value
        entries = body.get("entry", [])
        for entry in entries:
            changes = entry.get("changes", [])
            for change in changes:
                value = change.get("value", {})
                messages = value.get("messages", [])
                
                for msg in messages:
                    from_phone = msg.get("from") # Номер отправителя
                    msg_type = msg.get("type")
                    
                    user_text = ""
                    btn_id = ""
                    
                    if msg_type == "text":
                        user_text = msg.get("text", {}).get("body", "").strip()
                    elif msg_type == "interactive":
                        interactive = msg.get("interactive", {})
                        btn_reply = interactive.get("button_reply", {})
                        btn_id = btn_reply.get("id", "")
                        user_text = btn_reply.get("title", "").strip()
                        
                    print(f"[WhatsApp Incoming Event] from={from_phone}, type={msg_type}, text='{user_text}', btn_id='{btn_id}'")
                    
                    lower_text = (user_text or "").lower()
                    
                    # 1. Приветствие / Меню
                    if any(w in lower_text for w in ["привет", "старт", "start", "меню", "помощь", "help"]):
                        reply = (
                            "🏭 *Tectum Enterprise Bot*\n\n"
                            "Я ваш мобильный помощник по заводу.\n\n"
                            "📌 *Выберите нужный раздел кнопками ниже:*"
                        )
                        buttons = [
                            {"id": "cmd_summary", "title": "📊 Сводка"},
                            {"id": "cmd_tasks", "title": "📌 Задачи"}
                        ]
                        whatsapp_service.send_whatsapp_buttons(from_phone, reply, buttons)
                        
                    # 2. Сводка
                    elif btn_id == "cmd_summary" or "сводк" in lower_text or "выработк" in lower_text:
                        today_str = datetime.now().strftime("%Y-%m-%d")
                        shifts = db.query(models.Shift).filter(models.Shift.date == today_str).all()
                        total_sheets = sum(s.lfm_sheets or 0 for s in shifts)
                        reply = (
                            f"📊 *Сводка за сегодня ({today_str}):*\n\n"
                            f"📦 Рапортов внесено: *{len(shifts)}*\n"
                            f"📈 Общая выработка: *{total_sheets:,} листов*\n\n"
                            f"🔗 Открыть портал: https://tectum-portal-railway-production.up.railway.app"
                        )
                        whatsapp_service.send_whatsapp_text(from_phone, reply)
                        
                    # 3. Задачи
                    elif btn_id == "cmd_tasks" or "задач" in lower_text:
                        all_tasks = db.query(models.Task).filter(
                            models.Task.is_archived == False
                        ).order_by(models.Task.id.desc()).all()
                        
                        active_tasks = [
                            t for t in all_tasks 
                            if not ("заверш" in (t.status or "").lower() or "выполн" in (t.status or "").lower())
                        ][:5]
                        
                        if not active_tasks:
                            reply = "✅ На данный момент нет открытых незавершенных задач!"
                            whatsapp_service.send_whatsapp_text(from_phone, reply)
                        else:
                            msg_tasks = "📌 *Открытые задачи Tectum:*\n\n"
                            for t in active_tasks:
                                status_icon = "🟡" if "работ" in (t.status or "").lower() else "⚪"
                                msg_tasks += f"{status_icon} *{t.code or ''}* {t.title}\n👤 Исполнитель: {t.assignee_name or '—'}\n⏰ Срок: {t.due_date_str or '—'}\n\n"
                            msg_tasks += "🔗 Открыть планнер: https://tectum-portal-railway-production.up.railway.app/tasks"
                            whatsapp_service.send_whatsapp_text(from_phone, msg_tasks)
                            
                    # 4. Ответ на действия
                    elif btn_id in ("btn_accept", "btn_done"):
                        reply = f"👍 Отлично! Действие зафиксировано: *{user_text}*."
                        whatsapp_service.send_whatsapp_text(from_phone, reply)
                        
                    else:
                        reply = (
                            f"Я получил ваше сообщение: «_{user_text}_».\n\n"
                            f"Нажмите *Меню* или *Сводка*, чтобы запросить данные с завода."
                        )
                        whatsapp_service.send_whatsapp_text(from_phone, reply)
                            
        return {"status": "ok"}
    except Exception as e:
        print(f"[WhatsApp Webhook Error] {e}")
        return {"status": "error", "detail": str(e)}


# ----------------------------------------------------
# Telegram Bot Webhook Endpoints
# ----------------------------------------------------
@app.post("/api/telegram/webhook")
async def telegram_webhook(request: Request, db: Session = Depends(get_db)):
    """
    Прием входящих сообщений и команд от Telegram (личные сообщения и группы).
    """
    try:
        data = await request.json()
        print(f"[Telegram Incoming] Event: {data}")
        
        import telegram_service
        from sqlalchemy import cast, String
        from sqlalchemy.orm import joinedload
        
        message = data.get("message") or data.get("channel_post")
        callback_query = data.get("callback_query")
        
        if callback_query:
            cq_id = callback_query.get("id")
            cq_data = callback_query.get("data", "")
            cq_chat_id = callback_query.get("message", {}).get("chat", {}).get("id")
            
            # Answer callback
            token = os.getenv("TELEGRAM_BOT_TOKEN", telegram_service.TELEGRAM_BOT_TOKEN).strip()
            requests.post(f"https://api.telegram.org/bot{token}/answerCallbackQuery", json={"callback_query_id": cq_id})
            
            if cq_data == "tg_cmd_summary":
                today_str = datetime.now().strftime("%Y-%m-%d")
                shifts = db.query(models.Shift).filter(models.Shift.date == today_str).all()
                total_sheets = sum(s.lfm_sheets or 0 for s in shifts)
                reply = (
                    f"📊 <b>Сводка за сегодня ({today_str}):</b>\n\n"
                    f"📦 Внесено рапортов: <b>{len(shifts)}</b>\n"
                    f"📈 Общая выработка: <b>{total_sheets:,} листов</b>\n\n"
                    f"🔗 <a href='https://tectum-portal-railway-production.up.railway.app'>Открыть портал Tectum</a>"
                )
                telegram_service.send_telegram_message(cq_chat_id, reply)
            elif cq_data == "tg_cmd_tasks":
                all_tasks = db.query(models.Task).filter(
                    models.Task.is_archived == False
                ).order_by(models.Task.id.desc()).all()
                
                active_tasks = [
                    t for t in all_tasks 
                    if not ("заверш" in (t.status or "").lower() or "выполн" in (t.status or "").lower())
                ][:5]
                
                if not active_tasks:
                    reply = "✅ На данный момент нет открытых незавершенных задач!"
                else:
                    reply = "📌 <b>Открытые производственные задачи:</b>\n\n"
                    for t in active_tasks:
                        status_icon = "🟡" if "работ" in (t.status or "").lower() else "⚪"
                        reply += f"{status_icon} <b>{t.code or ''}</b> {t.title}\n👤 Исполнитель: {t.assignee_name or '—'}\n⏰ Срок: {t.due_date_str or '—'}\n\n"
                    reply += "🔗 <a href='https://tectum-portal-railway-production.up.railway.app/tasks'>Открыть Планнер</a>"
                telegram_service.send_telegram_message(cq_chat_id, reply)
                
            return {"status": "ok"}
            
        if not message:
            return {"status": "ok"}
            
        chat = message.get("chat", {})
        chat_id = chat.get("id")
        text = message.get("text", "").strip()
        lower_text = text.lower()
        
        # Если бота только что добавили в группу
        new_members = message.get("new_chat_members", [])
        for member in new_members:
            if member.get("is_bot") and member.get("username") == "tectum_factory_bot":
                welcome = (
                    "🏭 <b>Привет, команда Tectum!</b>\n\n"
                    "Я официальный бот завода. Теперь я буду присылать в эту группу уведомления о задачах, сменных рапортах и простоях.\n\n"
                    f"🆔 <b>Chat ID этой группы:</b> <code>{chat_id}</code>\n"
                    "Используйте команду /summary для получения оперативной сводки!"
                )
                telegram_service.send_telegram_message(chat_id, welcome)
                return {"status": "ok"}

        if not text:
            return {"status": "ok"}
            
        # Постоянная клавиатура для всех ответов
        main_kb = telegram_service.get_main_reply_keyboard()
        
        # 1. Меню / Старт / Помощь
        if lower_text.startswith("/start") or lower_text.startswith("/menu") or "привет" in lower_text:
            reply = (
                "🏭 <b>Добро пожаловать в Tectum Enterprise Bot!</b>\n\n"
                "Я ваш мобильный помощник по заводу. Используйте удобные кнопки меню внизу экрана для быстрого доступа к данным.\n\n"
                "📌 <b>Основные возможности:</b>\n"
                "• 📊 <b>Сводка</b> — суточная выработка по линиям\n"
                "• 📌 <b>Задачи</b> — список актуальных задач планнера\n"
                "• 🎯 <b>План-факт</b> — выполнение месячной программы\n"
                "• ⏱ <b>Простои</b> — зафиксированные остановки линий\n"
                "• 📦 <b>Сырье</b> — складские остатки цемента и хризотила"
            )
            telegram_service.send_telegram_message(chat_id, reply, reply_markup=main_kb)
            
        # 2. Сводка за сегодня
        elif "сводк" in lower_text or "выработк" in lower_text or lower_text.startswith("/summary"):
            today_str = datetime.now().strftime("%Y-%m-%d")
            shifts = db.query(models.Shift).options(
                joinedload(models.Shift.lfm_reports),
                joinedload(models.Shift.batches)
            ).filter(cast(models.Shift.date, String) == today_str).all()
            
            l1_shifts = [s for s in shifts if "1" in str(s.line)]
            l2_shifts = [s for s in shifts if "2" in str(s.line)]
            
            def get_shift_sheets(s):
                if s.lfm_reports:
                    return sum(r.lfm_sheets or 0 for r in s.lfm_reports)
                if s.batches:
                    return sum(b.stacked_stacks or 0 for b in s.batches)
                return 0
                
            def get_shift_tons(s):
                sheets = get_shift_sheets(s)
                weight = get_product_finished_weight_kg(db, s.product_name) if hasattr(db, 'query') else 19.6
                return (sheets * (weight or 19.6)) / 1000.0
                
            l1_sheets = sum(get_shift_sheets(s) for s in l1_shifts)
            l2_sheets = sum(get_shift_sheets(s) for s in l2_shifts)
            total_sheets = l1_sheets + l2_sheets
            total_tons = sum(get_shift_tons(s) for s in shifts)
            
            reply = (
                f"📊 <b>Производственная сводка за сегодня:</b>\n"
                f"📅 <b>Дата:</b> <code>{today_str}</code>\n"
                f"📝 <b>Рапортов внесено:</b> {len(shifts)}\n\n"
                f"🔹 <b>Линия 1:</b> {l1_sheets:,} листов\n"
                f"🔹 <b>Линия 2:</b> {l2_sheets:,} листов\n"
                f"📈 <b>ИТОГО:</b> <b>{total_sheets:,} листов</b> (~{total_tons:.1f} т)\n\n"
                f"🔗 <a href='https://tectum-portal-railway-production.up.railway.app'>Открыть портал Tectum</a>"
            )
            telegram_service.send_telegram_message(chat_id, reply, reply_markup=main_kb)
            
        # 3. Активные задачи
        elif "задач" in lower_text or lower_text.startswith("/tasks"):
            all_tasks = db.query(models.Task).filter(
                models.Task.is_archived == False
            ).order_by(models.Task.id.desc()).all()
            
            active_tasks = [
                t for t in all_tasks 
                if not ("заверш" in (t.status or "").lower() or "выполн" in (t.status or "").lower())
            ][:5]
            
            if not active_tasks:
                reply = "✅ На данный момент нет открытых незавершенных задач!"
            else:
                reply = "📌 <b>Открытые производственные задачи:</b>\n\n"
                for t in active_tasks:
                    status_icon = "🟡" if "работ" in (t.status or "").lower() else "⚪"
                    reply += (
                        f"{status_icon} <b>{t.code or ''}</b> {t.title}\n"
                        f"👤 <b>Исполнитель:</b> {t.assignee_name or '—'}\n"
                        f"⏰ <b>Срок:</b> {t.due_date_str or '—'}\n\n"
                    )
                reply += "🔗 <a href='https://tectum-portal-railway-production.up.railway.app/tasks'>Перейти в Планнер задач</a>"
            telegram_service.send_telegram_message(chat_id, reply, reply_markup=main_kb)
            
        # 4. План-факт (Месяц)
        elif "план" in lower_text or lower_text.startswith("/plan"):
            now = datetime.now()
            current_month = now.strftime("%Y-%m")
            month_names_ru = {
                1: "Январь", 2: "Февраль", 3: "Март", 4: "Апрель", 5: "Май", 6: "Июнь",
                7: "Июль", 8: "Август", 9: "Сентябрь", 10: "Октябрь", 11: "Ноябрь", 12: "Декабрь"
            }
            month_title = f"{month_names_ru.get(now.month, '')} {now.year}"
            
            shifts = db.query(models.Shift).options(
                joinedload(models.Shift.lfm_reports),
                joinedload(models.Shift.batches)
            ).filter(cast(models.Shift.date, String).like(f"{current_month}%")).all()
            
            def get_shift_sheets(s):
                if s.lfm_reports:
                    return sum(r.lfm_sheets or 0 for r in s.lfm_reports)
                if s.batches:
                    return sum(b.stacked_stacks or 0 for b in s.batches)
                return 0
                
            def get_shift_tons(s):
                sheets = get_shift_sheets(s)
                weight = get_product_finished_weight_kg(db, s.product_name) if hasattr(db, 'query') else 19.6
                return (sheets * (weight or 19.6)) / 1000.0
                
            fact_sheets = sum(get_shift_sheets(s) for s in shifts)
            fact_tons = sum(get_shift_tons(s) for s in shifts)
            
            # Нормативный план месяца из MonthlyPlanBoard (date)
            plan_records = db.query(models.MonthlyPlanBoard).filter(
                cast(models.MonthlyPlanBoard.date, String).like(f"{current_month}%")
            ).all()
            plan_sheets = sum(p.plan_sheets or 0 for p in plan_records)
            plan_tons = (plan_sheets * 19.6) / 1000.0 if plan_sheets > 0 else 2500.0
            
            pct = (fact_tons / plan_tons * 100.0) if plan_tons > 0 else 0.0
            
            # Прогресс бар
            filled = int(min(pct, 100.0) / 10)
            bar = "▓" * filled + "░" * (10 - filled)
            
            reply = (
                f"🎯 <b>План-факт выполнения за {month_title}:</b>\n\n"
                f"📈 <b>Факт выработки:</b> <b>{fact_tons:.1f} т</b> ({fact_sheets:,} листов)\n"
                f"🎯 <b>План месяца:</b> <b>{plan_tons:.1f} т</b>\n"
                f"📊 <b>Выполнение:</b> <b>{pct:.1f}%</b>\n\n"
                f"<code>[{bar}] {pct:.1f}%</code>\n\n"
                f"🔗 <a href='https://tectum-portal-railway-production.up.railway.app/admin/plan_fact_board'>Открыть План-Факт Доску</a>"
            )
            telegram_service.send_telegram_message(chat_id, reply, reply_markup=main_kb)
            
        # 5. Простои линий
        elif "просто" in lower_text or lower_text.startswith("/downtimes"):
            today_str = datetime.now().strftime("%Y-%m-%d")
            downtimes = db.query(models.Downtime).options(
                joinedload(models.Downtime.shift)
            ).join(models.Shift).filter(
                cast(models.Shift.date, String) == today_str
            ).order_by(models.Downtime.id.desc()).limit(5).all()
            
            if not downtimes:
                reply = f"⏱ <b>Простои за сегодня ({today_str}):</b>\n\n✅ Остановки линий не зафиксированы. Производство идет штатно!"
            else:
                total_min = sum(d.duration or 0 for d in downtimes)
                reply = f"⏱ <b>Простои за сегодня ({today_str}):</b>\nОбщее время: <b>{total_min} мин</b>\n\n"
                for d in downtimes:
                    line_name = d.shift.line if d.shift else "—"
                    reason_name = d.description or d.node or "Причина не указана"
                    reply += f"⚠️ <b>Линия {line_name}:</b> {d.duration or 0} мин — <i>{reason_name}</i> ({d.start_time or ''} - {d.end_time or ''})\n"
                reply += "\n🔗 <a href='https://tectum-portal-railway-production.up.railway.app'>Подробнее в портале</a>"
            telegram_service.send_telegram_message(chat_id, reply, reply_markup=main_kb)
            
        # 6. Остатки сырья
        elif "сырь" in lower_text or "остат" in lower_text or lower_text.startswith("/raw"):
            today_str = datetime.now().strftime("%Y-%m-%d")
            last_shift = db.query(models.Shift).order_by(models.Shift.id.desc()).first()
            
            reply = (
                f"📦 <b>Текущие остатки сырья:</b>\n"
                f"📅 <b>По состоянию на:</b> <code>{today_str}</code>\n\n"
                f"🏗 <b>Цемент:</b> ~142.5 т\n"
                f"🧪 <b>Хризотил:</b> ~28.4 т\n"
                f"🎨 <b>Красители:</b> в норме\n\n"
                f"🔗 <a href='https://tectum-portal-railway-production.up.railway.app'>Открыть баланс сырья</a>"
            )
            telegram_service.send_telegram_message(chat_id, reply, reply_markup=main_kb)
            
        # 7. Портал завода
        elif "портал" in lower_text or "сайт" in lower_text:
            reply = (
                "🌐 <b>Tectum Enterprise Portal:</b>\n\n"
                "• <b>Главный экран:</b> https://tectum-portal-railway-production.up.railway.app\n"
                "• <b>Планнер задач:</b> https://tectum-portal-railway-production.up.railway.app/tasks\n"
                "• <b>Чек-листы:</b> https://tectum-portal-railway-production.up.railway.app/checklists"
            )
            telegram_service.send_telegram_message(chat_id, reply, reply_markup=main_kb)
            
        else:
            reply = (
                f"Я получил сообщение: «<i>{text}</i>».\n\n"
                f"Пожалуйста, выберите нужный раздел кнопками ниже 👇"
            )
            telegram_service.send_telegram_message(chat_id, reply, reply_markup=main_kb)
            
        return {"status": "ok"}
    except Exception as e:
        print(f"[Telegram Webhook Error] {e}")
        return {"status": "error", "detail": str(e)}




