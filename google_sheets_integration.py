import os
import json
from google.oauth2 import service_account
from googleapiclient.discovery import build
from sqlalchemy.orm import Session
import models
from dotenv import load_dotenv

load_dotenv()

SPREADSHEET_ID = os.getenv("GOOGLE_SPREADSHEET_ID")
CREDENTIALS_PATH = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "google_credentials.json")

def get_sheets_service():
    # 1. Сначала пробуем загрузить из переменной окружения (для Railway/Render)
    creds_json = os.getenv("GOOGLE_CREDENTIALS_JSON")
    if creds_json:
        try:
            info = json.loads(creds_json)
            if "private_key" in info:
                info["private_key"] = info["private_key"].replace("\\n", "\n")
            creds = service_account.Credentials.from_service_account_info(
                info,
                scopes=["https://www.googleapis.com/auth/spreadsheets"]
            )
            return build("sheets", "v4", credentials=creds)
        except Exception as env_err:
            print(f"Ошибка парсинга GOOGLE_CREDENTIALS_JSON из переменных окружения: {env_err}")

    # 2. Если переменной нет, считываем локальный файл
    if not os.path.exists(CREDENTIALS_PATH):
        raise FileNotFoundError(f"Файл ключа Google не найден по пути: {CREDENTIALS_PATH}")
    
    with open(CREDENTIALS_PATH, "r", encoding="utf-8") as f:
        info = json.load(f)
    
    if "private_key" in info:
        info["private_key"] = info["private_key"].replace("\\n", "\n")
        
    creds = service_account.Credentials.from_service_account_info(
        info,
        scopes=["https://www.googleapis.com/auth/spreadsheets"]
    )
    return build("sheets", "v4", credentials=creds)

def get_product_finished_weight_kg(db: Session, product_name: str) -> float:
    norm = db.query(models.ProductNorm).filter(models.ProductNorm.product_name == product_name).first()
    if not norm or not norm.weight_kg:
        return 19.6
    return norm.weight_kg

def get_pct_deviation(fact_val: float, theo_val: float) -> float:
    if theo_val <= 0:
        if fact_val == 0:
            return 0.0
        return 100.0
    return ((fact_val - theo_val) / theo_val) * 100.0

