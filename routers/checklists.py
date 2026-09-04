import os
import json
from datetime import datetime, date, timedelta, timezone
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

@router.get("/api/checklists/employees")
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

@router.post("/api/checklists/employees")
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

@router.put("/api/checklists/employees/{emp_id}")
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

@router.delete("/api/checklists/employees/{emp_id}")
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

@router.get("/api/checklists/schedule/all")
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
@router.post("/api/checklists/schedule/update_day")
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

@router.get("/api/checklists/schedule/today")
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

@router.get("/api/checklists/templates")
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

@router.post("/api/checklists/submit")
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

@router.get("/api/checklists/submissions")
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

@router.post("/api/checklists/sync_google")
def manual_sync_checklists_google(db: Session = Depends(get_db)):
    """Принудительный экспорт всех чек-листов в Google Таблицу."""
    try:
        import google_sheets_integration
        google_sheets_integration.export_checklists_to_google_sheets(db)
        return {"status": "ok", "message": "Синхронизация чек-листов с Google Таблицей выполнена"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))