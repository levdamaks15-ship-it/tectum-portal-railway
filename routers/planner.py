import os
import re
import json
from datetime import datetime, date, timedelta
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Request, BackgroundTasks, UploadFile, File, Form, Query, Body
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_, func

import models
import schemas
from database import SessionLocal
from routers.common import check_admin_session

router = APIRouter(tags=["planner"])

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ==========================================================
# рџЋЇ TECTUM TASKS PLANNER API
# ==========================================================
# EMAIL NOTIFICATIONS FOR TASKS PLANNER
# ==========================================================
from email_service import send_task_html_email

def get_task_person_email(db: Session, person_name: str) -> Optional[str]:
    """РќР°С…РѕРґРёС‚ email СЃРѕС‚СЂСѓРґРЅРёРєР° СЃРЅР°С‡Р°Р»Р° РІ PlannerEmployee, Р·Р°С‚РµРј РІ Master."""
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
    """Р¤РѕРЅРѕРІР°СЏ РѕС‚РїСЂР°РІРєР° email-СѓРІРµРґРѕРјР»РµРЅРёСЏ С‡РµСЂРµР· email_service."""
    if not to_email or "@" not in to_email:
        return
    try:
        send_task_html_email(to_email, subject, event_type, task_dict)
    except Exception as e:
        print(f"[Email Notification Warning] Failed to send email to {to_email}: {e}")

# --- PLANNER SETTINGS (EMPLOYEES & ZONES) ENDPOINTS ---

@router.get("/api/planner/employees")
def get_planner_employees(db: Session = Depends(get_db)):
    """Р’РѕР·РІСЂР°С‰Р°РµС‚ СЃРїРёСЃРѕРє СЃРѕС‚СЂСѓРґРЅРёРєРѕРІ РїР»Р°РЅРЅРµСЂР°."""
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

@router.post("/api/planner/employees/verify_pin")
def verify_planner_pin(data: dict, db: Session = Depends(get_db)):
    """РџСЂРѕРІРµСЂСЏРµС‚ СЃРѕРѕС‚РІРµС‚СЃС‚РІРёРµ PIN-РєРѕРґР° СЃРѕС‚СЂСѓРґРЅРёРєР°."""
    name = (data.get("name") or "").strip()
    pin = (data.get("pin_code") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="РќРµ СѓРєР°Р·Р°РЅРѕ РёРјСЏ СЃРѕС‚СЂСѓРґРЅРёРєР°")
    
    emp = db.query(models.PlannerEmployee).filter(models.PlannerEmployee.name == name).first()
    if not emp:
        # Р•СЃР»Рё СЃРѕС‚СЂСѓРґРЅРёРєР° РЅРµС‚ РІ СЃРїСЂР°РІРѕС‡РЅРёРєРµ вЂ” СЂР°Р·СЂРµС€Р°РµРј Р±Р°Р·РѕРІС‹Р№ РІС…РѕРґ
        return {"status": "ok", "name": name, "verified": True}
    
    # Р•СЃР»Рё Сѓ СЃРѕС‚СЂСѓРґРЅРёРєР° СѓСЃС‚Р°РЅРѕРІР»РµРЅ PIN вЂ” СЃРІРµСЂСЏРµРј
    if emp.pin_code and emp.pin_code.strip():
        if emp.pin_code.strip() != pin:
            raise HTTPException(status_code=401, detail="РќРµРІРµСЂРЅС‹Р№ PIN-РєРѕРґ СЃРѕС‚СЂСѓРґРЅРёРєР°")
    
    return {"status": "ok", "name": emp.name, "verified": True}

@router.post("/api/planner/employees")
def create_planner_employee(data: schemas.PlannerEmployeeCreate, db: Session = Depends(get_db)):
    """Р”РѕР±Р°РІР»СЏРµС‚ СЃРѕС‚СЂСѓРґРЅРёРєР° РІ РЅР°СЃС‚СЂРѕР№РєРё РїР»Р°РЅРЅРµСЂР°."""
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

@router.put("/api/planner/employees/{emp_id}")
def update_planner_employee(emp_id: int, data: schemas.PlannerEmployeeUpdate, db: Session = Depends(get_db)):
    """РћР±РЅРѕРІР»СЏРµС‚ СЃРѕС‚СЂСѓРґРЅРёРєР° РїР»Р°РЅРЅРµСЂР°."""
    try:
        emp = db.query(models.PlannerEmployee).filter(models.PlannerEmployee.id == emp_id).first()
        if not emp:
            raise HTTPException(status_code=404, detail="РЎРѕС‚СЂСѓРґРЅРёРє РЅРµ РЅР°Р№РґРµРЅ")
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