def sync_report_to_google_sheets(db: Session):
    """
    Генерирует сводную таблицу рапортов смен аналогично Excel-отчету
    и выгружает ее в Google Таблицу по SPREADSHEET_ID с точным воссозданием форматирования.
    """
    if not SPREADSHEET_ID or SPREADSHEET_ID.startswith("1_mock"):
        print("Синхронизация с Google Таблицами пропущена: не задан реальный GOOGLE_SPREADSHEET_ID в .env")
        return
    
    service = get_sheets_service()
    
    # 1. Извлекаем данные из БД (все смены без фильтра по статусу "closed")
    shifts = db.query(models.Shift).order_by(models.Shift.date.asc(), models.Shift.line.asc(), models.Shift.shift_name.asc(), models.Shift.batch_number.asc(), models.Shift.id.asc()).all()
    
    # Записываем отладочный лог в AuditLog
    db.add(models.AuditLog(
        user_name="System Debug Sheets",
        action="INFO",
        target_table="shifts",
        target_id=0,
        details=f"Синхронизация Google Sheets: найдено {len(shifts)} смен в базе данных."
    ))
    db.commit()
    
    headers = [
        "Дата", "№ партии", "Линия", "Смена", "Мастер", "Наименование продукта",
        "Количество замесов", "Формовка (листы)", "Формовка (тонны)",
        "Кондиция (на склад)", "1-сорт", "Брак", "Сбросы наката",
        "Слив асб. (кг)", "Слив цем. (кг)",
        "Расход Хризотила 4-20 (кг)", "Расход Хризотила 5-65 (кг)", "Расход Хризотила 6-40 (кг)", "Расход Хризотила общ. (кг)",
        "Расход Цемента С1 (кг)", "Расход Цемента С2 (кг)", "Расход Цемента С3 (кг)", "Расход Цемента С4 (кг)", "Расход Цемента общ. (кг)",
        "Расход Асбокартона (кг)", "Расход Лапрола (кг)", "Расход Целлюлозы (кг)", "Расход Стекловолокна (кг)",
        "Расход Дробленого шифера (кг)", "Расход Асбозурита (кг)",
        "Отклонение Хризотила 4-20 (%)", "Отклонение Хризотила 5-65 (%)", "Отклонение Хризотила 6-40 (%)", "Отклонение Хризотила общ. (%)",
        "Отклонение Цемента общ. (%)", "Отклонение Асбокартона (%)", "Отклонение Лапрола (%)", "Отклонение Целлюлозы (%)",
        "Отклонение Стекловолокна (%)", "Отклонение Дробленого шифера (%)", "Отклонение Асбозурита (%)"
    ]
    
    # Создаем массив строк для Google Sheets
    rows_data = []
    
    # Записываем шапку
    rows_data.append(headers)
    
    for s in shifts:
        # Проверяем, есть ли плановые или фактические показатели производства в смене
        plan_sheets_check = s.plan_sheets or 0
        formovka_sheets_check = sum(r.lfm_sheets for r in s.lfm_reports)
        warehouse_gp_check = sum(b.qcd_condition for b in s.batches)
        zo_batches_check = s.zo_batches or 0
        
        if plan_sheets_check == 0 and formovka_sheets_check == 0 and warehouse_gp_check == 0 and zo_batches_check == 0 and not s.zo_submitted:
            continue
            
        date_str = s.date.strftime("%d.%m.%Y") if s.date else ""
        batch_numbers = ", ".join(b.batch_number for b in s.batches if b.batch_number)
        product_names = ", ".join(set(r.product_name for r in s.lfm_reports if r.product_name))
        formovka_sheets = formovka_sheets_check
        formovka_tons = sum(r.lfm_sheets * get_product_finished_weight_kg(db, r.product_name) for r in s.lfm_reports) / 1000.0
        
        qcd_condition = warehouse_gp_check
        qcd_first = sum(b.qcd_first_grade for b in s.batches)
        qcd_defect = sum(b.qcd_defect for b in s.batches)
        wind_resets = sum(r.lfm_wind_resets for r in s.lfm_reports)
        
        theory = {
            "chrysotile_4_20": 0.0, "chrysotile_5_65": 0.0, "chrysotile_6_40": 0.0,
            "cement": 0.0, "cellulose": 0.0, "crushed_slate": 0.0,
            "asbozurit": 0.0, "fiberglass": 0.0
        }
        for r in s.lfm_reports:
            norm = db.query(models.ProductNorm).filter(models.ProductNorm.product_name == r.product_name).first()
            if norm:
                theory["chrysotile_4_20"] += r.lfm_sheets * (norm.norm_chrysotile_4_20 or 0.0)
                theory["chrysotile_5_65"] += r.lfm_sheets * (norm.norm_chrysotile_5_65 or 0.0)
                theory["chrysotile_6_40"] += r.lfm_sheets * (norm.norm_chrysotile_6_40 or 0.0)
                theory["cement"] += r.lfm_sheets * (norm.norm_cement or 0.0)
                theory["cellulose"] += r.lfm_sheets * (norm.norm_cellulose or 0.0)
                theory["crushed_slate"] += r.lfm_sheets * (norm.norm_crushed_slate or 0.0)
                theory["asbozurit"] += r.lfm_sheets * (norm.norm_asbozurit or 0.0)
                theory["fiberglass"] += r.lfm_sheets * (norm.norm_fiberglass or 0.0)
                
        fact = {
            "chrysotile_4_20": s.zo_chrysotile_4_20 or 0.0,
            "chrysotile_5_65": s.zo_chrysotile_5_65 or 0.0,
            "chrysotile_6_40": s.zo_chrysotile_6_40 or 0.0,
            "cement_silo1": s.zo_cement_silo1 or 0.0,
            "cement_silo2": s.zo_cement_silo2 or 0.0,
            "cement_silo3": s.zo_cement_silo3 or 0.0,
            "cement_silo4": s.zo_cement_silo4 or 0.0,
            "asbocarton": s.zo_asbocarton or 0.0,
            "laprol": s.zo_laprol or 0.0,
            "cellulose": s.zo_cellulose or 0.0,
            "fiberglass": s.zo_fiberglass or 0.0,
            "crushed_slate": s.zo_crushed_slate or 0.0,
            "asbozurit": s.zo_asbozurit or 0.0,
        }
        
        total_fact_asbestos = fact["chrysotile_4_20"] + fact["chrysotile_5_65"] + fact["chrysotile_6_40"]
        total_theo_asbestos = theory["chrysotile_4_20"] + theory["chrysotile_5_65"] + theory["chrysotile_6_40"]
        total_fact_cement = fact["cement_silo1"] + fact["cement_silo2"] + fact["cement_silo3"] + fact["cement_silo4"]
        theory_cement = theory["cement"]
        
        row_data = [
            date_str,
            batch_numbers,
            s.line or "",
            s.shift_name or "",
            s.master.name if s.master else "",
            product_names,
            s.zo_batches or 0,
            formovka_sheets,
            round(formovka_tons, 3),
            qcd_condition,
            qcd_first,
            qcd_defect,
            wind_resets,
            s.zo_asb_drain or 0.0,
            s.zo_cem_drain or 0.0,
            fact["chrysotile_4_20"],
            fact["chrysotile_5_65"],
            fact["chrysotile_6_40"],
            total_fact_asbestos,
            fact["cement_silo1"],
            fact["cement_silo2"],
            fact["cement_silo3"],
            fact["cement_silo4"],
            total_fact_cement,
            fact["asbocarton"],
            fact["laprol"],
            fact["cellulose"],
            fact["fiberglass"],
            fact["crushed_slate"],
            fact["asbozurit"],
            # Deviations (in %!)
            get_pct_deviation(fact["chrysotile_4_20"], theory["chrysotile_4_20"]) / 100.0,
            get_pct_deviation(fact["chrysotile_5_65"], theory["chrysotile_5_65"]) / 100.0,
            get_pct_deviation(fact["chrysotile_6_40"], theory["chrysotile_6_40"]) / 100.0,
            get_pct_deviation(total_fact_asbestos, total_theo_asbestos) / 100.0,
            get_pct_deviation(total_fact_cement, theory_cement) / 100.0,
            get_pct_deviation(fact["asbocarton"], 0.0) / 100.0, # no theory for carton/laprol
            get_pct_deviation(fact["laprol"], 0.0) / 100.0,
            get_pct_deviation(fact["cellulose"], theory["cellulose"]) / 100.0,
            get_pct_deviation(fact["fiberglass"], theory["fiberglass"]) / 100.0,
            get_pct_deviation(fact["crushed_slate"], theory["crushed_slate"]) / 100.0,
            get_pct_deviation(fact["asbozurit"], theory["asbozurit"]) / 100.0
        ]
        rows_data.append(row_data)

    # 2. Выгружаем данные на лист "Сводный отчет"
    sheet_name = "Сводный отчет"
    
    # Проверим, существует ли лист, если нет - создадим
    spreadsheet = service.spreadsheets().get(spreadsheetId=SPREADSHEET_ID).execute()
    sheets_titles = [sh["properties"]["title"] for sh in spreadsheet["sheets"]]
    
    if sheet_name not in sheets_titles:
        body = {
            "requests": [{
                "addSheet": {
                    "properties": {
                        "title": sheet_name,
                        "gridProperties": {
                            "rowCount": 1000,
                            "columnCount": 45
                        }
                    }
                }
            }]
        }
        service.spreadsheets().batchUpdate(spreadsheetId=SPREADSHEET_ID, body=body).execute()
        # Обновим информацию о листах
        spreadsheet = service.spreadsheets().get(spreadsheetId=SPREADSHEET_ID).execute()
        
    sheet_id = next(sh["properties"]["sheetId"] for sh in spreadsheet["sheets"] if sh["properties"]["title"] == sheet_name)
    
    # 1. Получаем текущие данные на листе, чтобы узнать, какие строки уже есть
    result = service.spreadsheets().values().get(
        spreadsheetId=SPREADSHEET_ID,
        range=f"'{sheet_name}'!A1:AO1000"
    ).execute()
    existing_rows = result.get("values", [])
    
    # 2. Инициализируем или находим индексы строк для обновления
    # Ключ: (Дата, Линия, Смена)
    row_mapping = {}
    if len(existing_rows) > 1:
        for idx, row in enumerate(existing_rows[1:], start=2): # 1-based index, row 1 is header
            if len(row) >= 4:
                key = (row[0], row[2], row[3]) # (Дата, Линия, Смена)
                row_mapping[key] = idx
                
    # Записываем шапку, если лист вообще пустой
    if not existing_rows:
        service.spreadsheets().values().update(
            spreadsheetId=SPREADSHEET_ID,
            range=f"'{sheet_name}'!A1",
            valueInputOption="USER_ENTERED",
            body={"values": [headers]}
        ).execute()
        existing_rows = [headers]

    # Вместо clear() делаем жесткую перезапись диапазона A2:AO1000 пустыми значениями
    # Это решает проблему Умной Таблицы, не сдвигая строки вниз
    empty_block = [["" for _ in range(len(headers))] for _ in range(999)]
    service.spreadsheets().values().update(
        spreadsheetId=SPREADSHEET_ID,
        range=f"'{sheet_name}'!A2:AO1000",
        valueInputOption="USER_ENTERED",
        body={"values": empty_block}
    ).execute()
    
    row_mapping = {}
    
    # Очищаем старые правила условного форматирования для этого листа
    sheet_meta = next(sh for sh in spreadsheet["sheets"] if sh["properties"]["title"] == sheet_name)
    existing_rules = sheet_meta.get("conditionalFormats", [])
    if existing_rules:
        clear_requests = []
        for idx in range(len(existing_rules) - 1, -1, -1):
            clear_requests.append({
                "deleteConditionalFormatRule": {
                    "sheetId": sheet_id,
                    "index": idx
                }
            })
        service.spreadsheets().batchUpdate(spreadsheetId=SPREADSHEET_ID, body={"requests": clear_requests}).execute()
        
    # Записываем все строки данных разом, начиная с ячейки A2
    if len(rows_data) > 1:
        service.spreadsheets().values().update(
            spreadsheetId=SPREADSHEET_ID,
            range=f"'{sheet_name}'!A2",
            valueInputOption="USER_ENTERED",
            body={"values": rows_data[1:]}
        ).execute()
    
    # 3. Применяем форматирование (Navy Blue заголовок, стили, границы, цвета)
    total_rows = len(rows_data)
    
    requests = [
        # Устанавливаем только шрифт Calibri 11pt для всех ячеек, НЕ меняя цвет текста (чтобы не перекрывать белый цвет Умной Таблицы)
        {
            "repeatCell": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": 0,
                    "endRowIndex": total_rows,
                    "startColumnIndex": 0,
                    "endColumnIndex": len(headers)
                },
                "cell": {
                    "userEnteredFormat": {
                        "textFormat": {
                            "fontFamily": "Calibri",
                            "fontSize": 11
                        }
                    }
                },
                "fields": "userEnteredFormat.textFormat.fontFamily,userEnteredFormat.textFormat.fontSize"
            }
        },
        # Стилизация заголовка (Строка 1): Выравнивание и жирный текст (Цвета берем из встроенных стилей Умной Таблицы)
        {
            "repeatCell": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": 0,
                    "endRowIndex": 1,
                    "startColumnIndex": 0,
                    "endColumnIndex": len(headers)
                },
                "cell": {
                    "userEnteredFormat": {
                        "textFormat": {
                            "bold": True
                        },
                        "horizontalAlignment": "CENTER",
                        "verticalAlignment": "MIDDLE"
                    }
                },
                "fields": "userEnteredFormat.textFormat.bold,userEnteredFormat.horizontalAlignment,userEnteredFormat.verticalAlignment"
            }
        },
        # Форматирование отклонений (колонки 31-41, индексы 30-40) как проценты (+0.00% / -0.00%)
        {
            "repeatCell": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": 1,
                    "endRowIndex": total_rows,
                    "startColumnIndex": 30,
                    "endColumnIndex": 41
                },
                "cell": {
                    "userEnteredFormat": {
                        "numberFormat": {
                            "type": "PERCENT",
                            "pattern": "+0.00%;-0.00%;0.00%"
                        }
                    }
                },
                "fields": "userEnteredFormat.numberFormat"
            }
        }
    ]
    
    body = {"requests": requests}
    service.spreadsheets().batchUpdate(spreadsheetId=SPREADSHEET_ID, body=body).execute()
    print("Синхронизация отчета с Google Таблицами выполнена успешно.")


