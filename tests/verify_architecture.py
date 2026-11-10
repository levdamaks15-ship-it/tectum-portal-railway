"""
tests/test_architecture.py — Автономный сквозной тест архитектуры Tectum Portal.
Проверяет:
1. Все 10 канонических редиректов (302) к изолированным путям /p/shymkent/w/{workshop}/{module}.
2. Корректность отдачи Jinja2 SSR шаблонов для всех 8 кабинетов (200 OK).
3. Аппаратный барьер безопасности панели администратора (403 Forbidden).
"""

import os
import sys

# Настройка UTF-8 вывода для консоли Windows
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

# Добавляем корень проекта в путь поиска модулей
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT_DIR)

from fastapi.testclient import TestClient
from database import SessionLocal
import models
from main import app
import uuid
from datetime import datetime, timezone, timedelta

client = TestClient(app, follow_redirects=False)
db = SessionLocal()

print("=" * 65)
print("  ТЕКТУМ ПОРТАЛ — СКВОЗНОЙ АВТОТЕСТ АРХИТЕКТУРЫ И КАБИНЕТОВ")
print("=" * 65)

test_results = []

def record(name: str, passed: bool, details: str = ""):
    test_results.append((name, passed, details))
    icon = "[OK]" if passed else "[FAIL]"
    print(f"  {icon} {name:<42} : {details}")

