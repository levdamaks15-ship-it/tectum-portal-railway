from datetime import datetime
from dataclasses import dataclass, field
from typing import Optional, List
from fastapi import HTTPException, Request
from sqlalchemy.orm import Session, selectinload
import models

# Каноническая иерархия приоритета должностей и ролей
ROLE_PRIORITY = [
    "admin",
    "director",
    "tech_director",
    "production_head",
    "technologist",
    "workshop_master",
    "master",
    "qcd_inspector",
    "qcd",
    "mechanic",
    "itr",
    "operator",
]

# Канонический реестр производственных цехов Tectum
WORKSHOPS_METADATA = {
    "xci": {
        "id": "xci",
        "short_name": "ХЦИ",
        "name": "цех хризотилцементных изделий",
        "badge_class": "badge-shop-xci"
    },
    "agb": {
        "id": "agb",
        "short_name": "АГБ",
        "name": "цех автоклавного газобетона",
        "badge_class": "badge-shop-agb"
    },
    "lkc": {
        "id": "lkc",
        "short_name": "ЛКЦ",
        "name": "лакокрасочный цех",
        "badge_class": "badge-shop-lkc"
    },
    "stmo": {
        "id": "stmo",
        "short_name": "СТМО",
        "name": "цех СТМО",
        "badge_class": "badge-shop-stmo"
    },
    "skk": {
        "id": "skk",
        "short_name": "СКК",
        "name": "служба контроля качества",
        "badge_class": "badge-shop-skk"
    },
    "all": {
        "id": "all",
        "short_name": "ПОРТАЛ",
        "name": "корпоративный портал",
        "badge_class": "badge-shop-portal"
    }
}

@dataclass
class TenantContext:
    plant_id: str
    workshop_id: str
    user_id: int
    user_name: str
    role_code: str
    is_admin: bool
    can_switch_workshops: bool = False
    accessible_workshops: List[dict] = field(default_factory=list)
    current_workshop: dict = field(default_factory=dict)
    user: Optional[models.User] = None

def get_primary_role(user: Optional[models.User]) -> str:
    """Определяет наивысшую действующую роль пользователя по каноническому приоритету с нормализацией для совместимости."""
    if not user:
        return "operator"
    if (user.name and user.name.startswith("Левда")) or (user.pin_code == "6282"):
        return "admin"
    scopes = [s for s in (user.scopes or []) if getattr(s, "is_active", True)]
    if not scopes:
        return "operator"
    def role_rank(s):
        code = (s.role_code or "").strip().lower()
        try:
            return ROLE_PRIORITY.index(code)
        except ValueError:
            return 999
    sorted_scopes = sorted(scopes, key=role_rank)
    raw_role = (sorted_scopes[0].role_code or "").strip().lower()
    
    # Каноническая нормализация для бесшовной совместимости с клиентом и бэкендом
    if raw_role in ("workshop_master", "master"):
        return "master"
    if raw_role in ("qcd_inspector", "qcd"):
        return "qcd"
    return raw_role

def get_authenticated_user_from_request(request: Request, db: Session) -> Optional[models.User]:
    """Извлекает и валидирует пользователя строго из активной серверной сессии user_sessions."""
    token = (
        request.cookies.get("__Host-tectum_session")
        or request.cookies.get("tectum_session")
        or request.headers.get("x-session-token")
    )
    now = datetime.utcnow()
    if token:
        sess = db.query(models.UserSession).filter(
            models.UserSession.id == token,
            models.UserSession.expires_at > now,
            models.UserSession.revoked_at.is_(None)
        ).first()
        if sess:
            user = db.query(models.User).options(selectinload(models.User.scopes)).filter(models.User.id == sess.user_id).first()
            if user and user.is_active:
                return user

    return None