def export_norms_to_google_sheets(db: Session):
    """
    Создает или обновляет лист 'Нормативы' в Google Таблице, выгружая текущие нормативы
    """
    if not SPREADSHEET_ID or SPREADSHEET_ID.startswith("1_mock"):
        return
        
    service = get_sheets_service()
    sheet_name = "Нормативы"
    
    # 1. Проверяем существование листа
    spreadsheet = service.spreadsheets().get(spreadsheetId=SPREADSHEET_ID).execute()
    sheets_titles = [sh["properties"]["title"] for sh in spreadsheet["sheets"]]
    
    if sheet_name not in sheets_titles:
        body = {
            "requests": [{
                "addSheet": {
                    "properties": {
                        "title": sheet_name,
                        "gridProperties": {
                            "rowCount": 50,
                            "columnCount": 11
                        }
                    }
                }
            }]
        }
        service.spreadsheets().batchUpdate(spreadsheetId=SPREADSHEET_ID, body=body).execute()
        spreadsheet = service.spreadsheets().get(spreadsheetId=SPREADSHEET_ID).execute()
        
    sheet_id = next(sh["properties"]["sheetId"] for sh in spreadsheet["sheets"] if sh["properties"]["title"] == sheet_name)
    
    headers = [
        "Продукция", "Вес готового листа (кг)", 
        "Норма Хризотил 4-20", "Норма Хризотил 5-65", "Норма Хризотил 6-40",
        "Норма Цемент", "Норма Целлюлоза", "Норма Дробленый шифер", 
        "Норма Асбозурит", "Норма Стекловолокно"
    ]
    
    norms = db.query(models.ProductNorm).all()
    rows_data = [headers]
    for n in norms:
        rows_data.append([
            n.product_name,
            n.weight_kg or 19.6,
            n.norm_chrysotile_4_20 or 0.0,
            n.norm_chrysotile_5_65 or 0.0,
            n.norm_chrysotile_6_40 or 0.0,
            n.norm_cement or 0.0,
            n.norm_cellulose or 0.0,
            n.norm_crushed_slate or 0.0,
            n.norm_asbozurit or 0.0,
            n.norm_fiberglass or 0.0
        ])
        
    # Очищаем старые значения
    service.spreadsheets().values().clear(
        spreadsheetId=SPREADSHEET_ID,
        range=f"'{sheet_name}'!A1:K50"
    ).execute()
    
    # Записываем новые значения
    service.spreadsheets().values().update(
        spreadsheetId=SPREADSHEET_ID,
        range=f"'{sheet_name}'!A1",
        valueInputOption="USER_ENTERED",
        body={"values": rows_data}
    ).execute()
    
    # Форматирование шапки
    requests = [
        {
            "repeatCell": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": 0,
                    "endRowIndex": 1,
                    "startColumnIndex": 0,
                    "endColumnIndex": len(headers)
                },
                "cell": {
                    "userEnteredFormat": {
                        "backgroundColor": {
                            "red": 31/255.0,
                            "green": 78/255.0,
                            "blue": 120/255.0
                        },
                        "textFormat": {
                            "bold": True,
                            "foregroundColor": {"red": 1.0, "green": 1.0, "blue": 1.0}
                        },
                        "horizontalAlignment": "CENTER",
                        "verticalAlignment": "MIDDLE"
                    }
                },
                "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)"
            }
        },
        # Границы и шрифты
        {
            "repeatCell": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": 0,
                    "endRowIndex": len(rows_data),
                    "startColumnIndex": 0,
                    "endColumnIndex": len(headers)
                },
                "cell": {
                    "userEnteredFormat": {
                        "textFormat": {
                            "fontFamily": "Calibri",
                            "fontSize": 11
                        }
                    }
                },
                "fields": "userEnteredFormat.textFormat"
            }
        },
        {
            "autoResizeDimensions": {
                "dimensions": {
                    "sheetId": sheet_id,
                    "dimension": "COLUMNS",
                    "startIndex": 0,
                    "endIndex": len(headers)
                }
            }
        }
    ]
    service.spreadsheets().batchUpdate(spreadsheetId=SPREADSHEET_ID, body={"requests": requests}).execute()
    print("Нормативы успешно экспортированы в Google Таблицу.")