@router.delete("/api/planner/employees/{emp_id}")
def delete_planner_employee(emp_id: int, db: Session = Depends(get_db)):
    """РЈРґР°Р»СЏРµС‚ СЃРѕС‚СЂСѓРґРЅРёРєР° РёР· РЅР°СЃС‚СЂРѕРµРє РїР»Р°РЅРЅРµСЂР°."""
    try:
        emp = db.query(models.PlannerEmployee).filter(models.PlannerEmployee.id == emp_id).first()
        if not emp:
            raise HTTPException(status_code=404, detail="РЎРѕС‚СЂСѓРґРЅРёРє РЅРµ РЅР°Р№РґРµРЅ")
        db.delete(emp)
        db.commit()
        return {"status": "ok", "message": "РЎРѕС‚СЂСѓРґРЅРёРє СѓРґР°Р»РµРЅ"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/planner/zones")
def get_planner_zones(db: Session = Depends(get_db)):
    """Р’РѕР·РІСЂР°С‰Р°РµС‚ СЃРїРёСЃРѕРє Р·РѕРЅ / РїРѕРґСЂР°Р·РґРµР»РµРЅРёР№ РїР»Р°РЅРЅРµСЂР°."""
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

@router.post("/api/planner/zones")
def create_planner_zone(data: schemas.PlannerZoneCreate, db: Session = Depends(get_db)):
    """Р”РѕР±Р°РІР»СЏРµС‚ Р·РѕРЅСѓ / РїРѕРґСЂР°Р·РґРµР»РµРЅРёРµ РІ РЅР°СЃС‚СЂРѕР№РєРё РїР»Р°РЅРЅРµСЂР°."""
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

@router.put("/api/planner/zones/{zone_id}")
def update_planner_zone(zone_id: int, data: schemas.PlannerZoneUpdate, db: Session = Depends(get_db)):
    """РћР±РЅРѕРІР»СЏРµС‚ Р·РѕРЅСѓ / РїРѕРґСЂР°Р·РґРµР»РµРЅРёРµ РїР»Р°РЅРЅРµСЂР°."""
    try:
        zone = db.query(models.PlannerZone).filter(models.PlannerZone.id == zone_id).first()
        if not zone:
            raise HTTPException(status_code=404, detail="Р—РѕРЅР° РЅРµ РЅР°Р№РґРµРЅР°")
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

@router.delete("/api/planner/zones/{zone_id}")
def delete_planner_zone(zone_id: int, db: Session = Depends(get_db)):
    """РЈРґР°Р»СЏРµС‚ Р·РѕРЅСѓ РёР· РЅР°СЃС‚СЂРѕРµРє РїР»Р°РЅРЅРµСЂР°."""
    try:
        zone = db.query(models.PlannerZone).filter(models.PlannerZone.id == zone_id).first()
        if not zone:
            raise HTTPException(status_code=404, detail="Р—РѕРЅР° РЅРµ РЅР°Р№РґРµРЅР°")
        db.delete(zone)
        db.commit()
        return {"status": "ok", "message": "Р—РѕРЅР° СѓРґР°Р»РµРЅР°"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/planner/test_email")
def test_planner_email(
    to_email: str = Body(..., embed=True),
    background_tasks: BackgroundTasks = BackgroundTasks(),
    db: Session = Depends(get_db)
):
    """РћС‚РїСЂР°РІР»СЏРµС‚ С‚РµСЃС‚РѕРІРѕРµ Р±СЂРµРЅРґРёСЂРѕРІР°РЅРЅРѕРµ СѓРІРµРґРѕРјР»РµРЅРёРµ РЅР° СѓРєР°Р·Р°РЅРЅС‹Р№ email."""
    if not to_email or "@" not in to_email:
        raise HTTPException(status_code=400, detail="РЈРєР°Р¶РёС‚Рµ РєРѕСЂСЂРµРєС‚РЅС‹Р№ email Р°РґСЂРµСЃ")

    test_task = {
        "id": 999,
        "code": "TSK-TEST",
        "title": "РўРµСЃС‚РѕРІР°СЏ РїСЂРѕРІРµСЂРєР° СЃРёСЃС‚РµРјС‹ СѓРІРµРґРѕРјР»РµРЅРёР№ Tectum",
        "title_kz": "Tectum С…Р°Р±Р°СЂР»Р°РЅРґС‹СЂСѓ Р¶ТЇР№РµСЃС–РЅ СЃС‹РЅР°Т›С‚Р°РЅ У©С‚РєС–Р·Сѓ",
        "zone": "Р¦РёС„СЂРѕРІРѕР№ РїРѕСЂС‚Р°Р»",
        "due_date_str": datetime.now().strftime("%d.%m.%Y"),
        "author_name": "РђРґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂ",
        "assignee_name": "РўРµСЃС‚РѕРІС‹Р№ РёСЃРїРѕР»РЅРёС‚РµР»СЊ",
        "status": "рџџЎ Р’ СЂР°Р±РѕС‚Рµ",
        "comment": "РџРѕС‡С‚РѕРІС‹Р№ С€Р»СЋР· СѓСЃРїРµС€РЅРѕ РЅР°СЃС‚СЂРѕРµРЅ Рё РіРѕС‚РѕРІ Рє РѕС‚РїСЂР°РІРєРµ СѓРІРµРґРѕРјР»РµРЅРёР№.",
        "photo_link": "",
        "month_label": "РђРІРіСѓСЃС‚ 2026",
        "week_label": "РќРµРґРµР»СЏ 4 (24.08 - 28.08)"
    }

    success, err = send_task_html_email(
        to_email=to_email.strip(),
        subject="рџљЂ РџСЂРѕРІРµСЂРєР° РїРѕС‡С‚РѕРІС‹С… СѓРІРµРґРѕРјР»РµРЅРёР№ Tectum РџР»Р°РЅРЅРµСЂ",
        event_type="РўРµСЃС‚РѕРІРѕРµ СѓРІРµРґРѕРјР»РµРЅРёРµ",
        task_data=test_task
    )

    if success:
        return {"status": "ok", "message": f"РўРµСЃС‚РѕРІРѕРµ РїРёСЃСЊРјРѕ СѓСЃРїРµС€РЅРѕ РѕС‚РїСЂР°РІР»РµРЅРѕ РЅР° {to_email}!"}
    else:
        raise HTTPException(status_code=500, detail=f"РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РїСЂР°РІРёС‚СЊ РїРёСЃСЊРјРѕ: {err or 'РќРµРёР·РІРµСЃС‚РЅР°СЏ РѕС€РёР±РєР°'}")



def generate_calendar_structure_mon_fri(year: int = 2026):
    """Р“РµРЅРµСЂРёСЂСѓРµС‚ СЃС‚СЂРѕРіСѓСЋ СЃРµС‚РєСѓ СЂР°Р±РѕС‡РёС… РЅРµРґРµР»СЊ (РџРЅ-РџС‚) РґР»СЏ РІСЃРµС… 12 РјРµСЃСЏС†РµРІ РіРѕРґР°."""
    import datetime
    months_ru = [
        "РЇРЅРІР°СЂСЊ", "Р¤РµРІСЂР°Р»СЊ", "РњР°СЂС‚", "РђРїСЂРµР»СЊ", "РњР°Р№", "РСЋРЅСЊ",
        "РСЋР»СЊ", "РђРІРіСѓСЃС‚", "РЎРµРЅС‚СЏР±СЂСЊ", "РћРєС‚СЏР±СЂСЊ", "РќРѕСЏР±СЂСЊ", "Р”РµРєР°Р±СЂСЊ"
    ]
    structure = {}
    for m in range(1, 13):
        m_name = f"{months_ru[m-1]} {year}"
        weeks_list = []
        cur = datetime.date(year, m, 1)
        next_month = datetime.date(year + (1 if m == 12 else 0), 1 if m == 12 else m + 1, 1)
        
        # РџРµСЂРІС‹Р№ РїРѕРЅРµРґРµР»СЊРЅРёРє РЅР°С‡РёРЅР°СЏ СЃ 1-РіРѕ С‡РёСЃР»Р° РјРµСЃСЏС†Р°:
        cur_monday = cur + datetime.timedelta(days=(0 - cur.weekday()) % 7)
        
        w_idx = 1
        while cur_monday < next_month:
            fri = cur_monday + datetime.timedelta(days=4)
            s_str = cur_monday.strftime('%d.%m')
            e_str = fri.strftime('%d.%m')
            weeks_list.append(f"РќРµРґРµР»СЏ {w_idx} ({s_str} - {e_str})")
            w_idx += 1
            cur_monday += datetime.timedelta(days=7)
            
        structure[m_name] = weeks_list
    return structure

@router.get("/api/tasks/weeks")
def get_tasks_calendar_structure(db: Session = Depends(get_db)):
    """Р“РµРЅРµСЂРёСЂСѓРµС‚ СЃС‚СЂРѕРіРѕ С‡РёСЃС‚СѓСЋ РєР°Р»РµРЅРґР°СЂРЅСѓСЋ СЃРµС‚РєСѓ СЂР°Р±РѕС‡РёС… РЅРµРґРµР»СЊ (РџРЅ-РџС‚) РїРѕ РІСЃРµРј 12 РјРµСЃСЏС†Р°Рј РіРѕРґР° СЃ РґРёРЅР°РјРёС‡РµСЃРєРёРј Р°РІС‚РѕРІС‹Р±РѕСЂРѕРј С‚РµРєСѓС‰РµР№ РЅРµРґРµР»Рё."""
    import datetime
    try:
        today = datetime.date.today()
        year = today.year
        structure = generate_calendar_structure_mon_fri(year)

        default_month = None
        default_week = None

        # РС‰РµРј РЅРµРґРµР»СЋ РІРѕ РІСЃРµР№ СЃС‚СЂСѓРєС‚СѓСЂРµ РіРѕРґР°, РґРёР°РїР°Р·РѕРЅ РєРѕС‚РѕСЂРѕР№ РѕС…РІР°С‚С‹РІР°РµС‚ СЃРµРіРѕРґРЅСЏС€РЅРёР№ РґРµРЅСЊ (РџРЅ..Р’СЃ)
        for m_name, month_weeks in structure.items():
            for w in month_weeks:
                try:
                    # С„РѕСЂРјР°С‚: "РќРµРґРµР»СЏ X (DD.MM - DD.MM)"
                    dates_part = w.split('(')[1].split(')')[0]
                    start_part, end_part = dates_part.split(' - ')
                    sd, sm = map(int, start_part.strip().split('.'))
                    ed, em = map(int, end_part.strip().split('.'))
                    
                    # РЈС‡РµС‚ РїРµСЂРµС…РѕРґР° РіРѕРґР° (РґРµРєР°Р±СЂСЊ -> СЏРЅРІР°СЂСЊ)
                    start_year = year
                    end_year = year
                    if sm == 12 and em == 1:
                        end_year = year + 1
                    
                    w_start = datetime.date(start_year, sm, sd)
                    # Р’РѕСЃРєСЂРµСЃРµРЅСЊРµ РЅРµРґРµР»Рё = +6 РґРЅРµР№ РѕС‚ РїРѕРЅРµРґРµР»СЊРЅРёРєР°
                    w_end = w_start + datetime.timedelta(days=6)
                    
                    if w_start <= today <= w_end:
                        default_month = m_name
                        default_week = w
                        break
                except Exception:
                    pass
            if default_month and default_week:
                break

        # Р¤РѕР»Р»Р±СЌРє: РµСЃР»Рё РЅРµ РЅР°С€Р»Рё РїРѕ С‚РѕС‡РЅРѕРјСѓ РґРёР°РїР°Р·РѕРЅСѓ РґР°С‚, Р±РµСЂРµРј С‚РµРєСѓС‰РёР№ РєР°Р»РµРЅРґР°СЂРЅС‹Р№ РјРµСЃСЏС†
        if not default_month:
            months_ru = [
                "РЇРЅРІР°СЂСЊ", "Р¤РµРІСЂР°Р»СЊ", "РњР°СЂС‚", "РђРїСЂРµР»СЊ", "РњР°Р№", "РСЋРЅСЊ",
                "РСЋР»СЊ", "РђРІРіСѓСЃС‚", "РЎРµРЅС‚СЏР±СЂСЊ", "РћРєС‚СЏР±СЂСЊ", "РќРѕСЏР±СЂСЊ", "Р”РµРєР°Р±СЂСЊ"
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
        return {"months": ["РђРІРіСѓСЃС‚ 2026"], "structure": {"РђРІРіСѓСЃС‚ 2026": ["РќРµРґРµР»СЏ 5 (31.08 - 04.09)"]}, "default_month": "РђРІРіСѓСЃС‚ 2026", "default_week": "РќРµРґРµР»СЏ 5 (31.08 - 04.09)"}

def _fetch_translation_api(text: str, sl: str, tl: str) -> Optional[str]:
    """Р’РЅСѓС‚СЂРµРЅРЅРёР№ РЅР°РґРµР¶РЅС‹Р№ РїРµСЂРµРІРѕРґС‡РёРє (Google Clients API + MyMemory fallback)."""
    import urllib.parse
    import urllib.request
    import json
    
    clean_text = (text or "").strip()
    if not clean_text:
        return ""

    # 1. Google Clients Translate API (РѕС‡РµРЅСЊ Р±С‹СЃС‚СЂС‹Р№ Рё Р±РµР· 429 Р±Р»РѕРєРёСЂРѕРІРѕРє)
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

    # 2. Р¤РѕР»Р»Р±СЌРє С‡РµСЂРµР· MyMemory API
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
    РРЅС‚РµР»Р»РµРєС‚СѓР°Р»СЊРЅС‹Р№ Р°РЅР°Р»РёР·Р°С‚РѕСЂ СЏР·С‹РєР° Рё РґРІСѓСЃС‚РѕСЂРѕРЅРЅРёР№ РїРµСЂРµРІРѕРґС‡РёРє (RU <-> KZ).
    РћРїСЂРµРґРµР»СЏРµС‚ СЏР·С‹Рє РІРІРѕРґР°:
    - РџРѕ С…Р°СЂР°РєС‚РµСЂРЅС‹Рј СЃРёРјРІРѕР»Р°Рј РєР°Р·Р°С…СЃРєРѕРіРѕ Р°Р»С„Р°РІРёС‚Р° (У™, С–, ТЈ, Т“, ТЇ, Т±, Т›, У©, Т», У, Р†, Тў, Т’, Т®, Т°, Тљ, УЁ, Тє)
    - РџРѕ С…Р°СЂР°РєС‚РµСЂРЅС‹Рј РєР°Р·Р°С…СЃРєРёРј СЃР»РѕРІР°Рј/РѕРєРѕРЅС‡Р°РЅРёСЏРј (СЃУ™Р»РµРј, СЂР°С…РјРµС‚, Р¶Т±РјС‹СЃ, РєРµСЂРµРє, Р±РѕР»РґС‹, Р»Р°СЂ, Р»РµСЂ, РґР°СЂ, РґРµСЂ, С‚Р°СЂ, С‚РµСЂ, РЅС‹ТЈ, РЅС–ТЈ, Т“Р°, РіРµ, Т›Р°, РєРµ, РґР°, РґРµ, С‚Р°, С‚Рµ, РјРµРЅ, РїРµРЅ, Р±РµРЅ)
    - РџРѕ Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРѕРјСѓ РѕРїСЂРµРґРµР»РµРЅРёСЋ Google Translate (sl=auto)
    Р’РѕР·РІСЂР°С‰Р°РµС‚ СЃС‚СЂСѓРєС‚СѓСЂСѓ: {"status": "ok", "detected_lang": "ru"|"kk", "text_ru": "...", "text_kz": "..."}
    """
    clean_text = (text or "").strip()
    if not clean_text:
        return {"status": "ok", "detected_lang": "ru", "text_ru": "", "text_kz": ""}

    try:
        kz_chars = set("У™С–ТЈТ“ТЇТ±Т›У©Т»УР†ТўТ’Т®Т°ТљУЁТє")
        has_kz_chars = any(c in kz_chars for c in clean_text)

        # РџСЂРѕРІРµСЂРєР° С‡Р°СЃС‚С‹С… РєР°Р·Р°С…СЃРєРёС… СЃР»РѕРІ Рё СЃСѓС„С„РёРєСЃРѕРІ
        lower_words = set(re.findall(r'[a-zA-ZР°-СЏРђ-РЇС‘РЃУ™С–ТЈТ“ТЇТ±Т›У©Т»УР†ТўТ’Т®Т°ТљУЁТє]+', clean_text.lower()))
        common_kz_words = {
            "СЃУ™Р»РµРј", "СЃР°Р»РµРј", "СЂР°С…РјРµС‚", "Р¶Т±РјС‹СЃ", "Р¶СѓРјС‹СЃ", "РєРµСЂРµРє", "Р±РѕР»РґС‹", "Р±РѕР»Р°РґС‹", 
            "Р¶Р°СЃР°Сѓ", "Р¶Р°СЃР°Р»РґС‹", "Р°СѓС‹СЃС‚С‹СЂСѓ", "С‚РµРєСЃРµСЂСѓ", "Р¶У©РЅРґРµСѓ", "Р¶РѕРЅРґРµСѓ", "РѕСЂРЅР°С‚Сѓ", 
            "С‚Р°Р·Р°Р»Р°Сѓ", "Р±РѕСЏСѓ", "Т›Р°СЂР°Сѓ", "РєР°СЂР°Сѓ", "Т›РѕСЋ", "РєРѕСЋ", "Р°Р»Сѓ", "Р±РµСЂСѓ", "Р±Р°СЂ", "Р¶РѕТ›", "Р¶РѕРє"
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
            # РђРІС‚РѕРѕРїСЂРµРґРµР»РµРЅРёРµ С‡РµСЂРµР· РЅР°РґРµР¶РЅС‹Р№ Google Clients API
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
            # РСЃС…РѕРґРЅС‹Р№ С‚РµРєСЃС‚ - РєР°Р·Р°С…СЃРєРёР№. РџРµСЂРµРІРѕРґРёРј РЅР° СЂСѓСЃСЃРєРёР№
            trans_ru = _fetch_translation_api(clean_text, "kk", "ru") or clean_text
            return {
                "status": "ok",
                "detected_lang": "kk",
                "text_ru": trans_ru,
                "text_kz": clean_text
            }
        else:
            # РСЃС…РѕРґРЅС‹Р№ С‚РµРєСЃС‚ - СЂСѓСЃСЃРєРёР№. РџРµСЂРµРІРѕРґРёРј РЅР° РєР°Р·Р°С…СЃРєРёР№
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
    """Р’РЅСѓС‚СЂРµРЅРЅРёР№ С…РµР»РїРµСЂ РґР»СЏ Р°РІС‚РѕРїРµСЂРµРІРѕРґР° RU -> KZ."""
    res = detect_and_translate_task_text(text)
    return res.get("text_kz", "")

def extract_hashtags_from_title(title: str, existing_tags: Optional[str] = None) -> str:
    """РР·РІР»РµРєР°РµС‚ #С…СЌС€С‚РµРіРё РёР· С‚РµРєСЃС‚Р° Р·Р°РіРѕР»РѕРІРєР° Рё РѕР±СЉРµРґРёРЅСЏРµС‚ СЃ СЃСѓС‰РµСЃС‚РІСѓСЋС‰РёРјРё С‚РµРіР°РјРё."""
    import re
    tags_found = re.findall(r"#[A-Za-zРђ-РЇР°-СЏ0-9_\-]+", title or "")
    existing = [t.strip() for t in (existing_tags or "").split(",") if t.strip()]
    for t in tags_found:
        if t not in existing:
            existing.append(t)
    return ", ".join(existing)

def recalculate_parent_task_progress(db: Session, parent_id: Optional[int]):
    """РђРІС‚РѕРјР°С‚РёС‡РµСЃРєРё РїРµСЂРµСЃС‡РёС‚С‹РІР°РµС‚ РїСЂРѕС†РµРЅС‚ РІС‹РїРѕР»РЅРµРЅРёСЏ СЂРѕРґРёС‚РµР»СЊСЃРєРѕР№ Р·Р°РґР°С‡Рё РЅР° РѕСЃРЅРѕРІРµ СЃС‚Р°С‚СѓСЃР° РїРѕРґР·Р°РґР°С‡."""
    if not parent_id:
        return
    try:
        parent = db.query(models.Task).filter(models.Task.id == parent_id).first()
        if not parent:
            return
        subtasks = db.query(models.Task).filter(models.Task.parent_id == parent_id, models.Task.is_archived == False).all()
        if not subtasks:
            return
        done_count = sum(1 for st in subtasks if st.status == "рџџў Р’С‹РїРѕР»РЅРµРЅРѕ")
        total_count = len(subtasks)
        calc_prog = int((done_count / total_count) * 100) if total_count > 0 else 0
        parent.progress = calc_prog
        if calc_prog == 100 and parent.status != "рџџў Р’С‹РїРѕР»РЅРµРЅРѕ":
            parent.status = "рџџў Р’С‹РїРѕР»РЅРµРЅРѕ"
        elif calc_prog < 100 and parent.status == "рџџў Р’С‹РїРѕР»РЅРµРЅРѕ":
            parent.status = "рџџЎ Р’ СЂР°Р±РѕС‚Рµ"
        db.commit()
        if parent.parent_id:
            recalculate_parent_task_progress(db, parent.parent_id)
    except Exception as e:
        print(f"Error recalculating parent task progress: {e}")

@router.get("/api/tasks/tags")
def get_task_tags(db: Session = Depends(get_db)):
    """Р’РѕР·РІСЂР°С‰Р°РµС‚ СЃРїРёСЃРѕРє РІСЃРµС… СѓРЅРёРєР°Р»СЊРЅС‹С… С…СЌС€С‚РµРіРѕРІ СЃ РєРѕР»РёС‡РµСЃС‚РІРѕРј Р°РєС‚РёРІРЅС‹С… Р·Р°РґР°С‡."""
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

@router.get("/api/tasks/roadmaps")
def get_roadmaps_tree(quarter: Optional[str] = None, db: Session = Depends(get_db)):
    """Р’РѕР·РІСЂР°С‰Р°РµС‚ РёРµСЂР°СЂС…РёС‡РµСЃРєРѕРµ РґРµСЂРµРІРѕ Р”РѕСЂРѕР¶РЅС‹С… РєР°СЂС‚: РџСЂРѕРµРєС‚С‹ -> Р­С‚Р°РїС‹ -> РџРѕРґР·Р°РґР°С‡Рё."""
    try:
        query = db.query(models.Task).filter(
            models.Task.task_type == "roadmap",
            models.Task.is_archived == False
        )
        if quarter and quarter != "all":
            query = query.filter(models.Task.target_quarter == quarter)
        
        projects = query.order_by(models.Task.id.desc()).all()
        
        # РЎРѕР±РёСЂР°РµРј РІСЃРµ ID РїСЂРѕРµРєС‚РѕРІ
        project_ids = [p.id for p in projects]
        if not project_ids:
            return []

        # Р—Р°РіСЂСѓР¶Р°РµРј РґРѕС‡РµСЂРЅРёРµ СЌС‚Р°РїС‹ Рё Р·Р°РґР°С‡Рё
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

        # РџСЂРµРґР·Р°РіСЂСѓР·РєР° РґРѕРєСѓРјРµРЅС‚РѕРІ
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

        # РљР°СЂС‚Р° Р·Р°РІРёСЃРёРјРѕСЃС‚РµР№
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
                "zone": item.zone or "РџСЂРѕРµРєС‚",
                "title": item.title,
                "title_kz": item.title_kz or "",
                "task_type": item.task_type or "roadmap",
                "department_service": item.department_service or "",
                "target_quarter": item.target_quarter or "",
                "progress": item.progress or 0,
                "status": item.status or "рџџЎ Р’ СЂР°Р±РѕС‚Рµ",
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
            
            # РџРѕРґСЃС‡РµС‚ РїСЂРѕРіСЂРµСЃСЃР° РїСЂРѕРµРєС‚Р° РїРѕ СЌС‚Р°РїР°Рј/РїРѕРґР·Р°РґР°С‡Р°Рј
            total_items = 0
            done_items = 0
            milestones_list = []
            
            for m in p_children:
                m_dict = serialize_item(m)
                m_subs = [s for s in sub_children if s.parent_id == m.id]
                m_dict["subtasks"] = [serialize_item(s) for s in m_subs]
                
                # РџРѕРґСЃС‡РµС‚ РїСЂРѕРіСЂРµСЃСЃР° РІРµС…Рё
                m_total = len(m_subs)
                m_done = sum(1 for s in m_subs if s.status == "рџџў Р’С‹РїРѕР»РЅРµРЅРѕ")
                m_prog = int((m_done / m_total) * 100) if m_total > 0 else (100 if m.status == "рџџў Р’С‹РїРѕР»РЅРµРЅРѕ" else m.progress or 0)
                m_dict["calculated_progress"] = m_prog
                m_dict["subtasks_count"] = m_total
                m_dict["subtasks_done_count"] = m_done
                
                total_items += 1 + m_total
                done_items += (1 if m.status == "рџџў Р’С‹РїРѕР»РЅРµРЅРѕ" else 0) + m_done
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

@router.get("/api/documents/{doc_id}/tasks")
def get_document_tasks(doc_id: int, db: Session = Depends(get_db)):
    """Р’РѕР·РІСЂР°С‰Р°РµС‚ СЃРїРёСЃРѕРє РІСЃРµС… Р°РєС‚РёРІРЅС‹С… Р·Р°РґР°С‡, РїСЂРёРІСЏР·Р°РЅРЅС‹С… Рє РєРѕРЅРєСЂРµС‚РЅРѕРјСѓ СЂРµРіР»Р°РјРµРЅС‚Сѓ/РёРЅСЃС‚СЂСѓРєС†РёРё РёР· Р‘Р°Р·С‹ Р—РЅР°РЅРёР№."""
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
            "status": t.status or "рџџЎ Р’ СЂР°Р±РѕС‚Рµ",
            "month_label": t.month_label or "",
            "week_label": t.week_label or ""
        } for t in tasks]
    except Exception as e:
        print(f"Error fetching document tasks: {e}")
        return []

def parse_date_dm_or_full(d_str: Optional[str], default_year: int = 2026):
    """РџР°СЂСЃРёС‚ СЃС‚СЂРѕРєСѓ РґР°С‚С‹ РІРёРґР° '24.08', '24.08.2026', '30.09 (РЎСЂ)', '2026-08-24' РІ datetime.date."""
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
    """РР·РІР»РµРєР°РµС‚ РґР°С‚С‹ РЅР°С‡Р°Р»Р° Рё РєРѕРЅС†Р° СЂР°Р±РѕС‡РµР№ РЅРµРґРµР»Рё (РџРЅ, РџС‚) РёР· СЃС‚СЂРѕРєРё 'РќРµРґРµР»СЏ 4 (24.08 - 28.08)'."""
    if not week_label or week_label == "all":
        return None, None
    import re
    m = re.search(r"\((\d{1,2}\.\d{1,2})\s*-\s*(\d{1,2}\.\d{1,2})\)", str(week_label))
    if not m:
        return None, None
    s_date = parse_date_dm_or_full(m.group(1), default_year)
    e_date = parse_date_dm_or_full(m.group(2), default_year)
    return s_date, e_date

@router.get("/api/tasks")
def get_tasks(
    month: Optional[str] = None,
    week: Optional[str] = None,
    task_type: Optional[str] = None, # "weekly", "service_plan", "roadmap", "milestone", "all"
    department_service: Optional[str] = None, # "РћР“Рњ", "РћР“Р­", "РўРµС…РЅРѕР»РѕРіРё", "РћРўРљ", "all"
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
    """Р’РѕР·РІСЂР°С‰Р°РµС‚ СЃРїРёСЃРѕРє Р·Р°РґР°С‡ СЃ РїРѕРґРґРµСЂР¶РєРѕР№ 3 РіРѕСЂРёР·РѕРЅС‚РѕРІ, СЃРєРІРѕР·РЅС‹С… РґРѕР»РіРѕСЃСЂРѕС‡РЅС‹С… Р·Р°РґР°С‡ (cross-week), СЃР»СѓР¶Р±, С…СЌС€С‚РµРіРѕРІ Рё СЂРµРіР»Р°РјРµРЅС‚РѕРІ."""
    try:
        query = db.query(models.Task).filter(models.Task.is_archived == False)

        # 1. Р¤РёР»СЊС‚СЂР°С†РёСЏ РїРѕ С‚РёРїСѓ Р·Р°РґР°С‡Рё / РіРѕСЂРёР·РѕРЅС‚Сѓ
        if task_type == "weekly":
            query = query.filter((models.Task.task_type == "weekly") | (models.Task.task_type.is_(None)))
            query = query.filter(models.Task.task_type != "service_plan", models.Task.task_type != "roadmap", models.Task.task_type != "milestone")
        elif task_type == "service_plan":
            query = query.filter(
                (models.Task.task_type == "service_plan") |
                (models.Task.department_service.in_(["РћР“Рњ", "РћР“Р­", "РўРµС…РЅРѕР»РѕРіРё", "РћРўРљ", "РЎРљРљ"])) |
                (models.Task.zone.in_(["РћР“Рњ", "РћР“Р­", "РўРµС…РЅРѕР»РѕРіРё", "РћРўРљ", "РЎРљРљ"]))
            )
            query = query.filter(
                ~and_(
                    models.Task.task_type == "weekly",
                    models.Task.zone == "Р‘РµСЂРµР¶Р»РёРІРѕРµ РїСЂРѕРёР·РІРѕРґСЃС‚РІРѕ",
                    or_(models.Task.department_service.is_(None), models.Task.department_service.in_(["", "РћР±С‰РёР№"]))
                )
            )
        elif task_type and task_type != "all":
            query = query.filter(models.Task.task_type == task_type)

        # 2. Р¤РёР»СЊС‚СЂР°С†РёСЏ РїРѕ СЃР»СѓР¶Р±Р°Рј РћР“Рњ/РћР“Р­/РўРµС…РЅРѕР»РѕРіРё
        if department_service and department_service != "all":
            query = query.filter((models.Task.department_service == department_service) | (models.Task.zone == department_service))

        # 3. Р¤РёР»СЊС‚СЂР°С†РёСЏ РїРѕ С…СЌС€С‚РµРіР°Рј
        if tag and tag != "all":
            clean_tag = tag.strip()
            if not clean_tag.startswith("#"):
                clean_tag = "#" + clean_tag
            query = query.filter(models.Task.tags.ilike(f"%{clean_tag}%"))

        # 4. Р¤РёР»СЊС‚СЂР°С†РёСЏ РїРѕ РЅР°Р»РёС‡РёСЋ РїСЂРёРєСЂРµРїР»РµРЅРЅРѕРіРѕ СЂРµРіР»Р°РјРµРЅС‚Р°
        if has_doc is True:
            query = query.filter(models.Task.attached_document_id.isnot(None))
        elif has_doc is False:
            query = query.filter(models.Task.attached_document_id.is_(None))

        # 5. Р¤РёР»СЊС‚СЂР°С†РёСЏ РїРѕ СЂРѕРґРёС‚РµР»СЋ
        if parent_id is not None:
            query = query.filter(models.Task.parent_id == parent_id)

        # 6. Р¤РёР»СЊС‚СЂР°С†РёСЏ РїРѕ РїРµСЂСЃРѕРЅР°Р»Сѓ, Р·РѕРЅРµ, СЃС‚Р°С‚СѓСЃСѓ
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

        # РџР°СЂСЃРёРј РіСЂР°РЅРёС†С‹ РІС‹Р±СЂР°РЅРЅРѕР№ РЅРµРґРµР»Рё
        sel_week_start, sel_week_end = parse_week_label_range(week, month)

        # Р•СЃР»Рё РІС‹Р±СЂР°РЅР° РєРѕРЅРєСЂРµС‚РЅР°СЏ РЅРµРґРµР»СЏ: Р·Р°РїСЂР°С€РёРІР°РµРј СЂРѕРґРЅС‹Рµ Р·Р°РґР°С‡Рё + Р°РєС‚РёРІРЅС‹Рµ РєР°РЅРґРёРґР°С‚С‹ РЅР° СЃРєРІРѕР·РЅС‹Рµ Р·Р°РґР°С‡Рё
        if week and week != "all":
            if include_backlog:
                # Р’РєР»СЋС‡Р°СЏ РґРѕР»РіРё РїСЂРѕС€Р»С‹С… РїРµСЂРёРѕРґРѕРІ
                if month and month != "all":
                    week_match = and_(models.Task.month_label == month, models.Task.week_label == week)
                    backlog_match = and_(
                        models.Task.status != "рџџў Р’С‹РїРѕР»РЅРµРЅРѕ",
                        models.Task.status != "рџ”ґ РћС‚РјРµРЅРµРЅРѕ"
                    )
                    query = query.filter(or_(week_match, backlog_match))
                else:
                    week_match = (models.Task.week_label == week)
                    backlog_match = and_(
                        models.Task.status != "рџџў Р’С‹РїРѕР»РЅРµРЅРѕ",
                        models.Task.status != "рџ”ґ РћС‚РјРµРЅРµРЅРѕ"
                    )
                    query = query.filter(or_(week_match, backlog_match))
            else:
                # Р’С‹Р±РёСЂР°РµРј Р·Р°РґР°С‡Рё СЂРѕРґРЅРѕР№ РЅРµРґРµР»Рё РР›Р Р°РєС‚РёРІРЅС‹Рµ Р·Р°РґР°С‡Рё СЃ РґРµРґР»Р°Р№РЅРѕРј РґР»СЏ СЃРєРІРѕР·РЅРѕРіРѕ РѕС‚РѕР±СЂР°Р¶РµРЅРёСЏ
                week_match = and_(models.Task.month_label == month, models.Task.week_label == week) if (month and month != "all") else (models.Task.week_label == week)
                cross_candidate_match = and_(
                    models.Task.status != "рџ”ґ РћС‚РјРµРЅРµРЅРѕ",
                    models.Task.due_date_str.isnot(None),
                    models.Task.due_date_str != ""
                )
                query = query.filter(or_(week_match, cross_candidate_match))
        else:
            if month and month != "all":
                query = query.filter(models.Task.month_label == month)

        raw_tasks = query.order_by(models.Task.id.desc()).all()

        # Р¤РёР»СЊС‚СЂР°С†РёСЏ СЃРєРІРѕР·РЅС‹С… Р·Р°РґР°С‡ РїРѕ РІСЂРµРјРµРЅРЅРѕРјСѓ РґРёР°РїР°Р·РѕРЅСѓ
        filtered_tasks = []
        for t in raw_tasks:
            # 1. Р РѕРґРЅР°СЏ Р·Р°РґР°С‡Р° С‚РµРєСѓС‰РµР№ РЅРµРґРµР»Рё
            is_native_week = (week and week != "all" and t.week_label == week and (not month or month == "all" or t.month_label == month))
            
            if not week or week == "all" or is_native_week:
                filtered_tasks.append(t)
                continue

            # 2. Р•СЃР»Рё РІРєР»СЋС‡РµРЅ Р±СЌРєР»РѕРі РґРѕР»РіРѕРІ
            if include_backlog and t.status != "рџџў Р’С‹РїРѕР»РЅРµРЅРѕ" and t.status != "рџ”ґ РћС‚РјРµРЅРµРЅРѕ":
                filtered_tasks.append(t)
                continue

            # 3. РџСЂРѕРІРµСЂРєР° СЃРєРІРѕР·РЅРѕР№ Р°РєС‚РёРІРЅРѕСЃС‚Рё РїРѕ РґРёР°РїР°Р·РѕРЅСѓ [start, due_date]
            if sel_week_start and sel_week_end:
                t_due = parse_date_dm_or_full(t.due_date_str)
                # РќР°С‡Р°Р»Рѕ Р·Р°РґР°С‡Рё: РёР· created_at РёР»Рё РЅР°С‡Р°Р»Р° СЂРѕРґРЅРѕР№ РЅРµРґРµР»Рё Р·Р°РґР°С‡Рё
                t_orig_start, _ = parse_week_label_range(t.week_label, t.month_label)
                if not t_orig_start and t.created_at:
                    t_orig_start = t.created_at.date()

                if t_due and t_orig_start:
                    # Р—Р°РґР°С‡Р° Р°РєС‚РёРІРЅР° РЅР° С‚РµРєСѓС‰РµР№ РЅРµРґРµР»Рµ, РµСЃР»Рё СЃС‚Р°СЂС‚ <= РєРѕРЅРµС† РЅРµРґРµР»Рё Р РґРµРґР»Р°Р№РЅ >= РЅР°С‡Р°Р»Рѕ РЅРµРґРµР»Рё
                    if t_orig_start <= sel_week_end and t_due >= sel_week_start:
                        # Р•СЃР»Рё Р·Р°РґР°С‡Р° СѓР¶Рµ Р·Р°РІРµСЂС€РµРЅР°, РїРѕРєР°Р·С‹РІР°РµРј РµРµ С‚РѕР»СЊРєРѕ РµСЃР»Рё РѕРЅР° Р±С‹Р»Р° Р·Р°РІРµСЂС€РµРЅР° РЅР° СЌС‚РѕР№ РЅРµРґРµР»Рµ РёР»Рё РґРµРґР»Р°Р№РЅ РЅР° СЌС‚РѕР№ РЅРµРґРµР»Рµ
                        if t.status == "рџџў Р’С‹РїРѕР»РЅРµРЅРѕ" and t.completed_at and t.completed_at.date() < sel_week_start:
                            continue
                        filtered_tasks.append(t)

        tasks = filtered_tasks

        # РџСЂРµРґР·Р°РіСЂСѓР·РєР° РїСЂРёРєСЂРµРїР»РµРЅРЅС‹С… РґРѕРєСѓРјРµРЅС‚РѕРІ
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

        # РџСЂРµРґР·Р°РіСЂСѓР·РєР° СЂРѕРґРёС‚РµР»РµР№ Рё Р·Р°РІРёСЃРёРјРѕСЃС‚РµР№
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

        # РџСЂРµРґР·Р°РіСЂСѓР·РєР° РїРѕРґСЃС‡РµС‚Р° РїРѕРґР·Р°РґР°С‡
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
                if st_status == "рџџў Р’С‹РїРѕР»РЅРµРЅРѕ":
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
                "zone": t.zone or "Р‘РµСЂРµР¶Р»РёРІРѕРµ РїСЂРѕРёР·РІРѕРґСЃС‚РІРѕ",
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
                "status": t.status or "вљЄ Р’ РѕС‡РµСЂРµРґРё",
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

@router.post("/api/tasks/upload_photo")
async def upload_task_photo(file: UploadFile = File(...)):
    """
    РџСЂРёРЅРёРјР°РµС‚ СЃР¶Р°С‚РѕРµ webp/jpg С„РѕС‚Рѕ Р·Р°РґР°С‡Рё Рё СЃРѕС…СЂР°РЅСЏРµС‚ РІ РїРѕСЃС‚РѕСЏРЅРЅС‹Р№
    РґРёСЃРє Railway Volume (/uploads/tasks/), РіРґРµ С„Р°Р№Р»С‹ РЅРёРєРѕРіРґР° РЅРµ СЃС‚РёСЂР°СЋС‚СЃСЏ РїСЂРё РґРµРїР»РѕСЏС….
    """
    try:
        upload_dir = os.path.join("uploads", "tasks")
        os.makedirs(upload_dir, exist_ok=True)

        # Р“РµРЅРµСЂРёСЂСѓРµРј СѓРЅРёРєР°Р»СЊРЅРѕРµ РёРјСЏ С„Р°Р№Р»Р°
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

@router.get("/api/tasks/{task_id}")
def get_single_task(task_id: int, db: Session = Depends(get_db)):
    """Р’РѕР·РІСЂР°С‰Р°РµС‚ РїРѕР»РЅСѓСЋ РёРЅС„РѕСЂРјР°С†РёСЋ РїРѕ РєРѕРЅРєСЂРµС‚РЅРѕР№ Р·Р°РґР°С‡Рµ СЃ РїРѕРґР·Р°РґР°С‡Р°РјРё, СЃРІСЏР·СЏРјРё Рё РґРѕРєСѓРјРµРЅС‚РѕРј."""
    task = db.query(models.Task).filter(models.Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Р—Р°РґР°С‡Р° РЅРµ РЅР°Р№РґРµРЅР°")

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

    # РџРѕРґР·Р°РґР°С‡Рё
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

    done_cnt = sum(1 for s in subtasks if s.status == "рџџў Р’С‹РїРѕР»РЅРµРЅРѕ")
    calc_prog = int((done_cnt / len(subtasks)) * 100) if subtasks else (task.progress or 0)

    return {
        "id": task.id,
        "code": task.code or f"TSK-{task.id:02d}",
        "zone": task.zone or "Р‘РµСЂРµР¶Р»РёРІРѕРµ РїСЂРѕРёР·РІРѕРґСЃС‚РІРѕ",
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
        "status": task.status or "вљЄ Р’ РѕС‡РµСЂРµРґРё",
        "comment": task.comment or "",
        "month_label": task.month_label or "",
        "week_label": task.week_label or "",
        "attached_document_id": task.attached_document_id,
        "attached_doc": doc_info,
        "is_archived": False,
        "created_at": task.created_at.strftime("%d.%m.%Y %H:%M") if task.created_at else ""
    }

@router.get("/api/tasks/{task_id}/history")
def get_task_history(task_id: int, db: Session = Depends(get_db)):
    """Р’РѕР·РІСЂР°С‰Р°РµС‚ С…СЂРѕРЅРѕР»РѕРіРёС‡РµСЃРєСѓСЋ РёСЃС‚РѕСЂРёСЋ РёР·РјРµРЅРµРЅРёР№ Р·Р°РґР°С‡Рё РёР· AuditLog."""
    task = db.query(models.Task).filter(models.Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Р—Р°РґР°С‡Р° РЅРµ РЅР°Р№РґРµРЅР°")

    logs = db.query(models.AuditLog).filter(
        models.AuditLog.target_table == "tasks",
        models.AuditLog.target_id == task_id
    ).order_by(models.AuditLog.timestamp.asc(), models.AuditLog.id.asc()).all()

    history = []
    for log in logs:
        history.append({
            "id": log.id,
            "timestamp": log.timestamp.strftime("%d.%m.%Y %H:%M") if log.timestamp else "",
            "user_name": log.user_name or "РЎРёСЃС‚РµРјР°",
            "action": log.action,
            "details": log.details or ""
        })

    # Р•СЃР»Рё РІ AuditLog РїРѕРєР° РЅРµС‚ Р·Р°РїРёСЃРµР№, С„РѕСЂРјРёСЂСѓРµРј Р±Р°Р·РѕРІСѓСЋ Р·Р°РїРёСЃСЊ СЃРѕР·РґР°РЅРёСЏ
    if not history and task.created_at:
        history.append({
            "id": 0,
            "timestamp": task.created_at.strftime("%d.%m.%Y %H:%M"),
            "user_name": task.author_name or "РђРІС‚РѕСЂ",
            "action": "CREATE",
            "details": f"РЎРѕР·РґР°РЅР° Р·Р°РґР°С‡Р° [{task.code or f'TSK-{task.id}'}] В«{task.title}В». РСЃРїРѕР»РЅРёС‚РµР»СЊ: {task.assignee_name or 'вЂ”'}"
        })

    return {
        "task_id": task.id,
        "code": task.code or f"TSK-{task.id:02d}",
        "title": task.title,
        "status": task.status,
        "history": history
    }

@router.post("/api/tasks")
def create_task(task_data: schemas.TaskCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """РЎРѕР·РґР°РµС‚ РЅРѕРІСѓСЋ Р·Р°РґР°С‡Сѓ СЃ РїРѕРґРґРµСЂР¶РєРѕР№ РіРѕСЂРёР·РѕРЅС‚РѕРІ, С‚РµРіРѕРІ Рё СЃРІСЏР·РµР№."""
    try:
        author_name = (task_data.author_name or "").strip()
        pin = (task_data.pin_code or "").strip()

        # РџСЂРѕРІРµСЂРєР° PIN-РєРѕРґР° Р°РІС‚РѕСЂР°
        if author_name:
            emp = db.query(models.PlannerEmployee).filter(models.PlannerEmployee.name == author_name).first()
            if emp and emp.pin_code and emp.pin_code.strip():
                if emp.pin_code.strip() != pin:
                    raise HTTPException(status_code=401, detail=f"РќРµРІРµСЂРЅС‹Р№ PIN-РєРѕРґ РґР»СЏ Р°РІС‚РѕСЂР° В«{author_name}В»")

        last_task = db.query(models.Task).order_by(models.Task.id.desc()).first()
        next_num = (last_task.id + 1) if last_task else 1
        code_str = task_data.code or f"TSK-{next_num:02d}"

        title_ru = (task_data.title or "").strip()
        title_kz = (task_data.title_kz or "").strip()

        # РџР°СЂСЃРёРЅРі С…СЌС€С‚РµРіРѕРІ РёР· Р·Р°РіРѕР»РѕРІРєР°
        combined_tags = extract_hashtags_from_title(title_ru, task_data.tags)

        # РРЅС‚РµР»Р»РµРєС‚СѓР°Р»СЊРЅРѕРµ РІС‹СЂР°РІРЅРёРІР°РЅРёРµ СЏР·С‹РєРѕРІ
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
            zone=task_data.zone or "Р‘РµСЂРµР¶Р»РёРІРѕРµ РїСЂРѕРёР·РІРѕРґСЃС‚РІРѕ",
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
            status=task_data.status or "рџџЎ Р’ СЂР°Р±РѕС‚Рµ",
            comment=task_data.comment or "",
            month_label=task_data.month_label or "РђРІРіСѓСЃС‚ 2026",
            week_label=task_data.week_label or "РќРµРґРµР»СЏ 4 (24.08 - 28.08)",
            attached_document_id=task_data.attached_document_id,
            is_archived=False
        )
        db.add(new_task)
        db.flush()

        # РџРµСЂРµСЃС‡РёС‚С‹РІР°РµРј СЂРѕРґРёС‚РµР»СЊСЃРєСѓСЋ Р·Р°РґР°С‡Сѓ РїСЂРё РЅРµРѕР±С…РѕРґРёРјРѕСЃС‚Рё
        if new_task.parent_id:
            recalculate_parent_task_progress(db, new_task.parent_id)

        # AuditLog
        db.add(models.AuditLog(
            user_name=new_task.author_name or "РџР»Р°РЅРЅРµСЂ",
            action="CREATE",
            target_table="tasks",
            target_id=new_task.id,
            details=f"РЎРѕР·РґР°РЅР° Р·Р°РґР°С‡Р° [{new_task.code}] В«{new_task.title}В». РўРёРї: {new_task.task_type}, РЎР»СѓР¶Р±Р°: {new_task.department_service or 'вЂ”'}, РСЃРїРѕР»РЅРёС‚РµР»СЊ: {new_task.assignee_name or 'вЂ”'}"
        ))

        db.commit()
        db.refresh(new_task)

        # РћС‚РїСЂР°РІРєР° email РёСЃРїРѕР»РЅРёС‚РµР»СЋ
        if new_task.assignee_name:
            assignee_email = get_task_person_email(db, new_task.assignee_name)
            if assignee_email:
                subject = f"рџ“Њ РќРѕРІР°СЏ Р·Р°РґР°С‡Р° [{new_task.zone}]: {new_task.title}"
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
                background_tasks.add_task(send_task_email_notification, assignee_email, subject, "Р’Р°Рј РЅР°Р·РЅР°С‡РµРЅР° РЅРѕРІР°СЏ Р·Р°РґР°С‡Р°", task_dict)

        return {"status": "ok", "task_id": new_task.id, "code": new_task.code}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        print(f"Error creating task: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/tasks/bulk")
def create_tasks_bulk(bulk_data: schemas.BulkTasksCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """РњР°СЃСЃРѕРІРѕРµ СЃРѕР·РґР°РЅРёРµ Р·Р°РґР°С‡ РІ РµРґРёРЅРѕР№ С‚СЂР°РЅР·Р°РєС†РёРё Р‘Р”."""
    try:
        author_name = (bulk_data.author_name or "").strip()
        pin = (bulk_data.pin_code or "").strip()

        if not bulk_data.tasks or len(bulk_data.tasks) == 0:
            raise HTTPException(status_code=400, detail="РЎРїРёСЃРѕРє Р·Р°РґР°С‡ РїСѓСЃС‚")

        # РџСЂРѕРІРµСЂРєР° PIN-РєРѕРґР° Р°РІС‚РѕСЂР°
        if author_name:
            emp = db.query(models.PlannerEmployee).filter(models.PlannerEmployee.name == author_name).first()
            if emp and emp.pin_code and emp.pin_code.strip():
                if emp.pin_code.strip() != pin:
                    raise HTTPException(status_code=401, detail=f"РќРµРІРµСЂРЅС‹Р№ PIN-РєРѕРґ РґР»СЏ Р°РІС‚РѕСЂР° В«{author_name}В»")

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

            # РџР°СЂСЃРёРЅРі С…СЌС€С‚РµРіРѕРІ РёР· РЅР°Р·РІР°РЅРёСЏ
            combined_tags = extract_hashtags_from_title(title_raw, item.tags)

            # РџРµСЂРµРІРѕРґ РЅР°Р·РІР°РЅРёСЏ
            trans_info = detect_and_translate_task_text(title_raw)
            title_ru = trans_info.get("text_ru", title_raw)
            title_kz = trans_info.get("text_kz", "")

            # РћРїСЂРµРґРµР»РµРЅРёРµ СЃСЂРѕРєР° Р·Р°РґР°С‡Рё
            due_date = item.due_date_str or bulk_data.default_due_date_str or ""

            # РћРїСЂРµРґРµР»РµРЅРёРµ Р·РѕРЅС‹
            zone_val = item.zone or bulk_data.zone or "Р‘РµСЂРµР¶Р»РёРІРѕРµ РїСЂРѕРёР·РІРѕРґСЃС‚РІРѕ"

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
                status="рџџЎ Р’ СЂР°Р±РѕС‚Рµ",
                comment="",
                month_label=bulk_data.month_label or "РђРІРіСѓСЃС‚ 2026",
                week_label=bulk_data.week_label or "РќРµРґРµР»СЏ 4 (24.08 - 28.08)",
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

            # РџРѕРґРіРѕС‚РѕРІРєР° email РёСЃРїРѕР»РЅРёС‚РµР»СЋ
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
            raise HTTPException(status_code=400, detail="РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕР·РґР°С‚СЊ Р·Р°РґР°С‡Рё (РІСЃРµ СЃС‚СЂРѕРєРё РїСѓСЃС‚С‹)")

        # AuditLog
        dept_str = f", РЎР»СѓР¶Р±Р°: {bulk_data.department_service}" if bulk_data.department_service else ""
        db.add(models.AuditLog(
            user_name=author_name or "РџР»Р°РЅРЅРµСЂ",
            action="CREATE",
            target_table="tasks",
            target_id=created_tasks[0]["id"],
            details=f"РњР°СЃСЃРѕРІРѕ СЃРѕР·РґР°РЅРѕ Р·Р°РґР°С‡: {len(created_tasks)} С€С‚. РђРІС‚РѕСЂ: {author_name}{dept_str}. РљРѕРґС‹: {created_tasks[0]['code']}вЂ“{created_tasks[-1]['code']}"
        ))

        db.commit()

        # Р¤РѕРЅРѕРІР°СЏ РѕС‚РїСЂР°РІРєР° email
        for a_email, t_dict in task_dicts_for_email:
            subject = f"рџ“Њ РќРѕРІР°СЏ Р·Р°РґР°С‡Р° [{t_dict.get('zone', 'РџР»Р°РЅ')}]: {t_dict.get('title', '')}"
            background_tasks.add_task(send_task_email_notification, a_email, subject, "Р’Р°Рј РЅР°Р·РЅР°С‡РµРЅР° РЅРѕРІР°СЏ Р·Р°РґР°С‡Р°", t_dict)

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

@router.post("/api/tasks/bulk_status")
def update_tasks_bulk_status(payload: schemas.BulkTaskStatusUpdate, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """РњР°СЃСЃРѕРІРѕРµ РѕР±РЅРѕРІР»РµРЅРёРµ СЃС‚Р°С‚СѓСЃРѕРІ РїР°С‡РєРё Р·Р°РґР°С‡ (РґР»СЏ СЃР»СѓР¶Р± РћР“Р­ / РћР“Рњ) РІ РѕРґРЅРѕР№ С‚СЂР°РЅР·Р°РєС†РёРё."""
    try:
        task_ids = payload.task_ids or []
        if not task_ids:
            raise HTTPException(status_code=400, detail="РЎРїРёСЃРѕРє Р·Р°РґР°С‡ РїСѓСЃС‚")

        tasks = db.query(models.Task).filter(models.Task.id.in_(task_ids)).all()
        if not tasks:
            raise HTTPException(status_code=404, detail="Р—Р°РґР°С‡Рё РЅРµ РЅР°Р№РґРµРЅС‹")

        new_status = payload.status
        comment_text = (payload.comment or "").strip()
        move_next = payload.move_to_next_week or False
        next_month = (payload.next_month_label or "").strip()
        next_week = (payload.next_week_label or "").strip()

        parent_ids_to_recalc = set()
        updated_codes = []

        for task in tasks:
            task.status = new_status
            if comment_text:
                task.comment = comment_text
            elif new_status == "рџџў Р’С‹РїРѕР»РЅРµРЅРѕ" and not task.comment:
                task.comment = "Р’С‹РїРѕР»РЅРµРЅРѕ"

            if move_next and next_week:
                task.week_label = next_week
                if next_month:
                    task.month_label = next_month

            task.updated_at = datetime.utcnow()
            if task.parent_id:
                parent_ids_to_recalc.add(task.parent_id)
            updated_codes.append(task.code or f"TSK-{task.id}")

        for p_id in parent_ids_to_recalc:
            recalculate_parent_task_progress(db, p_id)

        # Р•РґРёРЅР°СЏ Р·Р°РїРёСЃСЊ РІ AuditLog
        user_label = tasks[0].assignee_name or tasks[0].author_name or "РџР»Р°РЅРЅРµСЂ"
        action_desc = f"РњР°СЃСЃРѕРІРѕРµ РёР·РјРµРЅРµРЅРёРµ СЃС‚Р°С‚СѓСЃР° РЅР° В«{new_status}В» РґР»СЏ {len(tasks)} Р·Р°РґР°С‡ ({', '.join(updated_codes[:8])}{'...' if len(updated_codes) > 8 else ''})"
        if move_next and next_week:
            action_desc += f", РїРµСЂРµРЅРµСЃРµРЅС‹ РЅР° {next_week}"

        db.add(models.AuditLog(
            user_name=user_label,
            action="UPDATE",
            target_table="tasks",
            target_id=tasks[0].id,
            details=action_desc
        ))

        db.commit()

        return {
            "status": "ok",
            "updated_count": len(tasks),
            "new_status": new_status
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        print(f"Error bulk updating task status: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/api/tasks/{task_id}")
def update_task(task_id: int, task_data: schemas.TaskUpdate, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """РћР±РЅРѕРІР»СЏРµС‚ Р·Р°РґР°С‡Сѓ, РїРµСЂРµСЃС‡РёС‚С‹РІР°РµС‚ СЃРІСЏР·Рё Рё РѕС‚РїСЂР°РІР»СЏРµС‚ СѓРІРµРґРѕРјР»РµРЅРёСЏ."""
    try:
        task = db.query(models.Task).filter(models.Task.id == task_id).first()
        if not task:
            raise HTTPException(status_code=404, detail="Р—Р°РґР°С‡Р° РЅРµ РЅР°Р№РґРµРЅР°")

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

        # РђРІС‚РѕРјР°С‚РёС‡РµСЃРєРѕРµ РёР·РІР»РµС‡РµРЅРёРµ С…СЌС€С‚РµРіРѕРІ РёР· Р·Р°РіРѕР»РѕРІРєР° РїСЂРё РѕР±РЅРѕРІР»РµРЅРёРё
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
                user_name=task.assignee_name or task.author_name or "РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ",
                action="UPDATE",
                target_table="tasks",
                target_id=task.id,
                details=f"РР·РјРµРЅРµРЅР° Р·Р°РґР°С‡Р° [{task.code}] В«{task.title}В». РР·РјРµРЅРµРЅРёСЏ: {'; '.join(changes)}"
            ))

        db.commit()
        db.refresh(task)

        # РџРµСЂРµСЃС‡РµС‚ РїСЂРѕРіСЂРµСЃСЃР° СЂРѕРґРёС‚РµР»СЏ
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

        # 1. Р•СЃР»Рё СЃРјРµРЅРёР»СЃСЏ РёСЃРїРѕР»РЅРёС‚РµР»СЊ Рё РЅР°Р·РЅР°С‡РµРЅ РЅРѕРІС‹Р№ -> СѓРІРµРґРѕРјР»РµРЅРёРµ РЅРѕРІРѕРјСѓ РёСЃРїРѕР»РЅРёС‚РµР»СЋ
        if task.assignee_name and task.assignee_name != old_assignee:
            new_assignee_email = get_task_person_email(db, task.assignee_name)
            if new_assignee_email:
                subject = f"рџ“Њ РќРѕРІР°СЏ Р·Р°РґР°С‡Р° [{task.zone}]: {task.title}"
                background_tasks.add_task(send_task_email_notification, new_assignee_email, subject, "Р’Р°Рј РЅР°Р·РЅР°С‡РµРЅР° РЅРѕРІР°СЏ Р·Р°РґР°С‡Р°", task_dict)

        # 2. РЈРІРµРґРѕРјР»РµРЅРёСЏ РїСЂРё СЃРјРµРЅРµ СЃС‚Р°С‚СѓСЃР°
        if task_data.status and task_data.status != old_status:
            # 2.1. Р•СЃР»Рё Р·Р°РґР°С‡Р° Р·Р°РІРµСЂС€РµРЅР° -> Р°РІС‚РѕСЂСѓ
            if task.status == "рџџў Р’С‹РїРѕР»РЅРµРЅРѕ" and task.author_name:
                author_email = get_task_person_email(db, task.author_name)
                if author_email:
                    subject = f"рџџў Р—Р°РґР°С‡Р° РІС‹РїРѕР»РЅРµРЅР° [{task.zone}]: {task.title}"
                    background_tasks.add_task(send_task_email_notification, author_email, subject, "Р—Р°РґР°С‡Р° РІС‹РїРѕР»РЅРµРЅР°", task_dict)

            # 2.2. Р•СЃР»Рё Р·Р°РґР°С‡Р° РїРµСЂРµРЅРµСЃРµРЅР° -> Р°РІС‚РѕСЂСѓ Рё РёСЃРїРѕР»РЅРёС‚РµР»СЋ
            elif task.status == "рџ”µ РџРµСЂРµРЅРµСЃРµРЅРѕ":
                due_info = f" РЅР° {task.due_date_str}" if task.due_date_str else ""
                subject = f"рџ”µ РЎСЂРѕРє Р·Р°РґР°С‡Рё РїРµСЂРµРЅРµСЃРµРЅ{due_info} [{task.zone}]: {task.title}"
                if task.author_name:
                    author_email = get_task_person_email(db, task.author_name)
                    if author_email:
                        background_tasks.add_task(send_task_email_notification, author_email, subject, "РЎСЂРѕРє Р·Р°РґР°С‡Рё РїРµСЂРµРЅРµСЃРµРЅ", task_dict)
                if task.assignee_name and task.assignee_name != task.author_name:
                    assignee_email = get_task_person_email(db, task.assignee_name)
                    if assignee_email:
                        background_tasks.add_task(send_task_email_notification, assignee_email, subject, "РЎСЂРѕРє Р·Р°РґР°С‡Рё РїРµСЂРµРЅРµСЃРµРЅ", task_dict)

            # 2.3. Р•СЃР»Рё Р·Р°РґР°С‡Р° РѕС‚РјРµРЅРµРЅР° -> РёСЃРїРѕР»РЅРёС‚РµР»СЋ Рё Р°РІС‚РѕСЂСѓ
            elif task.status == "рџ”ґ РћС‚РјРµРЅРµРЅРѕ":
                subject = f"рџ”ґ Р—Р°РґР°С‡Р° РѕС‚РјРµРЅРµРЅР° [{task.zone}]: {task.title}"
                if task.assignee_name:
                    assignee_email = get_task_person_email(db, task.assignee_name)
                    if assignee_email:
                        background_tasks.add_task(send_task_email_notification, assignee_email, subject, "Р—Р°РґР°С‡Р° РѕС‚РјРµРЅРµРЅР°", task_dict)
                if task.author_name and task.author_name != task.assignee_name:
                    author_email = get_task_person_email(db, task.author_name)
                    if author_email:
                        background_tasks.add_task(send_task_email_notification, author_email, subject, "Р—Р°РґР°С‡Р° РѕС‚РјРµРЅРµРЅР°", task_dict)

            # 2.4. Р•СЃР»Рё Р·Р°РґР°С‡Сѓ РІР·СЏР»Рё РІ СЂР°Р±РѕС‚Сѓ
            elif task.status == "рџџЎ Р’ СЂР°Р±РѕС‚Рµ" and task.assignee_name:
                assignee_email = get_task_person_email(db, task.assignee_name)
                if assignee_email:
                    subject = f"рџ“Њ Р—Р°РґР°С‡Р° РІ СЂР°Р±РѕС‚Рµ [{task.zone}]: {task.title}"
                    background_tasks.add_task(send_task_email_notification, assignee_email, subject, "Р—Р°РґР°С‡Р° РІ СЂР°Р±РѕС‚Рµ", task_dict)

        return {"status": "ok", "task_id": task.id}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        print(f"Error updating task: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/api/tasks/{task_id}")
def delete_task(task_id: int, db: Session = Depends(get_db)):
    """РЈРґР°Р»СЏРµС‚ Р·Р°РґР°С‡Сѓ (РґРѕСЃС‚СѓРїРЅРѕ С‚РѕР»СЊРєРѕ РёР· РїР°РЅРµР»Рё Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂР°)."""
    try:
        task = db.query(models.Task).filter(models.Task.id == task_id).first()
        if not task:
            raise HTTPException(status_code=404, detail="Р—Р°РґР°С‡Р° РЅРµ РЅР°Р№РґРµРЅР°")
        
        task_info = f"ID: {task.id}, РљРѕРґ: {task.code}, Р—Р°РіРѕР»РѕРІРѕРє: {task.title}, Р—РѕРЅР°: {task.zone}, РџРµСЂРёРѕРґ: {task.month_label}/{task.week_label}"
        db.delete(task)
        
        # Р›РѕРіРёСЂРѕРІР°РЅРёРµ РІ Р°СѓРґРёС‚
        db.add(models.AuditLog(
            user_name="РђРґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂ",
            action="DELETE",
            target_table="tasks",
            target_id=task_id,
            details=f"РђРґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂ СѓРґР°Р»РёР» Р·Р°РґР°С‡Сѓ [{task_info}]"
        ))
        
        db.commit()
        return {"status": "ok", "message": "Р—Р°РґР°С‡Р° СѓСЃРїРµС€РЅРѕ СѓРґР°Р»РµРЅР°"}
    except HTTPException:
        raise
@router.post("/api/tasks/{task_id}/move_next_week")
def move_task_to_next_week(
    task_id: int, 
    next_week: str, 
    next_month: Optional[str] = None, 
    background_tasks: BackgroundTasks = BackgroundTasks(),
    db: Session = Depends(get_db)
):
    """РџРµСЂРµРЅРѕСЃРёС‚ РѕС‚РґРµР»СЊРЅСѓСЋ Р·Р°РґР°С‡Сѓ РЅР° СЃР»РµРґСѓСЋС‰СѓСЋ РЅРµРґРµР»СЋ (Рё РїСЂРё РЅРµРѕР±С…РѕРґРёРјРѕСЃС‚Рё РІ СЃР»РµРґСѓСЋС‰РёР№ РјРµСЃСЏС†) СЃРѕ СЃС‚Р°С‚СѓСЃРѕРј РџРµСЂРµРЅРµСЃРµРЅРѕ."""
    try:
        task = db.query(models.Task).filter(models.Task.id == task_id).first()
        if not task:
            raise HTTPException(status_code=404, detail="Р—Р°РґР°С‡Р° РЅРµ РЅР°Р№РґРµРЅР°")

        old_week = task.week_label or ""
        task.week_label = next_week
        if next_month:
            task.month_label = next_month
        task.status = "рџ”µ РџРµСЂРµРЅРµСЃРµРЅРѕ"
        
        prev_comment = task.comment or ""
        note = f"(РџРµСЂРµРЅРµСЃРµРЅРѕ СЃ {old_week})"
        if note not in prev_comment:
            task.comment = f"{prev_comment} {note}".strip()

        db.add(models.AuditLog(
            user_name=task.assignee_name or task.author_name or "РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ",
            action="UPDATE",
            target_table="tasks",
            target_id=task.id,
            details=f"РџРµСЂРµРЅРѕСЃ Р·Р°РґР°С‡Рё [{task.code}] В«{task.title}В» СЃ В«{old_week}В» РЅР° В«{next_week}В»"
        ))

        db.commit()
        db.refresh(task)

        # РћС‚РїСЂР°РІРєР° СѓРІРµРґРѕРјР»РµРЅРёСЏ Р°РІС‚РѕСЂСѓ Рё РёСЃРїРѕР»РЅРёС‚РµР»СЋ Рѕ РїРµСЂРµРЅРѕСЃРµ
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
                subject = f"рџ”µ Р—Р°РґР°С‡Р° РїРµСЂРµРЅРµСЃРµРЅР° РЅР° {next_week} [{task.zone}]: {task.title}"
                background_tasks.add_task(send_task_email_notification, author_email, subject, "Р—Р°РґР°С‡Р° РїРµСЂРµРЅРµСЃРµРЅР°", task_dict)

        return {"status": "ok", "message": f"Р—Р°РґР°С‡Р° РїРµСЂРµРЅРµСЃРµРЅР° РЅР° {next_week}"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/tasks/archive_week")
def archive_week_tasks(
    current_week: str = Body(..., embed=True),
    next_week: Optional[str] = Body(None, embed=True),
    db: Session = Depends(get_db)
):
    """
    Р—Р°РІРµСЂС€Р°РµС‚ РЅРµРґРµР»СЋ:
    - Р’С‹РїРѕР»РЅРµРЅРЅС‹Рµ (рџџў Р’С‹РїРѕР»РЅРµРЅРѕ) РїРµСЂРµРЅРѕСЃРёС‚ РІ РђСЂС…РёРІ (is_archived = True).
    - РќРµР·Р°РІРµСЂС€РµРЅРЅС‹Рµ РїРµСЂРµРЅРѕСЃРёС‚ РЅР° СЃР»РµРґСѓСЋС‰СѓСЋ РЅРµРґРµР»СЋ (РµСЃР»Рё СѓРєР°Р·Р°РЅР°).
    """
    try:
        tasks = db.query(models.Task).filter(
            models.Task.week_label == current_week,
            models.Task.is_archived == False
        ).all()

        archived_count = 0
        moved_count = 0

        for t in tasks:
            if t.status == "рџџў Р’С‹РїРѕР»РЅРµРЅРѕ":
                t.is_archived = True
                archived_count += 1
            else:
                if next_week:
                    t.week_label = next_week
                    t.status = "рџ”µ РџРµСЂРµРЅРµСЃРµРЅРѕ"
                    note = f"(РџРµСЂРµРЅРµСЃРµРЅРѕ СЃ {current_week})"
                    prev_comment = t.comment or ""
                    if note not in prev_comment:
                        t.comment = f"{prev_comment} {note}".strip()
                    moved_count += 1

        db.add(models.AuditLog(
            user_name="РђРґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂ",
            action="UPDATE",
            target_table="tasks",
            target_id=None,
            details=f"РђСЂС…РёРІР°С†РёСЏ РЅРµРґРµР»Рё В«{current_week}В»: {archived_count} Р·Р°РІРµСЂС€РµРЅРѕ РІ Р°СЂС…РёРІ, {moved_count} РїРµСЂРµРЅРµСЃРµРЅРѕ РЅР° В«{next_week or 'СЃР»РµРґ. РЅРµРґРµР»СЋ'}В»"
        ))

        db.commit()
        return {
            "status": "ok",
            "archived_count": archived_count,
            "moved_count": moved_count,
            "message": f"РќРµРґРµР»СЏ Р·Р°РєСЂС‹С‚Р°! Р’ Р°СЂС…РёРІ: {archived_count} Р·Р°РґР°С‡. РџРµСЂРµРЅРµСЃРµРЅРѕ РЅР° {next_week or 'СЃР»РµРґ. РЅРµРґРµР»СЋ'}: {moved_count} Р·Р°РґР°С‡."
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/tasks/{task_id}/restore")
def restore_task_from_archive(task_id: int, target_week: Optional[str] = None, db: Session = Depends(get_db)):
    """Р’РѕСЃСЃС‚Р°РЅР°РІР»РёРІР°РµС‚ Р·Р°РґР°С‡Сѓ РёР· РђСЂС…РёРІР° РѕР±СЂР°С‚РЅРѕ РІ Р°РєС‚РёРІРЅС‹Р№ РїР»Р°РЅ."""
    try:
        task = db.query(models.Task).filter(models.Task.id == task_id).first()
        if not task:
            raise HTTPException(status_code=404, detail="Р—Р°РґР°С‡Р° РЅРµ РЅР°Р№РґРµРЅР°")

        task.is_archived = False
        if target_week:
            task.week_label = target_week
        task.status = "вљЄ Р’ РѕС‡РµСЂРµРґРё"
        db.commit()
        return {"status": "ok", "message": "Р—Р°РґР°С‡Р° РІРѕР·РІСЂР°С‰РµРЅР° РІ РїР»Р°РЅ"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/tasks/translate")
def translate_task_text(payload: dict = Body(...)):
    """РРЅС‚РµР»Р»РµРєС‚СѓР°Р»СЊРЅС‹Р№ РґРІСѓСЃС‚РѕСЂРѕРЅРЅРёР№ Р°РЅР°Р»РёР· Рё РїРµСЂРµРІРѕРґ RU <-> KZ."""
    text = payload.get("text", "") if isinstance(payload, dict) else str(payload)
    source_lang = payload.get("source_lang", "auto") if isinstance(payload, dict) else "auto"
    return detect_and_translate_task_text(text, forced_source=source_lang if source_lang != "auto" else None)

@router.post("/api/tasks/import_from_google_sheets")
def import_tasks_from_google_sheets(db: Session = Depends(get_db)):
    """РРјРїРѕСЂС‚РёСЂСѓРµС‚ РІСЃРµ Р°РєС‚РёРІРЅС‹Рµ Рё Р°СЂС…РёРІРЅС‹Рµ Р·Р°РґР°С‡Рё + СЃРїСЂР°РІРѕС‡РЅРёРєРё РёР· Google РўР°Р±Р»РёС†С‹."""
    try:
        import json
        from google.oauth2 import service_account
        from googleapiclient.discovery import build

        if not os.path.exists("google_credentials.json"):
            raise HTTPException(status_code=400, detail="Р¤Р°Р№Р» google_credentials.json РЅРµ РЅР°Р№РґРµРЅ")

        creds = service_account.Credentials.from_service_account_info(
            json.load(open('google_credentials.json', 'r', encoding='utf-8')),
            scopes=['https://www.googleapis.com/auth/spreadsheets']
        )
        service = build('sheets', 'v4', credentials=creds)
        spreadsheet_id = '1K6Lk0fVfVpfC7gpvg8Hlpj0IgTF9j5woLOWKquyFewc'

        # 1. РРјРїРѕСЂС‚ РЎРїСЂР°РІРѕС‡РЅРёРєРѕРІ (Email)
        try:
            res_dir = service.spreadsheets().values().get(spreadsheetId=spreadsheet_id, range='РЎРїСЂР°РІРѕС‡РЅРёРєРё!A2:B100').execute()
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

        # 2. РРјРїРѕСЂС‚ РђРєС‚РёРІРЅС‹С… Р·Р°РґР°С‡ ('РџР»Р°РЅ РЅР° РЅРµРґРµР»СЋ')
        imported_active = 0
        try:
            res_active = service.spreadsheets().values().get(spreadsheetId=spreadsheet_id, range='РџР»Р°РЅ РЅР° РЅРµРґРµР»СЋ!A4:L100').execute()
            active_rows = res_active.get('values', [])
            week_label = "РќРµРґРµР»СЏ 4 (24.08 - 28.08)"
            month_label = "РђРІРіСѓСЃС‚ 2026"

            for i, r in enumerate(active_rows):
                if not r or len(r) < 3:
                    continue
                code = r[0] if len(r) > 0 and r[0] else f"TSK-{(i+1):02d}"
                zone = r[1] if len(r) > 1 and r[1] else "Р‘РµСЂРµР¶Р»РёРІРѕРµ РїСЂРѕРёР·РІРѕРґСЃС‚РІРѕ"
                task_input = r[2] if len(r) > 2 else ""
                photo = r[3] if len(r) > 3 else ""
                task_ru = r[4] if len(r) > 4 and r[4] else task_input
                task_kz = r[5] if len(r) > 5 else ""
                author = r[6] if len(r) > 6 and r[6] else "Р›РµРІРґР° Рњ."
                assignee = r[7] if len(r) > 7 else ""
                due = r[8] if len(r) > 8 else ""
                status = r[9] if len(r) > 9 and r[9] else "вљЄ Р’ РѕС‡РµСЂРµРґРё"
                comment = r[10] if len(r) > 10 else ""

                if not task_ru and not task_input:
                    continue

                # РќРѕСЂРјР°Р»РёР·Р°С†РёСЏ СЃС‚Р°С‚СѓСЃР°
                norm_status = "вљЄ Р’ РѕС‡РµСЂРµРґРё"
                if "Р’С‹РїРѕР»РЅРµРЅРѕ" in status: norm_status = "рџџў Р’С‹РїРѕР»РЅРµРЅРѕ"
                elif "Р’ СЂР°Р±РѕС‚Рµ" in status: norm_status = "рџџЎ Р’ СЂР°Р±РѕС‚Рµ"
                elif "РџСЂРѕР±Р»РµРјР°" in status or "РџРµСЂРµРЅРµСЃРµРЅРѕ" in status: norm_status = "рџ”µ РџРµСЂРµРЅРµСЃРµРЅРѕ"

                # РџСЂРѕРІРµСЂСЏРµРј РЅРµС‚ Р»Рё СѓР¶Рµ С‚Р°РєРѕР№ Р·Р°РґР°С‡Рё
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

        return {"status": "ok", "imported_active": imported_active, "message": f"РЈСЃРїРµС€РЅРѕ РёРјРїРѕСЂС‚РёСЂРѕРІР°РЅРѕ {imported_active} Р·Р°РґР°С‡ РёР· Google РўР°Р±Р»РёС†С‹"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