def check_admin_session(request: Request, db: Session):
    """Строгая проверка прав администратора (только Левда М. / role=admin)."""
    # 1. Пробуем получить пользователя из активной сессии user_sessions
    user = get_authenticated_user_from_request(request, db)
    if user:
        is_admin = (user.name and user.name.startswith("Левда")) or any(
            s.role_code == "admin" for s in (user.scopes or []) if getattr(s, "is_active", True)
        )
        if is_admin:
            user.role = "admin"
            return user

    # 2. Проверяем legacy session cookies / session dict
    user_id = request.session.get('user_id')
    role = request.session.get('user_role')
    if user_id:
        user = db.query(models.User).filter(models.User.id == user_id).first()
        if user:
            is_admin = (user.name and user.name.startswith("Левда")) or any(
                s.role_code == "admin" for s in (user.scopes or []) if getattr(s, "is_active", True)
            )
            if is_admin or role == 'admin':
                user.role = "admin"
                return user

    # 3. Fallback to X-Admin-PIN / X-PIN header (строго мастер-PIN 6282 / Левда М.)
    pin_header = request.headers.get('x-admin-pin') or request.headers.get('x-pin')
    if pin_header:
        clean_pin = pin_header.strip()
        if clean_pin == '6282':
            levda = db.query(models.User).filter(models.User.name.like("%Левда%")).first()
            if not levda:
                levda = db.query(models.User).filter(models.User.pin_code == '6282').first()
            if levda:
                levda.role = "admin"
                return levda

    raise HTTPException(status_code=403, detail='Доступ запрещен. Вход в панель управления разрешен только системному администратору (Левда М.).')

_norms_cache = {}
_norms_cache_time = 0

def invalidate_norms_cache():
    global _norms_cache_time
    _norms_cache_time = 0

def _get_norm_cached(db: Session, product_name: str):
    global _norms_cache, _norms_cache_time
    import time
    if time.time() - _norms_cache_time > 60:
        norms = db.query(models.ProductNorm).all()
        _norms_cache = {n.product_name: n for n in norms}
        _norms_cache_time = time.time()
    res = _norms_cache.get(product_name)
    if not res:
        # Check standard aliases
        if product_name == "Шифер 7 волн гладкий":
            res = _norms_cache.get("Шифер 7 волн глад")
        elif product_name == "Шифер 7 волн глад":
            res = _norms_cache.get("Шифер 7 волн гладкий")
        elif product_name == "Шифер 8 волн гладкий":
            res = _norms_cache.get("Шифер 8 волн глад")
        elif product_name == "Шифер 8 волн глад":
            res = _norms_cache.get("Шифер 8 волн гладкий")
    return res

def get_product_finished_weight_kg(db: Session, product_name: str) -> float:
    norm = _get_norm_cached(db, product_name)
    if not norm or not norm.weight_kg:
        p = (product_name or "").lower()
        if "7 волн 3500" in p or "3500*980" in p:
            return 34.14
        if "7 волн" in p:
            return 17.07
        if "плоский 10" in p:
            return 34.99
        if "плоский 8" in p:
            return 27.99
        if "плоский 6" in p:
            return 21.00
        if "рп" in p:
            return 17.43
        return 19.6
    return norm.weight_kg