def sync_norms_from_google_sheets(db: Session):
    """
    Считывает измененные нормативы с листа 'Нормативы' Google Таблицы и записывает их в БД.
    """
    if not SPREADSHEET_ID or SPREADSHEET_ID.startswith("1_mock"):
        raise ValueError("GOOGLE_SPREADSHEET_ID не настроен")
        
    service = get_sheets_service()
    sheet_name = "Нормативы"
    
    result = service.spreadsheets().values().get(
        spreadsheetId=SPREADSHEET_ID,
        range=f"'{sheet_name}'!A1:K50"
    ).execute()
    
    rows = result.get("values", [])
    if not rows:
        raise ValueError("Лист 'Нормативы' пустой или не найден")
        
    header = rows[0]
    if "Продукция" not in header:
        raise ValueError("Неверный формат шапки листа 'Нормативы'")
        
    # Вспомогательная функция для безопасного парсинга float
    def safe_float(val):
        if val is None:
            return 0.0
        val_str = str(val).strip().replace(" ", "").replace(",", ".")
        if not val_str:
            return 0.0
        try:
            return float(val_str)
        except ValueError:
            return 0.0
            
    # Начинаем синхронизацию
    # Сначала удаляем старые нормы, чтобы перезаписать
    db.query(models.ProductNorm).delete()
    
    for row in rows[1:]:
        if not row or not row[0]:
            continue
            
        p_name = str(row[0]).strip()
        # Трансляция пиленого шифера в рифленый на лету
        if p_name == "Шифер 8 волн пиленый":
            p_name = "Шифер 8 волн рифленый"
            
        weight = safe_float(row[1] if len(row) > 1 else 19.6)
        n_c4 = safe_float(row[2] if len(row) > 2 else 0.0)
        n_c5 = safe_float(row[3] if len(row) > 3 else 0.0)
        n_c6 = safe_float(row[4] if len(row) > 4 else 0.0)
        n_cem = safe_float(row[5] if len(row) > 5 else 0.0)
        n_cel = safe_float(row[6] if len(row) > 6 else 0.0)
        n_sl = safe_float(row[7] if len(row) > 7 else 0.0)
        n_asb = safe_float(row[8] if len(row) > 8 else 0.0)
        n_fib = safe_float(row[9] if len(row) > 9 else 0.0)
        
        db.add(models.ProductNorm(
            product_name=p_name,
            weight_kg=weight,
            norm_chrysotile_4_20=n_c4,
            norm_chrysotile_5_65=n_c5,
            norm_chrysotile_6_40=n_c6,
            norm_cement=n_cem,
            norm_cellulose=n_cel,
            norm_crushed_slate=n_sl,
            norm_asbozurit=n_asb,
            norm_fiberglass=n_fib
        ))
        
    db.commit()
    print("Нормативы успешно обновлены из Google Таблицы.")


def export_downtime_directory_to_google_sheets(db: Session):
    """
    Создает или обновляет лист 'Справочник простоев' в Google Таблице
    """
    if not SPREADSHEET_ID or SPREADSHEET_ID.startswith("1_mock"):
        return
        
    service = get_sheets_service()
    sheet_name = "Справочник простоев"
    
    # 1. Проверяем существование листа
    spreadsheet = service.spreadsheets().get(spreadsheetId=SPREADSHEET_ID).execute()
    sheets_titles = [sh["properties"]["title"] for sh in spreadsheet["sheets"]]
    
    if sheet_name not in sheets_titles:
        body = {
            "requests": [{
                "addSheet": {
                    "properties": {
                        "title": sheet_name,
                        "gridProperties": {
                            "rowCount": 300,
                            "columnCount": 5
                        }
                    }
                }
            }]
        }
        service.spreadsheets().batchUpdate(spreadsheetId=SPREADSHEET_ID, body=body).execute()
        spreadsheet = service.spreadsheets().get(spreadsheetId=SPREADSHEET_ID).execute()
        
    sheet_id = next(sh["properties"]["sheetId"] for sh in spreadsheet["sheets"] if sh["properties"]["title"] == sheet_name)
    
    headers = ["Участок", "Узел", "Поломка", "Категория", "Комментарий"]
    
    dirs = db.query(models.DowntimeDirectory).all()
    rows_data = [headers]
    for d in dirs:
        rows_data.append([
            d.department or "",
            d.node or "",
            d.breakdown or "",
            d.category or "Механические",
            d.comment or ""
        ])
        
    # Очищаем старые значения
    service.spreadsheets().values().clear(
        spreadsheetId=SPREADSHEET_ID,
        range=f"'{sheet_name}'!A1:E300"
    ).execute()
    
    # Записываем новые значения
    service.spreadsheets().values().update(
        spreadsheetId=SPREADSHEET_ID,
        range=f"'{sheet_name}'!A1",
        valueInputOption="USER_ENTERED",
        body={"values": rows_data}
    ).execute()
    
    # Форматирование
    requests = [
        {
            "repeatCell": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": 0,
                    "endRowIndex": 1,
                    "startColumnIndex": 0,
                    "endColumnIndex": len(headers)
                },
                "cell": {
                    "userEnteredFormat": {
                        "backgroundColor": {
                            "red": 31/255.0,
                            "green": 78/255.0,
                            "blue": 120/255.0
                        },
                        "textFormat": {
                            "bold": True,
                            "foregroundColor": {"red": 1.0, "green": 1.0, "blue": 1.0}
                        },
                        "horizontalAlignment": "CENTER",
                        "verticalAlignment": "MIDDLE"
                    }
                },
                "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)"
            }
        },
        {
            "repeatCell": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": 0,
                    "endRowIndex": len(rows_data),
                    "startColumnIndex": 0,
                    "endColumnIndex": len(headers)
                },
                "cell": {
                    "userEnteredFormat": {
                        "textFormat": {
                            "fontFamily": "Calibri",
                            "fontSize": 11
                        }
                    }
                },
                "fields": "userEnteredFormat.textFormat"
            }
        },
        {
            "autoResizeDimensions": {
                "dimensions": {
                    "sheetId": sheet_id,
                    "dimension": "COLUMNS",
                    "startIndex": 0,
                    "endIndex": len(headers)
                }
            }
        }
    ]
    service.spreadsheets().batchUpdate(spreadsheetId=SPREADSHEET_ID, body={"requests": requests}).execute()
    print("Справочник простоев успешно экспортирован в Google Таблицу.")


