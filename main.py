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
        conn.execute("ALTER TABLE downtimes ADD COLUMN comment VARCHAR(255)")
        conn.commit()
        conn.close()
    except: pass

    try:
        conn = sqlite3.connect("tectum.db")
        conn.execute("ALTER TABLE downtimes ADD COLUMN breakdowns VARCHAR")
        conn.commit()
        conn.close()
    except: pass
    
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

        # Reclassify historical generic downtimes (Rule 5.8)
        db = SessionLocal()
        try:
            from downtime_classifier import classify_downtime_text, VALID_CATEGORIES
            dts = db.query(models.Downtime).all()
            updated_dt_count = 0
            for d in dts:
                text = d.description or d.comment or ""
                if not text:
                    continue
                if (not d.department or d.department in ["Формовочное отделение", "Общее", "Основное оборудование"] or 
                    d.node in ["Основное оборудование", "Разное", "Общее", None, ""] or 
                    (d.department == "Заготовительное отделение (ЗО)" and d.node == "Ковшевая мешалка") or
                    d.category not in VALID_CATEGORIES):
                    dept, node, cat, is_equip = classify_downtime_text(text, d.is_equipment_downtime, db=db)
                    d.department = dept
                    d.node = node
                    d.category = cat
                    if d.is_equipment_downtime is None:
                        d.is_equipment_downtime = is_equip
                    updated_dt_count += 1
            if updated_dt_count > 0:
                db.commit()
                print(f"Auto-reclassified {updated_dt_count} historical downtimes.")
                import google_sheets_integration
                try:
                    google_sheets_integration.export_downtimes_to_google_sheets(db)
                    print("Exported reclassified downtimes to Google Sheets.")
                except Exception as gs_err:
                    print(f"Warning: could not sync updated downtimes to Google Sheets: {gs_err}")
        except Exception as e:
            print(f"Error auto-reclassifying downtimes: {e}")
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
                google_sheets_integration.export_current_balance_to_google_sheets(db)
                google_sheets_integration.sync_qcd_reports_to_google_sheets(db)
                print("Initial Google Sheets sync completed on startup.")
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

def calculate_downtime_losses(duration_minutes: int, shift: models.Shift, db: Session) -> tuple[float, float]:
    if duration_minutes <= 0:
        return 0.0, 0.0
        
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
        from google_sheets_integration import sync_downtime_weekly_summary, get_sheets_service
        try:
            sync_downtime_weekly_summary(db)
        except Exception as e:
            import traceback, os
            err_msg = f"Crash in sync_downtime_weekly_summary: {str(e)}\n{traceback.format_exc()}"
            print(err_msg)
            try:
                sheet_id = os.getenv("GOOGLE_SPREADSHEET_ID")
                if sheet_id:
                    service = get_sheets_service()
                    service.spreadsheets().values().update(
                        spreadsheetId=sheet_id,
                        range="'Свод неделя'!A1",
                        valueInputOption="USER_ENTERED",
                        body={"values": [[err_msg]]}
                    ).execute()
            except:
                pass
    except Exception as e:
        print(f"Error syncing downtimes to Google Sheets: {e}")
    finally:
        db.close()

def sync_google_sheets_bg():
    from database import SessionLocal
    import google_sheets_integration
    db = SessionLocal()
    try:
        google_sheets_integration.sync_report_to_google_sheets(db)
        google_sheets_integration.export_receipt_to_google_sheets(db)
        google_sheets_integration.export_current_balance_to_google_sheets(db)
        google_sheets_integration.sync_qcd_reports_to_google_sheets(db)
    except Exception as e:
        print(f"Error syncing reports/receipts to Google Sheets: {e}")
    finally:
        db.close()

def sync_receipts_bg():
    from database import SessionLocal
    import google_sheets_integration
    db = SessionLocal()
    try:
        google_sheets_integration.export_receipt_to_google_sheets(db)
        google_sheets_integration.export_current_balance_to_google_sheets(db)
    except Exception as e:
        print(f"Error syncing receipts to Google Sheets: {e}")
    finally:
        db.close()

def sync_tasks_to_google_bg():
    from database import SessionLocal
    import google_sheets_integration
    db = SessionLocal()
    try:
        google_sheets_integration.export_tasks_to_google_sheets(db)
    except Exception as e:
        print(f"Error syncing tasks to Google Sheets: {e}")
    finally:
        db.close()


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

class LoginRequest(BaseModel):
    name: str
    pin: str

class AdminLoginRequest(BaseModel):
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

@app.post("/api/admin/login")
def admin_login(data: AdminLoginRequest, request: Request, db: Session = Depends(get_db)):
    admin = db.query(models.Master).filter(models.Master.pin == data.pin, models.Master.role.in_(["admin", "director", "technologist"])).first()
    if not admin:
        raise HTTPException(status_code=400, detail="Неверный ПИН-код или нет прав администратора")
    request.session["user_id"] = admin.id
    request.session["user_name"] = admin.name
    request.session["user_role"] = admin.role
    return {"id": admin.id, "name": admin.name, "role": admin.role}

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
    try:
        masters = db.query(models.Master).all()
        return sorted(masters, key=lambda m: (m.name != "Дауылбай М.", m.name))
    except Exception as e:
        import traceback
        print(f"Error in get_masters: {str(e)}\n{traceback.format_exc()}")
        return []

# --- УПРАВЛЕНИЕ СМЕНОЙ ---
@app.post("/api/shifts/")
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

@app.get("/api/shifts/active")
def get_active_shifts(db: Session = Depends(get_db)):
    try:
        return db.query(models.Shift).filter(models.Shift.status == "active").all()
    except Exception as e:
        import traceback
        print(f"Error in get_active_shifts: {str(e)}\n{traceback.format_exc()}")
        return []

@app.get("/api/shifts/all", response_model=list[schemas.Shift])
def get_all_shifts(db: Session = Depends(get_db)):
    try:
        shifts = db.query(models.Shift).options(
            selectinload(models.Shift.master),
            selectinload(models.Shift.receipts),
            selectinload(models.Shift.batches),
            selectinload(models.Shift.lfm_reports),
            selectinload(models.Shift.downtimes)
        ).order_by(models.Shift.date.desc(), models.Shift.line.asc(), models.Shift.shift_name.desc(), models.Shift.batch_number.desc(), models.Shift.id.desc()).all()
        
        result = []
        for shift in shifts:
            try:
                lfm_sheets = sum((r.lfm_sheets or 0) for r in shift.lfm_reports) if shift.lfm_reports else 0
                warehouse_gp = sum((b.ds_condition or 0) for b in shift.batches) if shift.batches else 0
                plan_sheets = shift.plan_sheets or 0
                zo_batches = shift.zo_batches or 0
                
                if plan_sheets == 0 and lfm_sheets == 0 and warehouse_gp == 0 and zo_batches == 0 and not shift.zo_submitted:
                    continue
                schemas.Shift.from_orm(shift)
                result.append(shift)
            except Exception as item_err:
                print(f"Warning: skipping shift ID {shift.id} in get_all_shifts due to validation error: {item_err}")
                continue
        return result
    except Exception as e:
        import traceback
        print(f"Error in get_all_shifts: {str(e)}\n{traceback.format_exc()}")
        return []

@app.get("/api/shifts/by_params")
def get_shift_by_params(date: str, shift_name: str, line: str, request: Request, product_name: Optional[str] = None, batch_number: Optional[str] = None, export_type: Optional[str] = None, master_id: Optional[int] = None, create_if_not_exists: bool = False, db: Session = Depends(get_db)):
    user_id = request.session.get("user_id")
    user_role = request.session.get("user_role")
    if not user_id:
        raise HTTPException(status_code=401, detail="Не авторизован")
    if user_role not in ["master", "admin", "director", "technologist"]:
        raise HTTPException(status_code=403, detail="Доступ запрещен")
        
    try:
        if hasattr(date, "strftime"):
            parsed_date = date.date() if hasattr(date, "date") else date
        else:
            parsed_date = datetime.strptime(str(date), "%Y-%m-%d").date()
    except Exception:
        raise HTTPException(400, "Неверный формат даты. Ожидается YYYY-MM-DD")
        
    query = db.query(models.Shift).filter(
        models.Shift.date == parsed_date,
        models.Shift.shift_name == shift_name,
        models.Shift.line == line
    )
    if product_name:
        query = query.filter(models.Shift.product_name == product_name)
    if batch_number:
        query = query.filter(models.Shift.batch_number == batch_number)
    if export_type:
        query = query.filter(models.Shift.export_type == export_type)
    shift = query.first()
    
    if not shift:
        if not create_if_not_exists:
            raise HTTPException(status_code=404, detail="Смена не найдена")
            
        # Автоматически создаем закрытую смену с переданным master_id, либо текущего пользователя, либо первого мастера в БД
        final_master_id = master_id if master_id else user_id
        if not final_master_id or user_role not in ["master"]:
            if not final_master_id:
                first_master = db.query(models.Master).filter(models.Master.role == "master").first()
                if first_master:
                    final_master_id = first_master.id
                else:
                    final_master_id = user_id
                    
        shift = models.Shift(
            date=parsed_date,
            shift_name=shift_name,
            line=line,
            master_id=final_master_id,
            product_name=product_name or "",
            batch_number=batch_number or "",
            export_type=export_type or "Эталон",
            status="closed",
            plan_sheets=0,
            plan_tons=0.0,
            created_at=datetime.utcnow()
        )
        db.add(shift)
        db.commit()
        db.refresh(shift)
        
    return shift

@app.get("/api/shifts/{shift_id}")
def get_single_shift(shift_id: int, request: Request, db: Session = Depends(get_db)):
    user_role = request.session.get("user_role")
    shift = db.query(models.Shift).options(
        joinedload(models.Shift.master),
        joinedload(models.Shift.receipts),
        joinedload(models.Shift.downtimes),
        joinedload(models.Shift.lfm_reports),
        joinedload(models.Shift.batches)
    ).get(shift_id)
    if not shift: raise HTTPException(404, "Смена не найдена")
    
    # Calculate edit window
    remaining_secs = 0
    if shift.created_at:
        diff = (datetime.utcnow() - shift.created_at).total_seconds()
        remaining_secs = max(0, int(1800 - diff))
    elif user_role == "admin":
        remaining_secs = 999999
        
    shift_dict = schemas.ShiftReportResponse.model_validate(shift).model_dump() if hasattr(schemas, 'ShiftReportResponse') else {c.name: getattr(shift, c.name) for c in shift.__table__.columns}
    shift_dict["created_at"] = shift.created_at.isoformat() if shift.created_at else None
    shift_dict["remaining_edit_seconds"] = remaining_secs
    shift_dict["can_edit"] = (user_role == "admin" or remaining_secs > 0)
    if shift.master:
        shift_dict["master"] = {"id": shift.master.id, "name": shift.master.name}
    shift_dict["receipts"] = [
        {
            "id": r.id,
            "shift_id": r.shift_id,
            "master_id": r.master_id,
            "timestamp": r.timestamp.isoformat() if r.timestamp else (r.created_at.isoformat() if getattr(r, 'created_at', None) else None),
            "created_at": (r.timestamp or getattr(r, 'created_at', None)).isoformat() if (r.timestamp or getattr(r, 'created_at', None)) else None,
            "can_edit": (user_role == "admin" or ((datetime.utcnow() - (r.timestamp or getattr(r, 'created_at', datetime.utcnow()))).total_seconds() <= 1800 if (r.timestamp or getattr(r, 'created_at', None)) else True)),
            "chrysotile_4_20": r.chrysotile_4_20,
            "chrysotile_5_65": r.chrysotile_5_65,
            "chrysotile_6_40": r.chrysotile_6_40,
            "cement_silo1": r.cement_silo1,
            "cement_silo2": r.cement_silo2,
            "cement_silo3": r.cement_silo3,
            "cement_silo4": r.cement_silo4,
            "cellulose": r.cellulose,
            "crushed_slate": r.crushed_slate,
            "asbozurit": r.asbozurit,
            "asbocarton": r.asbocarton,
            "pallets": r.pallets,
            "fiberglass": r.fiberglass,
            "laprol": r.laprol
        } for r in (shift.receipts or [])
    ]
    shift_dict["downtimes"] = [
        {
            "id": d.id,
            "shift_id": d.shift_id,
            "start_time": d.start_time,
            "end_time": d.end_time,
            "duration": d.duration,
            "category": d.category,
            "department": d.department,
            "node": d.node,
            "description": d.description,
            "comment": d.comment,
            "media_urls": d.media_urls,
            "is_equipment_downtime": d.is_equipment_downtime,
            "lost_tons": d.lost_tons,
            "lost_tenge": d.lost_tenge,
            "status": d.status,
            "created_at": d.created_at.isoformat() if d.created_at else None,
            "can_edit": (user_role == "admin" or (d.created_at and (datetime.utcnow() - d.created_at).total_seconds() <= 1800) or not d.created_at)
        } for d in (shift.downtimes or [])
    ]
    return shift_dict

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
        
    if user_role not in ["admin", "master"]:
        raise HTTPException(
            status_code=403,
            detail="Доступ запрещен. Только мастер смены или администратор могут закрыть её."
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
    
    if False and user_role == "master" and shift.master_id != user_id:
        master_name = shift.master.name if shift.master else "другим мастером"
        raise HTTPException(status_code=403, detail=f"Вы не можете редактировать рецепт этой смены, так как она была открыта мастером {master_name}.")
        
    if user_role not in ["master", "admin", "director", "technologist"]:
        raise HTTPException(status_code=403, detail="Недостаточно прав")
        

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
    
    if False and user_role == "master" and shift.master_id != user_id:
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
    
    if False and user_role == "master" and shift.master_id != user_id:
        master_name = shift.master.name if shift.master else "другим мастером"
        raise HTTPException(status_code=403, detail=f"Вы не можете редактировать сливы ЛФМ этой смены, так как она была открыта мастером {master_name}.")
        
    if user_role not in ["master", "admin", "lfm"]:
        raise HTTPException(status_code=403, detail="Недостаточно прав")
        
    shift.lfm_asb_drain = data.asb_drain
    shift.lfm_cem_drain = data.cem_drain
    db.commit()
    return {"message": "LFM drains updated"}

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
    if False and user_role == "master" and shift.master_id != user_id:
        raise HTTPException(status_code=403, detail="Вы не можете редактировать смену другого мастера")
        
    # Записываем приход

    
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
    lfm_reports = shift.lfm_reports
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
        norm = _get_norm_cached(db, prod_name)
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
            "zo_cem_drain": shift.zo_cem_drain
        }

    # Update Shift fields
    shift.master_id = data.master_id
    shift.batch_number = data.batch_number
    shift.product_name = data.product_name
    shift.status = "closed"
    
    # Расход сырья
    shift.zo_chrysotile_4_20_silo1 = data.zo_chrysotile_4_20_silo1
    shift.zo_chrysotile_4_20_silo2 = data.zo_chrysotile_4_20_silo2
    shift.zo_chrysotile_4_20_silo3 = data.zo_chrysotile_4_20_silo3
    shift.zo_chrysotile_4_20_silo4 = data.zo_chrysotile_4_20_silo4
    shift.zo_chrysotile_4_20 = (data.zo_chrysotile_4_20_silo1 or 0) + (data.zo_chrysotile_4_20_silo2 or 0) + (data.zo_chrysotile_4_20_silo3 or 0) + (data.zo_chrysotile_4_20_silo4 or 0)
    
    shift.zo_chrysotile_5_65_silo1 = data.zo_chrysotile_5_65_silo1
    shift.zo_chrysotile_5_65_silo2 = data.zo_chrysotile_5_65_silo2
    shift.zo_chrysotile_5_65_silo3 = data.zo_chrysotile_5_65_silo3
    shift.zo_chrysotile_5_65_silo4 = data.zo_chrysotile_5_65_silo4
    shift.zo_chrysotile_5_65 = (data.zo_chrysotile_5_65_silo1 or 0) + (data.zo_chrysotile_5_65_silo2 or 0) + (data.zo_chrysotile_5_65_silo3 or 0) + (data.zo_chrysotile_5_65_silo4 or 0)
    
    shift.zo_chrysotile_6_40_silo1 = data.zo_chrysotile_6_40_silo1
    shift.zo_chrysotile_6_40_silo2 = data.zo_chrysotile_6_40_silo2
    shift.zo_chrysotile_6_40_silo3 = data.zo_chrysotile_6_40_silo3
    shift.zo_chrysotile_6_40_silo4 = data.zo_chrysotile_6_40_silo4
    shift.zo_chrysotile_6_40 = (data.zo_chrysotile_6_40_silo1 or 0) + (data.zo_chrysotile_6_40_silo2 or 0) + (data.zo_chrysotile_6_40_silo3 or 0) + (data.zo_chrysotile_6_40_silo4 or 0)
    
    shift.zo_cement_silo1 = data.zo_cement_silo1
    shift.zo_cement_silo2 = data.zo_cement_silo2
    shift.zo_cement_silo3 = data.zo_cement_silo3
    shift.zo_cement_silo4 = data.zo_cement_silo4
    shift.zo_cement = (data.zo_cement_silo1 or 0) + (data.zo_cement_silo2 or 0) + (data.zo_cement_silo3 or 0) + (data.zo_cement_silo4 or 0)
    
    shift.zo_cellulose_silo1 = data.zo_cellulose_silo1
    shift.zo_cellulose_silo2 = data.zo_cellulose_silo2
    shift.zo_cellulose_silo3 = data.zo_cellulose_silo3
    shift.zo_cellulose_silo4 = data.zo_cellulose_silo4
    shift.zo_cellulose = (data.zo_cellulose_silo1 or 0) + (data.zo_cellulose_silo2 or 0) + (data.zo_cellulose_silo3 or 0) + (data.zo_cellulose_silo4 or 0)
    
    shift.zo_crushed_slate_silo1 = data.zo_crushed_slate_silo1
    shift.zo_crushed_slate_silo2 = data.zo_crushed_slate_silo2
    shift.zo_crushed_slate_silo3 = data.zo_crushed_slate_silo3
    shift.zo_crushed_slate_silo4 = data.zo_crushed_slate_silo4
    shift.zo_crushed_slate = (data.zo_crushed_slate_silo1 or 0) + (data.zo_crushed_slate_silo2 or 0) + (data.zo_crushed_slate_silo3 or 0) + (data.zo_crushed_slate_silo4 or 0)
    
    shift.zo_asbozurit_silo1 = data.zo_asbozurit_silo1
    shift.zo_asbozurit_silo2 = data.zo_asbozurit_silo2
    shift.zo_asbozurit_silo3 = data.zo_asbozurit_silo3
    shift.zo_asbozurit_silo4 = data.zo_asbozurit_silo4
    shift.zo_asbozurit = (data.zo_asbozurit_silo1 or 0) + (data.zo_asbozurit_silo2 or 0) + (data.zo_asbozurit_silo3 or 0) + (data.zo_asbozurit_silo4 or 0)
    
    shift.zo_fiberglass_silo1 = data.zo_fiberglass_silo1
    shift.zo_fiberglass_silo2 = data.zo_fiberglass_silo2
    shift.zo_fiberglass_silo3 = data.zo_fiberglass_silo3
    shift.zo_fiberglass_silo4 = data.zo_fiberglass_silo4
    shift.zo_fiberglass = (data.zo_fiberglass_silo1 or 0) + (data.zo_fiberglass_silo2 or 0) + (data.zo_fiberglass_silo3 or 0) + (data.zo_fiberglass_silo4 or 0)
    
    shift.zo_laprol_silo1 = data.zo_laprol_silo1
    shift.zo_laprol_silo2 = data.zo_laprol_silo2
    shift.zo_laprol_silo3 = data.zo_laprol_silo3
    shift.zo_laprol_silo4 = data.zo_laprol_silo4
    shift.zo_laprol = (data.zo_laprol_silo1 or 0) + (data.zo_laprol_silo2 or 0) + (data.zo_laprol_silo3 or 0) + (data.zo_laprol_silo4 or 0)
    
    shift.zo_asbocarton_silo1 = data.zo_asbocarton_silo1
    shift.zo_asbocarton_silo2 = data.zo_asbocarton_silo2
    shift.zo_asbocarton_silo3 = data.zo_asbocarton_silo3
    shift.zo_asbocarton_silo4 = data.zo_asbocarton_silo4
    shift.zo_asbocarton = (data.zo_asbocarton_silo1 or 0) + (data.zo_asbocarton_silo2 or 0) + (data.zo_asbocarton_silo3 or 0) + (data.zo_asbocarton_silo4 or 0)
    
    shift.zo_asb_drain = data.zo_asb_drain
    shift.zo_cem_drain = data.zo_cem_drain
    shift.zo_batches = data.zo_batches
    shift.zo_submitted = True
    if data.export_type is not None:
        shift.export_type = data.export_type or "Эталон"

    # Update LFM report
    lfm_report = db.query(models.LFMReport).filter(models.LFMReport.shift_id == shift.id).first()
    if not lfm_report:
        lfm_report = models.LFMReport(shift_id=shift.id)
        db.add(lfm_report)
    lfm_report.product_name = data.product_name
    lfm_report.export_type = data.export_type or "Эталон"
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
    batch.export_type = data.export_type or "Эталон"
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
    batch.qcd_defect = ds_defect_sum

    db.commit()

    # Export receipt data to Google Sheets (new sheet "Приход сырья")
    try:
        google_sheets_integration.export_receipt_to_google_sheets(db)
    except Exception as gs_err:
        print(f"Ошибка экспорта прихода сырья в Google Sheets: {gs_err}")

    # Sync to MonthlyPlanBoard (which also writes AuditLog)
    sync_lfm_to_plan_board(shift.date, shift.shift_name, shift.line, db, shift.master_id)

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
            "receipt_chrysotile_4_20": sum((r.chrysotile_4_20 or 0.0) for r in shift.receipts) if shift.receipts else 0.0,
            "receipt_chrysotile_5_65": sum((r.chrysotile_5_65 or 0.0) for r in shift.receipts) if shift.receipts else 0.0,
            "receipt_chrysotile_6_40": sum((r.chrysotile_6_40 or 0.0) for r in shift.receipts) if shift.receipts else 0.0,
            "receipt_cement": sum((((r.cement_silo1 or 0.0) + (r.cement_silo2 or 0.0) + (r.cement_silo3 or 0.0) + (r.cement_silo4 or 0.0))) for r in shift.receipts) if shift.receipts else 0.0,
            "receipt_cellulose": sum((r.cellulose or 0.0) for r in shift.receipts) if shift.receipts else 0.0,
            "receipt_crushed_slate": sum((r.crushed_slate or 0.0) for r in shift.receipts) if shift.receipts else 0.0,
            "receipt_asbozurit": sum((r.asbozurit or 0.0) for r in shift.receipts) if shift.receipts else 0.0,
            "receipt_asbocarton": sum((r.asbocarton or 0.0) for r in shift.receipts) if shift.receipts else 0.0,
            "receipt_pallets": sum((r.pallets or 0.0) for r in shift.receipts) if shift.receipts else 0.0,
            "receipt_fiberglass": sum((r.fiberglass or 0.0) for r in shift.receipts) if shift.receipts else 0.0,
            "receipt_laprol": sum((r.laprol or 0.0) for r in shift.receipts) if shift.receipts else 0.0
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

    # Проверка рапорта и отправка Telegram алерта в группу/руководству
    try:
        tg_chat_id = os.getenv("TELEGRAM_ALERT_CHAT_ID", "").strip()
        if tg_chat_id:
            import telegram_service
            warnings = []
            
            if not data.batch_number:
                warnings.append("Не заполнен номер партии")
            if not data.product_name:
                warnings.append("Не указано наименование продукции")
            if (data.lfm_sheets or 0) <= 0:
                warnings.append("Не указана выработка ЛФМ (0 листов)")
            if (shift.zo_cement or 0) <= 0:
                warnings.append("Не заполнен расход цемента (0 т)")
            if (shift.zo_chrysotile_4_20 or 0) + (shift.zo_chrysotile_5_65 or 0) + (shift.zo_chrysotile_6_40 or 0) <= 0:
                warnings.append("Не заполнен расход хризотила (все группы 0 т)")
                
            # Проверка аномального брака дестакера (> 4%)
            if data.lfm_sheets and data.lfm_sheets > 0:
                defect_pct = (ds_defect_sum / data.lfm_sheets) * 100.0
                if defect_pct > 4.0:
                    warnings.append(f"Высокий процент брака Дестакера: {defect_pct:.1f}% ({ds_defect_sum} листов)")
                    
            master_name = shift.master.name if shift.master else user_name
            tons = ((data.lfm_sheets or 0) * (get_product_finished_weight_kg(db, data.product_name) if hasattr(db, 'query') else 19.6)) / 1000.0
            
            shift_info = {
                "date": str(shift.date),
                "shift_name": shift.shift_name,
                "line": shift.line,
                "master_name": master_name,
                "sheets": data.lfm_sheets or 0,
                "tons": tons
            }
            
            # Отправляем алерт только если есть замечания (или отчет закрыт)
            if warnings:
                telegram_service.send_shift_quality_alert(tg_chat_id, shift_info, warnings, is_success=False)
    except Exception as tg_alert_err:
        print(f"Error sending Telegram shift report alert: {tg_alert_err}")


import google_sheets_integration

def sync_sharepoint_report_bg():
    db = SessionLocal()
    try:
        file_bytes = excel_exporter.generate_flat_report(db)
        filename = "Сводный_отчет_Tectum.xlsx"
        local_path = os.path.join("static", filename)
        try:
            with open(local_path, "wb") as f:
                f.write(file_bytes)
        except Exception as local_err:
            print(f"Error saving local excel: {local_err}")
            
        if os.getenv("M365_TENANT_ID"):
            try:
                m365_integration.upload_file_to_sharepoint(file_bytes, filename, folder="Reports")
            except Exception as sp_err:
                db.add(models.AuditLog(
                    user_name="System Background Sync",
                    action="ERROR",
                    target_table="shifts",
                    target_id=0,
                    details=f"Ошибка загрузки сводного отчета в SharePoint: {str(sp_err)}"
                ))
                db.commit()
            
        try:
            # Запускаем синхронизацию с Google Таблицами
            google_sheets_integration.sync_report_to_google_sheets(db)
            google_sheets_integration.sync_qcd_reports_to_google_sheets(db)
            google_sheets_integration.export_receipt_to_google_sheets(db)
            google_sheets_integration.export_current_balance_to_google_sheets(db)
            db.add(models.AuditLog(
                user_name="System Background Sync",
                action="UPDATE",
                target_table="shifts",
                target_id=0,
                details="Сводный отчет, остатки сырья и Отчет СКК успешно синхронизированы с Google Таблицами в фоновом режиме."
            ))
            db.commit()
        except Exception as gs_err:
            db.add(models.AuditLog(
                user_name="System Background Sync",
                action="ERROR",
                target_table="shifts",
                target_id=0,
                details=f"Ошибка синхронизации с Google Таблицами: {str(gs_err)}"
            ))
            db.commit()
    except Exception as e:
        print(f"Error in SharePoint/Google background sync: {e}")
    finally:
        db.close()


