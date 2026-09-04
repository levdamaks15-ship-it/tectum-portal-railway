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

@router.get("/api/planner/employees")
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

@router.post("/api/planner/employees/verify_pin")
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

@router.post("/api/planner/employees")
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

@router.put("/api/planner/employees/{emp_id}")
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

@router.delete("/api/planner/employees/{emp_id}")
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


@router.get("/api/planner/zones")
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

@router.post("/api/planner/zones")
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

@router.put("/api/planner/zones/{zone_id}")
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

@router.delete("/api/planner/zones/{zone_id}")
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

@router.post("/api/planner/test_email")
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

@router.get("/api/tasks/weeks")
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

@router.get("/api/tasks/tags")
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

@router.get("/api/tasks/roadmaps")
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

@router.get("/api/documents/{doc_id}/tasks")
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

@router.get("/api/tasks")
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

@router.post("/api/tasks/upload_photo")
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

@router.get("/api/tasks/{task_id}")
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

@router.get("/api/tasks/{task_id}/history")
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

@router.post("/api/tasks")
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

@router.post("/api/tasks/bulk")
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

@router.post("/api/tasks/bulk_status")
def update_tasks_bulk_status(payload: schemas.BulkTaskStatusUpdate, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Массовое обновление статусов пачки задач (для служб ОГЭ / ОГМ) в одной транзакции."""
    try:
        task_ids = payload.task_ids or []
        if not task_ids:
            raise HTTPException(status_code=400, detail="Список задач пуст")

        tasks = db.query(models.Task).filter(models.Task.id.in_(task_ids)).all()
        if not tasks:
            raise HTTPException(status_code=404, detail="Задачи не найдены")

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
            elif new_status == "🟢 Выполнено" and not task.comment:
                task.comment = "Выполнено"

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

        # Единая запись в AuditLog
        user_label = tasks[0].assignee_name or tasks[0].author_name or "Планнер"
        action_desc = f"Массовое изменение статуса на «{new_status}» для {len(tasks)} задач ({', '.join(updated_codes[:8])}{'...' if len(updated_codes) > 8 else ''})"
        if move_next and next_week:
            action_desc += f", перенесены на {next_week}"

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

@router.delete("/api/tasks/{task_id}")
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
@router.post("/api/tasks/{task_id}/move_next_week")
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

@router.post("/api/tasks/archive_week")
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

@router.post("/api/tasks/{task_id}/restore")
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

@router.post("/api/tasks/translate")
def translate_task_text(payload: dict = Body(...)):
    """Интеллектуальный двусторонний анализ и перевод RU <-> KZ."""
    text = payload.get("text", "") if isinstance(payload, dict) else str(payload)
    source_lang = payload.get("source_lang", "auto") if isinstance(payload, dict) else "auto"
    return detect_and_translate_task_text(text, forced_source=source_lang if source_lang != "auto" else None)

@router.post("/api/tasks/import_from_google_sheets")
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