def sync_downtime_directory_from_google_sheets(db: Session):
    """
    Считывает измененные простои с листа 'Справочник простоев' Google Таблицы и записывает их в БД.
    """
    if not SPREADSHEET_ID or SPREADSHEET_ID.startswith("1_mock"):
        raise ValueError("GOOGLE_SPREADSHEET_ID не настроен")
        
    service = get_sheets_service()
    sheet_name = "Справочник простоев"
    
    result = service.spreadsheets().values().get(
        spreadsheetId=SPREADSHEET_ID,
        range=f"'{sheet_name}'!A1:E300"
    ).execute()
    
    rows = result.get("values", [])
    if not rows:
        raise ValueError("Лист 'Справочник простоев' пустой или не найден")
        
    header = rows[0]
    if "Участок" not in header or "Поломка" not in header:
        raise ValueError("Неверный формат шапки листа 'Справочник простоев'")
        
    db.query(models.DowntimeDirectory).delete()
    
    for row in rows[1:]:
        if not row or len(row) < 3:
            continue
            
        dept = str(row[0]).strip()
        node = str(row[1]).strip() if row[1] else "Общее"
        bd = str(row[2]).strip()
        
        if not dept or not bd:
            continue
            
        cat = str(row[3]).strip() if len(row) > 3 and row[3] else "Механические"
        comm = str(row[4]).strip() if len(row) > 4 and row[4] else ""
        
        db.add(models.DowntimeDirectory(
            department=dept,
            node=node,
            breakdown=bd,
            category=cat,
            comment=comm
        ))
        
    db.commit()
    print("Справочник простоев успешно обновлен из Google Таблицы.")


