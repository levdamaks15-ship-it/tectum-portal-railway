import io
import os
from datetime import datetime, date, timedelta
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Request, Response, Query, status, BackgroundTasks
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session, selectinload
from sqlalchemy import desc, asc, and_, or_
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

import models
import schemas
from routers.common import get_db

router = APIRouter(prefix="/api/lkc", tags=["lkc"])

def normalize_lkc_shift(shift_raw: Optional[str]) -> str:
    """Нормализует наименование смены ЛКЦ к каноническим значениям 'День' или 'Ночь'."""
    if not shift_raw:
        return "День"
    s = str(shift_raw).strip().lower()
    if "ноч" in s or s == "2":
        return "Ночь"
    return "День"

# --- СПРАВОЧНИК НОМЕНКЛАТУРЫ И НОРМ РАСХОДА ---
LKC_CATALOG = [
    # --- РАСКРОЙ ПОЛОС: 1800х400 (3 полосы с 1 листа 1800х1200) ---
    {
        "id": "strip_1800_400_6",
        "name": "Полоса плоская 6мм 1800х400",
        "product_type": "Плоская полоса",
        "dimension_size": "пл. лист 6мм 1800х400",
        "thickness": "6 мм",
        "cut_ratio": 3.0,
        "default_unit": "шт",
        "norm_t": 0,
        "norm_l": 0,
        "norm_screws": 0,
        "norm_strips": 0,
        "plan_default": 750,
        "description": "Раскрой листа 6мм 1800х1200 на 3 полосы 1800х400"
    },
    {
        "id": "strip_1800_400_8",
        "name": "Полоса плоская 8мм 1800х400",
        "product_type": "Плоская полоса",
        "dimension_size": "пл. лист 8мм 1800х400",
        "thickness": "8 мм",
        "cut_ratio": 3.0,
        "default_unit": "шт",
        "norm_t": 0,
        "norm_l": 0,
        "norm_screws": 0,
        "norm_strips": 0,
        "plan_default": 750,
        "description": "Раскрой листа 8мм 1800х1200 на 3 полосы 1800х400"
    },
    {
        "id": "strip_1800_400_10",
        "name": "Полоса плоская 10мм 1800х400",
        "product_type": "Плоская полоса",
        "dimension_size": "пл. лист 10мм 1800х400",
        "thickness": "10 мм",
        "cut_ratio": 3.0,
        "default_unit": "шт",
        "norm_t": 0,
        "norm_l": 0,
        "norm_screws": 0,
        "norm_strips": 0,
        "plan_default": 750,
        "description": "Раскрой листа 10мм 1800х1200 на 3 полосы 1800х400"
    },

    # --- РАСКРОЙ ПОЛОС: 1800х300 (4 полосы с 1 листа 1800х1200) ---
    {
        "id": "strip_1800_300_6",
        "name": "Полоса плоская 6мм 1800х300",
        "product_type": "Плоская полоса",
        "dimension_size": "пл. лист 6мм 1800х300",
        "thickness": "6 мм",
        "cut_ratio": 4.0,
        "default_unit": "шт",
        "norm_t": 0,
        "norm_l": 0,
        "norm_screws": 0,
        "norm_strips": 0,
        "plan_default": 750,
        "description": "Раскрой листа 6мм 1800х1200 на 4 полосы 1800х300"
    },
    {
        "id": "strip_1800_300_8",
        "name": "Полоса плоская 8мм 1800х300",
        "product_type": "Плоская полоса",
        "dimension_size": "пл. лист 8мм 1800х300",
        "thickness": "8 мм",
        "cut_ratio": 4.0,
        "default_unit": "шт",
        "norm_t": 0,
        "norm_l": 0,
        "norm_screws": 0,
        "norm_strips": 0,
        "plan_default": 750,
        "description": "Раскрой листа 8мм 1800х1200 на 4 полосы 1800х300"
    },
    {
        "id": "strip_1800_300_10",
        "name": "Полоса плоская 10мм 1800х300",
        "product_type": "Плоская полоса",
        "dimension_size": "пл. лист 10мм 1800х300",
        "thickness": "10 мм",
        "cut_ratio": 4.0,
        "default_unit": "шт",
        "norm_t": 0,
        "norm_l": 0,
        "norm_screws": 0,
        "norm_strips": 0,
        "plan_default": 750,
        "description": "Раскрой листа 10мм 1800х1200 на 4 полосы 1800х300"
    },

    # --- РАСКРОЙ ПОЛОС: 1800х200 (6 полос с 1 листа 1800х1200) ---
    {
        "id": "strip_1800_200_6",
        "name": "Полоса плоская 6мм 1800х200",
        "product_type": "Плоская полоса",
        "dimension_size": "пл. лист 6мм 1800х200",
        "thickness": "6 мм",
        "cut_ratio": 6.0,
        "default_unit": "шт",
        "norm_t": 0,
        "norm_l": 0,
        "norm_screws": 0,
        "norm_strips": 0,
        "plan_default": 750,
        "description": "Раскрой листа 6мм 1800х1200 на 6 полос 1800х200"
    },
    {
        "id": "strip_1800_200_8",
        "name": "Полоса плоская 8мм 1800х200",
        "product_type": "Плоская полоса",
        "dimension_size": "пл. лист 8мм 1800х200",
        "thickness": "8 мм",
        "cut_ratio": 6.0,
        "default_unit": "шт",
        "norm_t": 0,
        "norm_l": 0,
        "norm_screws": 0,
        "norm_strips": 0,
        "plan_default": 750,
        "description": "Раскрой листа 8мм 1800х1200 на 6 полос 1800х200"
    },
    {
        "id": "strip_1800_200_10",
        "name": "Полоса плоская 10мм 1800х200",
        "product_type": "Плоская полоса",
        "dimension_size": "пл. лист 10мм 1800х200",
        "thickness": "10 мм",
        "cut_ratio": 6.0,
        "default_unit": "шт",
        "norm_t": 0,
        "norm_l": 0,
        "norm_screws": 0,
        "norm_strips": 0,
        "plan_default": 750,
        "description": "Раскрой листа 10мм 1800х1200 на 6 полос 1800х200"
    },

    # --- РАСКРОЙ ПОЛОС: 1800х240 (5 полос с 1 листа 1800х1200 по чертежу) ---
    {
        "id": "strip_1800_240_6",
        "name": "Полоса плоская 6мм 1800х240",
        "product_type": "Плоская полоса",
        "dimension_size": "пл. лист 6мм 1800х240",
        "thickness": "6 мм",
        "cut_ratio": 5.0,
        "default_unit": "шт",
        "norm_t": 0,
        "norm_l": 0,
        "norm_screws": 0,
        "norm_strips": 0,
        "plan_default": 750,
        "description": "Раскрой листа 6мм 1800х1200 на 5 полос 1800х240 (высота борта по ГОСТ 30340-2012)"
    },
    {
        "id": "strip_1800_240_8",
        "name": "Полоса плоская 8мм 1800х240",
        "product_type": "Плоская полоса",
        "dimension_size": "пл. лист 8мм 1800х240",
        "thickness": "8 мм",
        "cut_ratio": 5.0,
        "default_unit": "шт",
        "norm_t": 0,
        "norm_l": 0,
        "norm_screws": 0,
        "norm_strips": 0,
        "plan_default": 750,
        "description": "Раскрой листа 8мм 1800х1200 на 5 полос 1800х240 (высота борта по ГОСТ 30340-2012)"
    },
    {
        "id": "strip_1800_240_10",
        "name": "Полоса плоская 10мм 1800х240",
        "product_type": "Плоская полоса",
        "dimension_size": "пл. лист 10мм 1800х240",
        "thickness": "10 мм",
        "cut_ratio": 5.0,
        "default_unit": "шт",
        "norm_t": 0,
        "norm_l": 0,
        "norm_screws": 0,
        "norm_strips": 0,
        "plan_default": 750,
        "description": "Раскрой листа 10мм 1800х1200 на 5 полос 1800х240 (высота борта по ГОСТ 30340-2012)"
    },

    # --- ПЛОСКИЕ ЛИСТЫ (ЦЕЛЬНЫЕ): 1800х1200 ---
    {
        "id": "sheet_1800_1200_6",
        "name": "Плоский лист 6мм 1800х1200",
        "product_type": "Плоский лист",
        "dimension_size": "пл. лист 6мм 1800х1200",
        "thickness": "6 мм",
        "cut_ratio": 1.0,
        "default_unit": "шт",
        "norm_t": 0,
        "norm_l": 0,
        "norm_screws": 0,
        "norm_strips": 0,
        "plan_default": 750,
        "description": "Цельный плоский лист 6мм 1800х1200"
    },
    {
        "id": "sheet_1800_1200_8",
        "name": "Плоский лист 8мм 1800х1200",
        "product_type": "Плоский лист",
        "dimension_size": "пл. лист 8мм 1800х1200",
        "thickness": "8 мм",
        "cut_ratio": 1.0,
        "default_unit": "шт",
        "norm_t": 0,
        "norm_l": 0,
        "norm_screws": 0,
        "norm_strips": 0,
        "plan_default": 750,
        "description": "Цельный плоский лист 8мм 1800х1200"
    },
    {
        "id": "sheet_1800_1200_10",
        "name": "Плоский лист 10мм 1800х1200",
        "product_type": "Плоский лист",
        "dimension_size": "пл. лист 10мм 1800х1200",
        "thickness": "10 мм",
        "cut_ratio": 1.0,
        "default_unit": "шт",
        "norm_t": 0,
        "norm_l": 0,
        "norm_screws": 0,
        "norm_strips": 0,
        "plan_default": 750,
        "description": "Цельный плоский лист 10мм 1800х1200"
    },

    # --- КОМПЛЕКТЫ ГРЯДОК (Сборка под заказ, чертёжная высота 240 мм по ГОСТ 30340-2012) ---
    {
        "id": "bed_3600",
        "name": "Грядка 3.6 м (3600х900х240)",
        "product_type": "Комплект грядок",
        "dimension_size": "грядка 3600х900х240",
        "default_unit": "компл",
        "norm_t": 6,
        "norm_l": 4,
        "norm_screws": 40,
        "norm_strips": 10,
        "plan_default": 0,
        "description": "Комплект грядки 3.6 м (3600х900х240 мм). Норма на 1 компл: Т-профиль 6 шт, L-уголок 4 шт, Шурупы 40 шт, Полосы 10 шт (2 цельных листа 1800х1200). Свободный ввод заказа."
    },
    {
        "id": "bed_2700",
        "name": "Грядка 2.7 м (2700х900х240)",
        "product_type": "Комплект грядок",
        "dimension_size": "грядка 2700х900х240",
        "default_unit": "компл",
        "norm_t": 4,
        "norm_l": 4,
        "norm_screws": 32,
        "norm_strips": 8,
        "plan_default": 0,
        "description": "Комплект грядки 2.7 м (2700х900х240 мм по чертежу). Норма на 1 компл: Т-профиль 4 шт, L-уголок 4 шт, Шурупы 32 шт, Полосы 8 шт (1.6 листа 1800х1200). Свободный ввод заказа."
    },
    {
        "id": "bed_1800",
        "name": "Грядка 1.8 м (1800х900х240)",
        "product_type": "Комплект грядок",
        "dimension_size": "грядка 1800х900х240",
        "default_unit": "компл",
        "norm_t": 2,
        "norm_l": 4,
        "norm_screws": 24,
        "norm_strips": 6,
        "plan_default": 0,
        "description": "Комплект грядки 1.8 м (1800х900х240 мм). Норма на 1 компл: Т-профиль 2 шт, L-уголок 4 шт, Шурупы 24 шт, Полосы 6 шт (1.2 листа 1800х1200). Свободный ввод заказа."
    }
]