try:
    # 1. Подготовка тестовых сессий
    now = datetime.now(timezone.utc)
    expires = now + timedelta(days=7)

    # Администратор (Левда М.)
    admin_user = db.query(models.User).filter(models.User.name == "Левда М.").first()
    if not admin_user:
        admin_user = models.User(name="Левда М.", is_active=True)
        db.add(admin_user)
        db.commit()
        db.refresh(admin_user)

    admin_token = str(uuid.uuid4())
    session_admin = models.UserSession(
        id=admin_token,
        user_id=admin_user.id,
        created_at=now,
        expires_at=expires
    )
    db.add(session_admin)

    # Обычный сотрудник (без прав администратора)
    regular_user = db.query(models.User).filter(models.User.name != "Левда М.").first()
    if not regular_user:
        regular_user = models.User(name="Тестовый Оператор", is_active=True)
        db.add(regular_user)
        db.commit()
        db.refresh(regular_user)

    regular_token = str(uuid.uuid4())
    session_reg = models.UserSession(
        id=regular_token,
        user_id=regular_user.id,
        created_at=now,
        expires_at=expires
    )
    db.add(session_reg)
    db.commit()

    admin_cookies = {"__Host-tectum_session": admin_token}
    reg_cookies = {"__Host-tectum_session": regular_token}

    # ========================================================
    # БЛОК 1: Канонические редиректы 302
    # ========================================================
    print("\n--- [Блок 1: Канонические редиректы верхнего уровня] ---")
    redirects_to_test = [
        ("/admin", "/p/shymkent/w/xci/admin"),
        ("/tasks", "/p/shymkent/w/xci/tasks"),
        ("/planner", "/p/shymkent/w/xci/tasks"),
        ("/docs", "/p/shymkent/w/all/docs"),
        ("/knowledge", "/p/shymkent/w/all/docs"),
        ("/base", "/p/shymkent/w/all/docs"),
        ("/checklists", "/p/shymkent/w/xci/checklists"),
        ("/qcd", "/p/shymkent/w/skk/shifts"),
        ("/lkc", "/p/shymkent/w/lkc/shifts"),
        ("/analytics", "/p/shymkent/w/xci/technologist")
    ]
    for url, expected_loc in redirects_to_test:
        r = client.get(url)
        passed = (r.status_code == 302 and r.headers.get("location") == expected_loc)
        record(f"Редирект {url}", passed, f"{r.status_code} -> {r.headers.get('location')}")

    # ========================================================
    # БЛОК 2: Доставка и рендеринг 8 модулей (200 OK)
    # ========================================================
    print("\n--- [Блок 2: Рендеринг и изоляция всех 8 кабинетов] ---")
    
    # 1. Смены (ХЦИ, АГБ, СТМО)
    for ws in ["xci", "agb", "stmo"]:
        r = client.get(f"/p/shymkent/w/{ws}/shifts", cookies=reg_cookies)
        passed = (r.status_code == 200 and "shifts.css" in r.text and "tab-btn-production" in r.text)
        record(f"Кабинет смен ({ws.upper()})", passed, f"HTTP {r.status_code}")

    # 2. ЛКЦ (Раскрой и верстак)
    r = client.get("/p/shymkent/w/lkc/lkc", cookies=reg_cookies)
    passed = (r.status_code == 200 and "lkc.css" in r.text and "lkc.js" in r.text)
    record("Кабинет ЛКЦ (Прямой)", passed, f"HTTP {r.status_code}")

    r = client.get("/p/shymkent/w/lkc/shifts", cookies=reg_cookies)
    passed = (r.status_code == 200 and "lkc.css" in r.text)
    record("Кабинет ЛКЦ (Маршрут /shifts)", passed, f"HTTP {r.status_code}")

    # 3. СКК / ОТК (Разбраковка и акты)
    r = client.get("/p/shymkent/w/skk/qcd", cookies=reg_cookies)
    passed = (r.status_code == 200 and "qcd.css" in r.text)
    record("Кабинет СКК/ОТК (Прямой)", passed, f"HTTP {r.status_code}")

    r = client.get("/p/shymkent/w/skk/shifts", cookies=reg_cookies)
    passed = (r.status_code == 200 and "qcd.css" in r.text)
    record("Кабинет СКК/ОТК (Маршрут /shifts)", passed, f"HTTP {r.status_code}")

    # 4. Планнер задач
    r = client.get("/p/shymkent/w/xci/tasks", cookies=reg_cookies)
    passed = (r.status_code == 200 and ("tasks.css" in r.text or "planner.css" in r.text) and "tab-horizon-weekly" in r.text)
    record("Кабинет задач (Tasks)", passed, f"HTTP {r.status_code}")

    # 5. База знаний
    r = client.get("/p/shymkent/w/all/docs", cookies=reg_cookies)
    passed = (r.status_code == 200 and ("docs.css" in r.text or "docs-sidebar" in r.text))
    record("Кабинет Базы знаний (Docs)", passed, f"HTTP {r.status_code}")

    # 6. Чек-листы
    r = client.get("/p/shymkent/w/xci/checklists", cookies=reg_cookies)
    passed = (r.status_code == 200 and "checklists.css" in r.text and "checklists.js" in r.text)
    record("Кабинет Чек-листов", passed, f"HTTP {r.status_code}")

    # 7. Аналитика
    r = client.get("/p/shymkent/w/all/analytics", cookies=reg_cookies)
    passed = (r.status_code == 200 and "analytics.css" in r.text and "analytics.js" in r.text)
    record("Кабинет Аналитики", passed, f"HTTP {r.status_code}")

    # ========================================================
    # БЛОК 3: Безопасность и ролевой шлюз админки
    # ========================================================
    print("\n--- [Блок 3: Аппаратная безопасность Панели Администратора] ---")
    # Доступ под администратором
    r = client.get("/p/shymkent/w/all/admin", cookies=admin_cookies)
    passed = (r.status_code == 200 and "admin.css" in r.text and "id=\"admin-app\"" in r.text)
    record("Админка (Авторизован админ)", passed, f"HTTP {r.status_code} (Разрешено)")

    # Запрет доступа под обычным сотрудником
    r = client.get("/p/shymkent/w/all/admin", cookies=reg_cookies)
    passed = (r.status_code == 403)
    record("Админка (Отказ не-админу)", passed, f"HTTP {r.status_code} (Строгий 403 Forbidden)")

    # Редирект неавторизованного
    r = client.get("/p/shymkent/w/all/admin")
    passed = (r.status_code == 302 and "unauthorized=true" in r.headers.get("location", ""))
    record("Админка (Редирект гостя)", passed, f"HTTP {r.status_code} -> {r.headers.get('location')}")

finally:
    # Очистка тестовых сессий в БД
    try:
        db.query(models.UserSession).filter(models.UserSession.id.in_([admin_token, regular_token])).delete()
        db.commit()
    except Exception:
        pass
    db.close()

# ========================================================
# Итог проверки
# ========================================================
print("\n" + "=" * 65)
total = len(test_results)
passed_count = sum(1 for _, p, _ in test_results if p)
all_passed = (passed_count == total)

if all_passed:
    print(f"  ИТОГ: ВСЕ {passed_count}/{total} ТЕСТОВ ПРОЙДЕНЫ УСПЕШНО (100% PASS RATE)!")
    print("  АРХИТЕКТУРА ГОТОВА К ДЕПЛОЮ И МУЛЬТИ-АГЕНТНОЙ РАБОТЕ.")
else:
    print(f"  ИТОГ: ПРОВАЛЕНО {total - passed_count} ИЗ {total} ТЕСТОВ. ТРЕБУЕТСЯ ВНИМАНИЕ!")
    sys.exit(1)
print("=" * 65)
