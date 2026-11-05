"""
Модуль фоновых автомиграций и предстартовой инициализации Tectum Portal.
Вынесен из main.py для обеспечения чистоты Assembly Hub (Clean Assembly Standard).
"""

import os
import sqlite3
import requests
from sqlalchemy import text, or_
from database import SessionLocal, engine, Base
import models
import seed_norms


def run_sqlite_migrations():
    """SQLite alter table hack to auto-add columns if they don't exist."""
    try:
        conn = sqlite3.connect("tectum.db")
        try:
            conn.execute("ALTER TABLE planner_employees ADD COLUMN role TEXT DEFAULT 'portal';")
        except Exception:
            pass
        try:
            conn.execute("ALTER TABLE raw_material_receipts ADD COLUMN master_id INTEGER;")
        except Exception:
            pass
        try:
            conn.execute("ALTER TABLE downtimes ADD COLUMN description_kz TEXT;")
        except Exception:
            pass
        try:
            conn.execute("ALTER TABLE tasks ADD COLUMN depends_on_ids TEXT;")
        except Exception:
            pass
        try:
            conn.execute("ALTER TABLE tasks ADD COLUMN initial_due_date_str TEXT;")
        except Exception:
            pass
        try:
            conn.execute("ALTER TABLE tasks ADD COLUMN initial_week_label TEXT;")
        except Exception:
            pass
        try:
            conn.execute("ALTER TABLE tasks ADD COLUMN reschedule_count INTEGER DEFAULT 0;")
        except Exception:
            pass
        try:
            conn.execute("ALTER TABLE lfm_reports ADD COLUMN lfm_cart_resets INTEGER DEFAULT 0;")
        except Exception:
            pass
        try:
            conn.execute("ALTER TABLE batches ADD COLUMN qcd_act_number VARCHAR(50);")
        except Exception:
            pass
        for col_name, col_def in [
            ("google_synced", "BOOLEAN DEFAULT 0"),
            ("google_synced_at", "TIMESTAMP"),
            ("google_sync_error", "TEXT")
        ]:
            try:
                conn.execute(f"ALTER TABLE shifts ADD COLUMN {col_name} {col_def};")
            except Exception:
                pass
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"[SQLite Migrations] Notice: {e}")


def ensure_pg_column(db_sess, table, column, col_type):
    """Безопасная проверка и добавление колонки в PostgreSQL без блокировки."""
    try:
        exists = db_sess.execute(text(
            "SELECT 1 FROM information_schema.columns WHERE table_name=:tbl AND column_name=:col"
        ), {"tbl": table, "col": column}).scalar()
        if not exists:
            db_sess.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {col_type};"))
            db_sess.commit()
    except Exception as col_err:
        print(f"[PG Migrations] Notice column check/add {table}.{column}: {col_err}")
        db_sess.rollback()