@router.get("/catalog")
def get_catalog():
    """Возвращает справочник типоразмеров и норм расхода комплектующих."""
    return {"catalog": LKC_CATALOG}


@router.get("/reports", response_model=List[schemas.LKCShiftReportOut])
def get_reports(
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    limit: int = 50,
    db: Session = Depends(get_db)
):
    """Возвращает список рапортов ЛКЦ с фильтрацией по датам."""
    query = db.query(models.LKCShiftReport).options(
        selectinload(models.LKCShiftReport.items),
        selectinload(models.LKCShiftReport.raw_materials),
        selectinload(models.LKCShiftReport.downtimes)
    ).filter(models.LKCShiftReport.is_active == True)

    if start_date:
        query = query.filter(models.LKCShiftReport.report_date >= start_date)
    if end_date:
        query = query.filter(models.LKCShiftReport.report_date <= end_date)

    reports = query.order_by(models.LKCShiftReport.report_date.desc(), models.LKCShiftReport.id.desc()).limit(limit).all()
    return reports


@router.get("/reports/by_date", response_model=Optional[schemas.LKCShiftReportOut])
def get_report_by_date(
    report_date: date,
    shift_name: str = "День",
    db: Session = Depends(get_db)
):
    """Получает рапорт ЛКЦ на конкретную дату и смену (с авто-распознаванием 'День'/'Ночь')."""
    norm_shift = normalize_lkc_shift(shift_name)
    report = db.query(models.LKCShiftReport).options(
        selectinload(models.LKCShiftReport.items),
        selectinload(models.LKCShiftReport.raw_materials),
        selectinload(models.LKCShiftReport.downtimes)
    ).filter(
        models.LKCShiftReport.report_date == report_date,
        or_(
            models.LKCShiftReport.shift_name == norm_shift,
            models.LKCShiftReport.shift_name == shift_name,
            and_(norm_shift == "День", models.LKCShiftReport.shift_name.ilike("%Дневн%")),
            and_(norm_shift == "Ночь", models.LKCShiftReport.shift_name.ilike("%Ноч%"))
        ),
        models.LKCShiftReport.is_active == True
    ).first()
    return report