def export_receipt_to_google_sheets(db: Session):
    """
    Создает или обновляет лист 'Приход сырья' в Google Таблице,
    выгружая данные прихода сырья из всех смен (история накопления).
    Вызывается при сохранении сменного рапорта мастера.
    """
    if not SPREADSHEET_ID or SPREADSHEET_ID.startswith("1_mock"):
        print("Экспорт прихода сырья в Google Таблицы пропущен: не задан реальный GOOGLE_SPREADSHEET_ID в .env")
        return

    service = get_sheets_service()
    sheet_name = "Приход сырья"

    # 1. Проверяем существование листа, если нет — создаем
    spreadsheet = service.spreadsheets().get(spreadsheetId=SPREADSHEET_ID).execute()
    sheets_titles = [sh["properties"]["title"] for sh in spreadsheet["sheets"]]

    if sheet_name not in sheets_titles:
        body = {
            "requests": [{
                "addSheet": {
                    "properties": {
                        "title": sheet_name,
                        "gridProperties": {
                            "rowCount": 1000,
                            "columnCount": 18
                        }
                    }
                }
            }]
        }
        service.spreadsheets().batchUpdate(spreadsheetId=SPREADSHEET_ID, body=body).execute()
        spreadsheet = service.spreadsheets().get(spreadsheetId=SPREADSHEET_ID).execute()

    sheet_id = next(sh["properties"]["sheetId"] for sh in spreadsheet["sheets"] if sh["properties"]["title"] == sheet_name)

    # 2. Формируем заголовки
    headers = [
        "Дата", "Смена", "Линия", "Мастер",
        "Хризотил 4-20 (кг)", "Хризотил 5-65 (кг)", "Хризотил 6-40 (кг)",
        "Цемент С1 (кг)", "Цемент С2 (кг)", "Цемент С3 (кг)", "Цемент С4 (кг)", 
        "Целлюлоза (кг)", "Дробленый шифер (кг)",
        "Асбозурит (кг)", "Асбокартон (кг)", "Паллеты (шт)",
        "Стекловолокно (кг)", "Лапрол (кг)"
    ]

    # 3. Собираем данные из БД — все записи прихода сырья
    # Выгружаем каждую запись прихода как отдельную строку
    receipts = db.query(models.RawMaterialReceipt).join(models.Shift).order_by(models.Shift.date.asc(), models.Shift.line.asc(), models.Shift.shift_name.asc(), models.Shift.batch_number.asc(), models.RawMaterialReceipt.id.asc()).all()

    rows_data = []
    rows_data.append(headers)

    for r in receipts:
        date_str = r.shift.date.strftime("%d.%m.%Y") if r.shift and r.shift.date else ""
        shift_name = r.shift.shift_name or ""
        line = r.shift.line or ""
        master_name = r.master.name if r.master else (r.shift.master.name if r.shift and r.shift.master else "")
        
        row = [
            date_str,
            shift_name,
            line,
            master_name,
            r.chrysotile_4_20 or 0.0,
            r.chrysotile_5_65 or 0.0,
            r.chrysotile_6_40 or 0.0,
            r.cement_silo1 or 0.0,
            r.cement_silo2 or 0.0,
            r.cement_silo3 or 0.0,
            r.cement_silo4 or 0.0,
            r.cellulose or 0.0,
            r.crushed_slate or 0.0,
            r.asbozurit or 0.0,
            r.asbocarton or 0.0,
            r.pallets or 0.0,
            r.fiberglass or 0.0,
            r.laprol or 0.0,
        ]
        rows_data.append(row)

    # 4. Полностью перезаписываем лист (очищаем и пишем заново)
    total_rows = len(rows_data)

    # Очищаем старые данные
    service.spreadsheets().values().clear(
        spreadsheetId=SPREADSHEET_ID,
        range=f"'{sheet_name}'"
    ).execute()

    # Записываем данные
    if rows_data:
        service.spreadsheets().values().update(
            spreadsheetId=SPREADSHEET_ID,
            range=f"'{sheet_name}'!A1",
            valueInputOption="USER_ENTERED",
            body={"values": rows_data}
        ).execute()

    # 5. Форматирование
    requests = [
        # Шрифт Calibri 11pt для всех ячеек
        {
            "repeatCell": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": 0,
                    "endRowIndex": max(total_rows, 2),
                    "startColumnIndex": 0,
                    "endColumnIndex": len(headers)
                },
                "cell": {
                    "userEnteredFormat": {
                        "textFormat": {
                            "fontFamily": "Calibri",
                            "fontSize": 11
                        }
                    }
                },
                "fields": "userEnteredFormat.textFormat.fontFamily,userEnteredFormat.textFormat.fontSize"
            }
        },
        # Стилизация заголовка: navy-blue фон, белый жирный текст, выравнивание по центру
        {
            "repeatCell": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": 0,
                    "endRowIndex": 1,
                    "startColumnIndex": 0,
                    "endColumnIndex": len(headers)
                },
                "cell": {
                    "userEnteredFormat": {
                        "backgroundColor": {
                            "red": 31/255.0,
                            "green": 78/255.0,
                            "blue": 120/255.0
                        },
                        "textFormat": {
                            "bold": True,
                            "foregroundColor": {"red": 1.0, "green": 1.0, "blue": 1.0}
                        },
                        "horizontalAlignment": "CENTER",
                        "verticalAlignment": "MIDDLE"
                    }
                },
                "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)"
            }
        },
        # Выравнивание текста: левое для первых 4 колонок (текстовые), правое для числовых
        {
            "repeatCell": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": 0,
                    "endRowIndex": 1,
                    "startColumnIndex": 0,
                    "endColumnIndex": 4
                },
                "cell": {
                    "userEnteredFormat": {
                        "horizontalAlignment": "CENTER"
                    }
                },
                "fields": "userEnteredFormat.horizontalAlignment"
            }
        },
        {
            "repeatCell": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": 1,
                    "endRowIndex": max(total_rows, 2),
                    "startColumnIndex": 0,
                    "endColumnIndex": 4
                },
                "cell": {
                    "userEnteredFormat": {
                        "horizontalAlignment": "LEFT"
                    }
                },
                "fields": "userEnteredFormat.horizontalAlignment"
            }
        },
        {
            "repeatCell": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": 1,
                    "endRowIndex": max(total_rows, 2),
                    "startColumnIndex": 4,
                    "endColumnIndex": len(headers)
                },
                "cell": {
                    "userEnteredFormat": {
                        "horizontalAlignment": "RIGHT"
                    }
                },
                "fields": "userEnteredFormat.horizontalAlignment"
            }
        },
        # Сетка границ
        {
            "updateBorders": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": 0,
                    "endRowIndex": max(total_rows, 2),
                    "startColumnIndex": 0,
                    "endColumnIndex": len(headers)
                },
                "top": {"style": "SOLID", "width": 1, "color": {"red": 0.75, "green": 0.75, "blue": 0.75}},
                "bottom": {"style": "SOLID", "width": 1, "color": {"red": 0.75, "green": 0.75, "blue": 0.75}},
                "left": {"style": "SOLID", "width": 1, "color": {"red": 0.75, "green": 0.75, "blue": 0.75}},
                "right": {"style": "SOLID", "width": 1, "color": {"red": 0.75, "green": 0.75, "blue": 0.75}},
                "innerHorizontal": {"style": "SOLID", "width": 1, "color": {"red": 0.75, "green": 0.75, "blue": 0.75}},
                "innerVertical": {"style": "SOLID", "width": 1, "color": {"red": 0.75, "green": 0.75, "blue": 0.75}}
            }
        },
        # Авто-размер ширины колонок
        {
            "autoResizeDimensions": {
                "dimensions": {
                    "sheetId": sheet_id,
                    "dimension": "COLUMNS",
                    "startIndex": 0,
                    "endIndex": len(headers)
                }
            }
        }
    ]

    service.spreadsheets().batchUpdate(spreadsheetId=SPREADSHEET_ID, body={"requests": requests}).execute()
    print(f"Экспорт прихода сырья в Google Таблицы выполнен успешно. Выгружено {len(rows_data) - 1} смен.")