def run_database_migrations():
    """Проверка индексов и колонок PostgreSQL/SQLite."""
    try:
        db = SessionLocal()
        driver = db.bind.dialect.name if db.bind else 'unknown'

        if driver == 'postgresql':
            try:
                db.execute(text("CREATE INDEX IF NOT EXISTS idx_documents_category_id ON documents (category_id);"))
                db.execute(text("CREATE INDEX IF NOT EXISTS idx_doc_categories_parent_id ON document_categories (parent_id);"))
                db.commit()
            except Exception:
                db.rollback()

            ensure_pg_column(db, "shifts", "google_synced", "BOOLEAN DEFAULT FALSE")
            ensure_pg_column(db, "shifts", "google_synced_at", "TIMESTAMP")
            ensure_pg_column(db, "shifts", "google_sync_error", "TEXT")
            ensure_pg_column(db, "downtimes", "description_kz", "TEXT")
            ensure_pg_column(db, "tasks", "depends_on_ids", "TEXT")
            ensure_pg_column(db, "tasks", "photos", "TEXT")
            ensure_pg_column(db, "tasks", "initial_due_date_str", "TEXT")
            ensure_pg_column(db, "tasks", "initial_week_label", "TEXT")
            ensure_pg_column(db, "tasks", "reschedule_count", "INTEGER DEFAULT 0")

            try:
                db.execute(text("UPDATE tasks SET reschedule_count = 1 WHERE status LIKE '%Перенес%' AND (reschedule_count IS NULL OR reschedule_count = 0);"))
                db.execute(text("UPDATE tasks SET initial_due_date_str = due_date_str WHERE status LIKE '%Перенес%' AND (initial_due_date_str IS NULL OR initial_due_date_str = '');"))
                db.commit()
            except Exception:
                db.rollback()

            ensure_pg_column(db, "lkc_report_items", "comp_strips_count", "INTEGER DEFAULT 0")
            ensure_pg_column(db, "lfm_reports", "lfm_cart_resets", "INTEGER DEFAULT 0")
            ensure_pg_column(db, "planner_employees", "role", "VARCHAR(50) DEFAULT 'portal'")
            ensure_pg_column(db, "lkc_report_items", "order_number", "VARCHAR(100)")
            ensure_pg_column(db, "batches", "qcd_verified", "BOOLEAN DEFAULT FALSE")
            ensure_pg_column(db, "batches", "qcd_verified_at", "TIMESTAMP")
            ensure_pg_column(db, "batches", "qcd_verified_by", "VARCHAR(150)")
            ensure_pg_column(db, "batches", "qcd_root_cause", "TEXT")
            ensure_pg_column(db, "batches", "qcd_notes", "TEXT")
            ensure_pg_column(db, "batches", "qcd_act_number", "VARCHAR(50)")
            ensure_pg_column(db, "batches", "qcd_defect_curved_edge", "INTEGER DEFAULT 0")
            ensure_pg_column(db, "batches", "qcd_defect_no_pattern", "INTEGER DEFAULT 0")
            ensure_pg_column(db, "batches", "qcd_defect_tech", "INTEGER DEFAULT 0")

            try:
                db.execute(text("UPDATE monthly_plan_board SET plan_sheets = 800 WHERE line = 'ЛФМ-1' AND date >= '2026-09-07' AND shift_name = 'День' AND plan_sheets IN (2700, 0);"))
                db.execute(text("UPDATE monthly_plan_board SET plan_sheets = 1200 WHERE line = 'ЛФМ-1' AND date >= '2026-09-07' AND shift_name = 'Ночь' AND plan_sheets IN (3300, 0);"))
                db.commit()
            except Exception:
                db.rollback()

            # Ensure master_id in raw_material_receipts
            try:
                col_exists = db.execute(text(
                    "SELECT column_name FROM information_schema.columns WHERE table_name='raw_material_receipts' AND column_name='master_id'"
                )).fetchone()
                if not col_exists:
                    db.execute(text("ALTER TABLE raw_material_receipts ADD COLUMN master_id INTEGER REFERENCES masters(id);"))
                    db.commit()
            except Exception as e:
                db.rollback()

        elif driver == 'sqlite':
            db.execute(text("UPDATE monthly_plan_board SET plan_sheets = 800 WHERE line = 'ЛФМ-1' AND date >= '2026-09-07' AND shift_name = 'День' AND plan_sheets IN (2700, 0);"))
            db.execute(text("UPDATE monthly_plan_board SET plan_sheets = 1200 WHERE line = 'ЛФМ-1' AND date >= '2026-09-07' AND shift_name = 'Ночь' AND plan_sheets IN (3300, 0);"))
            db.commit()

    except Exception as e:
        print(f"[DB Migrations] Warning: {e}")
    finally:
        db.close()


def cleanup_document_titles():
    """Фоновая очистка суффиксов интеграций в названиях документов."""
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
            print(f"[Document Cleanup] Cleaned {cleaned_count} document titles and mime types.")
    except Exception as e:
        print(f"[Document Cleanup] Notice: {e}")
    finally:
        db_c.close()


