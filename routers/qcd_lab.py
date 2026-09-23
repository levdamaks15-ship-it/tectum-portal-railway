from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc, extract
from datetime import datetime, date
import json
from typing import Optional, List

import models
import schemas
from routers.common import get_db, sync_qcd_lab_bg

router = APIRouter(prefix="/api/qcd/lab", tags=["QCD Lab Analysis"])


@router.get("/reports", response_model=List[schemas.QcdLabAnalysisResponse])
def list_qcd_lab_reports(
    limit: int = 50,
    year: Optional[int] = None,
    month: Optional[int] = None,
    db: Session = Depends(get_db)
):
    """
    Получение списка лабораторных сменных анализов СКК.
    """
    query = db.query(models.QcdLabAnalysis)
    if year:
        query = query.filter(extract('year', models.QcdLabAnalysis.report_date) == year)
    if month:
        query = query.filter(extract('month', models.QcdLabAnalysis.report_date) == month)

    reports = (
        query
        .order_by(desc(models.QcdLabAnalysis.report_date), desc(models.QcdLabAnalysis.id))
        .limit(limit)
        .all()
    )
    return reports


@router.get("/reports/{report_id}")
def get_qcd_lab_report_details(report_id: int, db: Session = Depends(get_db)):
    """
    Получение полных данных анализа по ID (включая распарсенные JSON-массивы замеров).
    """
    rep = db.query(models.QcdLabAnalysis).get(report_id)
    if not rep:
        raise HTTPException(status_code=404, detail="Анализ СКК не найден")

    def parse_json(val):
        if not val:
            return []
        if isinstance(val, list):
            return val
        try:
            return json.loads(val)
        except Exception:
            return []

    return {
        "id": rep.id,
        "report_date": rep.report_date.strftime("%Y-%m-%d") if rep.report_date else "",
        "report_date_display": rep.report_date.strftime("%d.%m.%Y") if rep.report_date else "",
        "shift_name": rep.shift_name,
        "shift_id": rep.shift_id,
        "equipment": rep.equipment,
        "stream_line": rep.stream_line,
        "master_name": rep.master_name or "",
        "machinist_name": rep.machinist_name or "",
        "specialist_name": rep.specialist_name or "",
        "product_name": rep.product_name or "",
        "thickness_nominal": rep.thickness_nominal or "",
        "batch_number": rep.batch_number or "",
        "launch_time": rep.launch_time or "",
        "launch_details": rep.launch_details or "",
        
        # Сырье
        "asbestos_kg": rep.asbestos_kg or 0.0,
        "cement_kg": rep.cement_kg or 0.0,
        "cellulose_kg": rep.cellulose_kg or 0.0,
        "asbozurit_kg": rep.asbozurit_kg or 0.0,
        "crushed_slate_kg": rep.crushed_slate_kg or 0.0,
        "fiberglass_kg": rep.fiberglass_kg or 0.0,
        "raw_materials_total_kg": rep.raw_materials_total_kg or 0.0,
        
        # Подготовка массы
        "begun_time_min": rep.begun_time_min,
        "chrysotile_moisture_pct": rep.chrysotile_moisture_pct,
        "fluffing_pct": rep.fluffing_pct,
        "hydropulper_time_min": rep.hydropulper_time_min,
        "hydropulper_conc_pct": rep.hydropulper_conc_pct,
        "turbomixer_time_min": rep.turbomixer_time_min,
        "turbomixer_conc_pct": rep.turbomixer_conc_pct,
        "bucket_mixer_conc_pct": rep.bucket_mixer_conc_pct,
        "defective_mixer_conc_pct": rep.defective_mixer_conc_pct,
        "dilution_water_pct": rep.dilution_water_pct,
        "clean_recuperator_conc_pct": rep.clean_recuperator_conc_pct,
        "recuperator_water_temp_c": rep.recuperator_water_temp_c,
        "pool_temp_c": rep.pool_temp_c,
        "cellulose_dry_residue": rep.cellulose_dry_residue or "",
        "asbozurit_dry_residue": rep.asbozurit_dry_residue or "",
        
        # Ванны
        "vat_1_conc": rep.vat_1_conc,
        "vat_2_conc": rep.vat_2_conc,
        "vat_3_conc": rep.vat_3_conc,
        "vat_4_conc": rep.vat_4_conc,
        "vat_1_sediment": rep.vat_1_sediment,
        "vat_2_sediment": rep.vat_2_sediment,
        "vat_3_sediment": rep.vat_3_sediment,
        "vat_4_sediment": rep.vat_4_sediment,
        
        # Замеры
        "film_moisture_data": parse_json(rep.film_moisture_data),
        "density_moisture_data": parse_json(rep.density_moisture_data),
        "hourly_gp_data": parse_json(rep.hourly_gp_data),
        
        "status": rep.status or "draft",
        "notes": rep.notes or "",
        "google_spreadsheet_id": rep.google_spreadsheet_id,
        "google_sheet_title": rep.google_sheet_title,
        "google_synced": rep.google_synced,
        "google_sync_error": rep.google_sync_error,
        "created_at": rep.created_at.strftime("%d.%m.%Y %H:%M") if rep.created_at else "",
        "updated_at": rep.updated_at.strftime("%d.%m.%Y %H:%M") if rep.updated_at else ""
    }