@router.get("/reports/{report_id}", response_model=schemas.LKCShiftReportOut)
def get_report_by_id(report_id: int, db: Session = Depends(get_db)):
    """Получает подробный рапорт ЛКЦ по ID."""
    report = db.query(models.LKCShiftReport).options(
        selectinload(models.LKCShiftReport.items),
        selectinload(models.LKCShiftReport.raw_materials),
        selectinload(models.LKCShiftReport.downtimes)
    ).filter(
        models.LKCShiftReport.id == report_id,
        models.LKCShiftReport.is_active == True
    ).first()
    if not report:
        raise HTTPException(status_code=404, detail="Рапорт ЛКЦ не найден")
    return report


@router.post("/reports", response_model=schemas.LKCShiftReportOut)
def save_report(
    data: schemas.LKCShiftReportCreate,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """
    Создает или обновляет рапорт смены ЛКЦ в единой атомарной транзакции (Strict Backend-First).
    """
    try:
        norm_shift = normalize_lkc_shift(data.shift_name)

        # Ищем существующий рапорт на эту дату и смену
        report = db.query(models.LKCShiftReport).filter(
            models.LKCShiftReport.report_date == data.report_date,
            or_(
                models.LKCShiftReport.shift_name == norm_shift,
                models.LKCShiftReport.shift_name == data.shift_name,
                and_(norm_shift == "День", models.LKCShiftReport.shift_name.ilike("%Дневн%")),
                and_(norm_shift == "Ночь", models.LKCShiftReport.shift_name.ilike("%Ноч%"))
            ),
            models.LKCShiftReport.is_active == True
        ).first()

        if not report:
            report = models.LKCShiftReport(
                report_date=data.report_date,
                shift_name=norm_shift,
                master_id=data.master_id,
                master_name=data.master_name or "Миркасимов И.М.",
                status=data.status or "completed",
                raw_sheets_thickness=data.raw_sheets_thickness or "8 мм",
                raw_sheets_spent=data.raw_sheets_spent or 0.0,
                warehouse_submitted_qty=data.warehouse_submitted_qty or 0.0,
                scrap_defect_qty=data.scrap_defect_qty or 0.0,
                notes=data.notes or "",
                is_active=True,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow()
            )
            db.add(report)
            db.flush()
        else:
            # Обновляем поля шапки с нормализацией смены
            report.shift_name = norm_shift
            report.master_id = data.master_id
            report.master_name = data.master_name or report.master_name
            report.status = data.status or report.status
            report.raw_sheets_thickness = data.raw_sheets_thickness or report.raw_sheets_thickness
            report.raw_sheets_spent = data.raw_sheets_spent or 0.0
            report.warehouse_submitted_qty = data.warehouse_submitted_qty or 0.0
            report.scrap_defect_qty = data.scrap_defect_qty or 0.0
            report.notes = data.notes or ""
            report.updated_at = datetime.utcnow()
            
            # Удаляем старые строки позиций для чистой перезаписи
            db.query(models.LKCReportItem).filter(models.LKCReportItem.report_id == report.id).delete()
            db.query(models.LKCRawMaterialUsage).filter(models.LKCRawMaterialUsage.report_id == report.id).delete()

        # Добавляем строки позиций выпуска
        for idx, item_data in enumerate(data.items or []):
            order_num = (item_data.order_number or item_data.order_batch or "").strip()
            item = models.LKCReportItem(
                report_id=report.id,
                item_order=idx + 1,
                product_type=item_data.product_type or "Комплект грядок",
                dimension_size=item_data.dimension_size or "",
                plan_qty=item_data.plan_qty or 0.0,
                fact_qty=item_data.fact_qty or 0.0,
                fact_unit=item_data.fact_unit or "шт",
                order_batch=order_num,
                order_number=order_num,
                sets_count=item_data.sets_count or 0,
                comp_t_count=item_data.comp_t_count or 0.0,
                comp_l_count=item_data.comp_l_count or 0.0,
                comp_screws_count=item_data.comp_screws_count or 0,
                comp_strips_count=item_data.comp_strips_count or 0,
                raw_sheets_thickness=item_data.raw_sheets_thickness or report.raw_sheets_thickness,
                raw_sheets_spent=item_data.raw_sheets_spent or 0.0,
                warehouse_submitted_qty=item_data.warehouse_submitted_qty or 0.0,
                notes=item_data.notes or "",
                created_at=datetime.utcnow()
            )
            db.add(item)

        # Добавляем строки списания сырья
        total_raw_spent = 0.0
        total_wh_sub = 0.0
        total_scrap = 0.0
        for idx, raw_data in enumerate(data.raw_materials or []):
            spent = raw_data.spent_qty or 0.0
            wh_qty = raw_data.warehouse_submitted_qty or 0.0
            scrap = raw_data.scrap_defect_qty or 0.0
            total_raw_spent += spent
            total_wh_sub += wh_qty
            total_scrap += scrap

            raw_obj = models.LKCRawMaterialUsage(
                report_id=report.id,
                item_order=idx + 1,
                material_name=raw_data.material_name or "Плоский лист 8мм 1800х1200",
                thickness=raw_data.thickness or "8 мм",
                spent_qty=spent,
                unit=raw_data.unit or "шт",
                warehouse_submitted_qty=wh_qty,
                scrap_defect_qty=scrap,
                notes=raw_data.notes or "",
                created_at=datetime.utcnow()
            )
            db.add(raw_obj)

        if data.raw_materials:
            report.raw_sheets_spent = total_raw_spent
            report.warehouse_submitted_qty = total_wh_sub
            report.scrap_defect_qty = total_scrap

        # Обработка простоев (если переданы)
        if data.downtimes:
            # Удаляем старые простои, привязанные к отчету
            db.query(models.LKCDowntime).filter(models.LKCDowntime.report_id == report.id).delete()
            for dt in data.downtimes:
                downtime_obj = models.LKCDowntime(
                    report_id=report.id,
                    downtime_date=data.report_date,
                    shift_name=norm_shift,
                    master_name=report.master_name,
                    start_time=dt.start_time,
                    end_time=dt.end_time or "",
                    duration_minutes=dt.duration_minutes or 0,
                    equipment_node=dt.equipment_node or "Дисковая пила",
                    category=dt.category or "Механическая",
                    reason=dt.reason or "",
                    comment=dt.comment or "",
                    is_active=True,
                    created_at=datetime.utcnow()
                )
                db.add(downtime_obj)

        db.commit()

        # Фоновая синхронизация с Google Таблицей ЛКЦ
        try:
            import google_sheets_integration
            if background_tasks and google_sheets_integration:
                background_tasks.add_task(google_sheets_integration.export_lkc_to_google_sheets, db)
        except Exception as bg_err:
            print(f"[LKC] Фоновая синхронизация Google не запланирована: {bg_err}")

        # Перезагружаем со всеми связями
        db.refresh(report)
        return db.query(models.LKCShiftReport).options(
            selectinload(models.LKCShiftReport.items),
            selectinload(models.LKCShiftReport.raw_materials),
            selectinload(models.LKCShiftReport.downtimes)
        ).filter(models.LKCShiftReport.id == report.id).first()

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Ошибка сохранения рапорта ЛКЦ: {str(e)}")


@router.delete("/reports/{report_id}")
def delete_report(report_id: int, db: Session = Depends(get_db)):
    """Мягкое удаление рапорта ЛКЦ."""
    report = db.query(models.LKCShiftReport).filter(models.LKCShiftReport.id == report_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Рапорт не найден")
    report.is_active = False
    report.updated_at = datetime.utcnow()
    db.commit()
    return {"status": "ok", "message": f"Рапорт №{report_id} успешно удален"}


# --- АНАЛИТИКА: СКВОЗНЫЕ ЗАКАЗЫ И СЫРЬЕВОЙ БАЛАНС ---

@router.get("/orders/progress", response_model=schemas.LKCOrderProgressOut)
def get_order_progress(
    order_number: str = Query(..., description="Номер или наименование заказа"),
    current_report_id: Optional[int] = Query(None, description="ID текущего отчета"),
    current_shift_qty: Optional[float] = Query(0.0, description="Количество в текущей смене"),
    db: Session = Depends(get_db)
):
    """
    Возвращает сквозной прогресс выполнения заказа нарастающим итогом по всем сменам ЛКЦ.
    Позволяет мастеру видеть, сколько уже сделано по заказу ранее, сколько делается в эту смену,
    и сколько осталось до полного закрытия заказа.
    """
    clean_ord = str(order_number).strip()
    if not clean_ord:
        return schemas.LKCOrderProgressOut(order_number="")

    # Ищем все строки выпуска с этим номером заказа в активных отчетах
    items = db.query(models.LKCReportItem).join(models.LKCShiftReport).filter(
        models.LKCShiftReport.is_active == True,
        or_(
            models.LKCReportItem.order_number == clean_ord,
            models.LKCReportItem.order_batch == clean_ord,
            models.LKCReportItem.order_number.ilike(f"%{clean_ord}%"),
            models.LKCReportItem.order_batch.ilike(f"%{clean_ord}%")
        )
    ).all()

    total_planned = 0.0
    for it in items:
        if it.plan_qty and it.plan_qty > total_planned:
            total_planned = float(it.plan_qty)

    previously_produced = 0.0
    for it in items:
        if current_report_id and it.report_id == current_report_id:
            continue
        qty = float(it.sets_count if (it.sets_count and it.sets_count > 0) else (it.fact_qty or 0.0))
        previously_produced += qty

    cur_shift = float(current_shift_qty or 0.0)
    total_produced = previously_produced + cur_shift
    remaining = max(0.0, total_planned - total_produced) if total_planned > 0 else 0.0
    completion_pct = round((total_produced / total_planned * 100), 1) if total_planned > 0 else 0.0

    return schemas.LKCOrderProgressOut(
        order_number=clean_ord,
        total_planned_qty=total_planned,
        previously_produced_qty=previously_produced,
        current_shift_produced_qty=cur_shift,
        total_produced_qty=total_produced,
        remaining_qty=remaining,
        completion_percentage=completion_pct
    )


@router.get("/reports/{report_id}/balance", response_model=schemas.LKCMaterialBalanceSummary)
def get_report_balance(report_id: int, db: Session = Depends(get_db)):
    """
    Рассчитывает материальный сырьевой баланс отчета смены ЛКЦ:
    нормативная потребность (теоретический расход листов 6/8/10 мм, полос, Т, L, шурупов)
    в сравнении с фактическим списанием из таблицы сырья.
    """
    report = db.query(models.LKCShiftReport).options(
        selectinload(models.LKCShiftReport.items),
        selectinload(models.LKCShiftReport.raw_materials)
    ).filter(
        models.LKCShiftReport.id == report_id,
        models.LKCShiftReport.is_active == True
    ).first()
    if not report:
        raise HTTPException(status_code=404, detail="Рапорт ЛКЦ не найден")

    norm_sheets_6 = 0.0
    norm_sheets_8 = 0.0
    norm_sheets_10 = 0.0
    norm_strips = 0
    norm_t = 0.0
    norm_l = 0.0
    norm_screws = 0

    for it in (report.items or []):
        dim = (it.dimension_size or "").lower()
        is_bed = "гряд" in dim or "3600" in dim or "2700" in dim or "1800х900" in dim
        sets = it.sets_count or 0
        fact = it.fact_qty or 0.0

        if is_bed:
            strips_bed = 0
            if "3600" in dim or "3.6" in dim:
                norm_t += sets * 6
                norm_l += sets * 4
                norm_screws += sets * 40
                norm_strips += sets * 10
                strips_bed = sets * 10
            elif "2700" in dim or "2.7" in dim:
                norm_t += sets * 4
                norm_l += sets * 4
                norm_screws += sets * 32
                norm_strips += sets * 8
                strips_bed = sets * 8
            elif "1800" in dim or "1.8" in dim:
                norm_t += sets * 2
                norm_l += sets * 4
                norm_screws += sets * 24
                norm_strips += sets * 6
                strips_bed = sets * 6

            bed_ratio = 5.0 # Лист 1800х1200 дает 5 полос 1800х240 без отходов
            sheets_needed = (strips_bed / bed_ratio) if bed_ratio > 0 else 0.0
            th = (it.raw_sheets_thickness or "").lower()
            if "6" in th or "6мм" in dim:
                norm_sheets_6 += sheets_needed
            elif "10" in th or "10мм" in dim:
                norm_sheets_10 += sheets_needed
            else:
                norm_sheets_8 += sheets_needed
        else:
            ratio = 4.0
            if "400" in dim: ratio = 3.0
            elif "240" in dim: ratio = 5.0
            elif "200" in dim: ratio = 6.0
            elif "300" in dim: ratio = 4.0

            sheets_needed = (fact / ratio) if ratio > 0 else 0.0
            th = (it.raw_sheets_thickness or "").lower()
            if "6" in th or "6мм" in dim:
                norm_sheets_6 += sheets_needed
            elif "10" in th or "10мм" in dim:
                norm_sheets_10 += sheets_needed
            else:
                norm_sheets_8 += sheets_needed

    fact_spent = 0.0
    fact_sub = 0.0
    fact_scrap = 0.0

    for rm in (report.raw_materials or []):
        fact_spent += (rm.spent_qty or 0.0)
        fact_sub += (rm.warehouse_submitted_qty or 0.0)
        fact_scrap += (rm.scrap_defect_qty or 0.0)

    norm_total_sheets = round(norm_sheets_6 + norm_sheets_8 + norm_sheets_10, 1)
    balance_diff = round(fact_spent - (fact_sub + fact_scrap), 2)
    sheets_var = round(fact_spent - norm_total_sheets, 2)
    kis = round((fact_sub / fact_spent * 100), 1) if fact_spent > 0 else 0.0
    scrap_pct = round((fact_scrap / fact_spent * 100), 1) if fact_spent > 0 else 0.0

    return schemas.LKCMaterialBalanceSummary(
        report_id=report.id,
        report_date=report.report_date,
        shift_name=report.shift_name,
        master_name=report.master_name or "",
        norm_sheets_6mm=round(norm_sheets_6, 1),
        norm_sheets_8mm=round(norm_sheets_8, 1),
        norm_sheets_10mm=round(norm_sheets_10, 1),
        norm_sheets_total=norm_total_sheets,
        norm_strips_total=norm_strips,
        norm_t_total=norm_t,
        norm_l_total=norm_l,
        norm_screws_total=norm_screws,
        fact_sheets_spent=round(fact_spent, 1),
        fact_warehouse_submitted=round(fact_sub, 1),
        fact_scrap_defect=round(fact_scrap, 1),
        balance_diff=balance_diff,
        sheets_variance=sheets_var,
        kis_percentage=kis,
        defect_percentage=scrap_pct
    )


# --- ПРОСТОИ ЛКЦ ---
@router.get("/downtimes", response_model=List[schemas.LKCDowntimeOut])
def get_downtimes(
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    db: Session = Depends(get_db)
):
    """Возвращает список простоев участка ЛКЦ."""
    query = db.query(models.LKCDowntime).filter(models.LKCDowntime.is_active == True)
    if start_date:
        query = query.filter(models.LKCDowntime.downtime_date >= start_date)
    if end_date:
        query = query.filter(models.LKCDowntime.downtime_date <= end_date)
    return query.order_by(models.LKCDowntime.downtime_date.desc(), models.LKCDowntime.start_time.desc()).all()


@router.post("/downtimes", response_model=schemas.LKCDowntimeOut)
def create_downtime(data: schemas.LKCDowntimeCreate, db: Session = Depends(get_db)):
    """Создает запись простоя на участке ЛКЦ."""
    try:
        dt = models.LKCDowntime(
            report_id=data.report_id,
            downtime_date=data.downtime_date or date.today(),
            shift_name=normalize_lkc_shift(data.shift_name),
            master_name=data.master_name or "Миркасимов И.М.",
            start_time=data.start_time,
            end_time=data.end_time or "",
            duration_minutes=data.duration_minutes or 0,
            equipment_node=data.equipment_node or "Дисковая пила",
            category=data.category or "Механическая",
            reason=data.reason or "",
            comment=data.comment or "",
            is_active=True,
            created_at=datetime.utcnow()
        )
        db.add(dt)
        db.commit()
        db.refresh(dt)
        return dt
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Ошибка создания записи простоя: {str(e)}")


@router.delete("/downtimes/{downtime_id}")
def delete_downtime(downtime_id: int, db: Session = Depends(get_db)):
    """Мягкое удаление записи простоя."""
    dt = db.query(models.LKCDowntime).filter(models.LKCDowntime.id == downtime_id).first()
    if not dt:
        raise HTTPException(status_code=404, detail="Запись простоя не найдена")
    dt.is_active = False
    db.commit()
    return {"status": "ok", "message": f"Простой №{downtime_id} удален"}


# --- ЭКСПОРТ В EXCEL ---
@router.get("/export_excel")
def export_excel(
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    db: Session = Depends(get_db)
):
    """
    Генерирует недельный рапорт ЛКЦ в формате Excel (.xlsx),
    в точности повторяющий официальный шаблон предприятия.
    """
    if not start_date:
        today = date.today()
        start_date = today - timedelta(days=today.weekday())
    if not end_date:
        end_date = start_date + timedelta(days=6)

    # Извлекаем все рапорты за период
    reports = db.query(models.LKCShiftReport).options(
        selectinload(models.LKCShiftReport.items),
        selectinload(models.LKCShiftReport.downtimes)
    ).filter(
        models.LKCShiftReport.report_date >= start_date,
        models.LKCShiftReport.report_date <= end_date,
        models.LKCShiftReport.is_active == True
    ).order_by(models.LKCShiftReport.report_date.asc(), models.LKCShiftReport.id.asc()).all()

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Недельный рапорт ЛКЦ"

    # Стили
    title_font = Font(name="Calibri", size=13, bold=True, color="1E3A8A")
    sub_font = Font(name="Calibri", size=9, bold=False, color="475569")
    header_font = Font(name="Calibri", size=9, bold=True, color="FFFFFF")
    data_font = Font(name="Calibri", size=9, bold=False, color="0F172A")
    bold_font = Font(name="Calibri", size=9, bold=True, color="0F172A")
    total_font = Font(name="Calibri", size=10, bold=True, color="1E3A8A")

    header_fill = PatternFill(start_color="1E3A8A", end_color="1E3A8A", fill_type="solid")
    sub_header_fill = PatternFill(start_color="2563EB", end_color="2563EB", fill_type="solid")
    total_fill = PatternFill(start_color="E2E8F0", end_color="E2E8F0", fill_type="solid")

    thin_border = Border(
        left=Side(style="thin", color="CBD5E1"),
        right=Side(style="thin", color="CBD5E1"),
        top=Side(style="thin", color="CBD5E1"),
        bottom=Side(style="thin", color="CBD5E1")
    )
    thick_bottom = Border(
        left=Side(style="thin", color="CBD5E1"),
        right=Side(style="thin", color="CBD5E1"),
        top=Side(style="thin", color="CBD5E1"),
        bottom=Side(style="medium", color="1E3A8A")
    )

    align_center = Alignment(horizontal="center", vertical="center", wrap_text=True)
    align_left = Alignment(horizontal="left", vertical="center", wrap_text=True)
    align_right = Alignment(horizontal="right", vertical="center")

    # Шапка отчета
    ws.merge_cells("A1:N1")
    ws["A1"] = "ТЕКТУМ ИНЖИНИРИНГ (TECTUM ENGINEERING) — НЕДЕЛЬНЫЙ РАПОРТ ЛКЦ"
    ws["A1"].font = title_font
    ws["A1"].alignment = align_center

    period_str = f"Период: {start_date.strftime('%d.%m.%Y')} – {end_date.strftime('%d.%m.%Y')} | Участок: Линия кровельных сэндвич-панелей и комплектующих (ЛКЦ) | Режим: Дневная смена"
    ws.merge_cells("A2:N2")
    ws["A2"] = period_str
    ws["A2"].font = sub_font
    ws["A2"].alignment = align_center

    # Заголовки таблицы (Строки 4 и 5)
    headers = [
        ("A4:A5", "№\nп/п"),
        ("B4:B5", "Дата"),
        ("C4:C5", "Мастер\n(Ф.И.О.)"),
        ("D4:D5", "Размер /\nТипоразмер"),
        ("E4:E5", "План\n(шт.)"),
        ("F4:F5", "Факт\n(шт.)"),
        ("G4:G5", "Комплект\n(Заказ / Партия)"),
        ("H4:H5", "Кол-во\nкомпл."),
        ("I4:L4", "Комплектующие (шт.)"),
        ("M4:M5", "Сдано на\nсклад (шт.)"),
        ("N4:N5", "Причины простоев / Отклонений /\nПримечания"),
    ]

    for cell_range, text in headers:
        if ":" in cell_range:
            ws.merge_cells(cell_range)
            top_left = cell_range.split(":")[0]
            ws[top_left] = text
        else:
            ws[cell_range] = text

    # Подзаголовки комплектующих
    ws["I5"] = "T"
    ws["J5"] = "L"
    ws["K5"] = "Шурупы"
    ws["L5"] = "Полосы"

    for r in range(4, 6):
        for c in range(1, 15):
            cell = ws.cell(row=r, column=c)
            cell.font = header_font
            cell.fill = header_fill if r == 4 else sub_header_fill
            cell.alignment = align_center
            cell.border = thin_border

    # Заполнение строк по дням недели
    current_row = 6
    row_num = 1
    total_plan = 0
    total_fact = 0
    total_sets = 0
    total_t = 0
    total_l = 0
    total_screws = 0
    total_strips = 0
    total_warehouse = 0

    curr_d = start_date
    while curr_d <= end_date:
        d_str = curr_d.strftime("%d.%m.%Y")
        day_report = next((rep for rep in reports if rep.report_date == curr_d), None)

        if day_report and day_report.items:
            for item in day_report.items:
                ws.cell(row=current_row, column=1, value=row_num).alignment = align_center
                ws.cell(row=current_row, column=2, value=d_str).alignment = align_center
                ws.cell(row=current_row, column=3, value=day_report.master_name or "Миркасимов И.М.").alignment = align_left
                ws.cell(row=current_row, column=4, value=item.dimension_size or "").alignment = align_left
                ws.cell(row=current_row, column=5, value=item.plan_qty or 0).alignment = align_right
                ws.cell(row=current_row, column=6, value=item.fact_qty or 0).alignment = align_right
                order_disp = item.order_number or item.order_batch or ""
                ws.cell(row=current_row, column=7, value=order_disp).alignment = align_left
                ws.cell(row=current_row, column=8, value=item.sets_count or 0).alignment = align_right
                ws.cell(row=current_row, column=9, value=item.comp_t_count or 0).alignment = align_right
                ws.cell(row=current_row, column=10, value=item.comp_l_count or 0).alignment = align_right
                ws.cell(row=current_row, column=11, value=item.comp_screws_count or 0).alignment = align_right
                ws.cell(row=current_row, column=12, value=item.comp_strips_count or 0).alignment = align_right
                
                wh_val = item.warehouse_submitted_qty if item.warehouse_submitted_qty > 0 else (day_report.warehouse_submitted_qty or 0)
                ws.cell(row=current_row, column=13, value=wh_val).alignment = align_right
                
                notes_val = item.notes or day_report.notes or ""
                ws.cell(row=current_row, column=14, value=notes_val).alignment = align_left

                for c in range(1, 15):
                    cell = ws.cell(row=current_row, column=c)
                    cell.font = data_font
                    cell.border = thin_border

                total_plan += (item.plan_qty or 0)
                total_fact += (item.fact_qty or 0)
                total_sets += (item.sets_count or 0)
                total_t += (item.comp_t_count or 0)
                total_l += (item.comp_l_count or 0)
                total_screws += (item.comp_screws_count or 0)
                total_strips += (item.comp_strips_count or 0)
                total_warehouse += wh_val

                current_row += 1
                row_num += 1
        else:
            # Пустая строка для дня
            ws.cell(row=current_row, column=1, value=row_num).alignment = align_center
            ws.cell(row=current_row, column=2, value=d_str).alignment = align_center
            ws.cell(row=current_row, column=3, value=day_report.master_name if day_report else "Миркасимов И.М.").alignment = align_left
            ws.cell(row=current_row, column=4, value="").alignment = align_left
            ws.cell(row=current_row, column=5, value=750).alignment = align_right # Стандартный сменный план
            ws.cell(row=current_row, column=6, value="").alignment = align_right
            ws.cell(row=current_row, column=7, value="").alignment = align_left
            ws.cell(row=current_row, column=8, value="").alignment = align_right
            ws.cell(row=current_row, column=9, value="").alignment = align_right
            ws.cell(row=current_row, column=10, value="").alignment = align_right
            ws.cell(row=current_row, column=11, value="").alignment = align_right
            ws.cell(row=current_row, column=12, value="").alignment = align_right
            ws.cell(row=current_row, column=13, value="").alignment = align_right
            ws.cell(row=current_row, column=14, value=day_report.notes if day_report else "").alignment = align_left

            for c in range(1, 15):
                cell = ws.cell(row=current_row, column=c)
                cell.font = data_font
                cell.border = thin_border

            total_plan += 750
            current_row += 1
            row_num += 1

        curr_d += timedelta(days=1)

    # Строка ИТОГО ЗА НЕДЕЛЮ
    ws.merge_cells(f"A{current_row}:D{current_row}")
    ws[f"A{current_row}"] = f"ИТОГО ЗА НЕДЕЛЮ ({start_date.strftime('%d.%m.%Y')} - {end_date.strftime('%d.%m.%Y')}):"
    ws[f"A{current_row}"].font = total_font
    ws[f"A{current_row}"].alignment = align_right

    ws.cell(row=current_row, column=5, value=total_plan).alignment = align_right
    ws.cell(row=current_row, column=6, value=total_fact).alignment = align_right
    ws.cell(row=current_row, column=7, value="")
    ws.cell(row=current_row, column=8, value=total_sets).alignment = align_right
    ws.cell(row=current_row, column=9, value=total_t).alignment = align_right
    ws.cell(row=current_row, column=10, value=total_l).alignment = align_right
    ws.cell(row=current_row, column=11, value=total_screws).alignment = align_right
    ws.cell(row=current_row, column=12, value=total_strips).alignment = align_right
    ws.cell(row=current_row, column=13, value=total_warehouse).alignment = align_right
    ws.cell(row=current_row, column=14, value="")

    for c in range(1, 15):
        cell = ws.cell(row=current_row, column=c)
        cell.font = total_font
        cell.fill = total_fill
        cell.border = thick_bottom

    # Подписи внизу
    sign_row = current_row + 2
    ws.cell(row=sign_row, column=2, value="Мастер: ____________________ / Миркасимов И.М.").font = bold_font
    ws.cell(row=sign_row, column=5, value="Служба СКК: ____________________ / Мусаилова З.").font = bold_font
    ws.cell(row=sign_row, column=9, value="Начальник цеха / ПТО: ____________________").font = bold_font

    # Ширина колонок
    col_widths = {
        1: 6,   # №
        2: 14,  # Дата
        3: 18,  # Мастер
        4: 26,  # Размер / Типоразмер
        5: 12,  # План
        6: 12,  # Факт
        7: 22,  # Комплект / Заказ
        8: 12,  # Кол-во компл
        9: 10,  # T
        10: 10, # L
        11: 12, # Шурупы
        12: 12, # Полосы
        13: 15, # Сдано на склад
        14: 35  # Примечания
    }
    for col_idx, width in col_widths.items():
        ws.column_dimensions[get_column_letter(col_idx)].width = width

    # Сохраняем в память
    output = io.BytesIO()
    wb.save(output)
    output.seek(0)

    filename = f"Рапорт_ЛКЦ_{start_date.strftime('%d.%m')}-{end_date.strftime('%d.%m.%Y')}.xlsx"
    from urllib.parse import quote
    encoded_filename = quote(filename)

    headers = {
        "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}"
    }
    return Response(
        content=output.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers
    )


# --- СИНХРОНИЗАЦИЯ С GOOGLE ТАБЛИЦЕЙ ЛКЦ ---

@router.post("/sync_google_sheets")
def sync_google_sheets(db: Session = Depends(get_db)):
    """
    Принудительная выгрузка всех рапортов и простоев ЛКЦ в выделенную Google Таблицу (3 листа).
    """
    try:
        import google_sheets_integration
        res = google_sheets_integration.export_lkc_to_google_sheets(db)
        if not res.get("success"):
            raise HTTPException(status_code=500, detail=res.get("error", "Ошибка выгрузки в Google Sheets"))
        return res
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Непредвиденная ошибка синхронизации: {str(e)}")


@router.get("/google_sheet_url")
def get_google_sheet_url():
    """
    Возвращает актуальную ссылку на Google Таблицу ЛКЦ.
    """
    import google_sheets_integration
    url = google_sheets_integration.get_lkc_sheet_url()
    return {"url": url}