def get_product_raw_weight_kg(db: Session, product_name: str) -> float:
    norm = _get_norm_cached(db, product_name)
    if not norm:
        p = (product_name or "").lower()
        if "7 волн 3500" in p or "3500*980" in p:
            return 31.8
        if "7 волн" in p:
            return 15.6
        return 18.2
    return (
        (norm.norm_chrysotile_4_20 or 0) +
        (getattr(norm, 'norm_chrysotile_5_50', 0) or 0) +
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

from datetime import datetime
from sqlalchemy import func
import os
from database import SessionLocal
import excel_exporter
try:
    import m365_integration
except ImportError:
    m365_integration = None

try:
    import google_sheets_integration
except ImportError:
    google_sheets_integration = None

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


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
            
        is_line_1 = (pb_line == "ЛФМ-1")
        if is_line_1:
            default_plan_sheets = 800 if shift_name == "День" else 1200
        else:
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
            
        # SharePoint upload completed without touching Google Sheets
    except Exception as e:
        print(f"Error in SharePoint background sync: {e}")
    finally:
        db.close()

import threading
_google_sync_lock = threading.Lock()

def sync_google_sheets_bg():
    from database import SessionLocal
    import google_sheets_integration
    with _google_sync_lock:
        db = SessionLocal()
        try:
            google_sheets_integration.sync_report_to_google_sheets(db)
            google_sheets_integration.sync_qcd_reports_to_google_sheets(db)
            google_sheets_integration.sync_qcd_reports_to_dedicated_sheet(db)
            db.add(models.AuditLog(
                user_name="Google Sync Reports",
                action="UPDATE",
                target_table="shifts",
                target_id=0,
                details="Сводный отчет, переборка и акты СКК успешно синхронизированы с Google Таблицами в фоновом режиме."
            ))
            db.commit()
        except Exception as e:
            print(f"Error syncing reports to Google Sheets: {e}")
            try:
                db.rollback()
                db.add(models.AuditLog(
                    user_name="Google Sync Reports",
                    action="ERROR",
                    target_table="shifts",
                    target_id=0,
                    details=f"Ошибка синхронизации отчетов в Google Sheets: {str(e)}"
                ))
                db.commit()
            except Exception:
                pass
        finally:
            db.close()

def sync_norms_export_bg():
    from database import SessionLocal
    import google_sheets_integration
    with _google_sync_lock:
        db = SessionLocal()
        try:
            google_sheets_integration.export_norms_to_google_sheets(db)
            db.add(models.AuditLog(
                user_name="Google Sync Norms",
                action="EXPORT",
                target_table="product_norms",
                target_id=0,
                details="Нормативы продукции успешно выгружены в Google Таблицу в фоновом режиме."
            ))
            db.commit()
        except Exception as e:
            print(f"Error exporting norms to Google Sheets: {e}")
            try:
                db.rollback()
            except Exception:
                pass
        finally:
            db.close()

def sync_receipts_bg():
    from database import SessionLocal
    import google_sheets_integration
    with _google_sync_lock:
        db = SessionLocal()
        try:
            if google_sheets_integration:
                google_sheets_integration.export_receipt_to_google_sheets(db)
                db.add(models.AuditLog(
                    user_name="Google Sync Receipts",
                    action="UPDATE",
                    target_table="raw_material_receipts",
                    target_id=0,
                    details="Приходы сырья успешно синхронизированы с Google Таблицами в фоновом режиме."
                ))
                db.commit()
        except Exception as e:
            print(f"Error syncing receipts to Google Sheets: {e}")
            try:
                db.rollback()
                db.add(models.AuditLog(
                    user_name="Google Sync Receipts",
                    action="ERROR",
                    target_table="raw_material_receipts",
                    target_id=0,
                    details=f"Ошибка синхронизации приходов сырья в Google Sheets: {str(e)}"
                ))
                db.commit()
            except Exception:
                pass
        finally:
            db.close()

def sync_downtimes_bg():
    from database import SessionLocal
    import google_sheets_integration
    with _google_sync_lock:
        db = SessionLocal()
        try:
            if google_sheets_integration:
                google_sheets_integration.export_downtimes_to_google_sheets(db)
                db.add(models.AuditLog(
                    user_name="Google Sync Downtimes",
                    action="UPDATE",
                    target_table="downtimes",
                    target_id=0,
                    details="Простои успешно синхронизированы с Google Таблицами в фоновом режиме."
                ))
                db.commit()
        except Exception as e:
            print(f"Error syncing downtimes to Google Sheets: {e}")
            try:
                db.rollback()
                db.add(models.AuditLog(
                    user_name="Google Sync Downtimes",
                    action="ERROR",
                    target_table="downtimes",
                    target_id=0,
                    details=f"Ошибка экспорта простоев в Google Sheets: {str(e)}"
                ))
                db.commit()
            except Exception:
                pass
        finally:
            db.close()


def sync_unified_sheets_bg(target_shift_id: Optional[int] = None):
    """
    Последовательная безопасная синхронизация всех связанных сервисов:
    1. Сводный отчет смен, переборка и акты СКК
    2. Приходы сырья (с паузой 1.5 сек для исключения 429 Quota Exceeded)
    3. Простои (с паузой 1.5 сек для исключения 429 Quota Exceeded)
    Гарантирует единую очередь выполнения без коллизий записи в одну Google Таблицу через _google_sync_lock.
    """
    import time
    from database import SessionLocal
    import google_sheets_integration

    with _google_sync_lock:
        db = SessionLocal()
        try:
            if not google_sheets_integration:
                return

            # 1. Отчеты смен, переборка и СКК
            try:
                google_sheets_integration.sync_report_to_google_sheets(db, target_shift_id=target_shift_id)
                time.sleep(1.0)
                google_sheets_integration.sync_qcd_reports_to_google_sheets(db)
                time.sleep(1.0)
                google_sheets_integration.sync_qcd_reports_to_dedicated_sheet(db)
                db.add(models.AuditLog(
                    user_name="Google Sync Unified",
                    action="UPDATE",
                    target_table="shifts",
                    target_id=target_shift_id or 0,
                    details="[1/3] Сводный отчет, переборка и акты СКК успешно синхронизированы с Google Таблицами."
                ))
                db.commit()
            except Exception as e_rep:
                print(f"Unified sync error (reports): {e_rep}")
                try:
                    db.rollback()
                    db.add(models.AuditLog(
                        user_name="Google Sync Unified",
                        action="ERROR",
                        target_table="shifts",
                        target_id=target_shift_id or 0,
                        details=f"[1/3] Ошибка синхронизации отчетов в Google Sheets: {str(e_rep)}"
                    ))
                    db.commit()
                except Exception:
                    pass

            # Безопасный интервал для квоты Google Sheets API (60 req/min)
            time.sleep(1.5)

            # 2. Приходы сырья
            try:
                google_sheets_integration.export_receipt_to_google_sheets(db)
                db.add(models.AuditLog(
                    user_name="Google Sync Unified",
                    action="UPDATE",
                    target_table="raw_material_receipts",
                    target_id=0,
                    details="[2/3] Приход сырья успешно синхронизирован с Google Таблицами."
                ))
                db.commit()
            except Exception as e_rec:
                print(f"Unified sync error (receipts): {e_rec}")
                try:
                    db.rollback()
                    db.add(models.AuditLog(
                        user_name="Google Sync Unified",
                        action="ERROR",
                        target_table="raw_material_receipts",
                        target_id=0,
                        details=f"[2/3] Ошибка синхронизации приходов в Google Sheets: {str(e_rec)}"
                    ))
                    db.commit()
                except Exception:
                    pass

            # Безопасный интервал для квоты Google Sheets API
            time.sleep(1.5)

            # 3. Простои
            try:
                google_sheets_integration.export_downtimes_to_google_sheets(db)
                db.add(models.AuditLog(
                    user_name="Google Sync Unified",
                    action="UPDATE",
                    target_table="downtimes",
                    target_id=0,
                    details="[3/3] Простои успешно синхронизированы с Google Таблицами."
                ))
                db.commit()
            except Exception as e_down:
                print(f"Unified sync error (downtimes): {e_down}")
                try:
                    db.rollback()
                    db.add(models.AuditLog(
                        user_name="Google Sync Unified",
                        action="ERROR",
                        target_table="downtimes",
                        target_id=0,
                        details=f"[3/3] Ошибка синхронизации простоев в Google Sheets: {str(e_down)}"
                    ))
                    db.commit()
                except Exception:
                    pass

        except Exception as e:
            print(f"Fatal error in sync_unified_sheets_bg: {e}")
        finally:
            db.close()


sync_chained_sheets_bg = sync_unified_sheets_bg





def sync_qcd_dedicated_bg(report_id: int = None):
    from database import SessionLocal
    import google_sheets_integration
    db = SessionLocal()
    try:
        google_sheets_integration.sync_qcd_reports_to_dedicated_sheet(db, report_id)
        db.add(models.AuditLog(
            user_name="Google Sync QCD",
            action="EXPORT",
            target_table="qcd_sorting_reports",
            target_id=report_id or 0,
            details="Акты переборки СКК успешно синхронизированы в отдельную Google Таблицу."
        ))
        db.commit()
    except Exception as e:
        print(f"Error syncing QCD reports to dedicated sheet: {e}")
        try:
            db.add(models.AuditLog(
                user_name="Google Sync QCD",
                action="ERROR",
                target_table="qcd_sorting_reports",
                target_id=report_id or 0,
                details=f"Ошибка экспорта переборки СКК в Google Sheets: {str(e)}"
            ))
            db.commit()
        except Exception:
            pass
    finally:
        db.close()

def calculate_shift_deviations(db: Session, shift: models.Shift):
    # Find LFM reports for the shift
    lfm_reports = shift.lfm_reports
    product_counts = {}
    for r in lfm_reports:
        product_counts[r.product_name] = product_counts.get(r.product_name, 0) + (r.lfm_sheets or 0)
        
    theoretical = {
        "chrysotile_4_20": 0.0,
        "chrysotile_5_50": 0.0,
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
            theoretical["chrysotile_5_50"] += sheets * (getattr(norm, 'norm_chrysotile_5_50', 0.0) or 0.0)
            theoretical["chrysotile_5_65"] += sheets * (norm.norm_chrysotile_5_65 or 0.0)
            theoretical["chrysotile_6_40"] += sheets * (norm.norm_chrysotile_6_40 or 0.0)
            theoretical["cement"] += sheets * (norm.norm_cement or 0.0)
            theoretical["cellulose"] += sheets * (norm.norm_cellulose or 0.0)
            theoretical["crushed_slate"] += sheets * (norm.norm_crushed_slate or 0.0)
            theoretical["asbozurit"] += sheets * (norm.norm_asbozurit or 0.0)
            theoretical["fiberglass"] += sheets * (norm.norm_fiberglass or 0.0)
            
    actual = {
        "chrysotile_4_20": shift.zo_chrysotile_4_20 or 0.0,
        "chrysotile_5_50": getattr(shift, 'zo_chrysotile_5_50', 0.0) or 0.0,
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


def sync_qcd_lab_bg(analysis_id: int):
    """
    Фоновая выгрузка лабораторного анализа СКК в Google Таблицу соответствующего месяца.
    """
    from database import SessionLocal
    import google_sheets_integration
    db = SessionLocal()
    try:
        google_sheets_integration.sync_qcd_lab_analysis_to_google(db, analysis_id)
        db.add(models.AuditLog(
            user_name="Google Sync QCD Lab",
            action="EXPORT",
            target_table="qcd_lab_analyses",
            target_id=analysis_id or 0,
            details=f"Лабораторный анализ СКК ID {analysis_id} синхронизирован в Google Таблицы."
        ))
        db.commit()
    except Exception as e:
        print(f"Error syncing QCD Lab analysis to Google: {e}")
        try:
            db.add(models.AuditLog(
                user_name="Google Sync QCD Lab",
                action="ERROR",
                target_table="qcd_lab_analyses",
                target_id=analysis_id or 0,
                details=f"Ошибка экспорта анализа СКК в Google Таблицы: {str(e)}"
            ))
            db.commit()
        except Exception:
            pass
    finally:
        db.close()



def normalize_batch_number(batch_val) -> str:
    """
    Нормализует номер партии: удаляет лидирующие нули.
    Примеры: "0434" -> "434", "005" -> "5", "430" -> "430", "012-A" -> "12-A".
    """
    if not batch_val:
        return ""
    s = str(batch_val).strip()
    if s.isdigit():
        return str(int(s))
    import re
    m = re.match(r'^0+([0-9]+.*)$', s)
    if m:
        return m.group(1)
    return s


# ==========================================
# MULTI-TENANT CONTEXT RESOLVER (ЭТАП 3)
# ==========================================

def resolve_tenant_context(
    plant_slug: str,
    workshop_slug: str,
    request: Request,
    db: Session
) -> TenantContext:
    """
    Проверяет права доступа текущего пользователя к указанному заводу и цеху.
    Защищает от Multi-Tab Context Bleed и несанкционированного доступа.
    """
    user = get_authenticated_user_from_request(request, db)
    if not user:
        raise HTTPException(status_code=401, detail="Требуется авторизация в системе Tectum")

    # Проверка роли администратора
    is_admin = (user.name and user.name.startswith("Левда")) or any(
        s.role_code == "admin" for s in (user.scopes or []) if getattr(s, "is_active", True)
    )

    # Подготовка метаданных цехов
    cur_ws = WORKSHOPS_METADATA.get(workshop_slug.lower(), WORKSHOPS_METADATA["xci"])
    all_workshops = [WORKSHOPS_METADATA[k] for k in ["xci", "agb", "lkc", "stmo", "skk"]]

    # Админ имеет доступ ко всем заводам и цехам
    if is_admin:
        _update_last_visited_scope(request, db, plant_slug, workshop_slug)
        return TenantContext(
            plant_id=plant_slug,
            workshop_id=workshop_slug,
            user_id=user.id,
            user_name=user.name,
            role_code="admin",
            is_admin=True,
            can_switch_workshops=True,
            accessible_workshops=all_workshops,
            current_workshop=cur_ws,
            user=user
        )

    # Проверка прав для линейного персонала и руководства с учетом канонического приоритета ролей
    def role_rank(s):
        code = (s.role_code or "").strip().lower()
        try:
            return ROLE_PRIORITY.index(code)
        except ValueError:
            return 999
    sorted_scopes = sorted([s for s in (user.scopes or []) if getattr(s, "is_active", True)], key=role_rank)

    allowed = False
    matched_role = "operator"
    for s in sorted_scopes:
        plant_ok = (s.plant_id is None) or (s.plant_id.lower() == plant_slug.lower())
        workshop_ok = (s.workshop_id is None) or (workshop_slug.lower() == "all") or (s.workshop_id.lower() == workshop_slug.lower())
        
        if plant_ok and workshop_ok:
            allowed = True
            matched_role = s.role_code
            break

    if not allowed:
        raise HTTPException(
            status_code=403,
            detail=f"Доступ запрещен: у вас нет прав на просмотр цеха '{workshop_slug}' завода '{plant_slug}'"
        )

    # Проверка прав на переключение между цехами (директор, техдиректор, нач. производства, гл. технолог)
    can_switch = any(
        (s.workshop_id is None or (s.role_code or "").strip().lower() in ("director", "tech_director", "production_head", "technologist"))
        for s in sorted_scopes
    )
    if can_switch:
        accessible_workshops = all_workshops
        can_switch_workshops = True
    else:
        user_ws_ids = {s.workshop_id.lower() for s in sorted_scopes if s.workshop_id}
        if not user_ws_ids:
            user_ws_ids = {workshop_slug.lower()}
        accessible_workshops = [WORKSHOPS_METADATA[w] for w in user_ws_ids if w in WORKSHOPS_METADATA]
        if not accessible_workshops:
            accessible_workshops = [cur_ws]
        can_switch_workshops = len(accessible_workshops) > 1

    _update_last_visited_scope(request, db, plant_slug, workshop_slug)
    return TenantContext(
        plant_id=plant_slug,
        workshop_id=workshop_slug,
        user_id=user.id,
        user_name=user.name,
        role_code=matched_role,
        is_admin=False,
        can_switch_workshops=can_switch_workshops,
        accessible_workshops=accessible_workshops,
        current_workshop=cur_ws,
        user=user
    )

def _update_last_visited_scope(request: Request, db: Session, plant_slug: str, workshop_slug: str):
    """Обновляет последнюю открытую область в активной сессии."""
    token = (
        request.cookies.get("__Host-tectum_session")
        or request.cookies.get("tectum_session")
        or request.headers.get("x-session-token")
    )
    if token:
        try:
            scope_url = f"/p/{plant_slug}/w/{workshop_slug}/shifts"
            sess = db.query(models.UserSession).filter(models.UserSession.id == token).first()
            if sess and sess.last_visited_scope != scope_url:
                sess.last_visited_scope = scope_url
                db.commit()
        except Exception:
            db.rollback()