@router.post("/reports", response_model=schemas.QcdLabAnalysisResponse)
def create_qcd_lab_report(
    data: schemas.QcdLabAnalysisCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """
    Создание и сохранение лабораторного анализа СКК (черновик или чистовик).
    Автоматически запускает фоновую выгрузку в ежемесячную Google Таблицу.
    """
    now_utc = datetime.utcnow()
    
    # Автоподсчет суммы сырья
    calc_total = (
        (data.asbestos_kg or 0.0) +
        (data.cement_kg or 0.0) +
        (data.cellulose_kg or 0.0) +
        (data.asbozurit_kg or 0.0) +
        (data.crushed_slate_kg or 0.0) +
        (data.fiberglass_kg or 0.0)
    )

    film_json = json.dumps(data.film_moisture_data or [], ensure_ascii=False)
    dens_json = json.dumps(data.density_moisture_data or [], ensure_ascii=False)
    hourly_json = json.dumps(data.hourly_gp_data or [], ensure_ascii=False)

    rep = models.QcdLabAnalysis(
        report_date=data.report_date,
        shift_name=data.shift_name,
        shift_id=data.shift_id,
        equipment=data.equipment,
        stream_line=data.stream_line,
        master_name=data.master_name,
        machinist_name=data.machinist_name,
        specialist_name=data.specialist_name or "Мусаилова",
        product_name=data.product_name,
        thickness_nominal=data.thickness_nominal,
        batch_number=data.batch_number,
        launch_time=data.launch_time,
        launch_details=data.launch_details,
        
        asbestos_kg=data.asbestos_kg or 0.0,
        cement_kg=data.cement_kg or 0.0,
        cellulose_kg=data.cellulose_kg or 0.0,
        asbozurit_kg=data.asbozurit_kg or 0.0,
        crushed_slate_kg=data.crushed_slate_kg or 0.0,
        fiberglass_kg=data.fiberglass_kg or 0.0,
        raw_materials_total_kg=round(calc_total, 3),
        
        begun_time_min=data.begun_time_min,
        chrysotile_moisture_pct=data.chrysotile_moisture_pct,
        fluffing_pct=data.fluffing_pct,
        hydropulper_time_min=data.hydropulper_time_min,
        hydropulper_conc_pct=data.hydropulper_conc_pct,
        turbomixer_time_min=data.turbomixer_time_min,
        turbomixer_conc_pct=data.turbomixer_conc_pct,
        bucket_mixer_conc_pct=data.bucket_mixer_conc_pct,
        defective_mixer_conc_pct=data.defective_mixer_conc_pct,
        dilution_water_pct=data.dilution_water_pct,
        clean_recuperator_conc_pct=data.clean_recuperator_conc_pct,
        recuperator_water_temp_c=data.recuperator_water_temp_c,
        pool_temp_c=data.pool_temp_c,
        cellulose_dry_residue=data.cellulose_dry_residue or "",
        asbozurit_dry_residue=data.asbozurit_dry_residue or "",
        
        vat_1_conc=data.vat_1_conc,
        vat_2_conc=data.vat_2_conc,
        vat_3_conc=data.vat_3_conc,
        vat_4_conc=data.vat_4_conc,
        vat_1_sediment=data.vat_1_sediment,
        vat_2_sediment=data.vat_2_sediment,
        vat_3_sediment=data.vat_3_sediment,
        vat_4_sediment=data.vat_4_sediment,
        
        film_moisture_data=film_json,
        density_moisture_data=dens_json,
        hourly_gp_data=hourly_json,
        
        status=data.status or "draft",
        notes=data.notes or "",
        google_synced=False,
        created_at=now_utc,
        updated_at=now_utc
    )
    db.add(rep)
    db.commit()
    db.refresh(rep)

    background_tasks.add_task(sync_qcd_lab_bg, rep.id)
    return rep


@router.put("/reports/{report_id}", response_model=schemas.QcdLabAnalysisResponse)
def update_qcd_lab_report(
    report_id: int,
    data: schemas.QcdLabAnalysisUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """
    Пошаговое обновление замеров и статуса анализа СКК в течение дня.
    """
    rep = db.query(models.QcdLabAnalysis).get(report_id)
    if not rep:
        raise HTTPException(status_code=404, detail="Анализ СКК не найден")

    update_dict = data.dict(exclude_unset=True)

    # Сериализуем списки замеров в JSON при наличии
    if "film_moisture_data" in update_dict and update_dict["film_moisture_data"] is not None:
        rep.film_moisture_data = json.dumps(update_dict.pop("film_moisture_data"), ensure_ascii=False)
    if "density_moisture_data" in update_dict and update_dict["density_moisture_data"] is not None:
        rep.density_moisture_data = json.dumps(update_dict.pop("density_moisture_data"), ensure_ascii=False)
    if "hourly_gp_data" in update_dict and update_dict["hourly_gp_data"] is not None:
        rep.hourly_gp_data = json.dumps(update_dict.pop("hourly_gp_data"), ensure_ascii=False)

    for field, value in update_dict.items():
        setattr(rep, field, value)

    # Пересчет суммы сырья
    calc_total = (
        (rep.asbestos_kg or 0.0) +
        (rep.cement_kg or 0.0) +
        (rep.cellulose_kg or 0.0) +
        (rep.asbozurit_kg or 0.0) +
        (rep.crushed_slate_kg or 0.0) +
        (rep.fiberglass_kg or 0.0)
    )
    rep.raw_materials_total_kg = round(calc_total, 3)
    rep.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(rep)

    background_tasks.add_task(sync_qcd_lab_bg, rep.id)
    return rep


@router.delete("/reports/{report_id}")
def delete_qcd_lab_report(report_id: int, db: Session = Depends(get_db)):
    """
    Удаление ошибочного анализа СКК.
    """
    rep = db.query(models.QcdLabAnalysis).get(report_id)
    if not rep:
        raise HTTPException(status_code=404, detail="Анализ СКК не найден")
    db.delete(rep)
    db.commit()
    return {"status": "deleted", "id": report_id}


@router.post("/reports/{report_id}/sync-google")
def manual_sync_qcd_lab_report(
    report_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """
    Принудительный повторный запуск выгрузки смены в Google Таблицу.
    """
    rep = db.query(models.QcdLabAnalysis).get(report_id)
    if not rep:
        raise HTTPException(status_code=404, detail="Анализ СКК не найден")
    background_tasks.add_task(sync_qcd_lab_bg, rep.id)
    return {"status": "queued", "message": f"Синхронизация анализа СКК ID {rep.id} запущена"}


@router.get("/monthly-spreadsheets")
def list_monthly_spreadsheets(db: Session = Depends(get_db)):
    """
    Список всех созданных ежемесячных Google Таблиц СКК с прямыми ссылками.
    """
    return (
        db.query(models.QcdMonthlySpreadsheet)
        .order_by(desc(models.QcdMonthlySpreadsheet.year), desc(models.QcdMonthlySpreadsheet.month))
        .all()
    )
