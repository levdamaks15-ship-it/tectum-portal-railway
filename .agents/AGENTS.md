## Proactive Slash Command Suggestions

When interacting with the user, ALWAYS proactively suggest the use of slash commands if the context fits. Do not wait for the user to ask about them. 

- **`/goal`**: If the user requests a large, multi-step refactoring, bulk data processing, or a complex setup, explicitly suggest using `/goal` so you can complete it autonomously.
- **`/grill-me`**: If the user is unsure about a design decision or architecture, explicitly suggest using `/grill-me` to have an interactive interview to figure it out.
- **`/learn`**: If you and the user successfully solve a tricky edge-case, custom logic, or setup issue, explicitly suggest using `/learn` to persist this behavior as a skill/rule for the future.
- **`/schedule`**: If a task requires waiting, polling, or running on a timer, suggest using `/schedule`.

## Production Plan Rules
When making changes to the monthly production plan logic or generating plans (e.g. `distribute_plan.py`), ALWAYS use the fixed factory standard norms: Normal day = 2700, Night = 3300, Sanitary day (Monday Day) = 0. Do not calculate proportionally from a monthly target.

**Reporting Architecture**: The plan is static and primary. Reports (daily graphs, weekly tables) MUST always generate the full grid of expected shifts (e.g., 14 shifts for a week) with the static plan numbers, regardless of whether factual data exists for those days. Fact data should be overlaid onto this static plan grid.

**Sanitary Day Facts**: While the plan for a Sanitary Day (Monday Day) is 0, if actual production occurs, it MUST be fully recorded as fact, resulting in an over-fulfillment against the 0 plan.

## Language Rules
ALWAYS write and update planning artifacts, such as `implementation_plan.md` and `walkthrough.md`, in Russian.

## Portal Data Architecture and Edit Rules
При работе с сущностями портала Tectum строго придерживайтесь следующих правил редактирования и аудита:
- **Разрешено редактирование (CRUD)** для сущностей: Пользователи/Мастера (`models.Master`), Нормативы расхода (`models.ProductNorm`), Простои (`models.Downtime`). Все изменения должны проходить через соответствующие `PUT` методы.
- **План-факт доска (MonthlyPlanBoard)** обновляется через механизм Upsert (метод `POST /api/plan_board`). Все изменения (CREATE, UPDATE, DELETE) в ней должны обязательно логироваться в таблицу `AuditLog` с подробным описанием старых и новых значений.
- **Редактирование закрытых смен и производственных данных**: Администраторы системы (пользователи с ролью `admin`, включая `admin@TectumEngineering.onmicrosoft.com`) имеют права на полное редактирование (UPDATE) и удаление (DELETE) смен, отчетов ЛФМ, партий и простоев (даже если смена закрыта). Все такие изменения должны обязательно логироваться в таблицу `AuditLog` с детальным сравнением старых и новых значений полей.

## Azure Cloud and SSO Rules
При разработке и сопровождении портала учитывайте следующие правила облачной архитектуры:
- **База данных PostgreSQL:** Продакшн-окружение использует базу данных Azure Database for PostgreSQL. Локальный файл SQLite (`tectum.db`) используется только в тестовых целях.
- **Загрузка переменных окружения:** В конфигурационных файлах (таких как `database.py`) вызов `load_dotenv()` обязателен, чтобы переменная `DATABASE_URL` корректно считывалась локально из файла `.env`.
- **Интеграция с Microsoft 365 SSO:** 
  - Авторизация пользователей сопоставляется с базой данных на основе корпоративного email (`Master.email`).
  - Если email привязан к сотруднику в БД, при входе через SSO он автоматически заходит под своим профилем.
  - Управление email-адресами сотрудников должно быть доступно через админ-панель (`/admin`).
- **CI/CD в Azure App Service:** Деплой выполняется автоматически при пуше в `main` через GitHub Actions. Для авторизации используется секрет `AZURE_WEBAPP_PUBLISH_PROFILE` (содержимое XML-профиля публикации). В настройках Web App в Azure (Configuration -> General settings) обязательно должны быть включены параметры «SCM Basic Auth Publishing Credentials», иначе выгрузка завершится ошибкой. В репозитории должен быть только один рабочий workflow-файл деплоя (`main_tectum-portal.yml`), во избежание конфликтов блокировки файлов.


