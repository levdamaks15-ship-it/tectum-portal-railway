import os
import json
from datetime import datetime, date
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Request, BackgroundTasks, Query, Body
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_, func

import models
import schemas
from database import SessionLocal

try:
    import google_sheets_integration
except ImportError:
    google_sheets_integration = None

router = APIRouter(tags=["checklists"])

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ==========================================
# Р§Р•Рљ-Р›РРЎРўР«: API Р РРќРўР•Р“Р РђР¦РРЇ
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

@router.get("/api/checklists/employees")
def get_checklist_employees(db: Session = Depends(get_db)):
    """Р’РѕР·РІСЂР°С‰Р°РµС‚ СЃРїРёСЃРѕРє СЃРѕС‚СЂСѓРґРЅРёРєРѕРІ, СЃРіСЂСѓРїРїРёСЂРѕРІР°РЅРЅС‹С… РїРѕ СЃРјРµРЅР°Рј Рё РґРѕР»Р¶РЅРѕСЃС‚СЏРј."""
    try:
        employees = db.query(models.ChecklistEmployee).filter(models.ChecklistEmployee.is_active == True).order_by(
            models.ChecklistEmployee.shift_group.asc(),
            models.ChecklistEmployee.num.asc(),
            models.ChecklistEmployee.name.asc()
        ).all()
        
        # Р•СЃР»Рё СЃРѕС‚СЂСѓРґРЅРёРєРѕРІ РµС‰Рµ РЅРµС‚ РІ Р±Р°Р·Рµ, РїСЂРѕР±СѓРµРј Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё РёРјРїРѕСЂС‚РёСЂРѕРІР°С‚СЊ РёР· Google Sheets
        if not employees:
            import google_sheets_integration
            google_sheets_integration.sync_employees_from_google_sheets(db)
            employees = db.query(models.ChecklistEmployee).filter(models.ChecklistEmployee.is_active == True).all()
            
        return [
            {
                "id": e.id,
                "num": e.num,
                "shift_group": e.shift_group,
                "department": e.department or "Р›Р¤Рњ",
                "position": e.position,
                "name": e.name
            }
            for e in employees
        ]
    except Exception as e:
        print(f"Error fetching checklist employees: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/checklists/employees")
def create_checklist_employee(emp: ChecklistEmployeeCreate, db: Session = Depends(get_db)):
    """РЎРѕР·РґР°РµС‚ РЅРѕРІРѕРіРѕ СЃРѕС‚СЂСѓРґРЅРёРєР° РґР»СЏ С‡РµРє-Р»РёСЃС‚РѕРІ."""
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