def seed_masters_and_roles():
    """Инициализация профилей сотрудников предприятия и гарантия создания таблиц."""
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

        tumatov = db.query(models.Master).filter(models.Master.name.like("%Туматов%")).first()
        if not tumatov:
            db.add(models.Master(name="Туматов Д.", pin="1111", role="director"))
        else:
            tumatov.name = "Туматов Д."
            tumatov.role = "director"

        gerling = db.query(models.Master).filter(models.Master.name.like("%Герлинг%")).first()
        if not gerling:
            db.add(models.Master(name="Герлинг С.", pin="2222", role="tech_director"))
        else:
            gerling.name = "Герлинг С."
            gerling.role = "tech_director"

        bulekhanov = db.query(models.Master).filter(or_(models.Master.name.like("%Булеханов%"), models.Master.name.like("%Булекпаев%"))).first()
        if not bulekhanov:
            db.add(models.Master(name="Булеханов К.", pin="2026", role="production_head"))
        else:
            bulekhanov.name = "Булеханов К."
            bulekhanov.pin = "2026"
            bulekhanov.role = "production_head"

        # Деактивация исключенных из списков сотрудников
        db.query(models.Master).filter(models.Master.name.in_(["Акжанбаев Ж.", "Носиков Е."])).update({"role": "inactive"}, synchronize_session=False)
        db.query(models.PlannerEmployee).filter(models.PlannerEmployee.name.in_(["Акжанбаев Ж.", "Носиков Е."])).update({"is_active": False}, synchronize_session=False)

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
        models.LKCRawMaterialUsage.__table__.create(bind=engine, checkfirst=True)
        models.LKCReportItem.__table__.create(bind=engine, checkfirst=True)
        models.LKCDowntime.__table__.create(bind=engine, checkfirst=True)
        db.commit()

        print("[Seed] Seeded core master profiles successfully.")
    except Exception as e:
        print(f"[Seed] Error seeding users: {e}")
        db.rollback()
    finally:
        db.close()


def setup_telegram_webhook():
    """Фоновая настройка Telegram Webhook."""
    try:
        tg_token = os.getenv("TELEGRAM_BOT_TOKEN", "8980370531:AAGGhgbRH04LT_KOMUHr02ms1X4wZ0b3LwY").strip()
        webhook_url = "https://tectum-portal-railway-production.up.railway.app/api/telegram/webhook"
        r = requests.post(f"https://api.telegram.org/bot{tg_token}/setWebhook", json={"url": webhook_url}, timeout=5)
        print(f"[Telegram Startup] Webhook setup status: {r.json()}")
    except Exception:
        pass


def run_startup_migrations():
    """Главный вход автомиграций и предстартовой инициализации."""
    try:
        Base.metadata.create_all(bind=engine)
        run_sqlite_migrations()
        run_database_migrations()
        cleanup_document_titles()
        seed_masters_and_roles()
        seed_norms.seed_norms()

        # Мультитенантная структура
        try:
            import seed_tenant
            db_tenant = SessionLocal()
            try:
                seed_tenant.seed_tenant_structure(db_tenant)
            finally:
                db_tenant.close()
        except Exception as tenant_seed_err:
            print(f"[Tenant Startup] Error seeding tenant structure: {tenant_seed_err}")

        # Backfill roadmap quarters
        try:
            from routers.planner import backfill_missing_roadmap_quarters
            db_bf = SessionLocal()
            try:
                backfill_missing_roadmap_quarters(db_bf)
            finally:
                db_bf.close()
        except Exception as bf_err:
            print(f"[Planner Startup] Backfill roadmap quarters error: {bf_err}")

        setup_telegram_webhook()

    except Exception as startup_err:
        print(f"[Startup Migrations] Error: {startup_err}")