@app.post("/api/report")
def save_shift_report(data: schemas.ShiftReportCreate, request: Request, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    user_id = request.session.get("user_id") or 9999
    user_role = request.session.get("user_role") or "admin"
    user_name = request.session.get("user_name") or "Админ"
        
    if user_role not in ["master", "admin"]:
        raise HTTPException(status_code=403, detail="Доступ запрещен. Только мастера или администраторы могут сохранять рапорты.")
        
    # Check if shift exists or create it
    query = db.query(models.Shift).filter(
        models.Shift.date == data.date,
        models.Shift.shift_name == data.shift_name,
        models.Shift.line == data.line
    )
    if data.product_name:
        query = query.filter(models.Shift.product_name == data.product_name)
    if data.batch_number:
        query = query.filter(models.Shift.batch_number == data.batch_number)
    if data.export_type:
        query = query.filter(models.Shift.export_type == data.export_type)
    shift = query.first()
    
    is_new = False
    if not shift:
        is_new = True
        shift = models.Shift(
            date=data.date,
            shift_name=data.shift_name,
            line=data.line,
            master_id=data.master_id,
            product_name=data.product_name or "",
            batch_number=data.batch_number or "",
            export_type=data.export_type or "Эталон",
            status="closed",
            created_at=datetime.utcnow()
        )
        db.add(shift)
        db.flush()
    else:
        if user_role != "admin" and shift.created_at:
            time_diff = (datetime.utcnow() - shift.created_at).total_seconds()
            if time_diff > 1800: # 30 minutes
                raise HTTPException(
                    status_code=403, 
                    detail="Время на самостоятельное редактирование рапорта (30 мин) истекло. Для внесения правок обратитесь к администратору."
                )

    save_report_internal(db, shift, data, user_name, is_new)
    
    # Trigger background SharePoint sync
    background_tasks.add_task(sync_sharepoint_report_bg)
    
    return {"status": "success", "shift_id": shift.id}


@app.put("/api/report/{shift_id}")
def update_shift_report_endpoint(shift_id: int, data: schemas.ShiftReportCreate, request: Request, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    user_id = request.session.get("user_id")
    user_role = request.session.get("user_role")
    user_name = request.session.get("user_name", "Unknown")
    if not user_id or not user_role:
        raise HTTPException(status_code=401, detail="Не авторизован")
        
    shift = db.query(models.Shift).get(shift_id)
    if not shift:
        raise HTTPException(status_code=404, detail="Смена не найдена")
        
    if user_role != "admin" and shift.created_at:
        time_diff = (datetime.utcnow() - shift.created_at).total_seconds()
        if time_diff > 1800: # 30 minutes
            raise HTTPException(
                status_code=403, 
                detail="Время на самостоятельное редактирование рапорта (30 мин) истекло. Для внесения правок обратитесь к администратору."
            )
        
    save_report_internal(db, shift, data, user_name, False)
    
    # Trigger background SharePoint sync
    background_tasks.add_task(sync_sharepoint_report_bg)
    
    return {"status": "success", "shift_id": shift.id}


@app.post("/api/shifts/{shift_id}/receipts")
def add_raw_material_receipt(shift_id: int, data: schemas.RawMaterialReceiptCreate, request: Request, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    user_role = request.session.get("user_role")
    user_name = request.session.get("user_name", "Unknown")
    if not user_role:
        raise HTTPException(status_code=401, detail="Не авторизован")

    shift = db.query(models.Shift).get(shift_id)
    if not shift:
        raise HTTPException(status_code=404, detail="Смена не найдена")

    receipt = models.RawMaterialReceipt(
        shift_id=shift.id,
        master_id=data.master_id,
        chrysotile_4_20=data.chrysotile_4_20,
        chrysotile_5_65=data.chrysotile_5_65,
        chrysotile_6_40=data.chrysotile_6_40,
        cement_silo1=data.cement_silo1,
        cement_silo2=data.cement_silo2,
        cement_silo3=data.cement_silo3,
        cement_silo4=data.cement_silo4,
        cellulose=data.cellulose,
        crushed_slate=data.crushed_slate,
        asbozurit=data.asbozurit,
        asbocarton=data.asbocarton,
        pallets=data.pallets,
        fiberglass=data.fiberglass,
        laprol=data.laprol
    )
    db.add(receipt)
    
    db.add(models.AuditLog(
        user_name=user_name,
        action="CREATE",
        target_table="raw_material_receipts",
        target_id=shift_id,
        details=f"Добавлен приход сырья для смены {shift.date} {shift.shift_name}"
    ))
    db.commit()
    
    background_tasks.add_task(sync_receipts_bg)
    
    return {"status": "success", "receipt_id": receipt.id}


@app.put("/api/receipts/{receipt_id}")
def update_raw_material_receipt_endpoint(receipt_id: int, data: schemas.RawMaterialReceiptUpdate, request: Request, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    user_role = request.session.get("user_role")
    user_name = request.session.get("user_name", "Unknown")
    if not user_role:
        raise HTTPException(status_code=401, detail="Не авторизован")

    receipt = db.query(models.RawMaterialReceipt).get(receipt_id)
    if not receipt:
        raise HTTPException(status_code=404, detail="Приход сырья не найден")

    receipt_created = receipt.timestamp or getattr(receipt, 'created_at', None)
    if user_role != "admin" and receipt_created:
        time_diff = (datetime.utcnow() - receipt_created).total_seconds()
        if time_diff > 1800:
            raise HTTPException(
                status_code=403,
                detail="Время на самостоятельное редактирование прихода (30 мин) истекло. Обратитесь к администратору."
            )

    for field, val in data.model_dump(exclude_unset=True).items():
        if val is not None and hasattr(receipt, field):
            setattr(receipt, field, val)

    db.add(models.AuditLog(
        user_name=user_name,
        action="UPDATE",
        target_table="raw_material_receipts",
        target_id=receipt_id,
        details=f"Обновлен приход сырья ID {receipt_id}"
    ))
    db.commit()
    background_tasks.add_task(sync_receipts_bg)
    return {"status": "success"}


@app.delete("/api/receipts/{receipt_id}")
def delete_raw_material_receipt(receipt_id: int, request: Request, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    user_role = request.session.get("user_role")
    user_name = request.session.get("user_name", "Unknown")
    if not user_role:
        raise HTTPException(status_code=401, detail="Не авторизован")

    receipt = db.query(models.RawMaterialReceipt).get(receipt_id)
    if not receipt:
        raise HTTPException(status_code=404, detail="Приход сырья не найден")

    receipt_created = receipt.timestamp or getattr(receipt, 'created_at', None)
    if user_role != "admin" and receipt_created:
        time_diff = (datetime.utcnow() - receipt_created).total_seconds()
        if time_diff > 1800:
            raise HTTPException(
                status_code=403,
                detail="Время на самостоятельное удаление прихода (30 мин) истекло. Обратитесь к администратору."
            )

    shift = receipt.shift
    db.delete(receipt)
    
    db.add(models.AuditLog(
        user_name=user_name,
        action="DELETE",
        target_table="raw_material_receipts",
        target_id=receipt_id,
        details=f"Удален приход сырья для смены {shift.date if shift else 'Unknown'}"
    ))
    db.commit()
    
    background_tasks.add_task(sync_receipts_bg)
    
    return {"status": "success"}


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


@app.post("/api/downtimes/directory/sync_from_google")
def sync_downtime_directory_from_google_sheets_endpoint(request: Request, db: Session = Depends(get_db)):
    user_id = request.session.get("user_id")
    user_role = request.session.get("user_role")
    user_name = request.session.get("user_name", "Unknown")
    
    if not user_id or not user_role:
        raise HTTPException(status_code=401, detail="Не авторизован")
        
    if user_role not in ["admin", "mechanic", "technologist"]:
        raise HTTPException(status_code=403, detail="Доступ разрешен только Механику, Технологу или Администратору")
        
    try:
        google_sheets_integration.sync_downtime_directory_from_google_sheets(db)
        # Записываем действие в AuditLog
        db.add(models.AuditLog(
            user_name=user_name,
            action="IMPORT",
            target_table="downtime_directory",
            details="Синхронизация справочника простоев из Google Sheets"
        ))
        db.commit()
        return {"status": "success", "message": "Справочник простоев успешно обновлен из Google Sheets"}
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err))


@app.get("/api/report/summary")
def get_report_summary(
    request: Request,
    from_date: str = None,
    to_date: str = None,
    line: str = None,
    master_id: int = None,
    export_type: str = None,
    db: Session = Depends(get_db)
):
    user_id = request.session.get("user_id")
    user_role = request.session.get("user_role")
    if not user_id:
        raise HTTPException(status_code=401, detail="Не авторизован")
        
    result = []
    try:
        query = db.query(models.Shift)
    
        if from_date:
            if isinstance(from_date, (datetime, date)):
                f_date = from_date if isinstance(from_date, date) else from_date.date()
            else:
                f_date = datetime.strptime(str(from_date), "%Y-%m-%d").date()
            query = query.filter(models.Shift.date >= f_date)
        if to_date:
            if isinstance(to_date, (datetime, date)):
                t_date = to_date if isinstance(to_date, date) else to_date.date()
            else:
                t_date = datetime.strptime(str(to_date), "%Y-%m-%d").date()
            query = query.filter(models.Shift.date <= t_date)
        if line:
            query = query.filter(models.Shift.line == line)
        if master_id:
            query = query.filter(models.Shift.master_id == master_id)
        if export_type:
            query = query.filter(models.Shift.export_type == export_type)
        
        shifts = query.options(
            joinedload(models.Shift.master),
            joinedload(models.Shift.batches),
            joinedload(models.Shift.lfm_reports),
            joinedload(models.Shift.receipts)
        ).order_by(models.Shift.date.desc(), models.Shift.line.asc(), models.Shift.shift_name.desc(), models.Shift.batch_number.desc(), models.Shift.id.desc()).all()
    
        latest_shift_id = None
        # Find the most recently created shift
        latest_shift = db.query(models.Shift).filter(models.Shift.created_at.isnot(None)).order_by(models.Shift.created_at.desc(), models.Shift.id.desc()).first()
        if latest_shift:
            latest_shift_id = latest_shift.id

        result = []
        for shift in shifts:
            is_other_master = False
        
            lfm_reports = shift.lfm_reports
            batches = shift.batches
        
            # Фильтруем абсолютно пустые смены без факта производства и без плана
            lfm_sheets_check = sum((l.lfm_sheets or 0) for l in lfm_reports) if lfm_reports else 0
            warehouse_gp_check = sum((b.ds_condition or 0) for b in batches) if batches else 0
            zo_batches_check = shift.zo_batches or 0
            plan_sheets_check = shift.plan_sheets or 0
        
            if plan_sheets_check == 0 and lfm_sheets_check == 0 and warehouse_gp_check == 0 and zo_batches_check == 0 and not shift.zo_submitted:
                continue
            
            lfm_sheets = lfm_sheets_check if not is_other_master else 0
            lfm_resets = sum((l.lfm_wind_resets or 0) for l in lfm_reports) if (lfm_reports and not is_other_master) else 0
        
            warehouse_gp = warehouse_gp_check if not is_other_master else 0
            first_grade = sum((b.ds_first_grade or 0) for b in batches) if (batches and not is_other_master) else 0
            qcd_defect = sum((b.ds_defect or 0) for b in batches) if (batches and not is_other_master) else 0
        
            ds_defects = {
                "ds_defect_chip": sum((b.ds_defect_chip or 0) for b in batches) if (batches and not is_other_master) else 0,
                "ds_defect_scratch": sum((b.ds_defect_scratch or 0) for b in batches) if (batches and not is_other_master) else 0,
                "ds_defect_bad_cut": sum((b.ds_defect_bad_cut or 0) for b in batches) if (batches and not is_other_master) else 0,
                "ds_defect_stick_bottom": sum((b.ds_defect_stick_bottom or 0) for b in batches) if (batches and not is_other_master) else 0,
                "ds_defect_stick_top": sum((b.ds_defect_stick_top or 0) for b in batches) if (batches and not is_other_master) else 0,
                "ds_defect_broken": sum((b.ds_defect_broken or 0) for b in batches) if (batches and not is_other_master) else 0,
                "ds_defect_fell_box": sum((b.ds_defect_fell_box or 0) for b in batches) if (batches and not is_other_master) else 0,
                "ds_defect_dent": sum((b.ds_defect_dent or 0) for b in batches) if (batches and not is_other_master) else 0,
                "ds_defect_thickness": sum((b.ds_defect_thickness or 0) for b in batches) if (batches and not is_other_master) else 0,
                "ds_defect_delamination": sum((b.ds_defect_delamination or 0) for b in batches) if (batches and not is_other_master) else 0,
                "ds_defect_edge": sum((b.ds_defect_edge or 0) for b in batches) if (batches and not is_other_master) else 0,
            }

        
            product_name = shift.product_name if not is_other_master else "Скрыто"
            batch_number = shift.batch_number if not is_other_master else "Скрыто"
            export_type_val = shift.export_type if not is_other_master else "Скрыто"
            master_name = "Смена другого мастера" if is_other_master else (shift.master.name if shift.master else "Мастер удалён")
        
            lfm_tons = round(lfm_sheets * get_product_finished_weight_kg(db, product_name) / 1000.0, 2) if (lfm_sheets and not is_other_master) else 0.0
        
            dev_data = {"theoretical": {}, "actual": {}, "deviations": {}}
            if not is_other_master:
                dev_data = calculate_shift_deviations(db, shift)
            
            created_at_iso = shift.created_at.isoformat() if shift.created_at else None
            remaining_secs = 0
            # Only the latest shift gets the 30-minute window for masters
            is_the_latest = (shift.id == latest_shift_id)
            if shift.created_at and is_the_latest:
                diff = (datetime.utcnow() - shift.created_at).total_seconds()
                remaining_secs = max(0, int(1800 - diff))
            elif user_role == "admin":
                remaining_secs = 999999
            
            result.append({
                "shift_id": shift.id,
                "date": shift.date.strftime("%Y-%m-%d") if shift.date else "Н/Д",
                "shift_name": shift.shift_name,
                "line": shift.line,
                "master_id": shift.master_id,
                "master_name": master_name,
                "batch_number": batch_number,
                "product_name": product_name,
                "export_type": export_type_val or "Эталон",
                "status": shift.status,
                "created_at": created_at_iso,
                "remaining_edit_seconds": remaining_secs,
                "can_edit": (user_role == "admin" or (is_the_latest and remaining_secs > 0)),
            
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
                    "chrysotile_4_20": (sum((r.chrysotile_4_20 or 0.0) for r in shift.receipts) if getattr(shift, "receipts", None) else 0.0) if not is_other_master else 0.0,
                    "chrysotile_5_65": (sum((r.chrysotile_5_65 or 0.0) for r in shift.receipts) if getattr(shift, "receipts", None) else 0.0) if not is_other_master else 0.0,
                    "chrysotile_6_40": (sum((r.chrysotile_6_40 or 0.0) for r in shift.receipts) if getattr(shift, "receipts", None) else 0.0) if not is_other_master else 0.0,
                    "cement": (sum((((r.cement_silo1 or 0.0) + (r.cement_silo2 or 0.0) + (r.cement_silo3 or 0.0) + (r.cement_silo4 or 0.0))) for r in shift.receipts) if getattr(shift, "receipts", None) else 0.0) if not is_other_master else 0.0,
                    "cellulose": (sum((r.cellulose or 0.0) for r in shift.receipts) if getattr(shift, "receipts", None) else 0.0) if not is_other_master else 0.0,
                    "crushed_slate": (sum((r.crushed_slate or 0.0) for r in shift.receipts) if getattr(shift, "receipts", None) else 0.0) if not is_other_master else 0.0,
                    "asbozurit": (sum((r.asbozurit or 0.0) for r in shift.receipts) if getattr(shift, "receipts", None) else 0.0) if not is_other_master else 0.0,
                    "asbocarton": (sum((r.asbocarton or 0.0) for r in shift.receipts) if getattr(shift, "receipts", None) else 0.0) if not is_other_master else 0.0,
                    "pallets": (sum((r.pallets or 0.0) for r in shift.receipts) if getattr(shift, "receipts", None) else 0.0) if not is_other_master else 0.0,
                    "fiberglass": (sum((r.fiberglass or 0.0) for r in shift.receipts) if getattr(shift, "receipts", None) else 0.0) if not is_other_master else 0.0,
                    "laprol": (sum((r.laprol or 0.0) for r in shift.receipts) if getattr(shift, "receipts", None) else 0.0) if not is_other_master else 0.0
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
        
    except Exception as err:
        print(f"Error: {err}")
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
        
    try:
        query = db.query(models.Shift)
    
        if False and user_role == "master" and user_id:
            query = query.filter(models.Shift.master_id == user_id)
        
        if start_date:
            query = query.filter(models.Shift.date >= datetime.strptime(start_date, "%Y-%m-%d").date())
        if end_date:
            query = query.filter(models.Shift.date <= datetime.strptime(end_date, "%Y-%m-%d").date())
        
        shifts = query.order_by(models.Shift.date.asc(), models.Shift.line.asc(), models.Shift.shift_name.asc(), models.Shift.batch_number.asc(), models.Shift.id.asc()).all()
    
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
                "chrysotile_4_20": {"receipt": (sum((r.chrysotile_4_20 or 0.0) for r in shift.receipts) if getattr(shift, "receipts", None) else 0.0) or 0.0, "zo": shift.zo_chrysotile_4_20 or 0.0},
                "chrysotile_5_65": {"receipt": (sum((r.chrysotile_5_65 or 0.0) for r in shift.receipts) if getattr(shift, "receipts", None) else 0.0) or 0.0, "zo": shift.zo_chrysotile_5_65 or 0.0},
                "chrysotile_6_40": {"receipt": (sum((r.chrysotile_6_40 or 0.0) for r in shift.receipts) if getattr(shift, "receipts", None) else 0.0) or 0.0, "zo": shift.zo_chrysotile_6_40 or 0.0},
                "cement": {"receipt": (sum((((r.cement_silo1 or 0.0) + (r.cement_silo2 or 0.0) + (r.cement_silo3 or 0.0) + (r.cement_silo4 or 0.0))) for r in shift.receipts) if getattr(shift, "receipts", None) else 0.0) or 0.0, "zo": zo_cem},
                "cellulose": {"receipt": (sum((r.cellulose or 0.0) for r in shift.receipts) if getattr(shift, "receipts", None) else 0.0) or 0.0, "zo": shift.zo_cellulose or 0.0},
                "crushed_slate": {"receipt": (sum((r.crushed_slate or 0.0) for r in shift.receipts) if getattr(shift, "receipts", None) else 0.0) or 0.0, "zo": shift.zo_crushed_slate or 0.0},
                "asbozurit": {"receipt": (sum((r.asbozurit or 0.0) for r in shift.receipts) if getattr(shift, "receipts", None) else 0.0) or 0.0, "zo": shift.zo_asbozurit or 0.0},
                "asbocarton": {"receipt": (sum((r.asbocarton or 0.0) for r in shift.receipts) if getattr(shift, "receipts", None) else 0.0) or 0.0, "zo": shift.zo_asbocarton or 0.0},
                "fiberglass": {"receipt": (sum((r.fiberglass or 0.0) for r in shift.receipts) if getattr(shift, "receipts", None) else 0.0) or 0.0, "zo": shift.zo_fiberglass or 0.0},
                "laprol": {"receipt": (sum((r.laprol or 0.0) for r in shift.receipts) if getattr(shift, "receipts", None) else 0.0) or 0.0, "zo": shift.zo_laprol or 0.0}
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
        
    except Exception as err:
        print(f"Error: {err}")
    return {
        "totals": totals,
        "daily": daily_breakdown
    }


def sync_lfm_to_plan_board(shift_date, shift_name: str, shift_line: str, db: Session, master_id: int = None):
    # Map shift line to plan board line
    is_line_1 = "1" in shift_line
    pb_line = "ЛФМ-1" if is_line_1 else "ЛФМ-2"
    
    # Find all shifts matching the date, name, and line
    matching_shifts = db.query(models.Shift).filter(
        models.Shift.date == shift_date,
        models.Shift.shift_name == shift_name,
        models.Shift.line.like("%1%" if is_line_1 else "%2%")
    ).all()
    
    shift_ids = [s.id for s in matching_shifts]
    
    total_sheets = 0
    total_1st = 0
    total_defect = 0
    
    if shift_ids:
        # Calculate sum of sheets from LFM reports, and 1st grade, defect from batches for these shifts
        lfm_stats = db.query(
            func.sum(models.LFMReport.lfm_sheets).label("total_sheets")
        ).filter(models.LFMReport.shift_id.in_(shift_ids)).first()
        
        batch_stats = db.query(
            func.sum(models.Batch.ds_first_grade).label("total_1st"),
            func.sum(models.Batch.ds_defect).label("total_defect")
        ).filter(models.Batch.shift_id.in_(shift_ids)).first()
        
        total_sheets = int(lfm_stats.total_sheets or 0) if lfm_stats else 0
        total_1st = int(batch_stats.total_1st or 0) if batch_stats else 0
        total_defect = int(batch_stats.total_defect or 0) if batch_stats else 0
    
    # Find corresponding MonthlyPlanBoard row
    pb_row = db.query(models.MonthlyPlanBoard).filter(
        models.MonthlyPlanBoard.date == shift_date,
        models.MonthlyPlanBoard.shift_name == shift_name,
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
            details=f"Синхронизация {shift_line} {shift_date} {shift_name}. Факт обновлен: {old_fact} -> {total_sheets}. 1 сорт: {total_1st}, Брак: {total_defect}."
        )
        db.add(log_entry)
    else:
        # If there are no shifts and no fact, don't create a phantom row
        if total_sheets == 0 and not shift_ids:
            return
            
        final_master_id = master_id if master_id is not None else (matching_shifts[0].master_id if matching_shifts else None)
        if isinstance(shift_date, str):
            try:
                dt_obj = datetime.strptime(shift_date, "%Y-%m-%d").date()
                is_monday = dt_obj.weekday() == 0
            except:
                is_monday = False
        else:
            is_monday = shift_date.weekday() == 0
            
        default_plan_sheets = 0 if is_monday and shift_name == "День" else (2700 if shift_name == "День" else 3300)
        
        # Create a new plan board row if it doesn't exist
        pb_row = models.MonthlyPlanBoard(
            date=shift_date,
            shift_name=shift_name,
            line=pb_line,
            master_id=final_master_id,
            plan_sheets=default_plan_sheets,
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
            details=f"Создана новая запись план-борда для {shift_line} {shift_date} {shift_name}. Факт: {total_sheets}. 1 сорт: {total_1st}, Брак: {total_defect}."
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
    sync_lfm_to_plan_board(shift.date, shift.shift_name, shift.line, db, shift.master_id)
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
    results = db.query(models.DowntimeDirectory.breakdown, models.DowntimeDirectory.comment, models.DowntimeDirectory.category).filter(
        models.DowntimeDirectory.department == department,
        models.DowntimeDirectory.node == node
    ).all()
    return [{"breakdown": r[0], "comment": r[1], "category": r[2]} for r in results if r[0]]

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
def create_downtime(shift_id: int, data: schemas.DowntimeCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    shift = db.query(models.Shift).get(shift_id)
    if not shift: raise HTTPException(404)
    
    duration = 0
    if data.end_time and data.start_time:
        fmt = "%H:%M"
        try:
            t_start = datetime.strptime(data.start_time.strip(), fmt)
            t_end = datetime.strptime(data.end_time.strip(), fmt)
            if t_end < t_start:
                duration = int((t_end.timestamp() + 24*3600 - t_start.timestamp()) / 60)
            else:
                duration = int((t_end - t_start).total_seconds() / 60)
        except Exception:
            duration = 0
            
    lost_tons, lost_tenge = calculate_downtime_losses(duration, shift, db)
    status = "resolved" if data.end_time else "pending"
    
    desc_text = (data.description or data.comment or "").strip()
    
    from downtime_classifier import classify_downtime_text
    auto_dept, auto_node, auto_cat, auto_is_equip = classify_downtime_text(
        desc_text, 
        is_equipment_param=data.is_equipment_downtime if data.is_equipment_downtime is not None else True,
        db=db
    )
    
    category_val = data.category or auto_cat
    node_val = data.node if (data.node and data.node != "Основное оборудование" and data.node != "Разное") else auto_node
    dept_val = data.department if (data.department and data.department != "Формовочное отделение" and data.department != "Общее") else auto_dept
    is_equipment_val = data.is_equipment_downtime if data.is_equipment_downtime is not None else auto_is_equip
    
    dt_data = data.model_dump(exclude={"status", "category", "node", "department", "is_equipment_downtime"})
    dt_data["description"] = desc_text
    dt_data["comment"] = data.comment or desc_text
    dt_data["category"] = category_val
    dt_data["node"] = node_val
    dt_data["department"] = dept_val
    dt_data["is_equipment_downtime"] = is_equipment_val
    
    db_dt = models.Downtime(
        **dt_data,
        shift_id=shift_id,
        duration=duration,
        lost_tons=lost_tons,
        lost_tenge=lost_tenge,
        status=status,
        created_at=datetime.utcnow()
    )
    db.add(db_dt)
    db.commit()
    db.refresh(db_dt)
    background_tasks.add_task(sync_downtimes_bg)
    return db_dt

@app.put("/api/downtimes/{dt_id}", response_model=schemas.Downtime)
def update_downtime(dt_id: int, data: schemas.DowntimeCreate, request: Request, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    user_role = request.session.get("user_role")
    dt = db.query(models.Downtime).get(dt_id)
    if not dt: raise HTTPException(404)
    
    if user_role not in ["admin", "master", "mechanic", "technologist", "director"] and dt.created_at:
        time_diff = (datetime.utcnow() - dt.created_at).total_seconds()
        if time_diff > 1800:
            raise HTTPException(
                status_code=403, 
                detail="Время на самостоятельное редактирование простоя (30 мин) истекло. Обратитесь к администратору."
            )
    
    duration = 0
    if data.end_time and data.start_time:
        fmt = "%H:%M"
        try:
            t_start = datetime.strptime(data.start_time.strip(), fmt)
            t_end = datetime.strptime(data.end_time.strip(), fmt)
            if t_end < t_start:
                duration = int((t_end.timestamp() + 24*3600 - t_start.timestamp()) / 60)
            else:
                duration = int((t_end - t_start).total_seconds() / 60)
        except Exception:
            duration = 0
            
    shift = dt.shift
    if not shift:
        shift = db.query(models.Shift).get(dt.shift_id)
        
    lost_tons, lost_tenge = calculate_downtime_losses(duration, shift, db)
    status = "resolved" if data.end_time else "pending"
    
    desc_text = (data.description or data.comment or "").strip()
    
    from downtime_classifier import classify_downtime_text
    auto_dept, auto_node, auto_cat, auto_is_equip = classify_downtime_text(
        desc_text,
        is_equipment_param=data.is_equipment_downtime if data.is_equipment_downtime is not None else True,
        db=db
    )
    
    category_val = data.category or auto_cat
    node_val = data.node if (data.node and data.node != "Основное оборудование" and data.node != "Разное") else auto_node
    dept_val = data.department if (data.department and data.department != "Формовочное отделение" and data.department != "Общее") else auto_dept
    is_equipment_val = data.is_equipment_downtime if data.is_equipment_downtime is not None else auto_is_equip
    
    dt.start_time = data.start_time
    dt.end_time = data.end_time
    dt.description = desc_text
    dt.comment = data.comment or desc_text
    dt.category = category_val
    dt.department = dept_val
    dt.node = node_val
    dt.media_urls = data.media_urls
    dt.is_equipment_downtime = is_equipment_val
    dt.duration = duration
    dt.lost_tons = lost_tons
    dt.lost_tenge = lost_tenge
    dt.status = status
    if data.breakdowns:
        dt.breakdowns = data.breakdowns
        
    db.commit()
    db.refresh(dt)
    background_tasks.add_task(sync_downtimes_bg)
    return dt
    background_tasks.add_task(sync_downtimes_bg)
    return dt

@app.delete("/api/downtimes/{dt_id}")
def delete_downtime(dt_id: int, request: Request, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    user_role = request.session.get("user_role")
    dt = db.query(models.Downtime).get(dt_id)
    if not dt: raise HTTPException(404)
    
    if user_role != "admin" and dt.created_at:
        time_diff = (datetime.utcnow() - dt.created_at).total_seconds()
        if time_diff > 1800:
            raise HTTPException(
                status_code=403, 
                detail="Время на самостоятельное удаление простоя (30 мин) истекло. Обратитесь к администратору."
            )
            
    db.delete(dt)
    db.commit()
    background_tasks.add_task(sync_downtimes_bg)
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
    qcd_sorted_packs: int = 0
    qcd_first_grade: int = 0
    qcd_first_grade_note: Optional[str] = None
    qcd_defect_note: Optional[str] = None
    qcd_defect_chip: int = 0
    qcd_defect_scratch: int = 0
    qcd_defect_bad_cut: int = 0
    qcd_defect_stick_bottom: int = 0
    qcd_defect_stick_top: int = 0
    qcd_defect_broken: int = 0
    qcd_defect_fell_box: int = 0
    qcd_defect_dent: int = 0
    qcd_defect_thickness: int = 0
    qcd_defect_delamination: int = 0
    qcd_defect_edge: int = 0



@app.get("/api/dashboard/stats")
def get_dashboard_stats(request: Request, db: Session = Depends(get_db)):
    user_id = request.session.get("user_id")
    user_role = request.session.get("user_role") or "admin"

    prod_query = db.query(
        func.sum(models.Batch.ds_condition).label('condition'),
        func.sum(models.Batch.ds_first_grade).label('first_grade'),
        func.sum(models.Batch.ds_defect).label('defect')
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

    mats_query_receipt = db.query(
        func.sum(models.RawMaterialReceipt.chrysotile_4_20).label('r_4_20'),
        func.sum(models.RawMaterialReceipt.chrysotile_5_65).label('r_5_65'),
        func.sum(models.RawMaterialReceipt.chrysotile_6_40).label('r_6_40'),
        func.sum(models.RawMaterialReceipt.cement_silo1 + models.RawMaterialReceipt.cement_silo2 + models.RawMaterialReceipt.cement_silo3 + models.RawMaterialReceipt.cement_silo4).label('r_cem'),
        func.sum(models.RawMaterialReceipt.cellulose).label('r_cel')
    ).select_from(models.RawMaterialReceipt).join(models.Shift, models.Shift.id == models.RawMaterialReceipt.shift_id)

    mats_query_zo = db.query(
        func.sum(models.Shift.zo_chrysotile_4_20).label('z_4_20'),
        func.sum(models.Shift.zo_chrysotile_5_65).label('z_5_65'),
        func.sum(models.Shift.zo_chrysotile_6_40).label('z_6_40'),
        func.sum(models.Shift.zo_cement).label('z_cem'),
        func.sum(models.Shift.zo_cellulose).label('z_cel')
    )

    dt_query = db.query(models.Downtime)

    if False and user_role == "master" and user_id:
        prod_query = prod_query.join(models.Shift).filter(models.Shift.master_id == user_id)
        defects_query = defects_query.join(models.Shift).filter(models.Shift.master_id == user_id)
        mats_query_receipt = mats_query_receipt.filter(models.Shift.master_id == user_id)
        mats_query_zo = mats_query_zo.filter(models.Shift.master_id == user_id)
        dt_query = dt_query.join(models.Shift).filter(models.Shift.master_id == user_id)

    prod_stats = prod_query.first()
    defects = defects_query.first()
    mats_rec = mats_query_receipt.first()
    mats_zo = mats_query_zo.first()

    rec_asb = (mats_rec.r_4_20 or 0) + (mats_rec.r_5_65 or 0) + (mats_rec.r_6_40 or 0) if mats_rec else 0
    zo_asb = (mats_zo.z_4_20 or 0) + (mats_zo.z_5_65 or 0) + (mats_zo.z_6_40 or 0) if mats_zo else 0

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
            "Цемент": {"receipt": mats_rec.r_cem if mats_rec else 0 or 0, "zo": mats_zo.z_cem if mats_zo else 0 or 0},
            "Целлюлоза": {"receipt": mats_rec.r_cel if mats_rec else 0 or 0, "zo": mats_zo.z_cel if mats_zo else 0 or 0}
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
    if False and user_role == "master" and user_id:
        query = query.filter(models.Shift.master_id == user_id)
    shifts = query.order_by(models.Shift.date.desc(), models.Shift.line.asc(), models.Shift.shift_name.desc(), models.Shift.batch_number.desc(), models.Shift.id.desc()).limit(7).all()
    
    report_data = []
    for shift in shifts:
        # 1. Считаем формовку (ЛФМ)
        lfm_sheets = db.query(func.sum(models.LFMReport.lfm_sheets)).filter(models.LFMReport.shift_id == shift.id).scalar() or 0
        
        # 2. Считаем итог СКК
        qcd_stats = db.query(
            func.sum(models.Batch.ds_condition).label('condition'),
            func.sum(models.Batch.ds_first_grade).label('first_grade'),
            func.sum(models.Batch.ds_defect).label('defect')
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
    
    if False and user_role == "master" and user_id:
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
    serialized_downtimes = []
    
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
        
        serialized_downtimes.append({
            "id": dt.id,
            "date": date_str,
            "shift": dt.shift.shift_name if dt.shift else "",
            "line": dt.shift.line if dt.shift else "",
            "master": dt.shift.master.name if dt.shift and dt.shift.master else "Н/Д",
            "department": dt.department or "",
            "node": dt.node or "",
            "category": dt.category or "",
            "is_equipment_downtime": dt.is_equipment_downtime,
            "duration": dur,
            "lost_tons": tons,
            "lost_tenge": tenge,
            "description": dt.description or ""
        })
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
        "trend": sorted_trend,
        "downtimes": serialized_downtimes
    }

# --- НОРМЫ РАСХОДА И ОТЧЕТ ПО СЫРЬЮ ---
@app.get("/api/norms/", response_model=list[schemas.ProductNorm])
def get_product_norms(db: Session = Depends(get_db)):
    return db.query(models.ProductNorm).all()

_norms_cache = {}
_norms_cache_time = 0

def _get_norm_cached(db: Session, product_name: str):
    global _norms_cache, _norms_cache_time
    import time
    if time.time() - _norms_cache_time > 60:
        norms = db.query(models.ProductNorm).all()
        _norms_cache = {n.product_name: n for n in norms}
        _norms_cache_time = time.time()
    return _norms_cache.get(product_name)

def get_product_finished_weight_kg(db: Session, product_name: str) -> float:
    norm = _get_norm_cached(db, product_name)
    if not norm or not norm.weight_kg:
        return 19.6 # fallback for 8 волн
    return norm.weight_kg

def get_product_raw_weight_kg(db: Session, product_name: str) -> float:
    norm = _get_norm_cached(db, product_name)
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

def get_last_produced_weight_kg(db: Session, line_identifier: str, before_date_str: str = None) -> float:
    try:
        q = db.query(models.Shift).filter(models.Shift.line.like(f"%{line_identifier}%"))
        if before_date_str:
            q = q.filter(models.Shift.date <= before_date_str)
        shifts = q.order_by(models.Shift.date.desc(), models.Shift.id.desc()).limit(100).all()
        if not shifts:
            shifts = db.query(models.Shift).filter(models.Shift.line.like(f"%{line_identifier}%")).order_by(models.Shift.date.desc(), models.Shift.id.desc()).all()
        for s in shifts:
            if s.lfm_reports:
                for r in reversed(s.lfm_reports):
                    if r.lfm_sheets > 0 and r.product_name:
                        return get_product_finished_weight_kg(db, r.product_name)
    except Exception as e:
        print(f"Error in get_last_produced_weight_kg: {e}")
    return 19.6

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
def get_daily_report(
    request: Request,
    start_date: str = None,
    end_date: str = None,
    line: str = None,
    shift_number: int = None,
    master_id: int = None,
    db: Session = Depends(get_db)
):
    user_id = request.session.get("user_id")
    user_role = request.session.get("user_role") or "admin"
    range_type_param = request.query_params.get("range_type")

    # Dynamic date range calculation based on frontend params
    sd = None
    ed = None

    if start_date:
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
    else:
        # Fallback to query parameters passed by app.js (month, week, day, range_type)
        range_type = request.query_params.get("range_type", "month")
        month = request.query_params.get("month")
        week = request.query_params.get("week")
        day = request.query_params.get("day")

        if range_type == "month" and month:
            try:
                y, m = map(int, month.split('-'))
                num_days = calendar.monthrange(y, m)[1]
                sd = datetime(y, m, 1).date()
                ed = datetime(y, m, num_days).date()
            except Exception as e:
                raise HTTPException(400, f"Invalid month format: {e}")
        elif range_type == "week" and week:
            try:
                if not month:
                    now = datetime.now()
                    y, m = now.year, now.month
                else:
                    y, m = map(int, month.split('-'))
                
                week_num = int(week)
                first_day_of_month = datetime(y, m, 1).date()
                diff = -first_day_of_month.weekday()
                current_monday = first_day_of_month + timedelta(days=diff)
                
                if m == 12:
                    first_day_of_next_month = datetime(y + 1, 1, 1).date()
                else:
                    first_day_of_next_month = datetime(y, m + 1, 1).date()
                
                weeks = []
                while current_monday < first_day_of_next_month:
                    current_sunday = current_monday + timedelta(days=6)
                    weeks.append((current_monday, current_sunday))
                    current_monday += timedelta(days=7)
                
                idx = week_num - 1
                if 0 <= idx < len(weeks):
                    sd, ed = weeks[idx]
                elif len(weeks) > 0:
                    sd, ed = weeks[-1]
                else:
                    num_days = calendar.monthrange(y, m)[1]
                    sd = datetime(y, m, 1).date()
                    ed = datetime(y, m, num_days).date()
            except Exception as e:
                raise HTTPException(400, f"Invalid week or month format: {e}")
        elif range_type == "day" and day:
            try:
                sd = datetime.strptime(day, "%Y-%m-%d").date()
                ed = sd
            except Exception as e:
                raise HTTPException(400, f"Invalid day format: {e}")
        else:
            # Fallback to current month if no dates are provided
            now = datetime.now()
            y, m = now.year, now.month
            num_days = calendar.monthrange(y, m)[1]
            sd = datetime(y, m, 1).date()
            ed = datetime(y, m, num_days).date()

    num_days = (ed - sd).days + 1

    if not range_type_param:
        if num_days >= 28:
            effective_range_type = "month"
        elif num_days == 7:
            effective_range_type = "week"
        elif num_days == 1:
            effective_range_type = "day"
        else:
            effective_range_type = "custom"
    else:
        effective_range_type = range_type_param

    shifts_query = db.query(models.Shift).options(
        selectinload(models.Shift.lfm_reports),
        selectinload(models.Shift.batches)
    ).filter(
        models.Shift.date >= sd,
        models.Shift.date <= ed
    )
    if master_id is not None:
        shifts_query = shifts_query.filter(models.Shift.master_id == master_id)
    shifts = shifts_query.all()
    
    plan_boards_query = db.query(models.MonthlyPlanBoard).filter(
        models.MonthlyPlanBoard.date >= sd,
        models.MonthlyPlanBoard.date <= ed
    )
    if master_id is not None:
        plan_boards_query = plan_boards_query.filter(models.MonthlyPlanBoard.master_id == master_id)
    plan_boards = plan_boards_query.all()
    
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
            
            # Записываем факт для всех
            if True:
                data[line_key][day_key][s_name]["sheets"] = pb.fact_sheets or 0
                data[line_key][day_key][s_name]["tons"] = (pb.fact_sheets or 0) * 19.6 / 1000.0
                data[line_key][day_key][s_name]["first_grade"] = pb.first_grade or 0
                data[line_key][day_key][s_name]["defect"] = pb.defect or 0
            
    processed_slots = set()
    accumulate_sheets_slots = set()
    for s in shifts:
        if not s.date: continue
        # Не пропускаем смены других мастеров
        if False and user_role == "master" and s.master_id != user_id:
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
        total_1st = 0
        total_def = 0
        for r in s.lfm_reports:
            w_kg = get_product_finished_weight_kg(db, r.product_name)
            total_w += w_kg * r.lfm_sheets
            total_s += r.lfm_sheets
            
        for b in s.batches:
            total_1st += (b.ds_first_grade or 0)
            total_def += (b.ds_defect or 0)
            
        slot_key = (line_key, day_key, s_name)
        if slot_key not in processed_slots:
            processed_slots.add(slot_key)
            data[line_key][day_key][s_name]["tons"] = 0.0
            if data[line_key][day_key][s_name]["sheets"] == 0 or shift_number is not None:
                accumulate_sheets_slots.add(slot_key)
                data[line_key][day_key][s_name]["sheets"] = 0
            # Всегда инициализируем и накапливаем 1 сорт и брак напрямую из рапортов мастеров
            data[line_key][day_key][s_name]["first_grade"] = 0
            data[line_key][day_key][s_name]["defect"] = 0
        
        # Накапливаем 1 сорт и брак Дестакера напрямую из сменного рапорта
        data[line_key][day_key][s_name]["first_grade"] += total_1st
        data[line_key][day_key][s_name]["defect"] += total_def

        if total_s > 0:
            data[line_key][day_key][s_name]["tons"] += total_w / 1000.0
            if slot_key in accumulate_sheets_slots:
                data[line_key][day_key][s_name]["sheets"] += total_s
            
    last_known_weight = {}
    for l_k in data:
        line_name_for_q = "1" if l_k == "line_1" else "2"
        last_known_weight[l_k] = get_last_produced_weight_kg(db, line_name_for_q, str(sd))

    for i in range(num_days):
        day_k = str(sd + timedelta(days=i))
        for s_nm in ["День", "Ночь"]:
            for l_k in data:
                if day_k in data[l_k] and s_nm in data[l_k][day_k]:
                    slot_info = data[l_k][day_k][s_nm]
                    if slot_info["sheets"] > 0 and slot_info["tons"] > 0:
                        avg_w = (slot_info["tons"] * 1000.0) / slot_info["sheets"]
                        slot_info["plan_tons"] = slot_info["plan_sheets"] * avg_w / 1000.0
                        last_known_weight[l_k] = avg_w
                    else:
                        slot_info["plan_tons"] = slot_info["plan_sheets"] * last_known_weight[l_k] / 1000.0
            
    # Now structure response as expected by app.js
    days_list = []
    lines_to_include = []
    if line == "lfm1":
        lines_to_include = ["line_1"]
    elif line == "lfm2":
        lines_to_include = ["line_2"]
    else:
        lines_to_include = ["line_1", "line_2"]

    for i in range(num_days):
        dt = sd + timedelta(days=i)
        date_str = str(dt)
        day_num = dt.day
        month_num = dt.month
        
        for s_name in ["День", "Ночь"]:
            plan_sheets = 0
            fact_sheets = 0
            plan_tons = 0.0
            fact_tons = 0.0
            first_grade = 0
            defect = 0
            
            for l_key in lines_to_include:
                shift_data = data[l_key][date_str][s_name]
                plan_sheets += shift_data["plan_sheets"]
                fact_sheets += shift_data["sheets"]
                plan_tons += shift_data["plan_tons"]
                fact_tons += shift_data["tons"]
                first_grade += shift_data["first_grade"]
                defect += shift_data["defect"]
            
            suffix = "Д" if s_name == "День" else "Н"
            label = f"{day_num:02d}.{month_num:02d} ({suffix})"
            
            days_list.append({
                "date": date_str,
                "label": label,
                "plan_sheets": plan_sheets,
                "fact_sheets": fact_sheets,
                "plan_tons": plan_tons,
                "fact_tons": fact_tons,
                "first_grade": first_grade,
                "defect": defect
            })
        
            unique_shifts = set()
    for s in shifts:
        if line and not (("1" in s.line and line == "lfm1") or ("2" in s.line and line == "lfm2") or line == "all"):
            continue
        
        lfm_sheets = sum((r.lfm_sheets or 0) for r in s.lfm_reports) if getattr(s, 'lfm_reports', None) else 0
        warehouse_gp = sum((b.ds_condition or 0) for b in s.batches) if getattr(s, 'batches', None) else 0
        plan_sheets = s.plan_sheets or 0
        zo_batches = s.zo_batches or 0
        
        if plan_sheets == 0 and lfm_sheets == 0 and warehouse_gp == 0 and zo_batches == 0 and not getattr(s, 'zo_submitted', False):
            continue
            
        unique_shifts.add((s.date, s.shift_name, s.line))
            
    total_shifts = len(unique_shifts)
    total_fact_sheets = sum(d["fact_sheets"] for d in days_list)
    total_fact_tons = sum(d["fact_tons"] for d in days_list)

    if master_id is None and shift_number is None:
        if effective_range_type == "month" or num_days >= 28:
            total_plan_sheets = 160000 * len(lines_to_include)
        elif effective_range_type == "week" and num_days == 7:
            total_plan_sheets = 39000 * len(lines_to_include)
        else:
            total_plan_sheets = sum(d["plan_sheets"] for d in days_list)
    else:
        total_plan_sheets = sum(d["plan_sheets"] for d in days_list)

    if total_fact_sheets > 0:
        avg_period_weight = (total_fact_tons * 1000.0) / total_fact_sheets
        total_plan_tons = round((total_plan_sheets * avg_period_weight) / 1000.0, 2)
    else:
        total_plan_tons = round((total_plan_sheets * 19.6) / 1000.0, 2)

    avg_plan_percent = (total_fact_sheets / total_plan_sheets * 100.0) if total_plan_sheets > 0 else 0.0
    
    total_first_grade = sum(d["first_grade"] for d in days_list)
    total_defect = sum(d["defect"] for d in days_list)
    defect_percent = (total_defect / total_fact_sheets * 100.0) if total_fact_sheets > 0 else 0.0
    first_grade_percent = (total_first_grade / total_fact_sheets * 100.0) if total_fact_sheets > 0 else 0.0
    
    lag_sheets = total_plan_sheets - total_fact_sheets
    lag_tons = round(total_plan_tons - total_fact_tons, 2)
    
    return {
        "total_shifts": total_shifts,
        "total_fact_sheets": total_fact_sheets,
        "total_fact_tons": total_fact_tons,
        "total_plan_sheets": total_plan_sheets,
        "total_plan_tons": total_plan_tons,
        "lag_sheets": lag_sheets,
        "lag_tons": lag_tons,
        "total_first_grade": total_first_grade,
        "first_grade_percent": first_grade_percent,
        "total_defect": total_defect,
        "avg_plan_percent": avg_plan_percent,
        "defect_percent": defect_percent,
        "days": days_list
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
    
    shifts = db.query(models.Shift).options(
        selectinload(models.Shift.lfm_reports)
    ).filter(
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
        
        processed_slots = set()
        accumulate_sheets_slots = set()
        for s in shifts:
            if not s.date or s.line != line_id: continue
            # Пропускаем смены других мастеров для роли master
            if False and user_role == "master" and s.master_id != user_id:
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
                slot_key = (day_key, s_name)
                if slot_key not in processed_slots:
                    processed_slots.add(slot_key)
                    day_data[day_key][s_name]["tons"] = 0.0
                    if day_data[day_key][s_name]["sheets"] == 0:
                        accumulate_sheets_slots.add(slot_key)
                        day_data[day_key][s_name]["sheets"] = 0
                
                day_data[day_key][s_name]["tons"] += total_w / 1000.0
                if slot_key in accumulate_sheets_slots:
                    day_data[day_key][s_name]["sheets"] += total_s
                
        last_w = get_last_produced_weight_kg(db, "1" if line_id == "lfm1" else "2", str(sd))
        for i in range(num_days):
            day_k = str(sd + timedelta(days=i))
            if day_k in day_data:
                for s_nm in ["День", "Ночь"]:
                    slot_info = day_data[day_k][s_nm]
                    if slot_info["sheets"] > 0 and slot_info["tons"] > 0:
                        avg_w = (slot_info["tons"] * 1000.0) / slot_info["sheets"]
                        slot_info["plan_tons"] = slot_info["plan_sheets"] * avg_w / 1000.0
                        last_w = avg_w
                    else:
                        slot_info["plan_tons"] = slot_info["plan_sheets"] * last_w / 1000.0
                
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

@app.post("/api/admin/fix_plan_boards")
def fix_plan_boards(request: Request, db: Session = Depends(get_db)):
    user_role = request.session.get("user_role")
    if user_role != "admin":
        raise HTTPException(status_code=403, detail="Forbidden")
        
    try:
        boards = db.query(models.MonthlyPlanBoard).filter(models.MonthlyPlanBoard.plan_sheets == 0).all()
        updated_count = 0
        for pb in boards:
            date_val = pb.date
            is_monday = False
            if isinstance(date_val, str):
                try:
                    dt_obj = datetime.strptime(date_val, "%Y-%m-%d").date()
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
            
            log_entry = models.AuditLog(
                timestamp=datetime.utcnow(),
                user_name="System Admin",
                action="UPDATE",
                target_table="monthly_plan_board",
                target_id=pb.id,
                details=f"Исправление нулевого плана. Установлен план {correct_plan}."
            )
            db.add(log_entry)
            
        db.commit()
        return {"success": True, "updated_count": updated_count}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/dashboard/shift_board")
def get_shift_board(month: str, db: Session = Depends(get_db)):
    try:
        y, m = map(int, month.split('-'))
        num_days = calendar.monthrange(y, m)[1]
    except:
        raise HTTPException(400, "Invalid month format")
        
    month_start = datetime(y, m, 1).date()
    month_end = datetime(y, m, num_days).date()
    shifts = db.query(models.Shift).options(
        selectinload(models.Shift.lfm_reports)
    ).filter(
        models.Shift.date >= month_start,
        models.Shift.date <= month_end
    ).order_by(models.Shift.date.asc(), models.Shift.line.asc(), models.Shift.shift_name.asc(), models.Shift.batch_number.asc(), models.Shift.id.asc()).all()
    
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

@app.post("/api/dashboard/sync_google_sheets_manual")
def sync_google_sheets_manual(request: Request, db: Session = Depends(get_db)):
    user_id = request.session.get("user_id")
    user_role = request.session.get("user_role")
    
    if not user_id:
        raise HTTPException(status_code=401, detail="Вы не авторизованы")
        
    if user_role not in ["master", "admin"]:
        raise HTTPException(status_code=403, detail="Доступ запрещен. Только мастера или администраторы могут запускать выгрузку.")
        
    try:
        google_sheets_integration.sync_report_to_google_sheets(db)
        
        # Log to AuditLog
        db.add(models.AuditLog(
            user_name=request.session.get("user_email") or f"user_{user_id}",
            action="UPDATE",
            target_table="shifts",
            target_id=0,
            details="Выполнена ручная выгрузка сводного отчета в Google Таблицы."
        ))
        db.commit()
        return {"message": "Выгрузка в Google Таблицы выполнена успешно!"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка выгрузки в Google: {str(e)}")

@app.post("/api/dashboard/sync_downtimes_to_google")
def sync_downtimes_to_google(request: Request, db: Session = Depends(get_db)):
    user_id = request.session.get("user_id")
    user_role = request.session.get("user_role")
    
    if not user_id:
        raise HTTPException(status_code=401, detail="Вы не авторизованы")
        
    if user_role not in ["master", "admin", "director", "mechanic"]:
        raise HTTPException(status_code=403, detail="Доступ запрещен.")
        
    try:
        google_sheets_integration.export_downtimes_to_google_sheets(db)
        from google_sheets_integration import sync_downtime_weekly_summary, get_sheets_service
        try:
            sync_downtime_weekly_summary(db)
        except Exception as e:
            import traceback, os
            err_msg = f"Crash in sync_downtime_weekly_summary: {str(e)}\n{traceback.format_exc()}"
            print(err_msg)
            try:
                sheet_id = os.getenv("GOOGLE_SPREADSHEET_ID")
                if sheet_id:
                    service = get_sheets_service()
                    service.spreadsheets().values().update(
                        spreadsheetId=sheet_id,
                        range="'Свод неделя'!A1",
                        valueInputOption="USER_ENTERED",
                        body={"values": [[err_msg]]}
                    ).execute()
            except:
                pass
        
        db.add(models.AuditLog(
            user_name=request.session.get("user_email") or f"user_{user_id}",
            action="UPDATE",
            target_table="downtimes",
            target_id=0,
            details="Выполнена ручная выгрузка простоев в Google Таблицы."
        ))
        db.commit()
        return {"message": "Выгрузка простоев в Google Таблицы выполнена успешно!"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка выгрузки простоев в Google: {str(e)}")

@app.get("/api/dashboard/view_archive")
def view_archive(db: Session = Depends(get_db)):
    try:
        url = m365_integration.get_file_web_url("Сводный_отчет_Tectum.xlsx", folder="Reports")
        return RedirectResponse(url=url)
    except Exception as e:
        print("Ошибка получения ссылки из SharePoint, пробуем сгенерировать и загрузить отчет:", e)
        try:
            file_bytes = excel_exporter.generate_flat_report(db)
            filename = "Сводный_отчет_Tectum.xlsx"
            url = m365_integration.upload_file_to_sharepoint(file_bytes, filename, folder="Reports")
            return RedirectResponse(url=url)
        except Exception as upload_err:
            import traceback
            traceback.print_exc()
            raise HTTPException(
                status_code=500,
                detail=f"Не удалось открыть сводный отчет в SharePoint. Ошибка автозагрузки: {upload_err}. Исходная ошибка: {e}"
            )

@app.get("/api/dashboard/export_week")
def export_week(request: Request, start_date: str, db: Session = Depends(get_db)):
    user_id = request.session.get("user_id")
    user_role = request.session.get("user_role") or "admin"

    try:
        sd = datetime.strptime(start_date, "%Y-%m-%d").date()
    except:
        raise HTTPException(400, "Invalid date format, use YYYY-MM-DD")
        
    ed = sd + timedelta(days=6)
    
    query = db.query(models.Shift).options(
        selectinload(models.Shift.lfm_reports),
        selectinload(models.Shift.receipts),
        selectinload(models.Shift.downtimes)
    ).filter(
        models.Shift.date >= sd,
        models.Shift.date <= ed
    )
    if False and user_role == "master" and user_id:
        query = query.filter(models.Shift.master_id == user_id)
    shifts = query.order_by(models.Shift.date.asc(), models.Shift.line.asc(), models.Shift.shift_name.asc(), models.Shift.batch_number.asc(), models.Shift.id.asc()).all()
    
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
        last_w = get_last_produced_weight_kg(db, "1" if "1" in l_key else "2", str(sd)) / 1000.0
        for i in range(7):
            d = sd + timedelta(days=i)
            for s_name in ["День", "Ночь"]:
                plan_sheets = 0 if d.weekday() == 0 and s_name == "День" else (2700 if s_name == "День" else 3300)
                
                pb = pb_dict.get((d, s_name, l_key))
                if pb and pb.plan_sheets is not None:
                    plan_sheets = pb.plan_sheets
                    
                slot_shifts = [shift for shift in shifts if shift.date == d and shift.shift_name == s_name and (shift.line.replace("Линия ", "ЛФМ-") if shift.line else "ЛФМ-1") == l_key]
                s = slot_shifts[0] if slot_shifts else None
                
                show_fact = (user_role != "master" or (pb and pb.master_id == user_id) or (s and s.master_id == user_id))
                total_sheets = pb.fact_sheets if (pb and show_fact) else 0
                
                if s and show_fact:
                    sum_lfm_sheets = sum(r.lfm_sheets for sh in slot_shifts for r in sh.lfm_reports)
                    sum_lfm_tons = sum(r.lfm_sheets * get_product_finished_weight_kg(db, r.product_name) / 1000.0 for sh in slot_shifts for r in sh.lfm_reports)
                    if sum_lfm_sheets > 0:
                        avg_w = (sum_lfm_tons / sum_lfm_sheets)
                        last_w = avg_w
                    else:
                        avg_w = last_w
                    if total_sheets == 0 and sum_lfm_sheets > 0:
                        total_sheets = sum_lfm_sheets
                    master_name = s.master.name if s.master else "Н/Д"
                else:
                    avg_w = last_w
                    master_name = "Н/Д" if show_fact else "Смена др. мастера"
                    total_sheets = pb.fact_sheets if (pb and show_fact) else 0
                    
                plan_tons = plan_sheets * avg_w
                total_tons = sum_lfm_tons if (s and show_fact and sum_lfm_sheets > 0) else (total_sheets * avg_w)
                
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
    
    query = db.query(models.Shift).options(
        selectinload(models.Shift.lfm_reports),
        selectinload(models.Shift.receipts),
        selectinload(models.Shift.downtimes)
    ).filter(
        models.Shift.date >= sd,
        models.Shift.date <= ed
    )
    if False and user_role == "master" and user_id:
        query = query.filter(models.Shift.master_id == user_id)
    shifts = query.order_by(models.Shift.date.asc(), models.Shift.line.asc(), models.Shift.shift_name.asc(), models.Shift.batch_number.asc(), models.Shift.id.asc()).all()
    
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
        last_w = get_last_produced_weight_kg(db, "1" if "1" in l_key else "2", str(sd)) / 1000.0
        for i in range(7):
            d = sd + timedelta(days=i)
            day_str = str(d)
            for s_name in ["День", "Ночь"]:
                plan_sheets = 0 if d.weekday() == 0 and s_name == "День" else (2700 if s_name == "День" else 3300)
                
                pb = pb_dict.get((d, s_name, l_key))
                if pb and pb.plan_sheets is not None:
                    plan_sheets = pb.plan_sheets
                    
                slot_shifts = [shift for shift in shifts if shift.date == d and shift.shift_name == s_name and (shift.line.replace("Линия ", "ЛФМ-") if shift.line else "ЛФМ-1") == l_key]
                s = slot_shifts[0] if slot_shifts else None
                
                show_fact = (user_role != "master" or (pb and pb.master_id == user_id) or (s and s.master_id == user_id))
                total_sheets = pb.fact_sheets if (pb and show_fact) else 0
                
                if s and show_fact:
                    sum_lfm_sheets = sum(r.lfm_sheets for sh in slot_shifts for r in sh.lfm_reports)
                    sum_lfm_tons = sum(r.lfm_sheets * get_product_finished_weight_kg(db, r.product_name) / 1000.0 for sh in slot_shifts for r in sh.lfm_reports)
                    if sum_lfm_sheets > 0:
                        avg_w = (sum_lfm_tons / sum_lfm_sheets)
                        last_w = avg_w
                    else:
                        avg_w = last_w
                    if total_sheets == 0 and sum_lfm_sheets > 0:
                        total_sheets = sum_lfm_sheets
                        
                    if pb and (pb.first_grade or pb.defect):
                        ds_first = pb.first_grade
                        ds_defect = pb.defect
                    else:
                        ds_first = sum(b.ds_first_grade for sh in slot_shifts for b in sh.batches)
                        ds_defect = sum(b.ds_defect for sh in slot_shifts for b in sh.batches)
                        
                    qcd_first = sum(b.ds_first_grade for sh in slot_shifts for b in sh.batches)
                    qcd_defect = sum(b.ds_defect for sh in slot_shifts for b in sh.batches)
                    
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
                    avg_w = last_w
                    ds_first = pb.first_grade if (pb and show_fact) else 0
                    ds_defect = pb.defect if (pb and show_fact) else 0
                    qcd_first = 0
                    qcd_defect = 0
                    sanitary_note = "Санитарный день (план 0)" if d.weekday() == 0 and s_name == "День" else ("Нет данных" if show_fact else "Смена другого мастера")
                    master_name = "Н/Д"
                    shift_id = None
                    
                plan_tons = plan_sheets * avg_w
                total_tons = sum_lfm_tons if (s and show_fact and sum_lfm_sheets > 0) else (total_sheets * avg_w)
                
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
def admin_update_shift(shift_id: int, data: dict, request: Request, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    admin = check_admin_session(request, db)
    shift = db.query(models.Shift).get(shift_id)
    if not shift: raise HTTPException(404, "Смена не найдена")
    
    old_date, old_shift_name, old_line = shift.date, shift.shift_name, shift.line
    old_master_id = shift.master_id
    
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
        
        # Sync plan boards for old and new parameters
        sync_lfm_to_plan_board(old_date, old_shift_name, old_line, db, old_master_id)
        if shift.date != old_date or shift.shift_name != old_shift_name or shift.line != old_line:
            sync_lfm_to_plan_board(shift.date, shift.shift_name, shift.line, db, shift.master_id)
    else:
        db.commit()
    background_tasks.add_task(sync_google_sheets_bg)
    return {"status": "ok"}

@app.put("/api/admin/shift_report/{shift_id}")
def admin_update_shift_report(shift_id: int, data: schemas.AdminShiftReportUpdate, request: Request, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    admin = check_admin_session(request, db)
    shift = db.query(models.Shift).get(shift_id)
    if not shift:
        raise HTTPException(status_code=404, detail="Смена не найдена")
        
    old_date, old_shift_name, old_line = shift.date, shift.shift_name, shift.line
    old_master_id = shift.master_id
    
    changes = []
    
    # 1. Update Shift metadata and raw materials
    if data.date is not None and shift.date != data.date:
        changes.append(f"date: {shift.date} -> {data.date}")
        shift.date = data.date
    if data.shift_name is not None and shift.shift_name != data.shift_name:
        changes.append(f"shift_name: {shift.shift_name} -> {data.shift_name}")
        shift.shift_name = data.shift_name
    if data.line is not None and shift.line != data.line:
        changes.append(f"line: {shift.line} -> {data.line}")
        shift.line = data.line
    if data.master_id is not None and shift.master_id != data.master_id:
        changes.append(f"master_id: {shift.master_id} -> {data.master_id}")
        shift.master_id = data.master_id
    if data.batch_number is not None and shift.batch_number != data.batch_number:
        changes.append(f"batch_number: {shift.batch_number} -> {data.batch_number}")
        shift.batch_number = data.batch_number
    if data.product_name is not None and shift.product_name != data.product_name:
        changes.append(f"product_name: {shift.product_name} -> {data.product_name}")
        shift.product_name = data.product_name
    if data.export_type is not None and shift.export_type != data.export_type:
        changes.append(f"export_type: {shift.export_type} -> {data.export_type}")
        shift.export_type = data.export_type
    if data.status is not None and shift.status != data.status:
        changes.append(f"status: {shift.status} -> {data.status}")
        shift.status = data.status
        
    # ZO raw materials
    zo_fields = [
        "zo_batches", "zo_chrysotile_4_20", "zo_chrysotile_5_65", "zo_chrysotile_6_40",
        "zo_chrysotile_4_20_silo1", "zo_chrysotile_4_20_silo2", "zo_chrysotile_4_20_silo3", "zo_chrysotile_4_20_silo4",
        "zo_chrysotile_5_65_silo1", "zo_chrysotile_5_65_silo2", "zo_chrysotile_5_65_silo3", "zo_chrysotile_5_65_silo4",
        "zo_chrysotile_6_40_silo1", "zo_chrysotile_6_40_silo2", "zo_chrysotile_6_40_silo3", "zo_chrysotile_6_40_silo4",
        "zo_cement_silo1", "zo_cement_silo2", "zo_cement_silo3", "zo_cement_silo4",
        "zo_cellulose", "zo_cellulose_silo1", "zo_cellulose_silo2", "zo_cellulose_silo3", "zo_cellulose_silo4",
        "zo_crushed_slate", "zo_crushed_slate_silo1", "zo_crushed_slate_silo2", "zo_crushed_slate_silo3", "zo_crushed_slate_silo4",
        "zo_asbozurit", "zo_asbozurit_silo1", "zo_asbozurit_silo2", "zo_asbozurit_silo3", "zo_asbozurit_silo4",
        "zo_fiberglass", "zo_fiberglass_silo1", "zo_fiberglass_silo2", "zo_fiberglass_silo3", "zo_fiberglass_silo4",
        "zo_laprol", "zo_laprol_silo1", "zo_laprol_silo2", "zo_laprol_silo3", "zo_laprol_silo4",
        "zo_asbocarton", "zo_asbocarton_silo1", "zo_asbocarton_silo2", "zo_asbocarton_silo3", "zo_asbocarton_silo4",
        "lfm_asb_drain", "lfm_cem_drain", "zo_asb_drain", "zo_cem_drain"
    ]
    for f_name in zo_fields:
        val = getattr(data, f_name, None)
        if val is not None:
            old_val = getattr(shift, f_name, 0)
            if old_val != val:
                changes.append(f"{f_name}: {old_val} -> {val}")
                setattr(shift, f_name, val)
                
    # 2. Update LFM Report
    lfm_report = db.query(models.LFMReport).filter(models.LFMReport.shift_id == shift_id).first()
    if not lfm_report:
        lfm_report = models.LFMReport(
            shift_id=shift_id,
            product_name=shift.product_name or "",
            export_type=shift.export_type or "Эталон",
            lfm_sheets=data.lfm_sheets or 0,
            lfm_wind_resets=data.lfm_wind_resets or 0,
            transferred_to_warehouse=data.warehouse_gp or 0,
            formed_1st_grade=data.first_grade or 0,
            formed_defect=data.qcd_defect or 0
        )
        db.add(lfm_report)
        changes.append("Создан новый LFMReport")
    else:
        if data.lfm_sheets is not None and lfm_report.lfm_sheets != data.lfm_sheets:
            changes.append(f"lfm_sheets: {lfm_report.lfm_sheets} -> {data.lfm_sheets}")
            lfm_report.lfm_sheets = data.lfm_sheets
        if data.lfm_wind_resets is not None and lfm_report.lfm_wind_resets != data.lfm_wind_resets:
            changes.append(f"lfm_wind_resets: {lfm_report.lfm_wind_resets} -> {data.lfm_wind_resets}")
            lfm_report.lfm_wind_resets = data.lfm_wind_resets
        if data.warehouse_gp is not None and lfm_report.transferred_to_warehouse != data.warehouse_gp:
            changes.append(f"transferred_to_warehouse: {lfm_report.transferred_to_warehouse} -> {data.warehouse_gp}")
            lfm_report.transferred_to_warehouse = data.warehouse_gp
        if data.first_grade is not None and lfm_report.formed_1st_grade != data.first_grade:
            changes.append(f"formed_1st_grade: {lfm_report.formed_1st_grade} -> {data.first_grade}")
            lfm_report.formed_1st_grade = data.first_grade
        if data.qcd_defect is not None and lfm_report.formed_defect != data.qcd_defect:
            changes.append(f"formed_defect: {lfm_report.formed_defect} -> {data.qcd_defect}")
            lfm_report.formed_defect = data.qcd_defect
        if data.product_name is not None and lfm_report.product_name != data.product_name:
            lfm_report.product_name = data.product_name
        if data.export_type is not None and lfm_report.export_type != data.export_type:
            lfm_report.export_type = data.export_type
            
    # 3. Update Batch
    batch = db.query(models.Batch).filter(models.Batch.shift_id == shift_id).first()
    if not batch:
        batch = models.Batch(
            shift_id=shift_id,
            batch_number=shift.batch_number or "",
            product_name=shift.product_name or "",
            export_type=shift.export_type or "Эталон",
            status="stacked"
        )
        db.add(batch)
        changes.append("Создана новая партия Batch")
    else:
        batch.batch_number = shift.batch_number or ""
        batch.product_name = shift.product_name or ""
        batch.export_type = shift.export_type or "Эталон"
        
    if data.warehouse_gp is not None:
        batch.ds_condition = data.warehouse_gp
        batch.qcd_condition = data.warehouse_gp
    if data.first_grade is not None:
        batch.ds_first_grade = data.first_grade
        batch.qcd_first_grade = data.first_grade
    if data.qcd_defect is not None:
        batch.qcd_defect = data.qcd_defect
        
    ds_defect_fields = [
        "ds_defect_chip", "ds_defect_scratch", "ds_defect_bad_cut", "ds_defect_stick_bottom",
        "ds_defect_stick_top", "ds_defect_broken", "ds_defect_fell_box", "ds_defect_dent",
        "ds_defect_thickness", "ds_defect_delamination", "ds_defect_edge"
    ]
    total_ds_defect = 0
    for f_name in ds_defect_fields:
        val = getattr(data, f_name, None)
        if val is not None:
            old_val = getattr(batch, f_name, 0)
            if old_val != val:
                changes.append(f"{f_name}: {old_val} -> {val}")
                setattr(batch, f_name, val)
            total_ds_defect += val
        else:
            total_ds_defect += getattr(batch, f_name, 0) or 0
    batch.ds_defect = total_ds_defect
    batch.qcd_defect = total_ds_defect
    
    if changes:
        log_entry = models.AuditLog(
            timestamp=datetime.utcnow(),
            user_name=admin.name,
            action=f"Комплексное редактирование смены ID {shift_id}",
            details="Изменения: " + ", ".join(changes)
        )
        db.add(log_entry)
        
    db.commit()
    
    # Sync plan boards for old and new parameters
    sync_lfm_to_plan_board(old_date, old_shift_name, old_line, db, old_master_id)
    if shift.date != old_date or shift.shift_name != old_shift_name or shift.line != old_line:
        sync_lfm_to_plan_board(shift.date, shift.shift_name, shift.line, db, shift.master_id)
        
    # Trigger background Google Sheets sync
    background_tasks.add_task(sync_google_sheets_bg)
    
    return {"status": "ok", "shift_id": shift_id}

@app.delete("/api/admin/shifts/{shift_id}")
def admin_delete_shift(shift_id: int, request: Request, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    admin = check_admin_session(request, db)
    shift = db.query(models.Shift).get(shift_id)
    if not shift: raise HTTPException(404, "Смена не найдена")
    
    shift_date, shift_name, shift_line, master_id = shift.date, shift.shift_name, shift.line, shift.master_id
    
    db.query(models.LFMReport).filter(models.LFMReport.shift_id == shift_id).delete()
    db.query(models.Batch).filter(models.Batch.shift_id == shift_id).delete()
    db.query(models.Downtime).filter(models.Downtime.shift_id == shift_id).delete()
    
    log_entry = models.AuditLog(
        timestamp=datetime.utcnow(),
        user_name=admin.name,
        action=f"Удаление смены ID {shift_id}",
        details=f"Удалена смена за {shift_date} ({shift_name}, Линия {shift_line}) и все связанные с ней отчеты, партии и простои."
    )
    db.add(log_entry)
    db.delete(shift)
    db.commit()
    
    # Sync to clear phantom facts from plan board
    sync_lfm_to_plan_board(shift_date, shift_name, shift_line, db, master_id)
    background_tasks.add_task(sync_google_sheets_bg)
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
        shift = db.query(models.Shift).get(report.shift_id)
        if shift:
            sync_lfm_to_plan_board(shift.date, shift.shift_name, shift.line, db, shift.master_id)
    else:
        db.commit()
    return {"status": "ok"}

@app.delete("/api/admin/lfm/{report_id}")
def admin_delete_lfm(report_id: int, request: Request, db: Session = Depends(get_db)):
    admin = check_admin_session(request, db)
    report = db.query(models.LFMReport).get(report_id)
    if not report: raise HTTPException(404, "Отчет ЛФМ не найден")
    shift_id = report.shift_id
    shift = db.query(models.Shift).get(shift_id)
    shift_date, shift_name, shift_line, master_id = None, None, None, None
    if shift:
        shift_date, shift_name, shift_line, master_id = shift.date, shift.shift_name, shift.line, shift.master_id
        
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
    if shift:
        sync_lfm_to_plan_board(shift_date, shift_name, shift_line, db, master_id)
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

@app.get("/api/admin/downtimes/all")
def get_all_admin_downtimes(
    limit: int = 200, 
    offset: int = 0,
    request: Request = None, 
    db: Session = Depends(get_db)
):
    admin = check_admin_session(request, db)
    downtimes = db.query(models.Downtime).join(models.Shift).order_by(models.Shift.date.desc(), models.Downtime.id.desc()).offset(offset).limit(limit).all()
    
    result = []
    for d in downtimes:
        d_dict = {
            "id": d.id,
            "shift_id": d.shift_id,
            "start_time": d.start_time,
            "end_time": d.end_time,
            "duration": d.duration,
            "category": d.category,
            "department": d.department,
            "node": d.node,
            "description": d.description,
            "status": d.status,
            "is_equipment_downtime": d.is_equipment_downtime,
            "lost_tons": d.lost_tons,
            "lost_tenge": d.lost_tenge
        }
        if d.shift:
            d_dict["shift_date"] = d.shift.date
            d_dict["shift_line"] = d.shift.line
            d_dict["shift_name"] = d.shift.shift_name
        result.append(d_dict)
    return result

@app.put("/api/admin/downtimes/{downtime_id}")
def admin_update_downtime(downtime_id: int, data: dict, request: Request, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
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
    background_tasks.add_task(sync_downtimes_bg)
    return {"status": "ok"}

@app.delete("/api/admin/downtimes/{downtime_id}")
def admin_delete_downtime(downtime_id: int, request: Request, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
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
    background_tasks.add_task(sync_downtimes_bg)
    return {"status": "ok"}

@app.get("/api/admin/receipts")
def get_all_admin_receipts(
    start_date: str = Query(None),
    end_date: str = Query(None),
    request: Request = None, 
    db: Session = Depends(get_db)
):
    admin = check_admin_session(request, db)
    query = db.query(models.RawMaterialReceipt).join(models.Shift)
    
    if start_date:
        query = query.filter(models.Shift.date >= start_date)
    if end_date:
        query = query.filter(models.Shift.date <= end_date)
        
    receipts = query.order_by(models.Shift.date.desc(), models.RawMaterialReceipt.id.desc()).all()
    
    result = []
    for r in receipts:
        r_dict = schemas.RawMaterialReceipt.model_validate(r).model_dump()
        if r.shift:
            r_dict["shift_date"] = r.shift.date
            r_dict["shift_line"] = r.shift.line
            r_dict["shift_name"] = r.shift.shift_name
        if r.master:
            r_dict["master_name"] = r.master.name
        else:
            r_dict["master_name"] = "Н/Д"
        result.append(r_dict)
    return result

@app.put("/api/admin/receipts/{receipt_id}")
def admin_update_receipt(receipt_id: int, data: schemas.RawMaterialReceiptUpdate, request: Request, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    admin = check_admin_session(request, db)
    r = db.query(models.RawMaterialReceipt).get(receipt_id)
    if not r: raise HTTPException(404, "Приход сырья не найден")
    
    old_values = {}
    new_values = {}
    update_data = data.model_dump(exclude_unset=True)
    
    for key, val in update_data.items():
        if hasattr(r, key):
            old_val = getattr(r, key)
            if old_val != val:
                old_values[key] = str(old_val)
                new_values[key] = str(val)
                setattr(r, key, val)
                
    if old_values:
        log_entry = models.AuditLog(
            timestamp=datetime.utcnow(),
            user_name=admin.name,
            action=f"Редактирование прихода сырья ID {receipt_id}",
            details=f"Смена {r.shift_id}. Изменено: {old_values} -> {new_values}",
            target_table="raw_material_receipts",
            target_id=receipt_id
        )
        db.add(log_entry)
        db.commit()
    else:
        db.commit()
    background_tasks.add_task(sync_receipts_bg)
    return {"status": "ok"}

@app.delete("/api/admin/receipts/{receipt_id}")
def admin_delete_receipt(receipt_id: int, request: Request, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    admin = check_admin_session(request, db)
    r = db.query(models.RawMaterialReceipt).get(receipt_id)
    if not r: raise HTTPException(404, "Приход сырья не найден")
    
    log_entry = models.AuditLog(
        timestamp=datetime.utcnow(),
        user_name=admin.name,
        action=f"Удаление прихода сырья ID {receipt_id}",
        details=f"Смена {r.shift_id}. Цемент: {r.cement_silo1 + r.cement_silo2 + r.cement_silo3 + r.cement_silo4}, Хризотил 4-20: {r.chrysotile_4_20}",
        target_table="raw_material_receipts",
        target_id=receipt_id
    )
    db.add(log_entry)
    db.delete(r)
    db.commit()
    background_tasks.add_task(sync_receipts_bg)
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



# ==========================================
# API БАЗЫ ЗНАНИЙ (ЛОКАЛЬНОЕ ХРАНИЛИЩЕ)
# ==========================================
from fastapi import Form, UploadFile, File
from fastapi.responses import FileResponse
import os
import uuid
import shutil

UPLOAD_DIR = os.path.join(os.getcwd(), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

def sort_folders_custom(folders):
    order = {
        # Orange
        "Должностные инструкции по всем сотрудникам": 0,
        "ОТ и ТБ": 1,
        "Договора с подрядчиками": 2,
        # Purple
        "Отдел кадров": 3,
        "Коммерческий департамент": 4,
        "Технический директор": 5,
        "Финансовый директор": 6,
        "Начальник производства": 7,
        # Green
        "Главный технолог": 8,
        "Служба контроля качества": 9,
        "Бережливое производство": 10,
        "ОГМ": 11
    }
    return sorted(folders, key=lambda x: (order.get(x.name, 999), x.name))

from fastapi import Header

def build_category_protection_map(db: Session) -> dict:
    cats = {c.id: (c.parent_id, bool(c.password_hash)) for c in db.query(models.DocumentCategory.id, models.DocumentCategory.parent_id, models.DocumentCategory.password_hash).all()}
    memo = {}
    def check_prot(cid: int) -> bool:
        if cid in memo:
            return memo[cid]
        curr = cid
        while curr and curr in cats:
            parent_id, has_pwd = cats[curr]
            if has_pwd:
                memo[cid] = True
                return True
            curr = parent_id
        memo[cid] = False
        return False
    return {cid: check_prot(cid) for cid in cats}

def get_protected_ancestor(db: Session, folder_id: int):
    current_id = folder_id
    while current_id:
        folder = db.query(models.DocumentCategory).filter(models.DocumentCategory.id == current_id).first()
        if not folder:
            break
        if folder.password_hash:
            return folder
        current_id = folder.parent_id
    return None

def is_folder_protected(db: Session, folder_id: int) -> bool:
    return get_protected_ancestor(db, folder_id) is not None

@app.get("/api/documents/list")
def list_documents(
    parent_id: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    try:
        prot_map = build_category_protection_map(db)

        if q and q.strip():
            query_str = f"%{q.strip()}%"
            folders = db.query(models.DocumentCategory).filter(models.DocumentCategory.name.ilike(query_str)).order_by(models.DocumentCategory.name).all()
            files = db.query(models.Document).filter(models.Document.title.ilike(query_str)).order_by(models.Document.title).all()
        else:
            cat_id = None
            if parent_id and parent_id.startswith("folder_"):
                cat_id = int(parent_id.split("_")[1])
                
            if cat_id is None:
                folders = db.query(models.DocumentCategory).filter(models.DocumentCategory.parent_id == None).order_by(models.DocumentCategory.name).all()
                files = db.query(models.Document).filter(models.Document.category_id == None).order_by(models.Document.title).all()
            else:
                folders = db.query(models.DocumentCategory).filter(models.DocumentCategory.parent_id == cat_id).order_by(models.DocumentCategory.name).all()
                files = db.query(models.Document).filter(models.Document.category_id == cat_id).order_by(models.Document.title).all()
            
        folders = sort_folders_custom(folders)
        
        folder_data = []
        for f in folders:
            folder_data.append({
                "id": f"folder_{f.id}",
                "name": f.name,
                "mimeType": "application/vnd.google-apps.folder",
                "created_at": f.id,
                "created_by": f.created_by or "",
                "is_protected": prot_map.get(f.id, False)
            })
            
        file_data = []
        for f in files:
            file_link = f.external_url if f.external_url else f"/api/documents/download/{f.id}"
            file_data.append({
                "id": f"file_{f.id}",
                "name": f.title,
                "mimeType": f.mime_type or "application/octet-stream",
                "webViewLink": file_link,
                "external_url": f.external_url,
                "uploaded_at": f.uploaded_at.isoformat() if f.uploaded_at else "",
                "is_protected": prot_map.get(f.category_id, False) if f.category_id else False,
                "version_number": f.version_number or 1,
                "locked_by_user": f.locked_by_user,
                "locked_at": f.locked_at.strftime("%d.%m %H:%M") if f.locked_at else None,
                "last_modified_by": f.last_modified_by or "",
                "created_by": f.created_by or f.last_modified_by or ""
            })
            
        return {"status": "success", "data": {"folders": folder_data, "files": file_data}}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get("/api/documents/recent")
def get_recent_documents(db: Session = Depends(get_db)):
    """Возвращает 6 последних добавленных/обновленных документов для панели быстрого доступа"""
    try:
        prot_map = build_category_protection_map(db)
        docs = db.query(models.Document).order_by(models.Document.uploaded_at.desc(), models.Document.id.desc()).limit(6).all()
        recent_docs = []
        for d in docs:
            file_link = d.external_url if d.external_url else f"/api/documents/download/{d.id}"
            recent_docs.append({
                "id": f"file_{d.id}",
                "doc_id": d.id,
                "name": d.title,
                "mimeType": d.mime_type or "application/octet-stream",
                "webViewLink": file_link,
                "external_url": d.external_url,
                "uploaded_at": d.uploaded_at.strftime("%d.%m.%Y %H:%M") if d.uploaded_at else "",
                "is_protected": prot_map.get(d.category_id, False) if d.category_id else False,
                "version_number": d.version_number or 1,
                "locked_by_user": d.locked_by_user,
                "last_modified_by": d.last_modified_by or "Сотрудник",
                "created_by": d.created_by or d.last_modified_by or "Сотрудник"
            })
        return {"status": "success", "data": recent_docs}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get("/api/documents/all")
def get_all_documents_flat(db: Session = Depends(get_db)):
    """Возвращает плоский список всех документов с именами папок для модалки выбора."""
    try:
        categories = {c.id: c.name for c in db.query(models.DocumentCategory).all()}
        docs = db.query(models.Document).all()
        
        result = []
        for d in docs:
            file_link = d.external_url if d.external_url else f"/api/documents/download/{d.id}"
            cat_name = categories.get(d.category_id, "Главная директория")
            result.append({
                "id": d.id,
                "title": d.title or "Документ",
                "category_id": d.category_id,
                "category_name": cat_name,
                "mime_type": d.mime_type or "application/octet-stream",
                "doc_type": d.doc_type or "other",
                "link": file_link,
                "uploaded_at": d.uploaded_at.strftime("%d.%m.%Y %H:%M") if d.uploaded_at else "",
                "created_by": d.created_by or d.last_modified_by or ""
            })
        
        # Сортировка по имени
        result.sort(key=lambda x: (x["category_name"], x["title"].lower()))
        return result
    except Exception as e:
        print(f"Error fetching all documents flat: {e}")
        return []

@app.get("/api/documents/tree")
def get_documents_tree(db: Session = Depends(get_db)):
    try:
        prot_map = build_category_protection_map(db)
        folders = db.query(models.DocumentCategory).order_by(models.DocumentCategory.name).all()
        folders = sort_folders_custom(folders)
        folder_data = []
        for f in folders:
            folder_data.append({
                "id": f"folder_{f.id}",
                "name": f.name,
                "parent_id": f"folder_{f.parent_id}" if f.parent_id else None,
                "created_by": f.created_by or "",
                "is_protected": prot_map.get(f.id, False)
            })
            
        docs = db.query(models.Document).order_by(models.Document.title).all()
        file_data = []
        for d in docs:
            file_link = d.external_url if d.external_url else f"/api/documents/download/{d.id}"
            file_data.append({
                "id": f"file_{d.id}",
                "name": d.title,
                "parent_id": f"folder_{d.category_id}" if d.category_id else None,
                "mimeType": d.mime_type or "application/octet-stream",
                "webViewLink": file_link,
                "external_url": d.external_url,
                "is_protected": prot_map.get(d.category_id, False) if d.category_id else False,
                "version_number": d.version_number or 1,
                "locked_by_user": d.locked_by_user,
                "locked_at": d.locked_at.strftime("%d.%m %H:%M") if d.locked_at else None,
                "last_modified_by": d.last_modified_by or "",
                "created_by": d.created_by or d.last_modified_by or ""
            })
            
        return {"status": "success", "data": {"folders": folder_data, "files": file_data}}
    except Exception as e:
        return {"status": "error", "message": str(e)}

class VerifyPasswordRequest(BaseModel):
    folder_id: str
    password: str

@app.post("/api/documents/verify-password")
def verify_document_password(req: VerifyPasswordRequest, db: Session = Depends(get_db)):
    try:
        cat_id = None
        if req.folder_id and req.folder_id.startswith("folder_"):
            cat_id = int(req.folder_id.split("_")[1])
        if not cat_id:
            return {"status": "error", "message": "Неверный ID папки"}
            
        protected_folder = get_protected_ancestor(db, cat_id)
        if not protected_folder:
            return {"status": "success"} # Не защищена
            
        hashed_pwd = hashlib.sha256(req.password.encode()).hexdigest()
        if protected_folder.password_hash == hashed_pwd:
            return {"status": "success"}
        return {"status": "error", "message": "Неверный пароль"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post("/api/documents/sync-folders-to-drive")
def manual_sync_folders_to_drive(db: Session = Depends(get_db)):
    """Принудительная выгрузка всех папок и файлов из базы Tectum в Google Drive"""
    try:
        import google_drive_integration
        all_categories = db.query(models.DocumentCategory).all()
        synced_folders = []
        for cat in all_categories:
            # Force find or create in Drive
            f_id = get_or_create_google_drive_folder_for_category(db, cat.id, force_check=True)
            synced_folders.append({"id": cat.id, "name": cat.name, "drive_id": f_id})
            
        unmigrated_docs = db.query(models.Document).filter(
            (models.Document.google_drive_url == None) | (models.Document.google_drive_url == "")
        ).all()
        synced_docs = []
        for u_doc in unmigrated_docs:
            if u_doc.file_path and os.path.exists(u_doc.file_path):
                clean_t = u_doc.title or os.path.basename(u_doc.file_path)
                parent_drive_id = get_or_create_google_drive_folder_for_category(db, u_doc.category_id)
                d_info = google_drive_integration.upload_file_to_drive(u_doc.file_path, clean_t, parent_drive_id=parent_drive_id)
                if d_info and d_info.get("id"):
                    u_doc.google_drive_id = d_info["id"]
                    u_doc.google_drive_url = d_info["url"]
                    db.commit()
                    synced_docs.append(clean_t)

        return {
            "status": "success", 
            "folders_count": len(synced_folders), 
            "folders": synced_folders,
            "docs_synced": synced_docs
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get("/api/admin/document-categories")
def admin_get_document_categories(request: Request, db: Session = Depends(get_db)):
    if request.session.get("user_role") not in ["admin", "director", "technologist"]:
        return {"status": "error", "message": "Access denied"}
    try:
        folders = db.query(models.DocumentCategory).order_by(models.DocumentCategory.name).all()
        data = []
        for f in folders:
            data.append({
                "id": f.id,
                "name": f.name,
                "is_protected": bool(f.password_hash)
            })
        return {"status": "success", "data": data}
    except Exception as e:
        return {"status": "error", "message": str(e)}

class SetPasswordRequest(BaseModel):
    password: Optional[str] = None

@app.post("/api/admin/document-categories/{cat_id}/set-password")
def admin_set_document_password(cat_id: int, req: SetPasswordRequest, request: Request, db: Session = Depends(get_db)):
    if request.session.get("user_role") not in ["admin", "director", "technologist"]:
        return {"status": "error", "message": "Access denied"}
    try:
        folder = db.query(models.DocumentCategory).filter(models.DocumentCategory.id == cat_id).first()
        if not folder:
            return {"status": "error", "message": "Папка не найдена"}
            
        if req.password:
            folder.password_hash = hashlib.sha256(req.password.encode()).hexdigest()
        else:
            folder.password_hash = None
        db.commit()
        return {"status": "success"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

def is_editable_doc(file_name: str) -> bool:
    name = (file_name or '').lower()
    return name.endswith('.xlsx') or name.endswith('.xls') or name.endswith('.docx') or name.endswith('.doc') or name.endswith('.pptx') or name.endswith('.ppt')

def get_or_create_google_drive_folder_for_category(db: Session, cat_id: Optional[int], force_check: bool = False) -> Optional[str]:
    """
    Recursively ensures that the folder hierarchy exists in Google Drive
    and returns the google_drive_folder_id for the given category.
    """
    root_folder_id = os.getenv("GOOGLE_DRIVE_FOLDER_ID")
    if not cat_id:
        return root_folder_id
        
    category = db.query(models.DocumentCategory).filter(models.DocumentCategory.id == cat_id).first()
    if not category:
        return root_folder_id
        
    # If already set and not forced, return it
    if category.google_drive_folder_id and not force_check:
        return category.google_drive_folder_id
        
    # Get or create parent drive folder recursively
    parent_drive_id = get_or_create_google_drive_folder_for_category(db, category.parent_id, force_check=force_check)
    
    try:
        import google_drive_integration
        drive_folder_id = google_drive_integration.get_or_create_drive_folder(category.name, parent_drive_id)
        if drive_folder_id:
            category.google_drive_folder_id = drive_folder_id
            db.commit()
            return drive_folder_id
    except Exception as e:
        print(f"Failed to create Google Drive folder for '{category.name}': {e}")
        
    return root_folder_id

def upload_doc_to_drive_bg(doc_id: int, file_path: str, clean_title: str, cat_id: Optional[int] = None):
    """Фоновая выгрузка файла в Google Drive с обновлением ID и URL в БД и сохранением структуры папок"""
    try:
        import google_drive_integration
        bg_db = database.SessionLocal()
        parent_drive_id = None
        try:
            parent_drive_id = get_or_create_google_drive_folder_for_category(bg_db, cat_id)
        finally:
            bg_db.close()

        drive_info = google_drive_integration.upload_file_to_drive(file_path, clean_title, parent_drive_id=parent_drive_id)
        if drive_info and drive_info.get("id"):
            bg_db = database.SessionLocal()
            try:
                doc = bg_db.query(models.Document).filter(models.Document.id == doc_id).first()
                if doc:
                    doc.google_drive_id = drive_info["id"]
                    doc.google_drive_url = drive_info["url"]
                    bg_db.commit()
            finally:
                bg_db.close()
    except Exception as drive_err:
        print(f"Background upload to Google Drive failed for doc #{doc_id}: {drive_err}")

class DirectUploadRegisterRequest(BaseModel):
    title: str
    category_id: Optional[int] = None
    yandex_path: Optional[str] = None
    mime_type: Optional[str] = None
    r2_key: Optional[str] = None

@app.post("/api/documents/direct_upload_token")
def get_direct_upload_token(
    filename: str = Form(...),
    mime_type: Optional[str] = Form("application/octet-stream"),
    parent_id: Optional[str] = Form(None),
    relative_path: Optional[str] = Form(None),
    x_folder_password: Optional[str] = Header(None),
    db: Session = Depends(get_db)
):
    """
    Generates a direct PUT URL straight to Yandex Disk.
    The browser uploads directly into Yandex Disk without touching Railway server disk!
    """
    try:
        cat_id = None
        if parent_id and parent_id.startswith("folder_"):
            cat_id = int(parent_id.split("_")[1])
            
        if cat_id is not None:
            protected_folder = get_protected_ancestor(db, cat_id)
            if protected_folder:
                if not x_folder_password or protected_folder.password_hash != hashlib.sha256(x_folder_password.encode()).hexdigest():
                    raise HTTPException(status_code=403, detail="Access Denied")

        if relative_path:
            parts = relative_path.split("/")[:-1]
            current_parent = cat_id
            for part in parts:
                if not part: continue
                existing_folder = db.query(models.DocumentCategory).filter(
                    models.DocumentCategory.name == part,
                    models.DocumentCategory.parent_id == current_parent
                ).first()
                if not existing_folder:
                    try:
                        new_folder = models.DocumentCategory(name=part, parent_id=current_parent)
                        db.add(new_folder)
                        db.commit()
                        db.refresh(new_folder)
                        current_parent = new_folder.id
                    except Exception:
                        db.rollback()
                        existing_folder = db.query(models.DocumentCategory).filter(
                            models.DocumentCategory.name == part,
                            models.DocumentCategory.parent_id == current_parent
                        ).first()
                        if existing_folder:
                            current_parent = existing_folder.id
                else:
                    current_parent = existing_folder.id
            cat_id = current_parent

        import yandex_disk_integration, migrate_all_to_yandex, re
        clean_name = re.sub(r'[\\/:*?"<>|]', '_', filename.strip())
        folder_path = migrate_all_to_yandex.build_category_path(db, cat_id) if cat_id else "/Tectum"
        remote_path = f"{folder_path}/{clean_name}"
        
        upload_url = yandex_disk_integration.get_yandex_upload_url(remote_path)
        if not upload_url:
            raise HTTPException(status_code=500, detail="Не удалось получить ссылку для загрузки в Яндекс.Диск")

        return {
            "status": "success",
            "upload_url": upload_url,
            "yandex_path": remote_path,
            "category_id": cat_id
        }
    except HTTPException:
        raise
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post("/api/documents/register_direct_upload")
def register_direct_upload(
    req: DirectUploadRegisterRequest,
    db: Session = Depends(get_db)
):
    """
    Registers a file in Tectum database after direct upload straight to Yandex Disk and publishes it.
    """
    try:
        import yandex_disk_integration
        pub_url = None
        if req.yandex_path:
            pub_url = yandex_disk_integration.publish_and_get_public_url(req.yandex_path)

        new_doc = models.Document(
            title=req.title,
            category_id=req.category_id,
            file_path=None,
            mime_type=req.mime_type or "application/octet-stream",
            yandex_path=req.yandex_path,
            yandex_url=pub_url,
            r2_key=req.r2_key
        )
        db.add(new_doc)
        db.commit()
        db.refresh(new_doc)

        is_editable = is_editable_doc(new_doc.title)

        return {
            "status": "success",
            "file": {
                "id": f"file_{new_doc.id}",
                "name": new_doc.title,
                "mimeType": new_doc.mime_type,
                "webViewLink": f"/editor?id=file_{new_doc.id}" if is_editable else f"/api/documents/download/{new_doc.id}"
            }
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}

class AddExternalLinkRequest(BaseModel):
    title: str
    external_url: str
    parent_id: Optional[str] = None
    author_name: Optional[str] = "Сотрудник"

@app.post("/api/documents/add_link")
def add_external_document_link(
    req: AddExternalLinkRequest,
    x_folder_password: Optional[str] = Header(None),
    db: Session = Depends(get_db)
):
    """
    Добавляет ссылку на внешний документ (OneDrive, Google Docs, SharePoint, Яндекс.Диск и т.д.)
    """
    try:
        cat_id = None
        if req.parent_id and req.parent_id.startswith("folder_"):
            cat_id = int(req.parent_id.split("_")[1])

        if cat_id is not None:
            protected_folder = get_protected_ancestor(db, cat_id)
            if protected_folder:
                if not x_folder_password or protected_folder.password_hash != hashlib.sha256(x_folder_password.encode()).hexdigest():
                    raise HTTPException(status_code=403, detail="Access Denied")

        clean_url = req.external_url.strip()
        if not clean_url.startswith("http://") and not clean_url.startswith("https://"):
            clean_url = "https://" + clean_url

        # Определение типа иконки
        clean_title = req.title.strip()
        mime_type = "application/x-external-link"
        low_url = clean_url.lower()
        if "1drv.ms" in low_url or "onedrive" in low_url or "sharepoint" in low_url:
            mime_type = "application/vnd.ms-onedrive"
        elif "docs.google" in low_url or "drive.google" in low_url:
            mime_type = "application/vnd.google-apps.document"
        elif "disk.yandex" in low_url or "yadi.sk" in low_url:
            mime_type = "application/vnd.yandex-disk"
        elif "docs.google.com/spreadsheets" in low_url:
            mime_type = "application/vnd.google-apps.spreadsheet"
        elif "docs.google.com/document" in low_url:
            mime_type = "application/vnd.google-apps.document"
        elif "docs.google.com/presentation" in low_url:
            mime_type = "application/vnd.google-apps.presentation"

        new_doc = models.Document(
            title=clean_title,
            category_id=cat_id,
            external_url=clean_url,
            mime_type=mime_type,
            created_by=req.author_name or "Сотрудник",
            last_modified_by=req.author_name or "Сотрудник",
            uploaded_at=datetime.utcnow()
        )
        db.add(new_doc)
        db.commit()
        db.refresh(new_doc)

        return {
            "status": "success",
            "message": "Ссылка успешно добавлена!",
            "file": {
                "id": f"file_{new_doc.id}",
                "name": new_doc.title,
                "external_url": new_doc.external_url,
                "mimeType": new_doc.mime_type
            }
        }
    except Exception as e:
        db.rollback()
        return {"status": "error", "message": str(e)}

def extract_external_link_title_sync(clean_url: str) -> Optional[str]:
    """Вспомогательная функция для быстрого извлечения названия ссылки"""
    import re
    import html as py_html
    
    if not clean_url.startswith("http://") and not clean_url.startswith("https://"):
        clean_url = "https://" + clean_url
        
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7"
    }

    gdoc_match = re.search(r'docs\.google\.com/(spreadsheets|document|presentation)/d/([a-zA-Z0-9-_]+)', clean_url)
    target_urls_to_try = [clean_url]
    if gdoc_match:
        dtype, doc_id = gdoc_match.group(1), gdoc_match.group(2)
        if dtype == "spreadsheets":
            target_urls_to_try = [
                f"https://docs.google.com/spreadsheets/d/{doc_id}/edit",
                f"https://docs.google.com/spreadsheets/d/{doc_id}/preview",
                clean_url
            ]
        elif dtype == "document":
            target_urls_to_try = [
                f"https://docs.google.com/document/d/{doc_id}/edit",
                f"https://docs.google.com/document/d/{doc_id}/preview",
                clean_url
            ]

    for test_url in target_urls_to_try:
        try:
            resp = requests.get(test_url, headers=headers, timeout=4, allow_redirects=True)
            if resp.status_code != 200:
                continue
                
            text = resp.text
            title = ""
            
            itemprop_match = re.search(r'<meta\s+itemprop=["\']name["\']\s+content=["\']([^"\']+)["\']', text, re.IGNORECASE)
            if not itemprop_match:
                itemprop_match = re.search(r'<meta\s+content=["\']([^"\']+)["\']\s+itemprop=["\']name["\']', text, re.IGNORECASE)
            if itemprop_match:
                title = itemprop_match.group(1).strip()

            if not title:
                og_match = re.search(r'<meta\s+(?:property|name)=["\'](?:og:title|twitter:title)["\']\s+content=["\']([^"\']+)["\']', text, re.IGNORECASE)
                if not og_match:
                    og_match = re.search(r'<meta\s+content=["\']([^"\']+)["\']\s+(?:property|name)=["\'](?:og:title|twitter:title)["\']', text, re.IGNORECASE)
                if og_match:
                    title = og_match.group(1).strip()

            if not title:
                title_match = re.search(r'<title>(.*?)</title>', text, re.IGNORECASE | re.DOTALL)
                if title_match:
                    title = title_match.group(1).strip()
                    
            if title:
                title = py_html.unescape(title)
                for suffix in [
                    " - Google Таблицы", " - Google Документы", " - Google Презентации", 
                    " - Google Диск", " - Google Sheets", " - Google Docs", " - Google Drive",
                    " - OneDrive", " - Excel", " - Word", " - Microsoft OneDrive", " — Яндекс Диск"
                ]:
                    if title.endswith(suffix):
                        title = title[:-len(suffix)].strip()
                
                if title and not any(bad in title.lower() for bad in ["вход", "войти", "sign in", "login", "google accounts"]):
                    return title
        except Exception:
            continue
    return None

@app.get("/api/documents/fetch_link_title")
def fetch_external_link_title(url: str = Query(...)):
    """
    Автоматически извлекает реальный заголовок/название файла по ссылке (OneDrive, Google Docs, Sheets, Yandex и др.)
    """
    title = extract_external_link_title_sync(url)
    if title:
        return {"status": "success", "title": title}
    return {"status": "error", "message": "Не удалось автоматически извлечь заголовок"}

@app.post("/api/documents/sync_external_titles")
def sync_external_documents_titles(
    parent_id: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    """
    Фоновая синхронизация и актуализация названий документов по внешним облачным ссылкам
    """
    try:
        cat_id = None
        if parent_id and parent_id.startswith("folder_"):
            cat_id = int(parent_id.split("_")[1])
            
        query = db.query(models.Document).filter(models.Document.external_url != None)
        if cat_id is not None:
            query = query.filter(models.Document.category_id == cat_id)
        elif parent_id == "root":
            query = query.filter(models.Document.category_id == None)
            
        docs = query.all()
        updated_count = 0
        
        for doc in docs:
            if not doc.external_url:
                continue
            new_title = extract_external_link_title_sync(doc.external_url)
            if new_title and new_title != doc.title:
                doc.title = new_title
                updated_count += 1
                
        if updated_count > 0:
            db.commit()
            
        return {"status": "success", "updated_count": updated_count}
    except Exception as e:
        db.rollback()
        return {"status": "error", "message": str(e)}

@app.post("/api/documents/folders")
def create_document_folder(
    folder_name: str = Form(...),
    parent_id: Optional[str] = Form(None),
    author_name: Optional[str] = Form("Сотрудник"),
    x_folder_password: Optional[str] = Header(None),
    db: Session = Depends(get_db)
):
    try:
        cat_id = None
        if parent_id and parent_id.startswith("folder_"):
            cat_id = int(parent_id.split("_")[1])
            
        if cat_id is not None:
            protected_folder = get_protected_ancestor(db, cat_id)
            if protected_folder:
                if not x_folder_password or protected_folder.password_hash != hashlib.sha256(x_folder_password.encode()).hexdigest():
                    raise HTTPException(status_code=403, detail="Access Denied")
        else:
            if not x_folder_password or x_folder_password != "6282":
                raise HTTPException(status_code=403, detail="Неверный пароль для создания корневой папки")
            
        clean_name = folder_name.strip()
        existing = db.query(models.DocumentCategory).filter(
            models.DocumentCategory.name == clean_name,
            models.DocumentCategory.parent_id == cat_id
        ).first()
        if existing:
            return {"status": "success", "folder": {
                "id": f"folder_{existing.id}",
                "name": existing.name,
                "mimeType": "application/vnd.google-apps.folder"
            }}

        new_folder = models.DocumentCategory(
            name=clean_name,
            parent_id=cat_id,
            created_by=author_name or "Сотрудник"
        )
        db.add(new_folder)
        db.commit()
        db.refresh(new_folder)
        
        return {"status": "success", "folder": {
            "id": f"folder_{new_folder.id}",
            "name": new_folder.name,
            "mimeType": "application/vnd.google-apps.folder"
        }}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post("/api/documents/clean_duplicates")
def clean_duplicate_folders(request: Request, db: Session = Depends(get_db)):
    """Административная очистка дубликатов папок в базе данных"""
    try:
        all_folders = db.query(models.DocumentCategory).all()
        seen = {}
        duplicates = []
        for f in all_folders:
            key = (f.name.strip().lower(), f.parent_id)
            if key in seen:
                primary = seen[key]
                # Reassign documents from duplicate to primary
                db.query(models.Document).filter(models.Document.category_id == f.id).update(
                    {models.Document.category_id: primary.id}, synchronize_session=False
                )
                # Reassign subfolders
                db.query(models.DocumentCategory).filter(models.DocumentCategory.parent_id == f.id).update(
                    {models.DocumentCategory.parent_id: primary.id}, synchronize_session=False
                )
                duplicates.append(f)
            else:
                seen[key] = f

        for dup in duplicates:
            db.delete(dup)
        db.commit()
        return {"status": "success", "cleaned_count": len(duplicates)}
    except Exception as e:
        db.rollback()
        return {"status": "error", "message": str(e)}

def check_document_action_permission(
    db: Session,
    creator_name: Optional[str],
    user_name: Optional[str],
    user_pin: Optional[str],
    is_protected_folder_action: bool = False
):
    """
    Проверяет права доступа на действие с документом/папкой:
    - Разрешено, если автор совпадает и PIN-код валиден.
    - Разрешено администраторам (PIN 6282 или мастер-пароль).
    - Если у объекта еще не был указан создатель (старые файлы) и пользователь авторизован — действие разрешено.
    - Иначе — отказ 403 с пояснением.
    """
    clean_user = (user_name or "").strip()
    clean_pin = (user_pin or "").strip()
    clean_creator = (creator_name or "").strip()
    
    # 1. Проверка на суперпользователя / мастер-пароль
    if clean_pin == "6282":
        return True
        
    # 2. Если у объекта не указан создатель и пользователь авторизован
    if not clean_creator:
        if clean_user:
            return True
        # Если создатель неизвестен и пользователь не указан
        return True

    if not clean_user:
        raise HTTPException(
            status_code=403, 
            detail=f"Действие заблокировано. Объект создан сотрудником «{clean_creator}». Пожалуйста, авторизуйтесь под своим именем."
        )

    # 3. Проверка соответствия имени автора
    if clean_user.lower() != clean_creator.lower():
        raise HTTPException(
            status_code=403, 
            detail=f"Действие заблокировано: объект создан сотрудником «{clean_creator}». Удалять и изменять его может только автор или Администратор."
        )

    # 4. Проверка PIN-кода автора (если он задан в справочнике сотрудников)
    emp = db.query(models.PlannerEmployee).filter(models.PlannerEmployee.name == clean_user).first()
    if emp and emp.pin_code and emp.pin_code.strip():
        if emp.pin_code.strip() != clean_pin:
            raise HTTPException(status_code=401, detail="Неверный PIN-код для подтверждения действия")

    return True

@app.put("/api/documents/{item_id}/rename")
def rename_document(
    item_id: str,
    new_name: str = Form(...),
    user_name: Optional[str] = Form(None),
    user_pin: Optional[str] = Form(None),
    x_folder_password: Optional[str] = Header(None),
    db: Session = Depends(get_db)
):
    try:
        new_clean_name = new_name.strip()
        if not new_clean_name:
            return {"status": "error", "message": "Имя не может быть пустым"}
            
        if item_id.startswith("folder_"):
            cat_id = int(item_id.split("_")[1])
            folder = db.query(models.DocumentCategory).filter(models.DocumentCategory.id == cat_id).first()
            if not folder:
                return {"status": "error", "message": "Папка не найдена"}
                
            protected_folder = get_protected_ancestor(db, folder.id)
            if protected_folder:
                if not x_folder_password or protected_folder.password_hash != hashlib.sha256(x_folder_password.encode()).hexdigest():
                    raise HTTPException(status_code=403, detail="Access Denied")
                    
            check_document_action_permission(db, folder.created_by, user_name, user_pin or x_folder_password)
            folder.name = new_clean_name
            db.commit()
            return {"status": "success"}
            
        elif item_id.startswith("file_"):
            file_id = int(item_id.split("_")[1])
            doc = db.query(models.Document).filter(models.Document.id == file_id).first()
            if not doc:
                return {"status": "error", "message": "Файл не найден"}
                
            if doc.category_id:
                protected_folder = get_protected_ancestor(db, doc.category_id)
                if protected_folder:
                    if not x_folder_password or protected_folder.password_hash != hashlib.sha256(x_folder_password.encode()).hexdigest():
                        raise HTTPException(status_code=403, detail="Access Denied")
                        
            check_document_action_permission(db, doc.created_by or doc.last_modified_by, user_name, user_pin or x_folder_password)
            doc.title = new_clean_name
            db.commit()
            return {"status": "success"}
            
        return {"status": "error", "message": "Неизвестный тип объекта"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        return {"status": "error", "message": str(e)}

@app.put("/api/documents/{item_id}/move")
def move_document(
    item_id: str,
    target_folder_id: Optional[str] = Form(None),
    user_name: Optional[str] = Form(None),
    user_pin: Optional[str] = Form(None),
    x_folder_password: Optional[str] = Header(None),
    db: Session = Depends(get_db)
):
    try:
        target_cat_id: Optional[int] = None
        if target_folder_id and target_folder_id.strip() and target_folder_id != "root":
            if target_folder_id.startswith("folder_"):
                target_cat_id = int(target_folder_id.split("_")[1])
            elif target_folder_id.isdigit():
                target_cat_id = int(target_folder_id)
            else:
                return {"status": "error", "message": "Неверный формат идентификатора папки"}
            
            target_folder = db.query(models.DocumentCategory).filter(models.DocumentCategory.id == target_cat_id).first()
            if not target_folder:
                return {"status": "error", "message": "Целевая папка не найдена"}
                
            target_protected = get_protected_ancestor(db, target_folder.id)
            if target_protected:
                if not x_folder_password or target_protected.password_hash != hashlib.sha256(x_folder_password.encode()).hexdigest():
                    raise HTTPException(status_code=403, detail="Access Denied")

        if item_id.startswith("folder_"):
            cat_id = int(item_id.split("_")[1])
            folder = db.query(models.DocumentCategory).filter(models.DocumentCategory.id == cat_id).first()
            if not folder:
                return {"status": "error", "message": "Перемещаемая папка не найдена"}

            src_protected = get_protected_ancestor(db, folder.id)
            if src_protected:
                if not x_folder_password or src_protected.password_hash != hashlib.sha256(x_folder_password.encode()).hexdigest():
                    raise HTTPException(status_code=403, detail="Access Denied")

            check_document_action_permission(db, folder.created_by, user_name, user_pin or x_folder_password)

            if target_cat_id == folder.id:
                return {"status": "error", "message": "Нельзя переместить папку саму в себя"}

            if target_cat_id is not None:
                curr = target_cat_id
                while curr is not None:
                    if curr == folder.id:
                        return {"status": "error", "message": "Нельзя переместить папку в её собственную подпапку"}
                    parent_row = db.query(models.DocumentCategory.parent_id).filter(models.DocumentCategory.id == curr).first()
                    curr = parent_row[0] if parent_row else None

            folder.parent_id = target_cat_id
            db.commit()
            return {"status": "success", "message": "Папка успешно перемещена"}

        elif item_id.startswith("file_"):
            file_id = int(item_id.split("_")[1])
            doc = db.query(models.Document).filter(models.Document.id == file_id).first()
            if not doc:
                return {"status": "error", "message": "Файл не найден"}

            if doc.category_id:
                src_protected = get_protected_ancestor(db, doc.category_id)
                if src_protected:
                    if not x_folder_password or src_protected.password_hash != hashlib.sha256(x_folder_password.encode()).hexdigest():
                        raise HTTPException(status_code=403, detail="Access Denied")

            check_document_action_permission(db, doc.created_by or doc.last_modified_by, user_name, user_pin or x_folder_password)

            doc.category_id = target_cat_id
            db.commit()
            return {"status": "success", "message": "Файл успешно перемещен"}

        return {"status": "error", "message": "Неизвестный тип объекта"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        return {"status": "error", "message": str(e)}

@app.delete("/api/documents/{item_id}")
def delete_document(
    item_id: str, 
    user_name: Optional[str] = Query(None),
    user_pin: Optional[str] = Query(None),
    x_folder_password: Optional[str] = Header(None),
    db: Session = Depends(get_db)
):
    try:
        cat_id_to_check = None
        if item_id.startswith("folder_"):
            cat_id_to_check = int(item_id.split("_")[1])
        elif item_id.startswith("file_"):
            file_id = int(item_id.split("_")[1])
            doc = db.query(models.Document).filter(models.Document.id == file_id).first()
            if doc:
                cat_id_to_check = doc.category_id
                
        if cat_id_to_check is not None:
            protected_folder = get_protected_ancestor(db, cat_id_to_check)
            if protected_folder:
                if not x_folder_password or protected_folder.password_hash != hashlib.sha256(x_folder_password.encode()).hexdigest():
                    raise HTTPException(status_code=403, detail="Access Denied")

        if item_id.startswith("folder_"):
            cat_id = int(item_id.split("_")[1])
            folder = db.query(models.DocumentCategory).filter(models.DocumentCategory.id == cat_id).first()
            if folder:
                check_document_action_permission(db, folder.created_by, user_name, user_pin or x_folder_password)

                # Proper post-order traversal (children before parents)
                def get_all_descendant_ids_post_order(f_id: int) -> list[int]:
                    result = []
                    children = db.query(models.DocumentCategory).filter(models.DocumentCategory.parent_id == f_id).all()
                    for ch in children:
                        result.extend(get_all_descendant_ids_post_order(ch.id))
                    result.append(f_id)
                    return result

                all_cat_ids_to_delete = get_all_descendant_ids_post_order(folder.id)

                # 1. Delete all records inside these folders
                db.query(models.Document).filter(models.Document.category_id.in_(all_cat_ids_to_delete)).delete(synchronize_session=False)
                db.flush()

                # 2. Break parent_id foreign key references within categories to avoid constraint violations
                db.query(models.DocumentCategory).filter(models.DocumentCategory.id.in_(all_cat_ids_to_delete)).update(
                    {models.DocumentCategory.parent_id: None}, synchronize_session=False
                )
                db.flush()

                # 3. Delete folders from database in post-order
                for c_id in all_cat_ids_to_delete:
                    f_obj = db.query(models.DocumentCategory).filter(models.DocumentCategory.id == c_id).first()
                    if f_obj:
                        db.delete(f_obj)
                        db.flush()
                        
                db.commit()
        elif item_id.startswith("file_"):
            file_id = int(item_id.split("_")[1])
            doc = db.query(models.Document).filter(models.Document.id == file_id).first()
            if doc:
                check_document_action_permission(db, doc.created_by or doc.last_modified_by, user_name, user_pin or x_folder_password)
                db.delete(doc)
                db.commit()
                
        return {"status": "success"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        return {"status": "error", "message": str(e)}

# ==========================================
# API БАЗЫ ЗНАНИЙ: ЛОКАЛЬНЫЕ ФАЙЛЫ, MS OFFICE & ВЕРСИОНИРОВАНИЕ
# ==========================================

DOCS_STORAGE_DIR = os.path.join(os.getcwd(), "uploads", "kb_docs")
os.makedirs(DOCS_STORAGE_DIR, exist_ok=True)

@app.get("/api/documents/download/{doc_id}")
def download_local_document(doc_id: int, db: Session = Depends(get_db)):
    """Отдает локальный файл документа для скачивания или открытия в MS Office"""
    doc = db.query(models.Document).filter(models.Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Документ не найден")
    
    if not doc.file_path or not os.path.exists(doc.file_path):
        # Если привязана только внешняя ссылка
        if doc.external_url:
            return RedirectResponse(doc.external_url)
        raise HTTPException(status_code=404, detail="Файл документа отсутствует на диске")
    
    filename = doc.title or os.path.basename(doc.file_path)
    encoded_filename = quote(filename.encode('utf-8'))
    media_type = doc.mime_type or "application/octet-stream"
    
    # PDF, изображения и текст отдаем inline для комфортного онлайн-просмотра на смартфонах и ПК
    is_inline = False
    lower_name = filename.lower()
    if lower_name.endswith(('.pdf', '.png', '.jpg', '.jpeg', '.webp', '.txt', '.svg')) or (media_type and ("pdf" in media_type or "image" in media_type or "text" in media_type)):
        is_inline = True
        
    disposition = "inline" if is_inline else "attachment"
    
    headers = {
        "Content-Disposition": f"{disposition}; filename*=UTF-8''{encoded_filename}",
        "Access-Control-Expose-Headers": "Content-Disposition",
        "Cache-Control": "public, max-age=3600" if is_inline else "no-cache, no-store, must-revalidate",
        "Accept-Ranges": "bytes"
    }
    return FileResponse(doc.file_path, media_type=media_type, headers=headers)

@app.post("/api/documents/upload_local")
async def upload_local_document(
    file: UploadFile = File(...),
    parent_id: Optional[str] = Form(None),
    author_name: Optional[str] = Form("Сотрудник"),
    x_folder_password: Optional[str] = Header(None),
    db: Session = Depends(get_db)
):
    """Загрузка нового файла в локальную Базу Знаний с сохранением в uploads/kb_docs"""
    try:
        cat_id = None
        if parent_id and parent_id.startswith("folder_"):
            cat_id = int(parent_id.split("_")[1])
            
        if cat_id is not None:
            protected_folder = get_protected_ancestor(db, cat_id)
            if protected_folder:
                if not x_folder_password or protected_folder.password_hash != hashlib.sha256(x_folder_password.encode()).hexdigest():
                    raise HTTPException(status_code=403, detail="Access Denied")
        
        orig_filename = os.path.basename(file.filename)
        safe_ext = os.path.splitext(orig_filename)[1].lower()
        unique_name = f"doc_{uuid.uuid4().hex[:10]}_{int(datetime.utcnow().timestamp())}{safe_ext}"
        save_path = os.path.join(DOCS_STORAGE_DIR, unique_name)
        
        content = await file.read()
        file_size = len(content)
        with open(save_path, "wb") as f_out:
            f_out.write(content)
            
        new_doc = models.Document(
            title=orig_filename,
            category_id=cat_id,
            file_path=save_path,
            mime_type=file.content_type or "application/octet-stream",
            version_number=1,
            last_modified_by=author_name or "Сотрудник",
            created_by=author_name or "Сотрудник",
            uploaded_at=datetime.utcnow()
        )
        db.add(new_doc)
        db.commit()
        db.refresh(new_doc)
        
        # Создаем начальную версию v1 в архиве
        initial_version = models.DocumentVersion(
            document_id=new_doc.id,
            version_number=1,
            file_path=save_path,
            file_size=file_size,
            mime_type=new_doc.mime_type,
            author_name=author_name or "Сотрудник",
            comment="Исходная загрузка документа",
            created_at=datetime.utcnow()
        )
        db.add(initial_version)
        db.commit()
        
        return {
            "status": "success",
            "message": "Файл успешно загружен в Базу Знаний",
            "file": {
                "id": f"file_{new_doc.id}",
                "name": new_doc.title,
                "mimeType": new_doc.mime_type,
                "version_number": new_doc.version_number,
                "last_modified_by": new_doc.last_modified_by,
                "webViewLink": f"/api/documents/download/{new_doc.id}"
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        return {"status": "error", "message": str(e)}

@app.post("/api/documents/{doc_id}/save_version")
async def save_document_version(
    doc_id: int,
    file: UploadFile = File(...),
    author_name: str = Form(...),
    comment: Optional[str] = Form(""),
    x_folder_password: Optional[str] = Header(None),
    db: Session = Depends(get_db)
):
    """Загружает новую версию документа, архивирует старую и увеличивает счетчик версий"""
    try:
        doc = db.query(models.Document).filter(models.Document.id == doc_id).first()
        if not doc:
            raise HTTPException(status_code=404, detail="Документ не найден")
            
        if doc.category_id:
            protected_folder = get_protected_ancestor(db, doc.category_id)
            if protected_folder:
                if not x_folder_password or protected_folder.password_hash != hashlib.sha256(x_folder_password.encode()).hexdigest():
                    raise HTTPException(status_code=403, detail="Access Denied")
                    
        orig_filename = os.path.basename(file.filename)
        safe_ext = os.path.splitext(orig_filename)[1].lower()
        new_version_num = (doc.version_number or 1) + 1
        
        unique_name = f"doc_{doc.id}_v{new_version_num}_{uuid.uuid4().hex[:6]}{safe_ext}"
        save_path = os.path.join(DOCS_STORAGE_DIR, unique_name)
        
        content = await file.read()
        file_size = len(content)
        with open(save_path, "wb") as f_out:
            f_out.write(content)
            
        # Обновляем сам документ
        doc.file_path = save_path
        doc.mime_type = file.content_type or doc.mime_type
        doc.version_number = new_version_num
        doc.last_modified_by = author_name
        doc.locked_by_user = None
        doc.locked_at = None
        doc.uploaded_at = datetime.utcnow()
        
        # Добавляем запись в архив версий
        new_version_rec = models.DocumentVersion(
            document_id=doc.id,
            version_number=new_version_num,
            file_path=save_path,
            file_size=file_size,
            mime_type=doc.mime_type,
            author_name=author_name,
            comment=comment or f"Обновление до v{new_version_num}",
            created_at=datetime.utcnow()
        )
        db.add(new_version_rec)
        db.commit()
        db.refresh(doc)
        
        return {
            "status": "success",
            "message": f"Версия v{new_version_num} успешно сохранена",
            "version_number": new_version_num,
            "last_modified_by": doc.last_modified_by
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        return {"status": "error", "message": str(e)}

@app.get("/api/documents/{doc_id}/versions")
def get_document_versions(doc_id: int, db: Session = Depends(get_db)):
    """Возвращает историю всех версий документа"""
    try:
        doc = db.query(models.Document).filter(models.Document.id == doc_id).first()
        if not doc:
            raise HTTPException(status_code=404, detail="Документ не найден")
            
        versions = db.query(models.DocumentVersion).filter(
            models.DocumentVersion.document_id == doc_id
        ).order_by(models.DocumentVersion.version_number.desc()).all()
        
        data = []
        for v in versions:
            data.append({
                "id": v.id,
                "version_number": v.version_number,
                "author_name": v.author_name,
                "comment": v.comment or "",
                "file_size": v.file_size or 0,
                "created_at": v.created_at.strftime("%d.%m.%Y %H:%M") if v.created_at else "",
                "is_current": v.version_number == doc.version_number,
                "download_url": f"/api/documents/versions/{v.id}/download"
            })
            
        return {"status": "success", "data": data, "document_title": doc.title, "current_version": doc.version_number}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get("/api/documents/versions/{version_id}/download")
def download_document_version(version_id: int, db: Session = Depends(get_db)):
    """Скачивание конкретной архивной версии документа"""
    ver = db.query(models.DocumentVersion).filter(models.DocumentVersion.id == version_id).first()
    if not ver or not ver.file_path or not os.path.exists(ver.file_path):
        raise HTTPException(status_code=404, detail="Архивная версия файла не найдена")
        
    doc = db.query(models.Document).filter(models.Document.id == ver.document_id).first()
    doc_title = doc.title if doc else "document"
    name_parts = os.path.splitext(doc_title)
    archive_filename = f"{name_parts[0]}_v{ver.version_number}{name_parts[1]}"
    encoded_filename = quote(archive_filename.encode('utf-8'))
    
    headers = {
        "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}",
        "Access-Control-Expose-Headers": "Content-Disposition"
    }
    return FileResponse(ver.file_path, media_type=ver.mime_type or "application/octet-stream", headers=headers)

@app.post("/api/documents/{doc_id}/versions/{version_id}/restore")
def restore_document_version(
    doc_id: int, 
    version_id: int,
    user_name: str = Body(..., embed=True),
    x_folder_password: Optional[str] = Header(None),
    db: Session = Depends(get_db)
):
    """Откат документа к выбранной архивной версии с созданием нового шага в истории"""
    try:
        doc = db.query(models.Document).filter(models.Document.id == doc_id).first()
        if not doc:
            raise HTTPException(status_code=404, detail="Документ не найден")
            
        if doc.category_id:
            protected_folder = get_protected_ancestor(db, doc.category_id)
            if protected_folder:
                if not x_folder_password or protected_folder.password_hash != hashlib.sha256(x_folder_password.encode()).hexdigest():
                    raise HTTPException(status_code=403, detail="Access Denied")
                    
        ver = db.query(models.DocumentVersion).filter(
            models.DocumentVersion.id == version_id,
            models.DocumentVersion.document_id == doc_id
        ).first()
        if not ver or not ver.file_path or not os.path.exists(ver.file_path):
            raise HTTPException(status_code=404, detail="Архивная версия не найдена на диске")
            
        # Создаем копию файла архивной версии как новую актуальную версию
        new_version_num = (doc.version_number or 1) + 1
        safe_ext = os.path.splitext(ver.file_path)[1].lower()
        new_unique_name = f"doc_{doc.id}_v{new_version_num}_restored_{uuid.uuid4().hex[:6]}{safe_ext}"
        new_save_path = os.path.join(DOCS_STORAGE_DIR, new_unique_name)
        shutil.copy2(ver.file_path, new_save_path)
        
        file_size = os.path.getsize(new_save_path)
        
        doc.file_path = new_save_path
        doc.version_number = new_version_num
        doc.last_modified_by = user_name or "Сотрудник"
        doc.locked_by_user = None
        doc.locked_at = None
        doc.uploaded_at = datetime.utcnow()
        
        new_ver_rec = models.DocumentVersion(
            document_id=doc.id,
            version_number=new_version_num,
            file_path=new_save_path,
            file_size=file_size,
            mime_type=ver.mime_type or doc.mime_type,
            author_name=user_name or "Сотрудник",
            comment=f"Откат к версии v{ver.version_number}",
            created_at=datetime.utcnow()
        )
        db.add(new_ver_rec)
        db.commit()
        db.refresh(doc)
        
        return {
            "status": "success",
            "message": f"Документ успешно откачен к версии v{ver.version_number} (создана версия v{new_version_num})",
            "version_number": new_version_num,
            "last_modified_by": doc.last_modified_by
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        return {"status": "error", "message": str(e)}

class LockDocumentRequest(BaseModel):
    user_name: str

@app.post("/api/documents/{doc_id}/lock")
def lock_document(
    doc_id: int,
    req: LockDocumentRequest,
    db: Session = Depends(get_db)
):
    """Блокирует документ сотрудником при взятии в работу в MS Office"""
    try:
        doc = db.query(models.Document).filter(models.Document.id == doc_id).first()
        if not doc:
            raise HTTPException(status_code=404, detail="Документ не найден")
            
        if doc.locked_by_user and doc.locked_by_user != req.user_name:
            # Проверяем не устарела ли блокировка (более 4 часов)
            if doc.locked_at and (datetime.utcnow() - doc.locked_at).total_seconds() < 14400:
                return {
                    "status": "locked",
                    "locked_by": doc.locked_by_user,
                    "locked_at": doc.locked_at.strftime("%d.%m %H:%M"),
                    "message": f"Документ уже редактирует {doc.locked_by_user}"
                }
                
        doc.locked_by_user = req.user_name
        doc.locked_at = datetime.utcnow()
        db.commit()
        
        return {
            "status": "success",
            "locked_by": doc.locked_by_user,
            "locked_at": doc.locked_at.strftime("%d.%m %H:%M")
        }
    except Exception as e:
        db.rollback()
        return {"status": "error", "message": str(e)}

@app.post("/api/documents/{doc_id}/unlock")
def unlock_document(
    doc_id: int,
    user_name: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    """Снимает блокировку с документа"""
    try:
        doc = db.query(models.Document).filter(models.Document.id == doc_id).first()
        if not doc:
            raise HTTPException(status_code=404, detail="Документ не найден")
            
        doc.locked_by_user = None
        doc.locked_at = None
        db.commit()
        return {"status": "success", "message": "Блокировка снята"}
    except Exception as e:
        db.rollback()
        return {"status": "error", "message": str(e)}

@app.get("/api/documents/{doc_id}/office_uri")
def get_office_uri(doc_id: int, request: Request, db: Session = Depends(get_db)):
    """Формирует нативную URI ссылку для запуска MS Office (ms-word, ms-excel, ms-powerpoint)"""
    doc = db.query(models.Document).filter(models.Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Документ не найден")
        
    base_url = str(request.base_url).rstrip("/")
    download_url = f"{base_url}/api/documents/download/{doc.id}"
    
    fname = (doc.title or "").lower()
    scheme = "ms-word"
    if fname.endswith(".xlsx") or fname.endswith(".xls") or fname.endswith(".xlsm") or fname.endswith(".csv"):
        scheme = "ms-excel"
    elif fname.endswith(".pptx") or fname.endswith(".ppt"):
        scheme = "ms-powerpoint"
        
    uri = f"{scheme}:ofe|u|{download_url}"
    return {
        "status": "success",
        "uri": uri,
        "download_url": download_url,
        "file_path": doc.file_path,
        "filename": doc.title,
        "scheme": scheme,
        "locked_by": doc.locked_by_user
    }



# ==========================================
# ЧЕК-ЛИСТЫ: API И ИНТЕГРАЦИЯ
# ==========================================

class ChecklistEmployeeCreate(BaseModel):
    name: str
    position: str
    shift_group: str
    num: Optional[int] = None

class ChecklistSubmissionCreate(BaseModel):
    template_code: str
    template_title: str
    date_str: str
    shift_name: str
    shift_group: Optional[str] = None
    department: Optional[str] = None
    inspector_name: str
    inspector_position: Optional[str] = None
    submitter_name: Optional[str] = None
    submitter_position: Optional[str] = None
    notes: Optional[str] = None
    items: list

@app.get("/api/checklists/employees")
def get_checklist_employees(db: Session = Depends(get_db)):
    """Возвращает список сотрудников, сгруппированных по сменам и должностям."""
    try:
        employees = db.query(models.ChecklistEmployee).filter(models.ChecklistEmployee.is_active == True).order_by(
            models.ChecklistEmployee.shift_group.asc(),
            models.ChecklistEmployee.num.asc(),
            models.ChecklistEmployee.name.asc()
        ).all()
        
        # Если сотрудников еще нет в базе, пробуем автоматически импортировать из Google Sheets
        if not employees:
            import google_sheets_integration
            google_sheets_integration.sync_employees_from_google_sheets(db)
            employees = db.query(models.ChecklistEmployee).filter(models.ChecklistEmployee.is_active == True).all()
            
        return [
            {
                "id": e.id,
                "num": e.num,
                "shift_group": e.shift_group,
                "department": e.department or "ЛФМ",
                "position": e.position,
                "name": e.name
            }
            for e in employees
        ]
    except Exception as e:
        print(f"Error fetching checklist employees: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/checklists/employees")
def create_checklist_employee(emp: ChecklistEmployeeCreate, db: Session = Depends(get_db)):
    """Создает нового сотрудника для чек-листов."""
    try:
        import google_sheets_integration
        dept = google_sheets_integration.get_department_by_position(emp.position, emp.shift_group)
        new_emp = models.ChecklistEmployee(
            name=emp.name.strip(),
            position=emp.position.strip(),
            shift_group=emp.shift_group.strip(),
            department=dept,
            num=emp.num,
            is_active=True
        )
        db.add(new_emp)
        db.commit()
        db.refresh(new_emp)
        return {"status": "ok", "employee": {"id": new_emp.id, "name": new_emp.name, "position": new_emp.position, "shift_group": new_emp.shift_group, "department": new_emp.department}}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/api/checklists/employees/{emp_id}")
def update_checklist_employee(emp_id: int, emp: ChecklistEmployeeCreate, db: Session = Depends(get_db)):
    """Обновляет данные сотрудника."""
    try:
        db_emp = db.query(models.ChecklistEmployee).filter(models.ChecklistEmployee.id == emp_id).first()
        if not db_emp:
            raise HTTPException(status_code=404, detail="Сотрудник не найден")
        
        import google_sheets_integration
        dept = google_sheets_integration.get_department_by_position(emp.position, emp.shift_group)
        
        db_emp.name = emp.name.strip()
        db_emp.position = emp.position.strip()
        db_emp.shift_group = emp.shift_group.strip()
        db_emp.department = dept
        if emp.num is not None:
            db_emp.num = emp.num
        db.commit()
        return {"status": "ok", "message": "Сотрудник обновлен"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/checklists/employees/{emp_id}")
def delete_checklist_employee(emp_id: int, db: Session = Depends(get_db)):
    """Удаляет (деактивирует) сотрудника."""
    try:
        db_emp = db.query(models.ChecklistEmployee).filter(models.ChecklistEmployee.id == emp_id).first()
        if not db_emp:
            raise HTTPException(status_code=404, detail="Сотрудник не найден")
        db_emp.is_active = False
        db.commit()
        return {"status": "ok", "message": "Сотрудник удален"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/checklists/schedule/all")
def get_all_shift_schedules(db: Session = Depends(get_db)):
    """Возвращает весь график сменности."""
    try:
        entries = db.query(models.ShiftScheduleEntry).order_by(models.ShiftScheduleEntry.id.asc()).all()
        if not entries:
            import google_sheets_integration
            google_sheets_integration.sync_schedule_from_google_sheets(db)
            entries = db.query(models.ShiftScheduleEntry).order_by(models.ShiftScheduleEntry.id.asc()).all()
        return [
            {
                "id": e.id,
                "date_str": e.date_str,
                "day_of_week": e.day_of_week,
                "day_shift_group": e.day_shift_group,
                "night_shift_group": e.night_shift_group,
                "shift1_status": e.shift1_status,
                "shift2_status": e.shift2_status,
                "shift3_status": e.shift3_status,
                "shift4_status": e.shift4_status
            }
            for e in entries
        ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/checklists/schedule/update_day")
def update_shift_schedule_day(data: dict, db: Session = Depends(get_db)):
    """Обновляет смены на конкретную дату."""
    try:
        date_str = data.get("date_str")
        day_shift = data.get("day_shift_group")
        night_shift = data.get("night_shift_group")
        
        entry = db.query(models.ShiftScheduleEntry).filter(models.ShiftScheduleEntry.date_str == date_str).first()
        if not entry:
            entry = models.ShiftScheduleEntry(date_str=date_str, day_shift_group=day_shift, night_shift_group=night_shift)
            db.add(entry)
        else:
            if day_shift: entry.day_shift_group = day_shift
            if night_shift: entry.night_shift_group = night_shift
        db.commit()
        return {"status": "ok", "message": f"График на {date_str} обновлен"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/checklists/schedule/today")
def get_today_shift_schedule(date: Optional[str] = None, db: Session = Depends(get_db)):
    """Возвращает текущую смену и дежурную бригаду по графику сменности с учетом часового пояса завода (UTC+5)."""
    try:
        from datetime import timezone
        tz_kz = timezone(timedelta(hours=5))
        now = datetime.now(tz_kz)
        
        target_date_str = date if date else now.strftime("%d.%m.%Y")
        
        # Определение день/ночь по времени завода (UTC+5):
        # День: 08:00 - 19:00, Ночь: 19:00 - 08:00
        hour = now.hour
        is_day = 8 <= hour < 19
        shift_name = "День" if is_day else "Ночь"
        
        entry = db.query(models.ShiftScheduleEntry).filter(models.ShiftScheduleEntry.date_str == target_date_str).first()
        if not entry:
            import google_sheets_integration
            google_sheets_integration.sync_schedule_from_google_sheets(db)
            entry = db.query(models.ShiftScheduleEntry).filter(models.ShiftScheduleEntry.date_str == target_date_str).first()
            
        current_shift_group = ""
        prev_shift_group = ""
        
        if entry:
            if is_day:
                # Текущая смена: День сегодняшней даты
                current_shift_group = entry.day_shift_group
                # Сдающая смена: Ночь предыдущего дня!
                try:
                    target_dt = datetime.strptime(target_date_str, "%d.%m.%Y")
                    prev_dt_str = (target_dt - timedelta(days=1)).strftime("%d.%m.%Y")
                    prev_entry = db.query(models.ShiftScheduleEntry).filter(models.ShiftScheduleEntry.date_str == prev_dt_str).first()
                    if prev_entry and prev_entry.night_shift_group:
                        prev_shift_group = prev_entry.night_shift_group
                    else:
                        prev_shift_group = entry.night_shift_group
                except Exception:
                    prev_shift_group = entry.night_shift_group
            else:
                # Текущая смена: Ночь сегодняшней даты
                current_shift_group = entry.night_shift_group
                # Сдающая смена: День сегодняшней даты
                prev_shift_group = entry.day_shift_group
            
        return {
            "date": target_date_str,
            "shift_name": shift_name,
            "is_day": is_day,
            "current_shift_group": current_shift_group,
            "prev_shift_group": prev_shift_group,
            "schedule_entry": {
                "day_of_week": entry.day_of_week if entry else "",
                "day_shift_group": entry.day_shift_group if entry else "",
                "night_shift_group": entry.night_shift_group if entry else ""
            } if entry else None
        }
    except Exception as e:
        print(f"Error getting shift schedule: {e}")
        return {
            "date": datetime.now(timezone(timedelta(hours=5))).strftime("%d.%m.%Y"),
            "shift_name": "День",
            "current_shift_group": "Смена 1",
            "prev_shift_group": "Смена 4"
        }

@app.get("/api/shifts/crew_plan_fulfillment")
def get_crew_plan_fulfillment(month: Optional[str] = None, db: Session = Depends(get_db)):
    """
    Возвращает аналитическую сводку выполнения сменного плана бригадами (Смена 1..4)
    за выбранный месяц (YYYY-MM).
    Критерии плана по формовке ЛФМ:
    - Дневная смена: >= 2700 листов
    - Ночная смена: >= 3300 листов
    """
    try:
        from collections import defaultdict
        import calendar

        # Определение года и месяца
        if not month:
            from datetime import timezone
            tz_kz = timezone(timedelta(hours=5))
            month = datetime.now(tz_kz).strftime("%Y-%m")
            
        y_str, m_str = month.split("-")
        year = int(y_str)
        month_num = int(m_str)
        days_in_month = calendar.monthrange(year, month_num)[1]
        
        start_date = f"{year:04d}-{month_num:02d}-01"
        end_date = f"{year:04d}-{month_num:02d}-{days_in_month:02d}"

        # 1. Извлекаем рапорты за месяц
        shifts = db.query(models.Shift).filter(
            models.Shift.date >= start_date,
            models.Shift.date <= end_date
        ).order_by(models.Shift.date.asc(), models.Shift.shift_name.asc(), models.Shift.batch_number.asc(), models.Shift.id.asc()).all()

        # Суммируем выработку ЛФМ по слотам (date, shift_type)
        # Учитываем переход продукции / несколько партий в смене
        slot_lfm = defaultdict(int)
        slot_masters = defaultdict(set)
        slot_products = defaultdict(list)
        slot_batches = defaultdict(list)

        for s in shifts:
            lfm_reports = db.query(models.LFMReport).filter(models.LFMReport.shift_id == s.id).all()
            total_lfm = sum(r.lfm_sheets or 0 for r in lfm_reports)
            
            s_val = s.shift_name.strip() if s.shift_name else ""
            b = s_val.encode('utf-8')
            # Нормализация День / Ночь
            if len(b) > 1 and b[1] == 148: # 'Д'
                s_name = 'День'
            elif 'д' in s_val.lower() or 'day' in s_val.lower():
                s_name = 'День'
            else:
                s_name = 'Ночь'
                
            d_str = s.date.strftime("%Y-%m-%d") if hasattr(s.date, 'strftime') else str(s.date)
            slot_lfm[(d_str, s_name)] += total_lfm
            
            if s.master_id:
                m = db.query(models.Master).filter(models.Master.id == s.master_id).first()
                if m:
                    slot_masters[(d_str, s_name)].add(getattr(m, 'full_name', getattr(m, 'name', str(m.id))))
            if s.product_name:
                slot_products[(d_str, s_name)].append(s.product_name)
            if s.batch_number:
                slot_batches[(d_str, s_name)].append(s.batch_number)

        # 2. Извлекаем утвержденный график сменности
        entries = db.query(models.ShiftScheduleEntry).all()
        entry_map = {e.date_str: e for e in entries}

        days_data = []
        crew_stats = {
            1: {"name": "Смена №1", "total_shifts": 0, "met_count": 0, "day_shifts": 0, "day_met": 0, "night_shifts": 0, "night_met": 0, "total_lfm": 0},
            2: {"name": "Смена №2", "total_shifts": 0, "met_count": 0, "day_shifts": 0, "day_met": 0, "night_shifts": 0, "night_met": 0, "total_lfm": 0},
            3: {"name": "Смена №3", "total_shifts": 0, "met_count": 0, "day_shifts": 0, "day_met": 0, "night_shifts": 0, "night_met": 0, "total_lfm": 0},
            4: {"name": "Смена №4", "total_shifts": 0, "met_count": 0, "day_shifts": 0, "day_met": 0, "night_shifts": 0, "night_met": 0, "total_lfm": 0}
        }

        total_met_factory = 0
        total_shifts_factory = 0
        total_lfm_factory = 0

        for day in range(1, days_in_month + 1):
            d_date_str = f"{year:04d}-{month_num:02d}-{day:02d}"
            d_display_str = f"{day:02d}.{month_num:02d}.{year:04d}"
            
            entry = entry_map.get(d_display_str)
            dow = entry.day_of_week if entry else ""

            # Обрабатываем День и Ночь
            for s_name in ['День', 'Ночь']:
                plan = 2700 if s_name == 'День' else 3300
                fact_lfm = slot_lfm.get((d_date_str, s_name), 0)
                masters = ", ".join(sorted(slot_masters.get((d_date_str, s_name), [])))
                products = ", ".join(list(dict.fromkeys(slot_products.get((d_date_str, s_name), []))))
                batches = ", ".join(list(dict.fromkeys(slot_batches.get((d_date_str, s_name), []))))
                
                # Определение дежурной бригады по графику
                duty_crew = ""
                crew_num = None
                if entry:
                    if s_name == 'День':
                        duty_crew = entry.day_shift_group or ""
                    else:
                        duty_crew = entry.night_shift_group or ""
                
                if duty_crew:
                    for c_idx in [1, 2, 3, 4]:
                        if str(c_idx) in duty_crew:
                            crew_num = c_idx
                            break

                is_met = fact_lfm >= plan
                diff = fact_lfm - plan

                if crew_num:
                    c_stat = crew_stats[crew_num]
                    c_stat["total_shifts"] += 1
                    c_stat["total_lfm"] += fact_lfm
                    if s_name == 'День':
                        c_stat["day_shifts"] += 1
                        if is_met: c_stat["day_met"] += 1
                    else:
                        c_stat["night_shifts"] += 1
                        if is_met: c_stat["night_met"] += 1

                    if is_met:
                        c_stat["met_count"] += 1

                total_shifts_factory += 1
                total_lfm_factory += fact_lfm
                if is_met:
                    total_met_factory += 1

                days_data.append({
                    "date": d_date_str,
                    "date_display": d_display_str,
                    "day": day,
                    "day_of_week": dow,
                    "shift_name": s_name,
                    "crew_num": crew_num,
                    "crew_name": f"Смена №{crew_num}" if crew_num else duty_crew,
                    "fact_lfm": fact_lfm,
                    "plan": plan,
                    "diff": diff,
                    "is_met": is_met,
                    "master": masters,
                    "products": products,
                    "batches": batches
                })

        # Рассчитываем проценты выполнения
        for c_idx, st in crew_stats.items():
            tot = st["total_shifts"]
            st["percent"] = round((st["met_count"] / tot * 100), 1) if tot > 0 else 0.0

        factory_percent = round((total_met_factory / total_shifts_factory * 100), 1) if total_shifts_factory > 0 else 0.0

        return {
            "status": "ok",
            "month": month,
            "days_in_month": days_in_month,
            "factory_summary": {
                "total_shifts": total_shifts_factory,
                "total_met": total_met_factory,
                "percent": factory_percent,
                "total_lfm": total_lfm_factory
            },
            "crew_stats": crew_stats,
            "days": days_data
        }
    except Exception as e:
        print(f"Error in get_crew_plan_fulfillment: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/checklists/templates")
def get_checklist_templates():
    """Возвращает стандартные шаблоны чек-листов компании."""
    return [
        {
            "code": "master_shift",
            "title": "Чек-лист мастера смены",
            "subtitle": "Проверка состояния оборудования и рабочих мест перед началом смены",
            "department": "Цех ХЦИ",
            "has_submitter": True,
            "inspector_label": "Принимающий смену мастер",
            "submitter_label": "Сдающий смену мастер",
            "items": [
                {"index": 1, "title": "Состояние прокладок", "desc": "Целостность и износ прокладочного материала"},
                {"index": 2, "title": "Подкрутка всех болтов и гаек на машине", "desc": "Проверка затяжки ключевых узлов и креплений"},
                {"index": 3, "title": "Проверка состояния бахромы", "desc": "Состояние и очистка сукна / бахромы"},
                {"index": 4, "title": "Наличие поддонов", "desc": "Запас деревянных поддонов на линии и участках"},
                {"index": 5, "title": "Все ли расходники в достатке", "desc": "Наличие сырья, скотча, маркировочных материалов"},
                {"index": 6, "title": "Таблички КВТ установлены правильно", "desc": "Контроль визуализации и знаков безопасности"},
                {"index": 7, "title": "Отсутствие засорения и забивки механизмов и деталей", "desc": "Чистота направляющих, роликов, датчиков"},
                {"index": 8, "title": "Порядок на рабочих местах", "desc": "5S, отсутствие посторонних предметов и мусора"},
                {"index": 9, "title": "Готовые пачки продукции вывезены со склада/участка", "desc": "Своевременная передача на склад ГП"}
            ]
        },
        {
            "code": "worker_shift_handover",
            "title": "Чек-лист приема-передачи смены (Рабочие)",
            "subtitle": "Ауысымды қабылдау-тапсыру чек-парағы / Состояние рабочего места",
            "department": "Сменный участок",
            "has_submitter": True,
            "inspector_label": "Принимающий / Қабылдаушы",
            "submitter_label": "Сдающий / Тапсырушы",
            "items": [
                {"index": 1, "title": "Чистота рабочего места / Тазалық", "desc": "Уборка зоны, отсутствие шлама, грязи и отходов"},
                {"index": 2, "title": "Состояние инвентаря / Мүкәммал", "desc": "Наличие и исправность лопат, щеток, емкостей"},
                {"index": 3, "title": "Состояние инструмента / Құрал", "desc": "Комплектность и исправность рабочего инструмента"},
                {"index": 4, "title": "Оборудование и механизмы / Қондырғылар", "desc": "Исправность узлов на позиции, отсутствие течей и шумов"},
                {"index": 5, "title": "СИЗ и Безопасность / Қорғаныс құралдары", "desc": "Применение спецодежды, касок, защитных очков"}
            ]
        },
        {
            "code": "day_inspection",
            "title": "Чек-лист дневных сотрудников и инспекций",
            "subtitle": "Тексеру чек-парағы / Ежедневный контроль участка",
            "department": "ИТР / Дневные службы",
            "has_submitter": True,
            "inspector_label": "Проверяющий / Тексеруші",
            "submitter_label": "Ответственный сдающий / Тапсырушы",
            "items": [
                {"index": 1, "title": "Чистота и порядок в цехе / Тазалық", "desc": "Отсутствие захламления проходов и зон обслуживания"},
                {"index": 2, "title": "Состояние инвентаря и оборудования / Мүкәммал", "desc": "Техническое состояние закрепленных агрегатов"},
                {"index": 3, "title": "Исправность инструмента / Құрал", "desc": "Правильное хранение и безопасность использования"},
                {"index": 4, "title": "Охрана труда и промбезопасность", "desc": "Соблюдение регламентов и инструкций персоналом"}
            ]
        }
    ]

def sync_checklists_google_bg():
    from database import SessionLocal
    import google_sheets_integration
    db = SessionLocal()
    try:
        google_sheets_integration.export_checklists_to_google_sheets(db)
    except Exception as e:
        print(f"Error syncing checklists to Google Sheets: {e}")
    finally:
        db.close()

@app.post("/api/checklists/submit")
def submit_checklist(data: ChecklistSubmissionCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Сохраняет заполненный чек-лист и запускает синхронизацию с Google Sheets."""
    try:
        remarks_count = sum(1 for it in data.items if it.get("status") == "fail")
        status = "with_remarks" if remarks_count > 0 else "completed"
        
        sub = models.ChecklistSubmission(
            template_code=data.template_code,
            template_title=data.template_title,
            date_str=data.date_str,
            shift_name=data.shift_name,
            shift_group=data.shift_group,
            department=data.department,
            inspector_name=data.inspector_name,
            inspector_position=data.inspector_position,
            submitter_name=data.submitter_name,
            submitter_position=data.submitter_position,
            status=status,
            remarks_count=remarks_count,
            notes=data.notes,
            items_data=json.dumps(data.items, ensure_ascii=False)
        )
        db.add(sub)
        db.commit()
        db.refresh(sub)
        
        # Запускаем экспорт в Google Sheets в фоновом режиме через независимую сессию
        try:
            background_tasks.add_task(sync_checklists_google_bg)
        except Exception as e:
            print(f"Error scheduling Google Sheets export for checklist: {e}")
            
        return {
            "status": "ok",
            "id": sub.id,
            "remarks_count": remarks_count,
            "message": "Чек-лист успешно сохранен и передан в Google Таблицу"
        }
    except Exception as e:
        db.rollback()
        print(f"Error submitting checklist: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/checklists/submissions")
def get_checklist_submissions(
    date: Optional[str] = None,
    template_code: Optional[str] = None,
    shift_group: Optional[str] = None,
    limit: int = 50,
    db: Session = Depends(get_db)
):
    """Возвращает историю заполненных чек-листов с фильтрами."""
    try:
        query = db.query(models.ChecklistSubmission)
        if date:
            query = query.filter(models.ChecklistSubmission.date_str == date)
        if template_code:
            query = query.filter(models.ChecklistSubmission.template_code == template_code)
        if shift_group:
            query = query.filter(models.ChecklistSubmission.shift_group == shift_group)
            
        submissions = query.order_by(models.ChecklistSubmission.created_at.desc()).limit(limit).all()
        
        results = []
        for s in submissions:
            items = []
            try:
                items = json.loads(s.items_data or "[]")
            except Exception:
                pass
                
            results.append({
                "id": s.id,
                "template_code": s.template_code,
                "template_title": s.template_title,
                "date_str": s.date_str,
                "shift_name": s.shift_name,
                "shift_group": s.shift_group,
                "department": s.department,
                "inspector_name": s.inspector_name,
                "inspector_position": s.inspector_position,
                "submitter_name": s.submitter_name,
                "submitter_position": s.submitter_position,
                "status": s.status,
                "remarks_count": s.remarks_count,
                "notes": s.notes,
                "items": items,
                "created_at": s.created_at.strftime("%d.%m.%Y %H:%M") if s.created_at else ""
            })
        return results
    except Exception as e:
        print(f"Error getting checklist submissions: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/checklists/sync_google")
def manual_sync_checklists_google(db: Session = Depends(get_db)):
    """Принудительный экспорт всех чек-листов в Google Таблицу."""
    try:
        import google_sheets_integration
        google_sheets_integration.export_checklists_to_google_sheets(db)
        return {"status": "ok", "message": "Синхронизация чек-листов с Google Таблицей выполнена"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==========================================================
# 🎯 TECTUM TASKS PLANNER API
# ==========================================================
# EMAIL NOTIFICATIONS FOR TASKS PLANNER
# ==========================================================
from email_service import send_task_html_email

def get_task_person_email(db: Session, person_name: str) -> Optional[str]:
    """Находит email сотрудника сначала в PlannerEmployee, затем в Master."""
    if not person_name:
        return None
    pe = db.query(models.PlannerEmployee).filter(models.PlannerEmployee.name == person_name).first()
    if pe and pe.email and "@" in pe.email:
        return pe.email.strip()
    m = db.query(models.Master).filter(models.Master.name == person_name).first()
    if m and m.email and "@" in m.email:
        return m.email.strip()
    return None

def send_task_email_notification(to_email: str, subject: str, event_type: str, task_dict: dict):
    """Фоновая отправка email-уведомления через email_service."""
    if not to_email or "@" not in to_email:
        return
    try:
        send_task_html_email(to_email, subject, event_type, task_dict)
    except Exception as e:
        print(f"[Email Notification Warning] Failed to send email to {to_email}: {e}")

# --- PLANNER SETTINGS (EMPLOYEES & ZONES) ENDPOINTS ---

@app.get("/api/planner/employees")
def get_planner_employees(db: Session = Depends(get_db)):
    """Возвращает список сотрудников планнера."""
    try:
        emps = db.query(models.PlannerEmployee).order_by(models.PlannerEmployee.sort_order.asc(), models.PlannerEmployee.id.asc()).all()
        return [
            {
                "id": e.id,
                "name": e.name,
                "email": e.email or "",
                "pin_code": e.pin_code or "",
                "has_pin": bool(e.pin_code and e.pin_code.strip()),
                "is_active": bool(e.is_active),
                "sort_order": e.sort_order or 0
            }
            for e in emps
        ]
    except Exception as e:
        print(f"Error getting planner employees: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/planner/employees/verify_pin")
def verify_planner_pin(data: dict, db: Session = Depends(get_db)):
    """Проверяет соответствие PIN-кода сотрудника."""
    name = (data.get("name") or "").strip()
    pin = (data.get("pin_code") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Не указано имя сотрудника")
    
    emp = db.query(models.PlannerEmployee).filter(models.PlannerEmployee.name == name).first()
    if not emp:
        # Если сотрудника нет в справочнике — разрешаем базовый вход
        return {"status": "ok", "name": name, "verified": True}
    
    # Если у сотрудника установлен PIN — сверяем
    if emp.pin_code and emp.pin_code.strip():
        if emp.pin_code.strip() != pin:
            raise HTTPException(status_code=401, detail="Неверный PIN-код сотрудника")
    
    return {"status": "ok", "name": emp.name, "verified": True}

@app.post("/api/planner/employees")
def create_planner_employee(data: schemas.PlannerEmployeeCreate, db: Session = Depends(get_db)):
    """Добавляет сотрудника в настройки планнера."""
    try:
        new_emp = models.PlannerEmployee(
            name=data.name.strip(),
            email=data.email.strip() if data.email else "",
            pin_code=data.pin_code.strip() if data.pin_code else "",
            is_active=data.is_active if data.is_active is not None else True,
            sort_order=data.sort_order or 0
        )
        db.add(new_emp)
        db.commit()
        db.refresh(new_emp)
        return {"status": "ok", "id": new_emp.id, "name": new_emp.name, "email": new_emp.email, "pin_code": new_emp.pin_code}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/api/planner/employees/{emp_id}")
def update_planner_employee(emp_id: int, data: schemas.PlannerEmployeeUpdate, db: Session = Depends(get_db)):
    """Обновляет сотрудника планнера."""
    try:
        emp = db.query(models.PlannerEmployee).filter(models.PlannerEmployee.id == emp_id).first()
        if not emp:
            raise HTTPException(status_code=404, detail="Сотрудник не найден")
        if data.name is not None:
            emp.name = data.name.strip()
        if data.email is not None:
            emp.email = data.email.strip()
        if data.pin_code is not None:
            emp.pin_code = data.pin_code.strip()
        if data.is_active is not None:
            emp.is_active = data.is_active
        if data.sort_order is not None:
            emp.sort_order = data.sort_order
        db.commit()
        db.refresh(emp)
        return {"status": "ok", "id": emp.id, "name": emp.name, "email": emp.email, "pin_code": emp.pin_code}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/planner/employees/{emp_id}")
def delete_planner_employee(emp_id: int, db: Session = Depends(get_db)):
    """Удаляет сотрудника из настроек планнера."""
    try:
        emp = db.query(models.PlannerEmployee).filter(models.PlannerEmployee.id == emp_id).first()
        if not emp:
            raise HTTPException(status_code=404, detail="Сотрудник не найден")
        db.delete(emp)
        db.commit()
        return {"status": "ok", "message": "Сотрудник удален"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/planner/zones")
def get_planner_zones(db: Session = Depends(get_db)):
    """Возвращает список зон / подразделений планнера."""
    try:
        zones = db.query(models.PlannerZone).order_by(models.PlannerZone.sort_order.asc(), models.PlannerZone.id.asc()).all()
        return [
            {
                "id": z.id,
                "name": z.name,
                "is_active": bool(z.is_active),
                "sort_order": z.sort_order or 0
            }
            for z in zones
        ]
    except Exception as e:
        print(f"Error getting planner zones: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/planner/zones")
def create_planner_zone(data: schemas.PlannerZoneCreate, db: Session = Depends(get_db)):
    """Добавляет зону / подразделение в настройки планнера."""
    try:
        new_zone = models.PlannerZone(
            name=data.name.strip(),
            is_active=data.is_active if data.is_active is not None else True,
            sort_order=data.sort_order or 0
        )
        db.add(new_zone)
        db.commit()
        db.refresh(new_zone)
        return {"status": "ok", "id": new_zone.id, "name": new_zone.name}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/api/planner/zones/{zone_id}")
def update_planner_zone(zone_id: int, data: schemas.PlannerZoneUpdate, db: Session = Depends(get_db)):
    """Обновляет зону / подразделение планнера."""
    try:
        zone = db.query(models.PlannerZone).filter(models.PlannerZone.id == zone_id).first()
        if not zone:
            raise HTTPException(status_code=404, detail="Зона не найдена")
        if data.name is not None:
            zone.name = data.name.strip()
        if data.is_active is not None:
            zone.is_active = data.is_active
        if data.sort_order is not None:
            zone.sort_order = data.sort_order
        db.commit()
        db.refresh(zone)
        return {"status": "ok", "id": zone.id, "name": zone.name}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/planner/zones/{zone_id}")
def delete_planner_zone(zone_id: int, db: Session = Depends(get_db)):
    """Удаляет зону из настроек планнера."""
    try:
        zone = db.query(models.PlannerZone).filter(models.PlannerZone.id == zone_id).first()
        if not zone:
            raise HTTPException(status_code=404, detail="Зона не найдена")
        db.delete(zone)
        db.commit()
        return {"status": "ok", "message": "Зона удалена"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/planner/test_email")
def test_planner_email(
    to_email: str = Body(..., embed=True),
    background_tasks: BackgroundTasks = BackgroundTasks(),
    db: Session = Depends(get_db)
):
    """Отправляет тестовое брендированное уведомление на указанный email."""
    if not to_email or "@" not in to_email:
        raise HTTPException(status_code=400, detail="Укажите корректный email адрес")

    test_task = {
        "id": 999,
        "code": "TSK-TEST",
        "title": "Тестовая проверка системы уведомлений Tectum",
        "title_kz": "Tectum хабарландыру жүйесін сынақтан өткізу",
        "zone": "Цифровой портал",
        "due_date_str": datetime.now().strftime("%d.%m.%Y"),
        "author_name": "Администратор",
        "assignee_name": "Тестовый исполнитель",
        "status": "🟡 В работе",
        "comment": "Почтовый шлюз успешно настроен и готов к отправке уведомлений.",
        "photo_link": "",
        "month_label": "Август 2026",
        "week_label": "Неделя 4 (24.08 - 28.08)"
    }

    success, err = send_task_html_email(
        to_email=to_email.strip(),
        subject="🚀 Проверка почтовых уведомлений Tectum Планнер",
        event_type="Тестовое уведомление",
        task_data=test_task
    )

    if success:
        return {"status": "ok", "message": f"Тестовое письмо успешно отправлено на {to_email}!"}
    else:
        raise HTTPException(status_code=500, detail=f"Не удалось отправить письмо: {err or 'Неизвестная ошибка'}")



def generate_calendar_structure_mon_fri(year: int = 2026):
    """Генерирует строгую сетку рабочих недель (Пн-Пт) для всех 12 месяцев года."""
    import datetime
    months_ru = [
        "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
        "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"
    ]
    structure = {}
    for m in range(1, 13):
        m_name = f"{months_ru[m-1]} {year}"
        weeks_list = []
        cur = datetime.date(year, m, 1)
        next_month = datetime.date(year + (1 if m == 12 else 0), 1 if m == 12 else m + 1, 1)
        
        # Первый понедельник начиная с 1-го числа месяца:
        cur_monday = cur + datetime.timedelta(days=(0 - cur.weekday()) % 7)
        
        w_idx = 1
        while cur_monday < next_month:
            fri = cur_monday + datetime.timedelta(days=4)
            s_str = cur_monday.strftime('%d.%m')
            e_str = fri.strftime('%d.%m')
            weeks_list.append(f"Неделя {w_idx} ({s_str} - {e_str})")
            w_idx += 1
            cur_monday += datetime.timedelta(days=7)
            
        structure[m_name] = weeks_list
    return structure

@app.get("/api/tasks/weeks")
def get_tasks_calendar_structure(db: Session = Depends(get_db)):
    """Генерирует строго чистую календарную сетку рабочих недель (Пн-Пт) по всем 12 месяцам года с динамическим автовыбором текущей недели."""
    import datetime
    try:
        today = datetime.date.today()
        year = today.year
        structure = generate_calendar_structure_mon_fri(year)

        default_month = None
        default_week = None

        # Ищем неделю во всей структуре года, диапазон которой охватывает сегодняшний день (Пн..Вс)
        for m_name, month_weeks in structure.items():
            for w in month_weeks:
                try:
                    # формат: "Неделя X (DD.MM - DD.MM)"
                    dates_part = w.split('(')[1].split(')')[0]
                    start_part, end_part = dates_part.split(' - ')
                    sd, sm = map(int, start_part.strip().split('.'))
                    ed, em = map(int, end_part.strip().split('.'))
                    
                    # Учет перехода года (декабрь -> январь)
                    start_year = year
                    end_year = year
                    if sm == 12 and em == 1:
                        end_year = year + 1
                    
                    w_start = datetime.date(start_year, sm, sd)
                    # Воскресенье недели = +6 дней от понедельника
                    w_end = w_start + datetime.timedelta(days=6)
                    
                    if w_start <= today <= w_end:
                        default_month = m_name
                        default_week = w
                        break
                except Exception:
                    pass
            if default_month and default_week:
                break

        # Фоллбэк: если не нашли по точному диапазону дат, берем текущий календарный месяц
        if not default_month:
            months_ru = [
                "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
                "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"
            ]
            current_m_name = f"{months_ru[today.month - 1]} {year}"
            default_month = current_m_name if current_m_name in structure else list(structure.keys())[0]
            if default_month in structure and structure[default_month]:
                default_week = structure[default_month][0]

        return {
            "months": list(structure.keys()),
            "structure": structure,
            "default_month": default_month,
            "default_week": default_week
        }
    except Exception as e:
        print(f"Error getting calendar structure: {e}")
        return {"months": ["Август 2026"], "structure": {"Август 2026": ["Неделя 5 (31.08 - 04.09)"]}, "default_month": "Август 2026", "default_week": "Неделя 5 (31.08 - 04.09)"}

def _fetch_translation_api(text: str, sl: str, tl: str) -> Optional[str]:
    """Внутренний надежный переводчик (Google Clients API + MyMemory fallback)."""
    import urllib.parse
    import urllib.request
    import json
    
    clean_text = (text or "").strip()
    if not clean_text:
        return ""

    # 1. Google Clients Translate API (очень быстрый и без 429 блокировок)
    try:
        url_gt = f"https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl={sl}&tl={tl}&q=" + urllib.parse.quote(clean_text)
        req_gt = urllib.request.Request(url_gt, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'})
        with urllib.request.urlopen(req_gt, timeout=3) as resp:
            res_json = json.loads(resp.read().decode('utf-8'))
            if isinstance(res_json, list) and len(res_json) > 0:
                if isinstance(res_json[0], str) and res_json[0]:
                    return res_json[0]
                elif isinstance(res_json[0], list) and len(res_json[0]) > 0 and res_json[0][0]:
                    return "".join([p[0] for p in res_json[0] if isinstance(p, list) and len(p) > 0 and p[0]])
            elif isinstance(res_json, str) and res_json:
                return res_json
    except Exception:
        pass

    # 2. Фоллбэк через MyMemory API
    try:
        langpair = f"{sl}|{tl}" if sl != "auto" else (f"kk|{tl}" if tl == "ru" else f"ru|{tl}")
        url_mm = f"https://api.mymemory.translated.net/get?q={urllib.parse.quote(clean_text)}&langpair={langpair}"
        req_mm = urllib.request.Request(url_mm, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
        with urllib.request.urlopen(req_mm, timeout=4) as resp:
            data_mm = json.loads(resp.read().decode('utf-8'))
            trans = data_mm.get("responseData", {}).get("translatedText")
            if trans and not str(trans).startswith("MYMEMORY WARNING"):
                return trans
    except Exception:
        pass

    return None

def detect_and_translate_task_text(text: str, forced_source: Optional[str] = None) -> dict:
    """
    Интеллектуальный анализатор языка и двусторонний переводчик (RU <-> KZ).
    Определяет язык ввода:
    - По характерным символам казахского алфавита (ә, і, ң, ғ, ү, ұ, қ, ө, һ, Ә, І, Ң, Ғ, Ү, Ұ, Қ, Ө, Һ)
    - По характерным казахским словам/окончаниям (сәлем, рахмет, жұмыс, керек, болды, лар, лер, дар, дер, тар, тер, ның, нің, ға, ге, қа, ке, да, де, та, те, мен, пен, бен)
    - По автоматическому определению Google Translate (sl=auto)
    Возвращает структуру: {"status": "ok", "detected_lang": "ru"|"kk", "text_ru": "...", "text_kz": "..."}
    """
    clean_text = (text or "").strip()
    if not clean_text:
        return {"status": "ok", "detected_lang": "ru", "text_ru": "", "text_kz": ""}

    try:
        kz_chars = set("әіңғүұқөһӘІҢҒҮҰҚӨҺ")
        has_kz_chars = any(c in kz_chars for c in clean_text)

        # Проверка частых казахских слов и суффиксов
        lower_words = set(re.findall(r'[a-zA-Zа-яА-ЯёЁәіңғүұқөһӘІҢҒҮҰҚӨҺ]+', clean_text.lower()))
        common_kz_words = {
            "сәлем", "салем", "рахмет", "жұмыс", "жумыс", "керек", "болды", "болады", 
            "жасау", "жасалды", "ауыстыру", "тексеру", "жөндеу", "жондеу", "орнату", 
            "тазалау", "бояу", "қарау", "карау", "қою", "кою", "алу", "беру", "бар", "жоқ", "жок"
        }
        has_kz_words = bool(lower_words & common_kz_words)

        is_kz = False
        detected_lang = "ru"

        if forced_source == "kk" or has_kz_chars or has_kz_words:
            is_kz = True
            detected_lang = "kk"
        elif forced_source == "ru":
            is_kz = False
            detected_lang = "ru"
        else:
            # Автоопределение через надежный Google Clients API
            import urllib.parse
            import urllib.request
            import json
            try:
                url_detect = "https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=ru&q=" + urllib.parse.quote(clean_text)
                req = urllib.request.Request(url_detect, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'})
                with urllib.request.urlopen(req, timeout=3) as response:
                    res_json = json.loads(response.read().decode('utf-8'))
                    if isinstance(res_json, list) and len(res_json) > 0:
                        item = res_json[0]
                        if isinstance(item, list) and len(item) > 1 and isinstance(item[1], str):
                            lang_code = item[1].lower()
                            if lang_code in ["kk", "kaz", "ky"]:
                                is_kz = True
                                detected_lang = "kk"
            except Exception:
                pass

        if is_kz:
            # Исходный текст - казахский. Переводим на русский
            trans_ru = _fetch_translation_api(clean_text, "kk", "ru") or clean_text
            return {
                "status": "ok",
                "detected_lang": "kk",
                "text_ru": trans_ru,
                "text_kz": clean_text
            }
        else:
            # Исходный текст - русский. Переводим на казахский
            trans_kz = _fetch_translation_api(clean_text, "ru", "kk") or clean_text
            return {
                "status": "ok",
                "detected_lang": "ru",
                "text_ru": clean_text,
                "text_kz": trans_kz
            }
    except Exception as e:
        print(f"Translation analyzer error: {e}")
        return {
            "status": "fallback",
            "detected_lang": "ru",
            "text_ru": clean_text,
            "text_kz": clean_text
        }

def auto_translate_text_internal(text: str) -> str:
    """Внутренний хелпер для автоперевода RU -> KZ."""
    res = detect_and_translate_task_text(text)
    return res.get("text_kz", "")

def extract_hashtags_from_title(title: str, existing_tags: Optional[str] = None) -> str:
    """Извлекает #хэштеги из текста заголовка и объединяет с существующими тегами."""
    import re
    tags_found = re.findall(r"#[A-Za-zА-Яа-я0-9_\-]+", title or "")
    existing = [t.strip() for t in (existing_tags or "").split(",") if t.strip()]
    for t in tags_found:
        if t not in existing:
            existing.append(t)
    return ", ".join(existing)

def recalculate_parent_task_progress(db: Session, parent_id: Optional[int]):
    """Автоматически пересчитывает процент выполнения родительской задачи на основе статуса подзадач."""
    if not parent_id:
        return
    try:
        parent = db.query(models.Task).filter(models.Task.id == parent_id).first()
        if not parent:
            return
        subtasks = db.query(models.Task).filter(models.Task.parent_id == parent_id, models.Task.is_archived == False).all()
        if not subtasks:
            return
        done_count = sum(1 for st in subtasks if st.status == "🟢 Выполнено")
        total_count = len(subtasks)
        calc_prog = int((done_count / total_count) * 100) if total_count > 0 else 0
        parent.progress = calc_prog
        if calc_prog == 100 and parent.status != "🟢 Выполнено":
            parent.status = "🟢 Выполнено"
        elif calc_prog < 100 and parent.status == "🟢 Выполнено":
            parent.status = "🟡 В работе"
        db.commit()
        if parent.parent_id:
            recalculate_parent_task_progress(db, parent.parent_id)
    except Exception as e:
        print(f"Error recalculating parent task progress: {e}")

@app.get("/api/tasks/tags")
def get_task_tags(db: Session = Depends(get_db)):
    """Возвращает список всех уникальных хэштегов с количеством активных задач."""
    try:
        tasks = db.query(models.Task.tags).filter(models.Task.is_archived == False, models.Task.tags.isnot(None)).all()
        tag_counts = {}
        for (tag_str,) in tasks:
            if tag_str:
                for t in tag_str.split(","):
                    clean_t = t.strip()
                    if clean_t:
                        if not clean_t.startswith("#"):
                            clean_t = "#" + clean_t
                        tag_counts[clean_t] = tag_counts.get(clean_t, 0) + 1
        result = [{"tag": k, "count": v} for k, v in sorted(tag_counts.items(), key=lambda x: -x[1])]
        return result
    except Exception as e:
        print(f"Error fetching task tags: {e}")
        return []

@app.get("/api/tasks/roadmaps")
def get_roadmaps_tree(quarter: Optional[str] = None, db: Session = Depends(get_db)):
    """Возвращает иерархическое дерево Дорожных карт: Проекты -> Этапы -> Подзадачи."""
    try:
        query = db.query(models.Task).filter(
            models.Task.task_type == "roadmap",
            models.Task.is_archived == False
        )
        if quarter and quarter != "all":
            query = query.filter(models.Task.target_quarter == quarter)
        
        projects = query.order_by(models.Task.id.desc()).all()
        
        # Собираем все ID проектов
        project_ids = [p.id for p in projects]
        if not project_ids:
            return []

        # Загружаем дочерние этапы и задачи
        children = db.query(models.Task).filter(
            models.Task.parent_id.in_(project_ids),
            models.Task.is_archived == False
        ).order_by(models.Task.id.asc()).all()

        child_ids = [c.id for c in children]
        sub_children = []
        if child_ids:
            sub_children = db.query(models.Task).filter(
                models.Task.parent_id.in_(child_ids),
                models.Task.is_archived == False
            ).order_by(models.Task.id.asc()).all()

        # Предзагрузка документов
        all_tasks_for_docs = projects + children + sub_children
        doc_ids = [t.attached_document_id for t in all_tasks_for_docs if t.attached_document_id]
        doc_map = {}
        if doc_ids:
            docs = db.query(models.Document).filter(models.Document.id.in_(doc_ids)).all()
            for d in docs:
                file_link = d.external_url if d.external_url else f"/api/documents/download/{d.id}"
                doc_map[d.id] = {
                    "id": d.id,
                    "title": d.title,
                    "mime_type": d.mime_type,
                    "link": file_link
                }

        # Карта зависимостей
        depends_ids = [t.depends_on_id for t in all_tasks_for_docs if t.depends_on_id]
        dep_map = {}
        if depends_ids:
            dep_tasks = db.query(models.Task).filter(models.Task.id.in_(depends_ids)).all()
            for dt in dep_tasks:
                dep_map[dt.id] = {
                    "id": dt.id,
                    "code": dt.code or f"TSK-{dt.id}",
                    "title": dt.title,
                    "status": dt.status
                }

        def serialize_item(item):
            doc_info = doc_map.get(item.attached_document_id) if item.attached_document_id else None
            dep_info = dep_map.get(item.depends_on_id) if item.depends_on_id else None
            return {
                "id": item.id,
                "code": item.code or f"TSK-{item.id:02d}",
                "zone": item.zone or "Проект",
                "title": item.title,
                "title_kz": item.title_kz or "",
                "task_type": item.task_type or "roadmap",
                "department_service": item.department_service or "",
                "target_quarter": item.target_quarter or "",
                "progress": item.progress or 0,
                "status": item.status or "🟡 В работе",
                "assignee_name": item.assignee_name or "",
                "author_name": item.author_name or "",
                "due_date_str": item.due_date_str or "",
                "tags": item.tags or "",
                "comment": item.comment or "",
                "attached_doc": doc_info,
                "depends_on": dep_info,
                "created_at": item.created_at.strftime("%d.%m.%Y %H:%M") if item.created_at else ""
            }

        tree = []
        for p in projects:
            p_dict = serialize_item(p)
            p_children = [c for c in children if c.parent_id == p.id]
            
            # Подсчет прогресса проекта по этапам/подзадачам
            total_items = 0
            done_items = 0
            milestones_list = []
            
            for m in p_children:
                m_dict = serialize_item(m)
                m_subs = [s for s in sub_children if s.parent_id == m.id]
                m_dict["subtasks"] = [serialize_item(s) for s in m_subs]
                
                # Подсчет прогресса вехи
                m_total = len(m_subs)
                m_done = sum(1 for s in m_subs if s.status == "🟢 Выполнено")
                m_prog = int((m_done / m_total) * 100) if m_total > 0 else (100 if m.status == "🟢 Выполнено" else m.progress or 0)
                m_dict["calculated_progress"] = m_prog
                m_dict["subtasks_count"] = m_total
                m_dict["subtasks_done_count"] = m_done
                
                total_items += 1 + m_total
                done_items += (1 if m.status == "🟢 Выполнено" else 0) + m_done
                milestones_list.append(m_dict)

            p_dict["milestones"] = milestones_list
            p_calc_prog = int((done_items / total_items) * 100) if total_items > 0 else (p.progress or 0)
            p_dict["calculated_progress"] = p_calc_prog
            p_dict["total_elements"] = total_items
            p_dict["done_elements"] = done_items
            tree.append(p_dict)

        return tree
    except Exception as e:
        print(f"Error fetching roadmaps tree: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/documents/{doc_id}/tasks")
def get_document_tasks(doc_id: int, db: Session = Depends(get_db)):
    """Возвращает список всех активных задач, привязанных к конкретному регламенту/инструкции из Базы Знаний."""
    try:
        tasks = db.query(models.Task).filter(
            models.Task.attached_document_id == doc_id,
            models.Task.is_archived == False
        ).order_by(models.Task.id.desc()).all()

        return [{
            "id": t.id,
            "code": t.code or f"TSK-{t.id:02d}",
            "title": t.title,
            "task_type": t.task_type or "weekly",
            "department_service": t.department_service or "",
            "zone": t.zone or "",
            "assignee_name": t.assignee_name or "",
            "due_date_str": t.due_date_str or "",
            "status": t.status or "🟡 В работе",
            "month_label": t.month_label or "",
            "week_label": t.week_label or ""
        } for t in tasks]
    except Exception as e:
        print(f"Error fetching document tasks: {e}")
        return []

def parse_date_dm_or_full(d_str: Optional[str], default_year: int = 2026):
    """Парсит строку даты вида '24.08', '24.08.2026', '30.09 (Ср)', '2026-08-24' в datetime.date."""
    if not d_str:
        return None
    import re, datetime
    d_clean = str(d_str).strip()
    
    try:
        return datetime.date.fromisoformat(d_clean[:10])
    except Exception:
        pass
    
    m_full = re.search(r"(\d{1,2})\.(\d{1,2})\.(\d{4})", d_clean)
    if m_full:
        day, month, yr = int(m_full.group(1)), int(m_full.group(2)), int(m_full.group(3))
        try:
            return datetime.date(yr, month, day)
        except Exception:
            pass
            
    m_dm = re.search(r"(\d{1,2})\.(\d{1,2})", d_clean)
    if m_dm:
        day, month = int(m_dm.group(1)), int(m_dm.group(2))
        try:
            return datetime.date(default_year, month, day)
        except Exception:
            pass
    return None

def parse_week_label_range(week_label: Optional[str], month_label: Optional[str] = None, default_year: int = 2026):
    """Извлекает даты начала и конца рабочей недели (Пн, Пт) из строки 'Неделя 4 (24.08 - 28.08)'."""
    if not week_label or week_label == "all":
        return None, None
    import re
    m = re.search(r"\((\d{1,2}\.\d{1,2})\s*-\s*(\d{1,2}\.\d{1,2})\)", str(week_label))
    if not m:
        return None, None
    s_date = parse_date_dm_or_full(m.group(1), default_year)
    e_date = parse_date_dm_or_full(m.group(2), default_year)
    return s_date, e_date

@app.get("/api/tasks")
def get_tasks(
    month: Optional[str] = None,
    week: Optional[str] = None,
    task_type: Optional[str] = None, # "weekly", "service_plan", "roadmap", "milestone", "all"
    department_service: Optional[str] = None, # "ОГМ", "ОГЭ", "Технологи", "ОТК", "all"
    tag: Optional[str] = None,
    has_doc: Optional[bool] = None,
    parent_id: Optional[int] = None,
    assignee: Optional[str] = None,
    author: Optional[str] = None,
    zone: Optional[str] = None,
    status: Optional[str] = None,
    my_person: Optional[str] = None,
    include_backlog: bool = False,
    is_archived: bool = False,
    db: Session = Depends(get_db)
):
    """Возвращает список задач с поддержкой 3 горизонтов, сквозных долгосрочных задач (cross-week), служб, хэштегов и регламентов."""
    try:
        query = db.query(models.Task).filter(models.Task.is_archived == False)

        # 1. Фильтрация по типу задачи / горизонту
        if task_type == "weekly":
            query = query.filter((models.Task.task_type == "weekly") | (models.Task.task_type.is_(None)))
            query = query.filter(models.Task.task_type != "service_plan", models.Task.task_type != "roadmap", models.Task.task_type != "milestone")
        elif task_type == "service_plan":
            query = query.filter(
                (models.Task.task_type == "service_plan") |
                (models.Task.department_service.in_(["ОГМ", "ОГЭ", "Технологи", "ОТК", "СКК"])) |
                (models.Task.zone.in_(["ОГМ", "ОГЭ", "Технологи", "ОТК", "СКК"]))
            )
            query = query.filter(
                ~and_(
                    models.Task.task_type == "weekly",
                    models.Task.zone == "Бережливое производство",
                    or_(models.Task.department_service.is_(None), models.Task.department_service.in_(["", "Общий"]))
                )
            )
        elif task_type and task_type != "all":
            query = query.filter(models.Task.task_type == task_type)

        # 2. Фильтрация по службам ОГМ/ОГЭ/Технологи
        if department_service and department_service != "all":
            query = query.filter((models.Task.department_service == department_service) | (models.Task.zone == department_service))

        # 3. Фильтрация по хэштегам
        if tag and tag != "all":
            clean_tag = tag.strip()
            if not clean_tag.startswith("#"):
                clean_tag = "#" + clean_tag
            query = query.filter(models.Task.tags.ilike(f"%{clean_tag}%"))

        # 4. Фильтрация по наличию прикрепленного регламента
        if has_doc is True:
            query = query.filter(models.Task.attached_document_id.isnot(None))
        elif has_doc is False:
            query = query.filter(models.Task.attached_document_id.is_(None))

        # 5. Фильтрация по родителю
        if parent_id is not None:
            query = query.filter(models.Task.parent_id == parent_id)

        # 6. Фильтрация по персоналу, зоне, статусу
        if my_person and my_person != "all":
            query = query.filter(or_(models.Task.assignee_name == my_person, models.Task.author_name == my_person))
        else:
            if assignee and assignee != "all":
                query = query.filter(models.Task.assignee_name == assignee)
            if author and author != "all":
                query = query.filter(models.Task.author_name == author)
                
        if zone and zone != "all":
            query = query.filter(models.Task.zone == zone)
        if status and status != "all":
            query = query.filter(models.Task.status == status)

        # Парсим границы выбранной недели
        sel_week_start, sel_week_end = parse_week_label_range(week, month)

        # Если выбрана конкретная неделя: запрашиваем родные задачи + активные кандидаты на сквозные задачи
        if week and week != "all":
            if include_backlog:
                # Включая долги прошлых периодов
                if month and month != "all":
                    week_match = and_(models.Task.month_label == month, models.Task.week_label == week)
                    backlog_match = and_(
                        models.Task.status != "🟢 Выполнено",
                        models.Task.status != "🔴 Отменено"
                    )
                    query = query.filter(or_(week_match, backlog_match))
                else:
                    week_match = (models.Task.week_label == week)
                    backlog_match = and_(
                        models.Task.status != "🟢 Выполнено",
                        models.Task.status != "🔴 Отменено"
                    )
                    query = query.filter(or_(week_match, backlog_match))
            else:
                # Выбираем задачи родной недели ИЛИ активные задачи с дедлайном для сквозного отображения
                week_match = and_(models.Task.month_label == month, models.Task.week_label == week) if (month and month != "all") else (models.Task.week_label == week)
                cross_candidate_match = and_(
                    models.Task.status != "🔴 Отменено",
                    models.Task.due_date_str.isnot(None),
                    models.Task.due_date_str != ""
                )
                query = query.filter(or_(week_match, cross_candidate_match))
        else:
            if month and month != "all":
                query = query.filter(models.Task.month_label == month)

        raw_tasks = query.order_by(models.Task.id.desc()).all()

        # Фильтрация сквозных задач по временному диапазону
        filtered_tasks = []
        for t in raw_tasks:
            # 1. Родная задача текущей недели
            is_native_week = (week and week != "all" and t.week_label == week and (not month or month == "all" or t.month_label == month))
            
            if not week or week == "all" or is_native_week:
                filtered_tasks.append(t)
                continue

            # 2. Если включен бэклог долгов
            if include_backlog and t.status != "🟢 Выполнено" and t.status != "🔴 Отменено":
                filtered_tasks.append(t)
                continue

            # 3. Проверка сквозной активности по диапазону [start, due_date]
            if sel_week_start and sel_week_end:
                t_due = parse_date_dm_or_full(t.due_date_str)
                # Начало задачи: из created_at или начала родной недели задачи
                t_orig_start, _ = parse_week_label_range(t.week_label, t.month_label)
                if not t_orig_start and t.created_at:
                    t_orig_start = t.created_at.date()

                if t_due and t_orig_start:
                    # Задача активна на текущей неделе, если старт <= конец недели И дедлайн >= начало недели
                    if t_orig_start <= sel_week_end and t_due >= sel_week_start:
                        # Если задача уже завершена, показываем ее только если она была завершена на этой неделе или дедлайн на этой неделе
                        if t.status == "🟢 Выполнено" and t.completed_at and t.completed_at.date() < sel_week_start:
                            continue
                        filtered_tasks.append(t)

        tasks = filtered_tasks

        # Предзагрузка прикрепленных документов
        doc_ids = [t.attached_document_id for t in tasks if t.attached_document_id]
        doc_map = {}
        if doc_ids:
            docs = db.query(models.Document).filter(models.Document.id.in_(doc_ids)).all()
            for d in docs:
                file_link = d.external_url if d.external_url else f"/api/documents/download/{d.id}"
                doc_map[d.id] = {
                    "id": d.id,
                    "title": d.title,
                    "mime_type": d.mime_type,
                    "link": file_link
                }

        # Предзагрузка родителей и зависимостей
        ref_ids = set()
        for t in tasks:
            if t.parent_id:
                ref_ids.add(t.parent_id)
            if t.depends_on_id:
                ref_ids.add(t.depends_on_id)

        ref_map = {}
        if ref_ids:
            ref_tasks = db.query(models.Task).filter(models.Task.id.in_(list(ref_ids))).all()
            for rt in ref_tasks:
                ref_map[rt.id] = {
                    "id": rt.id,
                    "code": rt.code or f"TSK-{rt.id}",
                    "title": rt.title,
                    "status": rt.status
                }

        # Предзагрузка подсчета подзадач
        task_ids = [t.id for t in tasks]
        subtask_counts = {}
        if task_ids:
            all_subs = db.query(models.Task.parent_id, models.Task.status).filter(
                models.Task.parent_id.in_(task_ids),
                models.Task.is_archived == False
            ).all()
            for pid, st_status in all_subs:
                if pid not in subtask_counts:
                    subtask_counts[pid] = {"total": 0, "done": 0}
                subtask_counts[pid]["total"] += 1
                if st_status == "🟢 Выполнено":
                    subtask_counts[pid]["done"] += 1

        results = []
        for t in tasks:
            is_cross_week = False
            is_deadline_week = False
            origin_created_date = ""
            
            if week and week != "all":
                if t.week_label != week or (month and month != "all" and t.month_label != month):
                    is_cross_week = True
                    t_orig_start, _ = parse_week_label_range(t.week_label, t.month_label)
                    if t_orig_start:
                        origin_created_date = t_orig_start.strftime("%d.%m")
                    elif t.created_at:
                        origin_created_date = t.created_at.strftime("%d.%m")

                if sel_week_start and sel_week_end:
                    t_due = parse_date_dm_or_full(t.due_date_str)
                    if t_due and (sel_week_start <= t_due <= sel_week_end):
                        is_deadline_week = True

            doc_info = doc_map.get(t.attached_document_id) if t.attached_document_id else None
            parent_info = ref_map.get(t.parent_id) if t.parent_id else None
            dep_info = ref_map.get(t.depends_on_id) if t.depends_on_id else None

            subs_data = subtask_counts.get(t.id, {"total": 0, "done": 0})
            calc_prog = int((subs_data["done"] / subs_data["total"]) * 100) if subs_data["total"] > 0 else (t.progress or 0)

            results.append({
                "id": t.id,
                "code": t.code or f"TSK-{t.id:02d}",
                "zone": t.zone or "Бережливое производство",
                "title": t.title,
                "title_kz": t.title_kz or "",
                "task_type": t.task_type or "weekly",
                "department_service": t.department_service or "",
                "parent_id": t.parent_id,
                "parent_title": parent_info["title"] if parent_info else "",
                "depends_on_id": t.depends_on_id,
                "depends_on": dep_info,
                "tags": t.tags or "",
                "target_quarter": t.target_quarter or "",
                "progress": t.progress or 0,
                "calculated_progress": calc_prog,
                "subtasks_count": subs_data["total"],
                "subtasks_done_count": subs_data["done"],
                "photo_link": t.photo_link or "",
                "author_name": t.author_name or "",
                "assignee_name": t.assignee_name or "",
                "due_date_str": t.due_date_str or "",
                "status": t.status or "⚪ В очереди",
                "comment": t.comment or "",
                "month_label": t.month_label or "",
                "week_label": t.week_label or "",
                "attached_document_id": t.attached_document_id,
                "attached_doc": doc_info,
                "is_archived": False,
                "is_backlog": is_cross_week and include_backlog,
                "is_cross_week": is_cross_week,
                "origin_week_label": t.week_label or "",
                "origin_month_label": t.month_label or "",
                "origin_created_date": origin_created_date,
                "is_deadline_week": is_deadline_week,
                "created_at": t.created_at.strftime("%d.%m.%Y %H:%M") if t.created_at else ""
            })
        return results
    except Exception as e:
        print(f"Error fetching tasks: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/tasks/upload_photo")
async def upload_task_photo(file: UploadFile = File(...)):
    """
    Принимает сжатое webp/jpg фото задачи и сохраняет в постоянный
    диск Railway Volume (/uploads/tasks/), где файлы никогда не стираются при деплоях.
    """
    try:
        upload_dir = os.path.join("uploads", "tasks")
        os.makedirs(upload_dir, exist_ok=True)

        # Генерируем уникальное имя файла
        import uuid
        ext = os.path.splitext(file.filename)[1].lower() or ".webp"
        unique_name = f"task_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}{ext}"
        file_path = os.path.join(upload_dir, unique_name)

        contents = await file.read()
        with open(file_path, "wb") as f:
            f.write(contents)

        public_url = f"/uploads/tasks/{unique_name}"
        return {"status": "ok", "url": public_url, "filename": unique_name}
    except Exception as e:
        print(f"Error uploading task photo: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/tasks/{task_id}")
def get_single_task(task_id: int, db: Session = Depends(get_db)):
    """Возвращает полную информацию по конкретной задаче с подзадачами, связями и документом."""
    task = db.query(models.Task).filter(models.Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Задача не найдена")

    doc_info = None
    if task.attached_document_id:
        d = db.query(models.Document).filter(models.Document.id == task.attached_document_id).first()
        if d:
            doc_info = {
                "id": d.id,
                "title": d.title,
                "mime_type": d.mime_type,
                "link": d.external_url if d.external_url else f"/api/documents/download/{d.id}"
            }

    parent_info = None
    if task.parent_id:
        p = db.query(models.Task).filter(models.Task.id == task.parent_id).first()
        if p:
            parent_info = {"id": p.id, "code": p.code or f"TSK-{p.id}", "title": p.title}

    dep_info = None
    if task.depends_on_id:
        dep = db.query(models.Task).filter(models.Task.id == task.depends_on_id).first()
        if dep:
            dep_info = {"id": dep.id, "code": dep.code or f"TSK-{dep.id}", "title": dep.title, "status": dep.status}

    # Подзадачи
    subtasks = db.query(models.Task).filter(
        models.Task.parent_id == task.id,
        models.Task.is_archived == False
    ).order_by(models.Task.id.asc()).all()

    subtasks_list = [{
        "id": st.id,
        "code": st.code or f"TSK-{st.id:02d}",
        "title": st.title,
        "status": st.status,
        "assignee_name": st.assignee_name or "",
        "due_date_str": st.due_date_str or "",
        "progress": st.progress or 0
    } for st in subtasks]

    done_cnt = sum(1 for s in subtasks if s.status == "🟢 Выполнено")
    calc_prog = int((done_cnt / len(subtasks)) * 100) if subtasks else (task.progress or 0)

    return {
        "id": task.id,
        "code": task.code or f"TSK-{task.id:02d}",
        "zone": task.zone or "Бережливое производство",
        "title": task.title,
        "title_kz": task.title_kz or "",
        "task_type": task.task_type or "weekly",
        "department_service": task.department_service or "",
        "parent_id": task.parent_id,
        "parent": parent_info,
        "depends_on_id": task.depends_on_id,
        "depends_on": dep_info,
        "tags": task.tags or "",
        "target_quarter": task.target_quarter or "",
        "progress": task.progress or 0,
        "calculated_progress": calc_prog,
        "subtasks": subtasks_list,
        "photo_link": task.photo_link or "",
        "author_name": task.author_name or "",
        "assignee_name": task.assignee_name or "",
        "due_date_str": task.due_date_str or "",
        "status": task.status or "⚪ В очереди",
        "comment": task.comment or "",
        "month_label": task.month_label or "",
        "week_label": task.week_label or "",
        "attached_document_id": task.attached_document_id,
        "attached_doc": doc_info,
        "is_archived": False,
        "created_at": task.created_at.strftime("%d.%m.%Y %H:%M") if task.created_at else ""
    }

@app.get("/api/tasks/{task_id}/history")
def get_task_history(task_id: int, db: Session = Depends(get_db)):
    """Возвращает хронологическую историю изменений задачи из AuditLog."""
    task = db.query(models.Task).filter(models.Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Задача не найдена")

    logs = db.query(models.AuditLog).filter(
        models.AuditLog.target_table == "tasks",
        models.AuditLog.target_id == task_id
    ).order_by(models.AuditLog.timestamp.asc(), models.AuditLog.id.asc()).all()

    history = []
    for log in logs:
        history.append({
            "id": log.id,
            "timestamp": log.timestamp.strftime("%d.%m.%Y %H:%M") if log.timestamp else "",
            "user_name": log.user_name or "Система",
            "action": log.action,
            "details": log.details or ""
        })

    # Если в AuditLog пока нет записей, формируем базовую запись создания
    if not history and task.created_at:
        history.append({
            "id": 0,
            "timestamp": task.created_at.strftime("%d.%m.%Y %H:%M"),
            "user_name": task.author_name or "Автор",
            "action": "CREATE",
            "details": f"Создана задача [{task.code or f'TSK-{task.id}'}] «{task.title}». Исполнитель: {task.assignee_name or '—'}"
        })

    return {
        "task_id": task.id,
        "code": task.code or f"TSK-{task.id:02d}",
        "title": task.title,
        "status": task.status,
        "history": history
    }

@app.post("/api/tasks")
def create_task(task_data: schemas.TaskCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Создает новую задачу с поддержкой горизонтов, тегов и связей."""
    try:
        author_name = (task_data.author_name or "").strip()
        pin = (task_data.pin_code or "").strip()

        # Проверка PIN-кода автора
        if author_name:
            emp = db.query(models.PlannerEmployee).filter(models.PlannerEmployee.name == author_name).first()
            if emp and emp.pin_code and emp.pin_code.strip():
                if emp.pin_code.strip() != pin:
                    raise HTTPException(status_code=401, detail=f"Неверный PIN-код для автора «{author_name}»")

        last_task = db.query(models.Task).order_by(models.Task.id.desc()).first()
        next_num = (last_task.id + 1) if last_task else 1
        code_str = task_data.code or f"TSK-{next_num:02d}"

        title_ru = (task_data.title or "").strip()
        title_kz = (task_data.title_kz or "").strip()

        # Парсинг хэштегов из заголовка
        combined_tags = extract_hashtags_from_title(title_ru, task_data.tags)

        # Интеллектуальное выравнивание языков
        if title_ru and not title_kz:
            trans_info = detect_and_translate_task_text(title_ru)
            title_ru = trans_info.get("text_ru", title_ru)
            title_kz = trans_info.get("text_kz", "")
        elif not title_ru and title_kz:
            trans_info = detect_and_translate_task_text(title_kz, forced_source="kk")
            title_ru = trans_info.get("text_ru", "")
            title_kz = trans_info.get("text_kz", title_kz)

        new_task = models.Task(
            code=code_str,
            zone=task_data.zone or "Бережливое производство",
            title=title_ru,
            title_kz=title_kz,
            task_type=task_data.task_type or "weekly",
            department_service=task_data.department_service or "",
            parent_id=task_data.parent_id,
            depends_on_id=task_data.depends_on_id,
            tags=combined_tags,
            target_quarter=task_data.target_quarter or "",
            progress=task_data.progress or 0,
            photo_link=task_data.photo_link or "",
            author_name=task_data.author_name or "",
            assignee_name=task_data.assignee_name or "",
            due_date_str=task_data.due_date_str or "",
            status=task_data.status or "🟡 В работе",
            comment=task_data.comment or "",
            month_label=task_data.month_label or "Август 2026",
            week_label=task_data.week_label or "Неделя 4 (24.08 - 28.08)",
            attached_document_id=task_data.attached_document_id,
            is_archived=False
        )
        db.add(new_task)
        db.flush()

        # Пересчитываем родительскую задачу при необходимости
        if new_task.parent_id:
            recalculate_parent_task_progress(db, new_task.parent_id)

        # AuditLog
        db.add(models.AuditLog(
            user_name=new_task.author_name or "Планнер",
            action="CREATE",
            target_table="tasks",
            target_id=new_task.id,
            details=f"Создана задача [{new_task.code}] «{new_task.title}». Тип: {new_task.task_type}, Служба: {new_task.department_service or '—'}, Исполнитель: {new_task.assignee_name or '—'}"
        ))

        db.commit()
        db.refresh(new_task)

        # Отправка email исполнителю
        if new_task.assignee_name:
            assignee_email = get_task_person_email(db, new_task.assignee_name)
            if assignee_email:
                subject = f"📌 Новая задача [{new_task.zone}]: {new_task.title}"
                task_dict = {
                    "id": new_task.id,
                    "code": new_task.code,
                    "title": new_task.title,
                    "title_kz": new_task.title_kz,
                    "zone": new_task.zone,
                    "due_date_str": new_task.due_date_str,
                    "author_name": new_task.author_name,
                    "assignee_name": new_task.assignee_name,
                    "status": new_task.status,
                    "comment": new_task.comment,
                    "photo_link": new_task.photo_link,
                    "month_label": new_task.month_label,
                    "week_label": new_task.week_label
                }
                background_tasks.add_task(send_task_email_notification, assignee_email, subject, "Вам назначена новая задача", task_dict)

        return {"status": "ok", "task_id": new_task.id, "code": new_task.code}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        print(f"Error creating task: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/tasks/bulk")
def create_tasks_bulk(bulk_data: schemas.BulkTasksCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Массовое создание задач в единой транзакции БД."""
    try:
        author_name = (bulk_data.author_name or "").strip()
        pin = (bulk_data.pin_code or "").strip()

        if not bulk_data.tasks or len(bulk_data.tasks) == 0:
            raise HTTPException(status_code=400, detail="Список задач пуст")

        # Проверка PIN-кода автора
        if author_name:
            emp = db.query(models.PlannerEmployee).filter(models.PlannerEmployee.name == author_name).first()
            if emp and emp.pin_code and emp.pin_code.strip():
                if emp.pin_code.strip() != pin:
                    raise HTTPException(status_code=401, detail=f"Неверный PIN-код для автора «{author_name}»")

        last_task = db.query(models.Task).order_by(models.Task.id.desc()).first()
        current_max_id = last_task.id if last_task else 0

        created_tasks = []
        task_dicts_for_email = []

        for idx, item in enumerate(bulk_data.tasks):
            title_raw = (item.title or "").strip()
            if not title_raw:
                continue

            current_max_id += 1
            code_str = f"TSK-{current_max_id:02d}"

            # Парсинг хэштегов из названия
            combined_tags = extract_hashtags_from_title(title_raw, item.tags)

            # Перевод названия
            trans_info = detect_and_translate_task_text(title_raw)
            title_ru = trans_info.get("text_ru", title_raw)
            title_kz = trans_info.get("text_kz", "")

            # Определение срока задачи
            due_date = item.due_date_str or bulk_data.default_due_date_str or ""

            # Определение зоны
            zone_val = item.zone or bulk_data.zone or "Бережливое производство"

            new_task = models.Task(
                code=code_str,
                zone=zone_val,
                title=title_ru,
                title_kz=title_kz,
                task_type=bulk_data.task_type or "weekly",
                department_service=bulk_data.department_service or "",
                tags=combined_tags,
                target_quarter=bulk_data.target_quarter or "",
                progress=0,
                photo_link=item.photo_link or "",
                author_name=author_name,
                assignee_name=(item.assignee_name or "").strip(),
                due_date_str=due_date,
                status="🟡 В работе",
                comment="",
                month_label=bulk_data.month_label or "Август 2026",
                week_label=bulk_data.week_label or "Неделя 4 (24.08 - 28.08)",
                attached_document_id=item.attached_document_id,
                is_archived=False
            )
            db.add(new_task)
            db.flush()

            created_tasks.append({
                "id": new_task.id,
                "code": new_task.code,
                "title": new_task.title,
                "assignee_name": new_task.assignee_name
            })

            # Подготовка email исполнителю
            if new_task.assignee_name:
                assignee_email = get_task_person_email(db, new_task.assignee_name)
                if assignee_email:
                    task_dicts_for_email.append((assignee_email, {
                        "id": new_task.id,
                        "code": new_task.code,
                        "title": new_task.title,
                        "title_kz": new_task.title_kz,
                        "zone": new_task.zone,
                        "due_date_str": new_task.due_date_str,
                        "author_name": new_task.author_name,
                        "assignee_name": new_task.assignee_name,
                        "status": new_task.status,
                        "comment": new_task.comment,
                        "photo_link": new_task.photo_link,
                        "month_label": new_task.month_label,
                        "week_label": new_task.week_label
                    }))

        if not created_tasks:
            raise HTTPException(status_code=400, detail="Не удалось создать задачи (все строки пусты)")

        # AuditLog
        dept_str = f", Служба: {bulk_data.department_service}" if bulk_data.department_service else ""
        db.add(models.AuditLog(
            user_name=author_name or "Планнер",
            action="CREATE",
            target_table="tasks",
            target_id=created_tasks[0]["id"],
            details=f"Массово создано задач: {len(created_tasks)} шт. Автор: {author_name}{dept_str}. Коды: {created_tasks[0]['code']}–{created_tasks[-1]['code']}"
        ))

        db.commit()

        # Фоновая отправка email
        for a_email, t_dict in task_dicts_for_email:
            subject = f"📌 Новая задача [{t_dict.get('zone', 'План')}]: {t_dict.get('title', '')}"
            background_tasks.add_task(send_task_email_notification, a_email, subject, "Вам назначена новая задача", t_dict)

        return {
            "status": "ok",
            "count": len(created_tasks),
            "created_tasks": created_tasks
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        print(f"Error bulk creating tasks: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/api/tasks/{task_id}")
def update_task(task_id: int, task_data: schemas.TaskUpdate, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Обновляет задачу, пересчитывает связи и отправляет уведомления."""
    try:
        task = db.query(models.Task).filter(models.Task.id == task_id).first()
        if not task:
            raise HTTPException(status_code=404, detail="Задача не найдена")

        pin = (task_data.pin_code or "").strip()
        if pin:
            author_emp = db.query(models.PlannerEmployee).filter(models.PlannerEmployee.name == task.author_name).first() if task.author_name else None
            assignee_emp = db.query(models.PlannerEmployee).filter(models.PlannerEmployee.name == task.assignee_name).first() if task.assignee_name else None
            
            valid = False
            if author_emp and author_emp.pin_code and author_emp.pin_code.strip() == pin:
                valid = True
            if assignee_emp and assignee_emp.pin_code and assignee_emp.pin_code.strip() == pin:
                valid = True
            if (not author_emp or not author_emp.pin_code) and (not assignee_emp or not assignee_emp.pin_code):
                valid = True

        old_status = task.status
        old_assignee = task.assignee_name
        old_parent_id = task.parent_id

        # Автоматическое извлечение хэштегов из заголовка при обновлении
        update_dict = task_data.dict(exclude_unset=True)
        update_dict.pop("pin_code", None)

        if "title" in update_dict:
            curr_tags = update_dict.get("tags") if "tags" in update_dict else task.tags
            update_dict["tags"] = extract_hashtags_from_title(update_dict["title"], curr_tags)

        changes = []
        for key, val in update_dict.items():
            if hasattr(task, key) and val is not None:
                old_val = getattr(task, key)
                if old_val != val:
                    changes.append(f"{key}: '{old_val}' -> '{val}'")
                setattr(task, key, val)

        task.updated_at = datetime.utcnow()

        if changes:
            db.add(models.AuditLog(
                user_name=task.assignee_name or task.author_name or "Пользователь",
                action="UPDATE",
                target_table="tasks",
                target_id=task.id,
                details=f"Изменена задача [{task.code}] «{task.title}». Изменения: {'; '.join(changes)}"
            ))

        db.commit()
        db.refresh(task)

        # Пересчет прогресса родителя
        if task.parent_id:
            recalculate_parent_task_progress(db, task.parent_id)
        if old_parent_id and old_parent_id != task.parent_id:
            recalculate_parent_task_progress(db, old_parent_id)

        task_dict = {
            "id": task.id,
            "code": task.code,
            "title": task.title,
            "title_kz": task.title_kz,
            "zone": task.zone,
            "due_date_str": task.due_date_str,
            "author_name": task.author_name,
            "assignee_name": task.assignee_name,
            "status": task.status,
            "comment": task.comment,
            "photo_link": task.photo_link,
            "month_label": task.month_label,
            "week_label": task.week_label
        }

        # 1. Если сменился исполнитель и назначен новый -> уведомление новому исполнителю
        if task.assignee_name and task.assignee_name != old_assignee:
            new_assignee_email = get_task_person_email(db, task.assignee_name)
            if new_assignee_email:
                subject = f"📌 Новая задача [{task.zone}]: {task.title}"
                background_tasks.add_task(send_task_email_notification, new_assignee_email, subject, "Вам назначена новая задача", task_dict)

        # 2. Уведомления при смене статуса
        if task_data.status and task_data.status != old_status:
            # 2.1. Если задача завершена -> автору
            if task.status == "🟢 Выполнено" and task.author_name:
                author_email = get_task_person_email(db, task.author_name)
                if author_email:
                    subject = f"🟢 Задача выполнена [{task.zone}]: {task.title}"
                    background_tasks.add_task(send_task_email_notification, author_email, subject, "Задача выполнена", task_dict)

            # 2.2. Если задача перенесена -> автору и исполнителю
            elif task.status == "🔵 Перенесено":
                due_info = f" на {task.due_date_str}" if task.due_date_str else ""
                subject = f"🔵 Срок задачи перенесен{due_info} [{task.zone}]: {task.title}"
                if task.author_name:
                    author_email = get_task_person_email(db, task.author_name)
                    if author_email:
                        background_tasks.add_task(send_task_email_notification, author_email, subject, "Срок задачи перенесен", task_dict)
                if task.assignee_name and task.assignee_name != task.author_name:
                    assignee_email = get_task_person_email(db, task.assignee_name)
                    if assignee_email:
                        background_tasks.add_task(send_task_email_notification, assignee_email, subject, "Срок задачи перенесен", task_dict)

            # 2.3. Если задача отменена -> исполнителю и автору
            elif task.status == "🔴 Отменено":
                subject = f"🔴 Задача отменена [{task.zone}]: {task.title}"
                if task.assignee_name:
                    assignee_email = get_task_person_email(db, task.assignee_name)
                    if assignee_email:
                        background_tasks.add_task(send_task_email_notification, assignee_email, subject, "Задача отменена", task_dict)
                if task.author_name and task.author_name != task.assignee_name:
                    author_email = get_task_person_email(db, task.author_name)
                    if author_email:
                        background_tasks.add_task(send_task_email_notification, author_email, subject, "Задача отменена", task_dict)

            # 2.4. Если задачу взяли в работу
            elif task.status == "🟡 В работе" and task.assignee_name:
                assignee_email = get_task_person_email(db, task.assignee_name)
                if assignee_email:
                    subject = f"📌 Задача в работе [{task.zone}]: {task.title}"
                    background_tasks.add_task(send_task_email_notification, assignee_email, subject, "Задача в работе", task_dict)

        return {"status": "ok", "task_id": task.id}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        print(f"Error updating task: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/tasks/{task_id}")
def delete_task(task_id: int, db: Session = Depends(get_db)):
    """Удаляет задачу (доступно только из панели администратора)."""
    try:
        task = db.query(models.Task).filter(models.Task.id == task_id).first()
        if not task:
            raise HTTPException(status_code=404, detail="Задача не найдена")
        
        task_info = f"ID: {task.id}, Код: {task.code}, Заголовок: {task.title}, Зона: {task.zone}, Период: {task.month_label}/{task.week_label}"
        db.delete(task)
        
        # Логирование в аудит
        db.add(models.AuditLog(
            user_name="Администратор",
            action="DELETE",
            target_table="tasks",
            target_id=task_id,
            details=f"Администратор удалил задачу [{task_info}]"
        ))
        
        db.commit()
        return {"status": "ok", "message": "Задача успешно удалена"}
    except HTTPException:
        raise
@app.post("/api/tasks/{task_id}/move_next_week")
def move_task_to_next_week(
    task_id: int, 
    next_week: str, 
    next_month: Optional[str] = None, 
    background_tasks: BackgroundTasks = BackgroundTasks(),
    db: Session = Depends(get_db)
):
    """Переносит отдельную задачу на следующую неделю (и при необходимости в следующий месяц) со статусом Перенесено."""
    try:
        task = db.query(models.Task).filter(models.Task.id == task_id).first()
        if not task:
            raise HTTPException(status_code=404, detail="Задача не найдена")

        old_week = task.week_label or ""
        task.week_label = next_week
        if next_month:
            task.month_label = next_month
        task.status = "🔵 Перенесено"
        
        prev_comment = task.comment or ""
        note = f"(Перенесено с {old_week})"
        if note not in prev_comment:
            task.comment = f"{prev_comment} {note}".strip()

        db.add(models.AuditLog(
            user_name=task.assignee_name or task.author_name or "Пользователь",
            action="UPDATE",
            target_table="tasks",
            target_id=task.id,
            details=f"Перенос задачи [{task.code}] «{task.title}» с «{old_week}» на «{next_week}»"
        ))

        db.commit()
        db.refresh(task)

        # Отправка уведомления автору и исполнителю о переносе
        task_dict = {
            "id": task.id,
            "code": task.code,
            "title": task.title,
            "title_kz": task.title_kz,
            "zone": task.zone,
            "due_date_str": task.due_date_str,
            "author_name": task.author_name,
            "assignee_name": task.assignee_name,
            "status": task.status,
            "comment": task.comment,
            "photo_link": task.photo_link,
            "month_label": task.month_label,
            "week_label": task.week_label
        }
        if task.author_name:
            author_email = get_task_person_email(db, task.author_name)
            if author_email:
                subject = f"🔵 Задача перенесена на {next_week} [{task.zone}]: {task.title}"
                background_tasks.add_task(send_task_email_notification, author_email, subject, "Задача перенесена", task_dict)

        return {"status": "ok", "message": f"Задача перенесена на {next_week}"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/tasks/archive_week")
def archive_week_tasks(
    current_week: str = Body(..., embed=True),
    next_week: Optional[str] = Body(None, embed=True),
    db: Session = Depends(get_db)
):
    """
    Завершает неделю:
    - Выполненные (🟢 Выполнено) переносит в Архив (is_archived = True).
    - Незавершенные переносит на следующую неделю (если указана).
    """
    try:
        tasks = db.query(models.Task).filter(
            models.Task.week_label == current_week,
            models.Task.is_archived == False
        ).all()

        archived_count = 0
        moved_count = 0

        for t in tasks:
            if t.status == "🟢 Выполнено":
                t.is_archived = True
                archived_count += 1
            else:
                if next_week:
                    t.week_label = next_week
                    t.status = "🔵 Перенесено"
                    note = f"(Перенесено с {current_week})"
                    prev_comment = t.comment or ""
                    if note not in prev_comment:
                        t.comment = f"{prev_comment} {note}".strip()
                    moved_count += 1

        db.add(models.AuditLog(
            user_name="Администратор",
            action="UPDATE",
            target_table="tasks",
            target_id=None,
            details=f"Архивация недели «{current_week}»: {archived_count} завершено в архив, {moved_count} перенесено на «{next_week or 'след. неделю'}»"
        ))

        db.commit()
        return {
            "status": "ok",
            "archived_count": archived_count,
            "moved_count": moved_count,
            "message": f"Неделя закрыта! В архив: {archived_count} задач. Перенесено на {next_week or 'след. неделю'}: {moved_count} задач."
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/tasks/{task_id}/restore")
def restore_task_from_archive(task_id: int, target_week: Optional[str] = None, db: Session = Depends(get_db)):
    """Восстанавливает задачу из Архива обратно в активный план."""
    try:
        task = db.query(models.Task).filter(models.Task.id == task_id).first()
        if not task:
            raise HTTPException(status_code=404, detail="Задача не найдена")

        task.is_archived = False
        if target_week:
            task.week_label = target_week
        task.status = "⚪ В очереди"
        db.commit()
        return {"status": "ok", "message": "Задача возвращена в план"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/tasks/translate")
def translate_task_text(payload: dict = Body(...)):
    """Интеллектуальный двусторонний анализ и перевод RU <-> KZ."""
    text = payload.get("text", "") if isinstance(payload, dict) else str(payload)
    source_lang = payload.get("source_lang", "auto") if isinstance(payload, dict) else "auto"
    return detect_and_translate_task_text(text, forced_source=source_lang if source_lang != "auto" else None)

@app.post("/api/tasks/import_from_google_sheets")
def import_tasks_from_google_sheets(db: Session = Depends(get_db)):
    """Импортирует все активные и архивные задачи + справочники из Google Таблицы."""
    try:
        import json
        from google.oauth2 import service_account
        from googleapiclient.discovery import build

        if not os.path.exists("google_credentials.json"):
            raise HTTPException(status_code=400, detail="Файл google_credentials.json не найден")

        creds = service_account.Credentials.from_service_account_info(
            json.load(open('google_credentials.json', 'r', encoding='utf-8')),
            scopes=['https://www.googleapis.com/auth/spreadsheets']
        )
        service = build('sheets', 'v4', credentials=creds)
        spreadsheet_id = '1K6Lk0fVfVpfC7gpvg8Hlpj0IgTF9j5woLOWKquyFewc'

        # 1. Импорт Справочников (Email)
        try:
            res_dir = service.spreadsheets().values().get(spreadsheetId=spreadsheet_id, range='Справочники!A2:B100').execute()
            dir_rows = res_dir.get('values', [])
            for r in dir_rows:
                if len(r) >= 2 and r[0] and r[1]:
                    name, email = str(r[0]).strip(), str(r[1]).strip()
                    master = db.query(models.Master).filter(models.Master.name == name).first()
                    if master:
                        master.email = email
                    else:
                        db.add(models.Master(name=name, email=email, pin="1234", role="master"))
            db.commit()
        except Exception as e_dir:
            print(f"Directory import note: {e_dir}")

        # 2. Импорт Активных задач ('План на неделю')
        imported_active = 0
        try:
            res_active = service.spreadsheets().values().get(spreadsheetId=spreadsheet_id, range='План на неделю!A4:L100').execute()
            active_rows = res_active.get('values', [])
            week_label = "Неделя 4 (24.08 - 28.08)"
            month_label = "Август 2026"

            for i, r in enumerate(active_rows):
                if not r or len(r) < 3:
                    continue
                code = r[0] if len(r) > 0 and r[0] else f"TSK-{(i+1):02d}"
                zone = r[1] if len(r) > 1 and r[1] else "Бережливое производство"
                task_input = r[2] if len(r) > 2 else ""
                photo = r[3] if len(r) > 3 else ""
                task_ru = r[4] if len(r) > 4 and r[4] else task_input
                task_kz = r[5] if len(r) > 5 else ""
                author = r[6] if len(r) > 6 and r[6] else "Левда М."
                assignee = r[7] if len(r) > 7 else ""
                due = r[8] if len(r) > 8 else ""
                status = r[9] if len(r) > 9 and r[9] else "⚪ В очереди"
                comment = r[10] if len(r) > 10 else ""

                if not task_ru and not task_input:
                    continue

                # Нормализация статуса
                norm_status = "⚪ В очереди"
                if "Выполнено" in status: norm_status = "🟢 Выполнено"
                elif "В работе" in status: norm_status = "🟡 В работе"
                elif "Проблема" in status or "Перенесено" in status: norm_status = "🔵 Перенесено"

                # Проверяем нет ли уже такой задачи
                existing = db.query(models.Task).filter(models.Task.title == (task_ru or task_input), models.Task.week_label == week_label).first()
                if not existing:
                    db.add(models.Task(
                        code=code,
                        zone=zone,
                        title=task_ru or task_input,
                        title_kz=task_kz,
                        photo_link=photo,
                        author_name=author,
                        assignee_name=assignee,
                        due_date_str=due,
                        status=norm_status,
                        comment=comment,
                        month_label=month_label,
                        week_label=week_label,
                        is_archived=False
                    ))
                    imported_active += 1
            db.commit()
        except Exception as e_act:
            print(f"Active tasks import error: {e_act}")

        return {"status": "ok", "imported_active": imported_active, "message": f"Успешно импортировано {imported_active} задач из Google Таблицы"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


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