@router.put("/api/checklists/employees/{emp_id}")
def update_checklist_employee(emp_id: int, emp: ChecklistEmployeeCreate, db: Session = Depends(get_db)):
    """РћР±РЅРѕРІР»СЏРµС‚ РґР°РЅРЅС‹Рµ СЃРѕС‚СЂСѓРґРЅРёРєР°."""
    try:
        db_emp = db.query(models.ChecklistEmployee).filter(models.ChecklistEmployee.id == emp_id).first()
        if not db_emp:
            raise HTTPException(status_code=404, detail="РЎРѕС‚СЂСѓРґРЅРёРє РЅРµ РЅР°Р№РґРµРЅ")
        
        import google_sheets_integration
        dept = google_sheets_integration.get_department_by_position(emp.position, emp.shift_group)
        
        db_emp.name = emp.name.strip()
        db_emp.position = emp.position.strip()
        db_emp.shift_group = emp.shift_group.strip()
        db_emp.department = dept
        if emp.num is not None:
            db_emp.num = emp.num
        db.commit()
        return {"status": "ok", "message": "РЎРѕС‚СЂСѓРґРЅРёРє РѕР±РЅРѕРІР»РµРЅ"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/api/checklists/employees/{emp_id}")
def delete_checklist_employee(emp_id: int, db: Session = Depends(get_db)):
    """РЈРґР°Р»СЏРµС‚ (РґРµР°РєС‚РёРІРёСЂСѓРµС‚) СЃРѕС‚СЂСѓРґРЅРёРєР°."""
    try:
        db_emp = db.query(models.ChecklistEmployee).filter(models.ChecklistEmployee.id == emp_id).first()
        if not db_emp:
            raise HTTPException(status_code=404, detail="РЎРѕС‚СЂСѓРґРЅРёРє РЅРµ РЅР°Р№РґРµРЅ")
        db_emp.is_active = False
        db.commit()
        return {"status": "ok", "message": "РЎРѕС‚СЂСѓРґРЅРёРє СѓРґР°Р»РµРЅ"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/checklists/schedule/all")
def get_all_shift_schedules(db: Session = Depends(get_db)):
    """Р’РѕР·РІСЂР°С‰Р°РµС‚ РІРµСЃСЊ РіСЂР°С„РёРє СЃРјРµРЅРЅРѕСЃС‚Рё."""
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

@router.post("/api/checklists/schedule/update_day")
def update_shift_schedule_day(data: dict, db: Session = Depends(get_db)):
    """РћР±РЅРѕРІР»СЏРµС‚ СЃРјРµРЅС‹ РЅР° РєРѕРЅРєСЂРµС‚РЅСѓСЋ РґР°С‚Сѓ."""
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
        return {"status": "ok", "message": f"Р“СЂР°С„РёРє РЅР° {date_str} РѕР±РЅРѕРІР»РµРЅ"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/checklists/schedule/today")
def get_today_shift_schedule(date: Optional[str] = None, db: Session = Depends(get_db)):
    """Р’РѕР·РІСЂР°С‰Р°РµС‚ С‚РµРєСѓС‰СѓСЋ СЃРјРµРЅСѓ Рё РґРµР¶СѓСЂРЅСѓСЋ Р±СЂРёРіР°РґСѓ РїРѕ РіСЂР°С„РёРєСѓ СЃРјРµРЅРЅРѕСЃС‚Рё СЃ СѓС‡РµС‚РѕРј С‡Р°СЃРѕРІРѕРіРѕ РїРѕСЏСЃР° Р·Р°РІРѕРґР° (UTC+5)."""
    try:
        from datetime import timezone
        tz_kz = timezone(timedelta(hours=5))
        now = datetime.now(tz_kz)
        
        target_date_str = date if date else now.strftime("%d.%m.%Y")
        
        # РћРїСЂРµРґРµР»РµРЅРёРµ РґРµРЅСЊ/РЅРѕС‡СЊ РїРѕ РІСЂРµРјРµРЅРё Р·Р°РІРѕРґР° (UTC+5):
        # Р”РµРЅСЊ: 08:00 - 19:00, РќРѕС‡СЊ: 19:00 - 08:00
        hour = now.hour
        is_day = 8 <= hour < 19
        shift_name = "Р”РµРЅСЊ" if is_day else "РќРѕС‡СЊ"
        
        entry = db.query(models.ShiftScheduleEntry).filter(models.ShiftScheduleEntry.date_str == target_date_str).first()
        if not entry:
            import google_sheets_integration
            google_sheets_integration.sync_schedule_from_google_sheets(db)
            entry = db.query(models.ShiftScheduleEntry).filter(models.ShiftScheduleEntry.date_str == target_date_str).first()
            
        current_shift_group = ""
        prev_shift_group = ""
        
        if entry:
            if is_day:
                # РўРµРєСѓС‰Р°СЏ СЃРјРµРЅР°: Р”РµРЅСЊ СЃРµРіРѕРґРЅСЏС€РЅРµР№ РґР°С‚С‹
                current_shift_group = entry.day_shift_group
                # РЎРґР°СЋС‰Р°СЏ СЃРјРµРЅР°: РќРѕС‡СЊ РїСЂРµРґС‹РґСѓС‰РµРіРѕ РґРЅСЏ!
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
                # РўРµРєСѓС‰Р°СЏ СЃРјРµРЅР°: РќРѕС‡СЊ СЃРµРіРѕРґРЅСЏС€РЅРµР№ РґР°С‚С‹
                current_shift_group = entry.night_shift_group
                # РЎРґР°СЋС‰Р°СЏ СЃРјРµРЅР°: Р”РµРЅСЊ СЃРµРіРѕРґРЅСЏС€РЅРµР№ РґР°С‚С‹
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
            "shift_name": "Р”РµРЅСЊ",
            "current_shift_group": "РЎРјРµРЅР° 1",
            "prev_shift_group": "РЎРјРµРЅР° 4"
        }

@router.get("/api/checklists/templates")
def get_checklist_templates():
    """Р’РѕР·РІСЂР°С‰Р°РµС‚ СЃС‚Р°РЅРґР°СЂС‚РЅС‹Рµ С€Р°Р±Р»РѕРЅС‹ С‡РµРє-Р»РёСЃС‚РѕРІ РєРѕРјРїР°РЅРёРё."""
    return [
        {
            "code": "master_shift",
            "title": "Р§РµРє-Р»РёСЃС‚ РјР°СЃС‚РµСЂР° СЃРјРµРЅС‹",
            "subtitle": "РџСЂРѕРІРµСЂРєР° СЃРѕСЃС‚РѕСЏРЅРёСЏ РѕР±РѕСЂСѓРґРѕРІР°РЅРёСЏ Рё СЂР°Р±РѕС‡РёС… РјРµСЃС‚ РїРµСЂРµРґ РЅР°С‡Р°Р»РѕРј СЃРјРµРЅС‹",
            "department": "Р¦РµС… РҐР¦Р",
            "has_submitter": True,
            "inspector_label": "РџСЂРёРЅРёРјР°СЋС‰РёР№ СЃРјРµРЅСѓ РјР°СЃС‚РµСЂ",
            "submitter_label": "РЎРґР°СЋС‰РёР№ СЃРјРµРЅСѓ РјР°СЃС‚РµСЂ",
            "items": [
                {"index": 1, "title": "РЎРѕСЃС‚РѕСЏРЅРёРµ РїСЂРѕРєР»Р°РґРѕРє", "desc": "Р¦РµР»РѕСЃС‚РЅРѕСЃС‚СЊ Рё РёР·РЅРѕСЃ РїСЂРѕРєР»Р°РґРѕС‡РЅРѕРіРѕ РјР°С‚РµСЂРёР°Р»Р°"},
                {"index": 2, "title": "РџРѕРґРєСЂСѓС‚РєР° РІСЃРµС… Р±РѕР»С‚РѕРІ Рё РіР°РµРє РЅР° РјР°С€РёРЅРµ", "desc": "РџСЂРѕРІРµСЂРєР° Р·Р°С‚СЏР¶РєРё РєР»СЋС‡РµРІС‹С… СѓР·Р»РѕРІ Рё РєСЂРµРїР»РµРЅРёР№"},
                {"index": 3, "title": "РџСЂРѕРІРµСЂРєР° СЃРѕСЃС‚РѕСЏРЅРёСЏ Р±Р°С…СЂРѕРјС‹", "desc": "РЎРѕСЃС‚РѕСЏРЅРёРµ Рё РѕС‡РёСЃС‚РєР° СЃСѓРєРЅР° / Р±Р°С…СЂРѕРјС‹"},
                {"index": 4, "title": "РќР°Р»РёС‡РёРµ РїРѕРґРґРѕРЅРѕРІ", "desc": "Р—Р°РїР°СЃ РґРµСЂРµРІСЏРЅРЅС‹С… РїРѕРґРґРѕРЅРѕРІ РЅР° Р»РёРЅРёРё Рё СѓС‡Р°СЃС‚РєР°С…"},
                {"index": 5, "title": "Р’СЃРµ Р»Рё СЂР°СЃС…РѕРґРЅРёРєРё РІ РґРѕСЃС‚Р°С‚РєРµ", "desc": "РќР°Р»РёС‡РёРµ СЃС‹СЂСЊСЏ, СЃРєРѕС‚С‡Р°, РјР°СЂРєРёСЂРѕРІРѕС‡РЅС‹С… РјР°С‚РµСЂРёР°Р»РѕРІ"},
                {"index": 6, "title": "РўР°Р±Р»РёС‡РєРё РљР’Рў СѓСЃС‚Р°РЅРѕРІР»РµРЅС‹ РїСЂР°РІРёР»СЊРЅРѕ", "desc": "РљРѕРЅС‚СЂРѕР»СЊ РІРёР·СѓР°Р»РёР·Р°С†РёРё Рё Р·РЅР°РєРѕРІ Р±РµР·РѕРїР°СЃРЅРѕСЃС‚Рё"},
                {"index": 7, "title": "РћС‚СЃСѓС‚СЃС‚РІРёРµ Р·Р°СЃРѕСЂРµРЅРёСЏ Рё Р·Р°Р±РёРІРєРё РјРµС…Р°РЅРёР·РјРѕРІ Рё РґРµС‚Р°Р»РµР№", "desc": "Р§РёСЃС‚РѕС‚Р° РЅР°РїСЂР°РІР»СЏСЋС‰РёС…, СЂРѕР»РёРєРѕРІ, РґР°С‚С‡РёРєРѕРІ"},
                {"index": 8, "title": "РџРѕСЂСЏРґРѕРє РЅР° СЂР°Р±РѕС‡РёС… РјРµСЃС‚Р°С…", "desc": "5S, РѕС‚СЃСѓС‚СЃС‚РІРёРµ РїРѕСЃС‚РѕСЂРѕРЅРЅРёС… РїСЂРµРґРјРµС‚РѕРІ Рё РјСѓСЃРѕСЂР°"},
                {"index": 9, "title": "Р“РѕС‚РѕРІС‹Рµ РїР°С‡РєРё РїСЂРѕРґСѓРєС†РёРё РІС‹РІРµР·РµРЅС‹ СЃРѕ СЃРєР»Р°РґР°/СѓС‡Р°СЃС‚РєР°", "desc": "РЎРІРѕРµРІСЂРµРјРµРЅРЅР°СЏ РїРµСЂРµРґР°С‡Р° РЅР° СЃРєР»Р°Рґ Р“Рџ"}
            ]
        },
        {
            "code": "worker_shift_handover",
            "title": "Р§РµРє-Р»РёСЃС‚ РїСЂРёРµРјР°-РїРµСЂРµРґР°С‡Рё СЃРјРµРЅС‹ (Р Р°Р±РѕС‡РёРµ)",
            "subtitle": "РђСѓС‹СЃС‹РјРґС‹ Т›Р°Р±С‹Р»РґР°Сѓ-С‚Р°РїСЃС‹СЂСѓ С‡РµРє-РїР°СЂР°Т“С‹ / РЎРѕСЃС‚РѕСЏРЅРёРµ СЂР°Р±РѕС‡РµРіРѕ РјРµСЃС‚Р°",
            "department": "РЎРјРµРЅРЅС‹Р№ СѓС‡Р°СЃС‚РѕРє",
            "has_submitter": True,
            "inspector_label": "РџСЂРёРЅРёРјР°СЋС‰РёР№ / ТљР°Р±С‹Р»РґР°СѓС€С‹",
            "submitter_label": "РЎРґР°СЋС‰РёР№ / РўР°РїСЃС‹СЂСѓС€С‹",
            "items": [
                {"index": 1, "title": "Р§РёСЃС‚РѕС‚Р° СЂР°Р±РѕС‡РµРіРѕ РјРµСЃС‚Р° / РўР°Р·Р°Р»С‹Т›", "desc": "РЈР±РѕСЂРєР° Р·РѕРЅС‹, РѕС‚СЃСѓС‚СЃС‚РІРёРµ С€Р»Р°РјР°, РіСЂСЏР·Рё Рё РѕС‚С…РѕРґРѕРІ"},
                {"index": 2, "title": "РЎРѕСЃС‚РѕСЏРЅРёРµ РёРЅРІРµРЅС‚Р°СЂСЏ / РњТЇРєУ™РјРјР°Р»", "desc": "РќР°Р»РёС‡РёРµ Рё РёСЃРїСЂР°РІРЅРѕСЃС‚СЊ Р»РѕРїР°С‚, С‰РµС‚РѕРє, РµРјРєРѕСЃС‚РµР№"},
                {"index": 3, "title": "РЎРѕСЃС‚РѕСЏРЅРёРµ РёРЅСЃС‚СЂСѓРјРµРЅС‚Р° / ТљТ±СЂР°Р»", "desc": "РљРѕРјРїР»РµРєС‚РЅРѕСЃС‚СЊ Рё РёСЃРїСЂР°РІРЅРѕСЃС‚СЊ СЂР°Р±РѕС‡РµРіРѕ РёРЅСЃС‚СЂСѓРјРµРЅС‚Р°"},
                {"index": 4, "title": "РћР±РѕСЂСѓРґРѕРІР°РЅРёРµ Рё РјРµС…Р°РЅРёР·РјС‹ / ТљРѕРЅРґС‹СЂТ“С‹Р»Р°СЂ", "desc": "РСЃРїСЂР°РІРЅРѕСЃС‚СЊ СѓР·Р»РѕРІ РЅР° РїРѕР·РёС†РёРё, РѕС‚СЃСѓС‚СЃС‚РІРёРµ С‚РµС‡РµР№ Рё С€СѓРјРѕРІ"},
                {"index": 5, "title": "РЎРР— Рё Р‘РµР·РѕРїР°СЃРЅРѕСЃС‚СЊ / ТљРѕСЂТ“Р°РЅС‹СЃ Т›Т±СЂР°Р»РґР°СЂС‹", "desc": "РџСЂРёРјРµРЅРµРЅРёРµ СЃРїРµС†РѕРґРµР¶РґС‹, РєР°СЃРѕРє, Р·Р°С‰РёС‚РЅС‹С… РѕС‡РєРѕРІ"}
            ]
        },
        {
            "code": "day_inspection",
            "title": "Р§РµРє-Р»РёСЃС‚ РґРЅРµРІРЅС‹С… СЃРѕС‚СЂСѓРґРЅРёРєРѕРІ Рё РёРЅСЃРїРµРєС†РёР№",
            "subtitle": "РўРµРєСЃРµСЂСѓ С‡РµРє-РїР°СЂР°Т“С‹ / Р•Р¶РµРґРЅРµРІРЅС‹Р№ РєРѕРЅС‚СЂРѕР»СЊ СѓС‡Р°СЃС‚РєР°",
            "department": "РРўР  / Р”РЅРµРІРЅС‹Рµ СЃР»СѓР¶Р±С‹",
            "has_submitter": True,
            "inspector_label": "РџСЂРѕРІРµСЂСЏСЋС‰РёР№ / РўРµРєСЃРµСЂСѓС€С–",
            "submitter_label": "РћС‚РІРµС‚СЃС‚РІРµРЅРЅС‹Р№ СЃРґР°СЋС‰РёР№ / РўР°РїСЃС‹СЂСѓС€С‹",
            "items": [
                {"index": 1, "title": "Р§РёСЃС‚РѕС‚Р° Рё РїРѕСЂСЏРґРѕРє РІ С†РµС…Рµ / РўР°Р·Р°Р»С‹Т›", "desc": "РћС‚СЃСѓС‚СЃС‚РІРёРµ Р·Р°С…Р»Р°РјР»РµРЅРёСЏ РїСЂРѕС…РѕРґРѕРІ Рё Р·РѕРЅ РѕР±СЃР»СѓР¶РёРІР°РЅРёСЏ"},
                {"index": 2, "title": "РЎРѕСЃС‚РѕСЏРЅРёРµ РёРЅРІРµРЅС‚Р°СЂСЏ Рё РѕР±РѕСЂСѓРґРѕРІР°РЅРёСЏ / РњТЇРєУ™РјРјР°Р»", "desc": "РўРµС…РЅРёС‡РµСЃРєРѕРµ СЃРѕСЃС‚РѕСЏРЅРёРµ Р·Р°РєСЂРµРїР»РµРЅРЅС‹С… Р°РіСЂРµРіР°С‚РѕРІ"},
                {"index": 3, "title": "РСЃРїСЂР°РІРЅРѕСЃС‚СЊ РёРЅСЃС‚СЂСѓРјРµРЅС‚Р° / ТљТ±СЂР°Р»", "desc": "РџСЂР°РІРёР»СЊРЅРѕРµ С…СЂР°РЅРµРЅРёРµ Рё Р±РµР·РѕРїР°СЃРЅРѕСЃС‚СЊ РёСЃРїРѕР»СЊР·РѕРІР°РЅРёСЏ"},
                {"index": 4, "title": "РћС…СЂР°РЅР° С‚СЂСѓРґР° Рё РїСЂРѕРјР±РµР·РѕРїР°СЃРЅРѕСЃС‚СЊ", "desc": "РЎРѕР±Р»СЋРґРµРЅРёРµ СЂРµРіР»Р°РјРµРЅС‚РѕРІ Рё РёРЅСЃС‚СЂСѓРєС†РёР№ РїРµСЂСЃРѕРЅР°Р»РѕРј"}
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

@router.post("/api/checklists/submit")
def submit_checklist(data: ChecklistSubmissionCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """РЎРѕС…СЂР°РЅСЏРµС‚ Р·Р°РїРѕР»РЅРµРЅРЅС‹Р№ С‡РµРє-Р»РёСЃС‚ Рё Р·Р°РїСѓСЃРєР°РµС‚ СЃРёРЅС…СЂРѕРЅРёР·Р°С†РёСЋ СЃ Google Sheets."""
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
        
        # Р—Р°РїСѓСЃРєР°РµРј СЌРєСЃРїРѕСЂС‚ РІ Google Sheets РІ С„РѕРЅРѕРІРѕРј СЂРµР¶РёРјРµ С‡РµСЂРµР· РЅРµР·Р°РІРёСЃРёРјСѓСЋ СЃРµСЃСЃРёСЋ
        try:
            background_tasks.add_task(sync_checklists_google_bg)
        except Exception as e:
            print(f"Error scheduling Google Sheets export for checklist: {e}")
            
        return {
            "status": "ok",
            "id": sub.id,
            "remarks_count": remarks_count,
            "message": "Р§РµРє-Р»РёСЃС‚ СѓСЃРїРµС€РЅРѕ СЃРѕС…СЂР°РЅРµРЅ Рё РїРµСЂРµРґР°РЅ РІ Google РўР°Р±Р»РёС†Сѓ"
        }
    except Exception as e:
        db.rollback()
        print(f"Error submitting checklist: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/checklists/submissions")
def get_checklist_submissions(
    date: Optional[str] = None,
    template_code: Optional[str] = None,
    shift_group: Optional[str] = None,
    limit: int = 50,
    db: Session = Depends(get_db)
):
    """Р’РѕР·РІСЂР°С‰Р°РµС‚ РёСЃС‚РѕСЂРёСЋ Р·Р°РїРѕР»РЅРµРЅРЅС‹С… С‡РµРє-Р»РёСЃС‚РѕРІ СЃ С„РёР»СЊС‚СЂР°РјРё."""
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

@router.post("/api/checklists/sync_google")
def manual_sync_checklists_google(db: Session = Depends(get_db)):
    """РџСЂРёРЅСѓРґРёС‚РµР»СЊРЅС‹Р№ СЌРєСЃРїРѕСЂС‚ РІСЃРµС… С‡РµРє-Р»РёСЃС‚РѕРІ РІ Google РўР°Р±Р»РёС†Сѓ."""
    try:
        import google_sheets_integration
        google_sheets_integration.export_checklists_to_google_sheets(db)
        return {"status": "ok", "message": "РЎРёРЅС…СЂРѕРЅРёР·Р°С†РёСЏ С‡РµРє-Р»РёСЃС‚РѕРІ СЃ Google РўР°Р±Р»РёС†РµР№ РІС‹РїРѕР»РЅРµРЅР°"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
