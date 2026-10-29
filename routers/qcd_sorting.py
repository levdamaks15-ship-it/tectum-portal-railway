from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Request
from sqlalchemy.orm import Session
from sqlalchemy import case, cast, Integer, desc
from datetime import datetime, date, timedelta
import json
from typing import Optional

import models
import schemas
from routers.common import get_db, sync_qcd_dedicated_bg

router = APIRouter(prefix="/api/qcd", tags=["QCD Sorting"])

@router.get("/shifts-window")
def get_qcd_shifts_window(limit: int = 5, db: Session = Depends(get_db)):
    """
    Возвращает список последних N (по умолчанию 5) смен завода, отсортированных
    хронологически в обратном порядке (от самой свежей к более ранней).
    Для каждой смены извлекается реальный объем формовки ЛФМ, партии, продукция и мастер.
    """
    shifts = (
        db.query(models.Shift)
        .order_by(
            desc(models.Shift.date),
            case(
                (models.Shift.shift_name.ilike('%ночь%'), 1),
                (models.Shift.shift_name.ilike('%день%'), 2),
                else_=3
            ).asc(),
            desc(models.Shift.id)
        )
        .limit(limit)
        .all()
    )

    result = []
    for s in shifts:
        lfm_sheets = 0
        if s.lfm_reports:
            lfm_sheets = sum(r.lfm_sheets or 0 for r in s.lfm_reports)
        elif s.batches:
            lfm_sheets = sum(b.stacked_stacks or 0 for b in s.batches)
        
        master_name = s.master.name if s.master else "Мастер смены"
        batch_num = s.batch_number or ""
        prod_name = s.product_name or "Шифер 8 волн"
        if not batch_num and s.batches:
            batch_num = ", ".join(b.batch_number for b in s.batches if b.batch_number)
        if s.batches and not prod_name:
            prod_name = s.batches[0].product_name or "Шифер 8 волн"

        date_str = s.date.strftime("%d.%m.%Y") if s.date else ""

        result.append({
            "id": s.id,
            "date": date_str,
            "raw_date": s.date.strftime("%Y-%m-%d") if s.date else "",
            "shift_name": s.shift_name or "День",
            "line": s.line or "ЛФМ-1",
            "master_name": master_name,
            "batch_number": batch_num,
            "product_name": prod_name,
            "lfm_sheets": lfm_sheets,
            "status": s.status or "closed"
        })

    return result