def export_downtimes_to_google_sheets(db: Session):
    """
    Создает или обновляет лист 'Простои' в Google Таблице,
    выгружая данные о простоях из всех смен (история накопления).
    """
    if not SPREADSHEET_ID or SPREADSHEET_ID.startswith("1_mock"):
        print("Экспорт простоев в Google Таблицы пропущен: не задан реальный GOOGLE_SPREADSHEET_ID в .env")
        return

    service = get_sheets_service()
    sheet_name = "Простои"

    # 1. Проверяем существование листа, если нет — создаем
    spreadsheet = service.spreadsheets().get(spreadsheetId=SPREADSHEET_ID).execute()
    sheets_titles = [sh["properties"]["title"] for sh in spreadsheet["sheets"]]

    if sheet_name not in sheets_titles:
        body = {
            "requests": [{
                "addSheet": {
                    "properties": {
                        "title": sheet_name,
                        "gridProperties": {
                            "rowCount": 2000,
                            "columnCount": 14
                        }
                    }
                }
            }]
        }
        service.spreadsheets().batchUpdate(spreadsheetId=SPREADSHEET_ID, body=body).execute()
        spreadsheet = service.spreadsheets().get(spreadsheetId=SPREADSHEET_ID).execute()

    sheet_id = next(sh["properties"]["sheetId"] for sh in spreadsheet["sheets"] if sh["properties"]["title"] == sheet_name)

    # 2. Формируем заголовки
    headers = [
        "Дата", "Смена", "Линия", "Мастер",
        "Участок", "Узел", "Описание поломки", "Описание / Комментарий", "Категория",
        "Время начала", "Время конца", "Длительность (мин)",
        "Потеряно тонн", "Остановка оборудования"
    ]

    # 3. Собираем данные из БД — все простои с информацией о смене
    downtimes = db.query(models.Downtime).join(models.Shift).order_by(
        models.Shift.date.asc(), models.Shift.line.asc(), models.Shift.shift_name.asc(), models.Downtime.start_time.asc(), models.Downtime.id.asc()
    ).all()

    rows_data = []
    rows_data.append(headers)

    for d in downtimes:
        shift = d.shift
        date_str = shift.date.strftime("%d.%m.%Y") if shift.date else ""
        
        b_dept = d.department or ""
        b_node = d.node or ""
        b_desc = d.description or ""
        b_cat = d.category or ""
        
        if hasattr(d, 'breakdowns') and d.breakdowns:
            try:
                bk_list = json.loads(d.breakdowns)
                if bk_list and isinstance(bk_list, list):
                    # dict.fromkeys to keep unique order
                    b_dept = ", ".join(list(dict.fromkeys([str(b.get('department') or 'Разное') for b in bk_list])))
                    b_node = ";\n".join([f"{b.get('node') or '-'}" for b in bk_list])
                    b_desc = ";\n".join([f"{b.get('description') or '-'}" for b in bk_list])
                    b_cat = ", ".join(list(dict.fromkeys([str(b.get('category') or '') for b in bk_list if b.get('category')])))
            except Exception as e:
                print(f"Error parsing breakdowns for downtime {d.id}: {e}")

        row = [
            date_str,
            shift.shift_name or "",
            shift.line or "",
            shift.master.name if shift.master else "",
            b_dept,
            b_node,
            b_desc,
            d.comment or "",
            b_cat,
            d.start_time or "",
            d.end_time or "",
            d.duration or 0,
            d.lost_tons or 0.0,
            "Да" if d.is_equipment_downtime else "Нет"
        ]
        rows_data.append(row)

    # 4. Полностью перезаписываем лист (очищаем и пишем заново)
    total_rows = len(rows_data)

    # Очищаем старые данные
    service.spreadsheets().values().clear(
        spreadsheetId=SPREADSHEET_ID,
        range=f"'{sheet_name}'"
    ).execute()

    # Записываем данные
    if rows_data:
        service.spreadsheets().values().update(
            spreadsheetId=SPREADSHEET_ID,
            range=f"'{sheet_name}'!A1",
            valueInputOption="USER_ENTERED",
            body={"values": rows_data}
        ).execute()

    # 5. Форматирование
    requests = [
        # Шрифт Calibri 11pt для всех ячеек
        {
            "repeatCell": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": 0,
                    "endRowIndex": max(total_rows, 2),
                    "startColumnIndex": 0,
                    "endColumnIndex": len(headers)
                },
                "cell": {
                    "userEnteredFormat": {
                        "textFormat": {
                            "fontFamily": "Calibri",
                            "fontSize": 11
                        }
                    }
                },
                "fields": "userEnteredFormat.textFormat.fontFamily,userEnteredFormat.textFormat.fontSize"
            }
        },
        # Стилизация заголовка: navy-blue фон, белый жирный текст, выравнивание по центру
        {
            "repeatCell": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": 0,
                    "endRowIndex": 1,
                    "startColumnIndex": 0,
                    "endColumnIndex": len(headers)
                },
                "cell": {
                    "userEnteredFormat": {
                        "backgroundColor": {
                            "red": 31/255.0,
                            "green": 78/255.0,
                            "blue": 120/255.0
                        },
                        "textFormat": {
                            "bold": True,
                            "foregroundColor": {"red": 1.0, "green": 1.0, "blue": 1.0}
                        },
                        "horizontalAlignment": "CENTER",
                        "verticalAlignment": "MIDDLE"
                    }
                },
                "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)"
            }
        },
        # Выравнивание текста
        {
            "repeatCell": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": 0,
                    "endRowIndex": 1,
                    "startColumnIndex": 0,
                    "endColumnIndex": 4
                },
                "cell": {
                    "userEnteredFormat": {
                        "horizontalAlignment": "CENTER"
                    }
                },
                "fields": "userEnteredFormat.horizontalAlignment"
            }
        },
        {
            "repeatCell": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": 1,
                    "endRowIndex": max(total_rows, 2),
                    "startColumnIndex": 0,
                    "endColumnIndex": 4
                },
                "cell": {
                    "userEnteredFormat": {
                        "horizontalAlignment": "LEFT"
                    }
                },
                "fields": "userEnteredFormat.horizontalAlignment"
            }
        },
        {
            "repeatCell": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": 1,
                    "endRowIndex": max(total_rows, 2),
                    "startColumnIndex": 4,
                    "endColumnIndex": len(headers)
                },
                "cell": {
                    "userEnteredFormat": {
                        "horizontalAlignment": "RIGHT"
                    }
                },
                "fields": "userEnteredFormat.horizontalAlignment"
            }
        },
        # Сетка границ
        {
            "updateBorders": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": 0,
                    "endRowIndex": max(total_rows, 2),
                    "startColumnIndex": 0,
                    "endColumnIndex": len(headers)
                },
                "top": {"style": "SOLID", "width": 1, "color": {"red": 0.75, "green": 0.75, "blue": 0.75}},
                "bottom": {"style": "SOLID", "width": 1, "color": {"red": 0.75, "green": 0.75, "blue": 0.75}},
                "left": {"style": "SOLID", "width": 1, "color": {"red": 0.75, "green": 0.75, "blue": 0.75}},
                "right": {"style": "SOLID", "width": 1, "color": {"red": 0.75, "green": 0.75, "blue": 0.75}},
                "innerHorizontal": {"style": "SOLID", "width": 1, "color": {"red": 0.75, "green": 0.75, "blue": 0.75}},
                "innerVertical": {"style": "SOLID", "width": 1, "color": {"red": 0.75, "green": 0.75, "blue": 0.75}}
            }
        },
        # Авто-размер ширины колонок
        {
            "autoResizeDimensions": {
                "dimensions": {
                    "sheetId": sheet_id,
                    "dimension": "COLUMNS",
                    "startIndex": 0,
                    "endIndex": len(headers)
                }
            }
        }
    ]

    service.spreadsheets().batchUpdate(spreadsheetId=SPREADSHEET_ID, body={"requests": requests}).execute()
    print(f"Экспорт простоев в Google Таблицы выполнен успешно. Выгружено {len(rows_data) - 1} записей.")




