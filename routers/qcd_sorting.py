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