@router.post("/reports", response_model=schemas.QcdSortingResponse)
def create_qcd_report(
    data: schemas.QcdSortingCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """
    Создание и сохранение нового официального Акта переборки СКК.
    Автоматически генерирует номер акта, сохраняет снимок смен,
    валидирует суммы и запускает фоновую выгрузку в выделенную Google Таблицу.
    """
    now_utc = datetime.utcnow()
    year_month = now_utc.strftime("%Y/%m")
    
    count_this_month = (
        db.query(models.QcdSortingReport)
        .filter(models.QcdSortingReport.act_number.like(f"СКК-{year_month}-%"))
        .count()
    )
    act_number = f"СКК-{year_month}-{count_this_month + 1:03d}"

    shifts_breakdown_json = "[]"
    if data.shifts_breakdown:
        shifts_breakdown_json = json.dumps(data.shifts_breakdown, ensure_ascii=False)
    elif data.selected_shift_ids:
        selected_shifts = db.query(models.Shift).filter(models.Shift.id.in_(data.selected_shift_ids)).all()
        breakdown_list = []
        for s in selected_shifts:
            lfm = sum(r.lfm_sheets or 0 for r in s.lfm_reports) if s.lfm_reports else 0
            breakdown_list.append({
                "shift_id": s.id,
                "date": s.date.strftime("%d.%m.%Y") if s.date else "",
                "shift_name": s.shift_name,
                "line": s.line,
                "master_name": s.master.name if s.master else "",
                "batch_number": s.batch_number or "",
                "product_name": s.product_name or "",
                "lfm_sheets": lfm
            })
        shifts_breakdown_json = json.dumps(breakdown_list, ensure_ascii=False)

    fg_json = json.dumps(data.first_grade_details or {}, ensure_ascii=False)
    defects_json = json.dumps(data.defect_details or {}, ensure_ascii=False)
    selected_ids_json = json.dumps(data.selected_shift_ids or [])

    total_sorted = data.first_grade_total + data.defect_total
    calc_percent = 0.0
    if total_sorted > 0:
        calc_percent = round((data.defect_total / total_sorted) * 100.0, 2)
    elif data.total_formed > 0:
        calc_percent = round((data.defect_total / data.total_formed) * 100.0, 2)

    report = models.QcdSortingReport(
        act_number=act_number,
        act_date=data.act_date,
        inspector_name=data.inspector_name,
        selected_shift_ids=selected_ids_json,
        product_name=data.product_name or "Шифер 8 волн",
        total_formed=data.total_formed,
        first_grade_total=data.first_grade_total,
        defect_total=data.defect_total,
        defect_percentage=calc_percent,
        first_grade_details=fg_json,
        defect_details=defects_json,
        shifts_breakdown=shifts_breakdown_json,
        notes=data.notes or "",
        google_synced=False,
        created_at=now_utc
    )
    db.add(report)
    db.commit()
    db.refresh(report)

    background_tasks.add_task(sync_qcd_dedicated_bg, report.id)

    return report


@router.get("/reports", response_model=list[schemas.QcdSortingResponse])
def list_qcd_reports(limit: int = 50, db: Session = Depends(get_db)):
    """
    Получение списка ранее созданных актов переборки СКК.
    """
    return (
        db.query(models.QcdSortingReport)
        .order_by(desc(models.QcdSortingReport.act_date), desc(models.QcdSortingReport.id))
        .limit(limit)
        .all()
    )


@router.get("/reports/{report_id}")
def get_qcd_report_details(report_id: int, db: Session = Depends(get_db)):
    """
    Получение полных данных акта переборки по ID (включая распарсенный JSON для UI печати).
    """
    report = db.query(models.QcdSortingReport).get(report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Акт СКК не найден")

    try:
        fg_dict = json.loads(report.first_grade_details) if report.first_grade_details else {}
    except Exception:
        fg_dict = {}
        
    try:
        def_dict = json.loads(report.defect_details) if report.defect_details else {}
    except Exception:
        def_dict = {}

    try:
        shifts_list = json.loads(report.shifts_breakdown) if report.shifts_breakdown else []
    except Exception:
        shifts_list = []

    return {
        "id": report.id,
        "act_number": report.act_number,
        "act_date": report.act_date.strftime("%Y-%m-%d") if report.act_date else "",
        "act_date_display": report.act_date.strftime("%d.%m.%Y") if report.act_date else "",
        "inspector_name": report.inspector_name,
        "product_name": report.product_name,
        "total_formed": report.total_formed,
        "first_grade_total": report.first_grade_total,
        "defect_total": report.defect_total,
        "defect_percentage": report.defect_percentage,
        "first_grade_details": fg_dict,
        "defect_details": def_dict,
        "shifts_breakdown": shifts_list,
        "notes": report.notes or "",
        "google_synced": report.google_synced,
        "google_sync_error": report.google_sync_error,
        "created_at": report.created_at.strftime("%d.%m.%Y %H:%M") if report.created_at else ""
    }


@router.post("/reports/{report_id}/sync-google")
def manual_sync_google(
    report_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """
    Ручной повторный запуск выгрузки акта в Google Sheets (например, при сетевом сбое).
    """
    report = db.query(models.QcdSortingReport).get(report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Акт СКК не найден")
    background_tasks.add_task(sync_qcd_dedicated_bg, report.id)
    return {"status": "queued", "message": f"Выгрузка акта {report.act_number} поставлена в очередь"}


@router.delete("/reports/{report_id}")
def delete_qcd_report(report_id: int, db: Session = Depends(get_db)):
    """
    Удаление ошибочно созданного акта СКК.
    """
    report = db.query(models.QcdSortingReport).get(report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Акт СКК не найден")
    db.delete(report)
    db.commit()
    return {"status": "deleted", "id": report_id}


# ==============================================================================
# НОВЫЙ МОДУЛЬ: ПЕРЕБОРКА ГОТОВОЙ ПАРТИИ (СВЕРКА И КОРРЕКТИРОВКА СКК)
# ==============================================================================

from pydantic import BaseModel, Field
from typing import Optional, Dict, Any

class QCDVerifyBatchDTO(BaseModel):
    condition: int = Field(0, description="Кондиция (ГП на склад), шт")
    first_grade: int = Field(0, description="1-й сорт (допустимые микроотклонения), шт")
    defect_total: int = Field(0, description="Итого брак (отбраковка), шт")
    
    # 11 категорий 1-го сорта (по заводскому стандарту)
    fg_chip: int = Field(0, description="Скол (до 50x50 мм)")
    fg_scratch: int = Field(0, description="Сдир")
    fg_bad_cut: int = Field(0, description="Плохой рез")
    fg_stick_bottom: int = Field(0, description="Налип снизу")
    fg_stick_top: int = Field(0, description="Налип сверху")
    fg_curved_edge: int = Field(0, description="Кривой край (загнут угол)")
    fg_no_pattern: int = Field(0, description="Нет рисунка")
    fg_dent: int = Field(0, description="Вмятина")
    fg_thickness: int = Field(0, description="Не соотв. толщине")
    fg_delamination: int = Field(0, description="Расслоение")
    fg_edge: int = Field(0, description="Выпирание кромок")
    
    # Категории брака (Жарамсыз)
    def_fell_box: int = Field(0, description="Упал с коробки")
    def_broken: int = Field(0, description="Сломан доводчиком / сломан")
    def_tech: int = Field(0, description="Технологический / прочий брак")
    
    root_cause: Optional[str] = Field(None, description="Корневая причина брака")
    notes: Optional[str] = Field(None, description="Замечания инспектора СКК")
    inspector_name: Optional[str] = Field(None, description="ФИО инспектора СКК")


@router.get("/batches/recent")
def get_recent_batches_for_qcd(limit: int = 30, db: Session = Depends(get_db)):
    """
    Возвращает список последних партий завода с предзагрузкой смен и мастеров (без N+1).
    Используется в селекторе Кабинета СКК.
    """
    from sqlalchemy.orm import selectinload
    batches = (
        db.query(models.Batch)
        .join(models.Shift)
        .options(
            selectinload(models.Batch.shift).selectinload(models.Shift.master),
            selectinload(models.Batch.shift).selectinload(models.Shift.lfm_reports)
        )
        .order_by(
            desc(models.Shift.date),
            case(
                (models.Shift.shift_name.ilike('%ночь%'), 1),
                (models.Shift.shift_name.ilike('%день%'), 2),
                else_=3
            ).asc(),
            # cast(models.Batch.batch_number, Integer).desc(),
            desc(models.Batch.id)
        )
        .limit(limit)
        .all()
    )

    items = []
    for b in batches:
        s = b.shift
        master_name = s.master.name if s and s.master else "Мастер смены"
        lfm_sheets = 0
        if s and s.lfm_reports:
            lfm_sheets = sum(r.lfm_sheets or 0 for r in s.lfm_reports)
        elif b.stacked_stacks:
            lfm_sheets = b.stacked_stacks

        prod_name = b.product_name or (s.product_name if s else "Шифер 8 волн")
        date_str = s.date.strftime("%d.%m.%Y") if s and s.date else ""
        raw_date = s.date.strftime("%Y-%m-%d") if s and s.date else ""

        # Первичные данные мастера
        master_condition = b.ds_condition or 0
        master_first_grade = b.ds_first_grade or 0
        master_defect = b.ds_defect or 0

        # Если была верификация СКК, берем qcd_*
        qcd_cond = b.qcd_condition if b.qcd_verified else master_condition
        qcd_fg = b.qcd_first_grade if b.qcd_verified else master_first_grade
        qcd_def = b.qcd_defect if b.qcd_verified else master_defect

        items.append({
            "id": b.id,
            "shift_id": s.id if s else None,
            "batch_number": b.batch_number or "—",
            "date": date_str,
            "raw_date": raw_date,
            "shift_name": s.shift_name or "День" if s else "День",
            "master_name": master_name,
            "product_name": prod_name,
            "lfm_sheets": lfm_sheets,
            "qcd_verified": bool(b.qcd_verified),
            "qcd_verified_at": b.qcd_verified_at.strftime("%d.%m.%Y %H:%M") if b.qcd_verified_at else None,
            "qcd_verified_by": b.qcd_verified_by,
            
            # Данные мастера (база)
            "master_condition": master_condition,
            "master_first_grade": master_first_grade,
            "master_defect": master_defect,
            
            # Текущие значения
            "condition": qcd_cond,
            "first_grade": qcd_fg,
            "defect": qcd_def,
        })

    return items


@router.get("/batches/{batch_id}")
def get_batch_details_for_qcd(batch_id: int, db: Session = Depends(get_db)):
    """
    Возвращает детальную карточку партии: данные мастера и текущие данные СКК.
    """
    from sqlalchemy.orm import selectinload
    b = (
        db.query(models.Batch)
        .options(
            selectinload(models.Batch.shift).selectinload(models.Shift.master),
            selectinload(models.Batch.shift).selectinload(models.Shift.lfm_reports)
        )
        .filter(models.Batch.id == batch_id)
        .first()
    )
    if not b:
        raise HTTPException(status_code=404, detail="Партия не найдена")

    s = b.shift
    master_name = s.master.name if s and s.master else "Мастер смены"
    lfm_sheets = 0
    if s and s.lfm_reports:
        lfm_sheets = sum(r.lfm_sheets or 0 for r in s.lfm_reports)
    elif b.stacked_stacks:
        lfm_sheets = b.stacked_stacks

    prod_name = b.product_name or (s.product_name if s else "Шифер 8 волн")
    date_str = s.date.strftime("%d.%m.%Y") if s and s.date else ""

    # Первичные значения мастера
    master_cond = b.ds_condition or 0
    master_fg = b.ds_first_grade or 0
    master_def = b.ds_defect or 0

    # Если уже верифицировано СКК, отдаем qcd_* иначе предзаполняем от мастера
    is_v = bool(b.qcd_verified)
    qcd_cond = b.qcd_condition if is_v else master_cond
    qcd_fg = b.qcd_first_grade if is_v else master_fg
    qcd_def = b.qcd_defect if is_v else master_def

    return {
        "id": b.id,
        "shift_id": s.id if s else None,
        "batch_number": b.batch_number or "—",
        "date": date_str,
        "raw_date": s.date.strftime("%Y-%m-%d") if s and s.date else "",
        "shift_name": s.shift_name or "День" if s else "День",
        "master_name": master_name,
        "product_name": prod_name,
        "lfm_sheets": lfm_sheets,
        "qcd_verified": is_v,
        "qcd_verified_at": b.qcd_verified_at.strftime("%d.%m.%Y %H:%M") if b.qcd_verified_at else None,
        "qcd_verified_by": b.qcd_verified_by,
        "qcd_root_cause": b.qcd_root_cause or "",
        "qcd_notes": b.qcd_notes or "",

        # Исходные данные мастера
        "master": {
            "condition": master_cond,
            "first_grade": master_fg,
            "defect": master_def,
            "pct_defect": round((master_def / lfm_sheets * 100), 2) if lfm_sheets > 0 else 0.0,
            "defect_chip": b.ds_defect_chip or 0,
            "defect_scratch": b.ds_defect_scratch or 0,
            "defect_bad_cut": b.ds_defect_bad_cut or 0,
            "defect_stick_bottom": b.ds_defect_stick_bottom or 0,
            "defect_stick_top": b.ds_defect_stick_top or 0,
            "defect_broken": b.ds_defect_broken or 0,
            "defect_fell_box": b.ds_defect_fell_box or 0,
            "defect_dent": b.ds_defect_dent or 0,
            "defect_thickness": b.ds_defect_thickness or 0,
            "defect_delamination": b.ds_defect_delamination or 0,
            "defect_edge": b.ds_defect_edge or 0,
        },

        # Значения СКК
        "qcd": {
            "condition": qcd_cond,
            "first_grade": qcd_fg,
            "defect": qcd_def,
            "pct_defect": round((qcd_def / lfm_sheets * 100), 2) if lfm_sheets > 0 else 0.0,
            "fg_chip": b.qcd_defect_chip or 0,
            "fg_scratch": b.qcd_defect_scratch or 0,
            "fg_bad_cut": b.qcd_defect_bad_cut or 0,
            "fg_stick_bottom": b.qcd_defect_stick_bottom or 0,
            "fg_stick_top": b.qcd_defect_stick_top or 0,
            "fg_curved_edge": getattr(b, 'qcd_defect_curved_edge', 0) or 0,
            "fg_no_pattern": getattr(b, 'qcd_defect_no_pattern', 0) or 0,
            "fg_dent": b.qcd_defect_dent or 0,
            "fg_thickness": b.qcd_defect_thickness or 0,
            "fg_delamination": b.qcd_defect_delamination or 0,
            "fg_edge": b.qcd_defect_edge or 0,
            "def_fell_box": b.qcd_defect_fell_box or 0,
            "def_broken": b.qcd_defect_broken or 0,
            "def_tech": getattr(b, 'qcd_defect_tech', 0) or 0,
        }
    }


@router.post("/batches/{batch_id}/verify")
def verify_batch_by_qcd(
    batch_id: int,
    data: QCDVerifyBatchDTO,
    background_tasks: BackgroundTasks,
    request: Request,
    db: Session = Depends(get_db)
):
    """
    Атомарная верификация партии инспектором СКК:
    1. Записывает проверенные значения в models.Batch (qcd_* поля).
    2. Обновляет итоговые значения сменного рапорта models.LFMReport (склад ГП, 1 сорт, брак).
    3. Логирует факт проверки в models.AuditLog.
    4. Запускает фоновую синхронизацию sync_google_sheets_bg() для мгновенного обновления листа «Переборка».
    """
    from routers.common import sync_google_sheets_bg

    b = db.query(models.Batch).filter(models.Batch.id == batch_id).first()
    if not b:
        raise HTTPException(status_code=404, detail="Партия не найдена")

    # Имя инспектора из сессии или входного DTO
    inspector = data.inspector_name
    if not inspector:
        sess_user = request.session.get("user")
        if sess_user and isinstance(sess_user, dict):
            inspector = sess_user.get("name")
    if not inspector:
        inspector = "Инспектор СКК"

    old_condition = b.qcd_condition or b.ds_condition or 0
    old_fg = b.qcd_first_grade or b.ds_first_grade or 0
    old_def = b.qcd_defect or b.ds_defect or 0

    # 1. Обновляем Batch поля СКК
    b.qcd_condition = data.condition
    b.qcd_first_grade = data.first_grade
    b.qcd_defect = data.defect_total

    # Детализация 1-го сорта
    b.qcd_defect_chip = data.fg_chip
    b.qcd_defect_scratch = data.fg_scratch
    b.qcd_defect_bad_cut = data.fg_bad_cut
    b.qcd_defect_stick_bottom = data.fg_stick_bottom
    b.qcd_defect_stick_top = data.fg_stick_top
    if hasattr(b, 'qcd_defect_curved_edge'):
        b.qcd_defect_curved_edge = data.fg_curved_edge
    if hasattr(b, 'qcd_defect_no_pattern'):
        b.qcd_defect_no_pattern = data.fg_no_pattern
    b.qcd_defect_dent = data.fg_dent
    b.qcd_defect_thickness = data.fg_thickness
    b.qcd_defect_delamination = data.fg_delamination
    b.qcd_defect_edge = data.fg_edge

    # Детализация брака
    b.qcd_defect_fell_box = data.def_fell_box
    b.qcd_defect_broken = data.def_broken
    if hasattr(b, 'qcd_defect_tech'):
        b.qcd_defect_tech = data.def_tech

    # Причина и протокол
    b.qcd_root_cause = data.root_cause
    b.qcd_notes = data.notes
    b.qcd_verified = True
    b.qcd_verified_at = datetime.utcnow()
    b.qcd_verified_by = inspector
    b.status = "qcd_checked"

    # 2. Каскадный пересчет основного сменного рапорта LFMReport
    s = b.shift
    if s and s.lfm_reports:
        # Для партии этой смены обновляем агрегаты сдачи на склад в LFMReport
        # Суммируем все проверенные партии смены или берем текущую
        total_qcd_gp = sum((item.qcd_condition if item.qcd_verified else (item.ds_condition or 0)) for item in s.batches)
        total_qcd_fg = sum((item.qcd_first_grade if item.qcd_verified else (item.ds_first_grade or 0)) for item in s.batches)
        total_qcd_def = sum((item.qcd_defect if item.qcd_verified else (item.ds_defect or 0)) for item in s.batches)

        # Обновляем первый LFMReport смены
        rep = s.lfm_reports[0]
        rep.transferred_to_warehouse = total_qcd_gp
        rep.formed_1st_grade = total_qcd_fg
        rep.formed_defect = total_qcd_def

    # 3. Аудит изменений
    audit_entry = models.AuditLog(
        user_name=inspector,
        action="QCD_VERIFY",
        target_table="batches",
        target_id=b.id,
        details=(
            f"Партия №{b.batch_number}: ГП {old_condition}->{data.condition}, "
            f"1 сорт {old_fg}->{data.first_grade}, Брак {old_def}->{data.defect_total}. "
            f"Причина: {data.root_cause or 'не указана'}."
        )
    )
    db.add(audit_entry)

    db.commit()
    db.refresh(b)

    # 4. Фоновая выгрузка в Google Sheets (лист «Переборка»)
    background_tasks.add_task(sync_google_sheets_bg)

    return {
        "status": "success",
        "message": f"Партия №{b.batch_number} успешно утверждена СКК и отправлена в Google Sheets",
        "batch_id": b.id,
        "qcd_verified_at": b.qcd_verified_at.strftime("%d.%m.%Y %H:%M") if b.qcd_verified_at else None,
        "qcd_verified_by": b.qcd_verified_by
    }