def sync_qcd_reports_to_google_sheets(db: Session):
    if not SPREADSHEET_ID or SPREADSHEET_ID.startswith("1_mock"):
        return
        
    service = get_sheets_service()
    sheet_name = "Отчет СКК"
    
    # 1. Проверяем существование листа
    spreadsheet = service.spreadsheets().get(spreadsheetId=SPREADSHEET_ID).execute()
    sheets_titles = [sh["properties"]["title"] for sh in spreadsheet["sheets"]]
    
    if sheet_name not in sheets_titles:
        body = {
            "requests": [{
                "addSheet": {
                    "properties": {
                        "title": sheet_name,
                        "gridProperties": {
                            "rowCount": 1000,
                            "columnCount": 25
                        }
                    }
                }
            }]
        }
        service.spreadsheets().batchUpdate(spreadsheetId=SPREADSHEET_ID, body=body).execute()
        spreadsheet = service.spreadsheets().get(spreadsheetId=SPREADSHEET_ID).execute()
        
    sheet_id = next(sh["properties"]["sheetId"] for sh in spreadsheet["sheets"] if sh["properties"]["title"] == sheet_name)
    
    headers = [
        "№ партии", "Смены", "Продукт", "Формовка, шт", 
        "ГП (шт)", "%", "первый сорт (шт)", "% ", "примечание", 
        "брак (шт)", "%  ", "примечание "
    ]
    
    # Получаем все партии, сортируем по дате и номеру
    batches = db.query(models.Batch).join(models.Shift).order_by(models.Shift.date.asc(), models.Batch.batch_number.asc()).all()
    
    rows_data = [headers]
    for b in batches:
        shift_name = b.shift.shift_name if b.shift else ""
        product_name = b.product_name or ""
        
        # Данные мастера (ds_)
        ds_cond = b.ds_condition or 0
        ds_first = b.ds_first_grade or 0
        ds_def = b.ds_defect or 0
        
        total_sheets = ds_cond + ds_first + ds_def
        
        pct_cond = (ds_cond / total_sheets) if total_sheets > 0 else 0
        pct_first = (ds_first / total_sheets) if total_sheets > 0 else 0
        pct_defect = (ds_def / total_sheets) if total_sheets > 0 else 0
        
        note_first = ""
        
        # Собираем причины брака
        def_parts = []
        if b.ds_defect_chip: def_parts.append(f"Скол ({b.ds_defect_chip})")
        if b.ds_defect_scratch: def_parts.append(f"Сдир ({b.ds_defect_scratch})")
        if b.ds_defect_bad_cut: def_parts.append(f"Плохой рез ({b.ds_defect_bad_cut})")
        if b.ds_defect_stick_bottom: def_parts.append(f"Налип снизу ({b.ds_defect_stick_bottom})")
        if b.ds_defect_stick_top: def_parts.append(f"Налип сверху ({b.ds_defect_stick_top})")
        if b.ds_defect_broken: def_parts.append(f"Сломан ({b.ds_defect_broken})")
        if b.ds_defect_fell_box: def_parts.append(f"Упал коробки ({b.ds_defect_fell_box})")
        if b.ds_defect_dent: def_parts.append(f"Вмятина ({b.ds_defect_dent})")
        if b.ds_defect_thickness: def_parts.append(f"Не соотв. толщины ({b.ds_defect_thickness})")
        if b.ds_defect_delamination: def_parts.append(f"Расслоение ({b.ds_defect_delamination})")
        if b.ds_defect_edge: def_parts.append(f"Кромка ({b.ds_defect_edge})")
        
        note_defect = ", ".join(def_parts)
        
        rows_data.append([
            b.batch_number or "",
            shift_name,
            product_name,
            total_sheets,
            ds_cond,
            pct_cond,
            ds_first,
            pct_first,
            note_first,
            ds_def,
            pct_defect,
            note_defect
        ])
        
    service.spreadsheets().values().clear(
        spreadsheetId=SPREADSHEET_ID,
        range=f"'{sheet_name}'!A1:X1000"
    ).execute()
    
    if len(rows_data) > 0:
        service.spreadsheets().values().update(
            spreadsheetId=SPREADSHEET_ID,
            range=f"'{sheet_name}'!A1",
            valueInputOption="USER_ENTERED",
            body={"values": rows_data}
        ).execute()
        
    requests = [
        {
            "repeatCell": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": 0,
                    "endRowIndex": 1,
                    "startColumnIndex": 0,
                    "endColumnIndex": len(headers)
                },
                "cell": {
                    "userEnteredFormat": {
                        "backgroundColor": {
                            "red": 180/255.0,
                            "green": 198/255.0,
                            "blue": 231/255.0
                        },
                        "textFormat": {
                            "bold": True
                        },
                        "horizontalAlignment": "CENTER",
                        "verticalAlignment": "MIDDLE"
                    }
                },
                "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)"
            }
        },
        {
            "updateBorders": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": 0,
                    "endRowIndex": max(len(rows_data), 2),
                    "startColumnIndex": 0,
                    "endColumnIndex": len(headers)
                },
                "top": {"style": "SOLID", "width": 1, "color": {"red": 0.5, "green": 0.5, "blue": 0.5}},
                "bottom": {"style": "SOLID", "width": 1, "color": {"red": 0.5, "green": 0.5, "blue": 0.5}},
                "left": {"style": "SOLID", "width": 1, "color": {"red": 0.5, "green": 0.5, "blue": 0.5}},
                "right": {"style": "SOLID", "width": 1, "color": {"red": 0.5, "green": 0.5, "blue": 0.5}},
                "innerHorizontal": {"style": "SOLID", "width": 1, "color": {"red": 0.5, "green": 0.5, "blue": 0.5}},
                "innerVertical": {"style": "SOLID", "width": 1, "color": {"red": 0.5, "green": 0.5, "blue": 0.5}}
            }
        },
        {
            "repeatCell": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": 1,
                    "endRowIndex": max(len(rows_data), 2),
                    "startColumnIndex": 5, # % ГП
                    "endColumnIndex": 6
                },
                "cell": {
                    "userEnteredFormat": {
                        "numberFormat": {
                            "type": "PERCENT",
                            "pattern": "0.00%"
                        }
                    }
                },
                "fields": "userEnteredFormat.numberFormat"
            }
        },
        {
            "repeatCell": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": 1,
                    "endRowIndex": max(len(rows_data), 2),
                    "startColumnIndex": 7, # % 1 сорта
                    "endColumnIndex": 8
                },
                "cell": {
                    "userEnteredFormat": {
                        "numberFormat": {
                            "type": "PERCENT",
                            "pattern": "0.00%"
                        }
                    }
                },
                "fields": "userEnteredFormat.numberFormat"
            }
        },
        {
            "repeatCell": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": 1,
                    "endRowIndex": max(len(rows_data), 2),
                    "startColumnIndex": 10, # % брака
                    "endColumnIndex": 11
                },
                "cell": {
                    "userEnteredFormat": {
                        "numberFormat": {
                            "type": "PERCENT",
                            "pattern": "0.00%"
                        }
                    }
                },
                "fields": "userEnteredFormat.numberFormat"
            }
        }
    ]
    service.spreadsheets().batchUpdate(spreadsheetId=SPREADSHEET_ID, body={"requests": requests}).execute()
    print("Отчет СКК успешно экспортирован.")
