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
    if not os.path.exists(CREDENTIALS_PATH):
        raise FileNotFoundError(f"Файл ключа Google не найден по пути: {CREDENTIALS_PATH}")
    
    # Загружаем credentials сервисного аккаунта
    creds = service_account.Credentials.from_service_account_file(
        CREDENTIALS_PATH,
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
    
    # 1. Извлекаем данные из БД
    shifts = db.query(models.Shift).filter(models.Shift.status == "closed").order_by(models.Shift.date.asc(), models.Shift.id.asc()).all()
    
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
        date_str = s.date.strftime("%d.%m.%Y") if s.date else ""
        batch_numbers = ", ".join(b.batch_number for b in s.batches if b.batch_number)
        product_names = ", ".join(set(r.product_name for r in s.lfm_reports if r.product_name))
        formovka_sheets = sum(r.lfm_sheets for r in s.lfm_reports)
        formovka_tons = sum(r.lfm_sheets * get_product_finished_weight_kg(db, r.product_name) for r in s.lfm_reports) / 1000.0
        
        qcd_condition = sum(b.qcd_condition for b in s.batches)
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
    
    # Сначала очистим старые данные
    service.spreadsheets().values().clear(
        spreadsheetId=SPREADSHEET_ID,
        range=f"'{sheet_name}'!A1:AO1000"
    ).execute()
    
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
    
    # Записываем новые данные
    service.spreadsheets().values().update(
        spreadsheetId=SPREADSHEET_ID,
        range=f"'{sheet_name}'!A1",
        valueInputOption="USER_ENTERED",
        body={"values": rows_data}
    ).execute()
    
    # 3. Применяем форматирование (Navy Blue заголовок, стили, границы, цвета)
    total_rows = len(rows_data)
    
    requests = [
        # Устанавливаем шрифт Calibri 11pt для всех ячеек
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
                "fields": "userEnteredFormat.textFormat"
            }
        },
        # Стилизация заголовка (Строка 1): Цвет фона #1F4E78, белый жирный текст
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
        },
        # Выравнивание текста: левое для текстовых колонок (0-5), правое для числовых (6-40)
        {
            "repeatCell": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": 1,
                    "endRowIndex": total_rows,
                    "startColumnIndex": 6,
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
                    "endRowIndex": total_rows,
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
    
    # 4. Добавляем условное форматирование для Брак (колонка 12, индекс 11)
    # Если Брак > 0 - красим в нежно-красный (#FCE4D6), если Брак = 0 - в нежно-зеленый (#E2EFDA)
    requests.extend([
        {
            "addConditionalFormatRule": {
                "rule": {
                    "ranges": [{
                        "sheetId": sheet_id,
                        "startRowIndex": 1,
                        "endRowIndex": total_rows,
                        "startColumnIndex": 11,
                        "endColumnIndex": 12
                    }],
                    "booleanRule": {
                        "condition": {
                            "type": "NUMBER_GREATER",
                            "values": [{"userEnteredValue": "0"}]
                        },
                        "format": {
                            "backgroundColor": {"red": 252/255.0, "green": 228/255.0, "blue": 214/255.0} # Soft red
                        }
                    }
                },
                "index": 0
            }
        },
        {
            "addConditionalFormatRule": {
                "rule": {
                    "ranges": [{
                        "sheetId": sheet_id,
                        "startRowIndex": 1,
                        "endRowIndex": total_rows,
                        "startColumnIndex": 11,
                        "endColumnIndex": 12
                    }],
                    "booleanRule": {
                        "condition": {
                            "type": "NUMBER_EQ",
                            "values": [{"userEnteredValue": "0"}]
                        },
                        "format": {
                            "backgroundColor": {"red": 226/255.0, "green": 239/255.0, "blue": 218/255.0} # Soft green
                        }
                    }
                },
                "index": 1
            }
        }
    ])
    
    # 5. Добавляем условное форматирование для Отклонений (колонки 31-41, индексы 30-40)
    # Если Отклонение > 0.001 (0.1%) - красим в нежно-красный, если <= 0.001 - в нежно-зеленый
    requests.extend([
        {
            "addConditionalFormatRule": {
                "rule": {
                    "ranges": [{
                        "sheetId": sheet_id,
                        "startRowIndex": 1,
                        "endRowIndex": total_rows,
                        "startColumnIndex": 30,
                        "endColumnIndex": 41
                    }],
                    "booleanRule": {
                        "condition": {
                            "type": "NUMBER_GREATER",
                            "values": [{"userEnteredValue": "0,001"}]
                        },
                        "format": {
                            "backgroundColor": {"red": 252/255.0, "green": 228/255.0, "blue": 214/255.0} # Soft red
                        }
                    }
                },
                "index": 2
            }
        },
        {
            "addConditionalFormatRule": {
                "rule": {
                    "ranges": [{
                        "sheetId": sheet_id,
                        "startRowIndex": 1,
                        "endRowIndex": total_rows,
                        "startColumnIndex": 30,
                        "endColumnIndex": 41
                    }],
                    "booleanRule": {
                        "condition": {
                            "type": "NUMBER_LESS_THAN_EQ",
                            "values": [{"userEnteredValue": "0,001"}]
                        },
                        "format": {
                            "backgroundColor": {"red": 226/255.0, "green": 239/255.0, "blue": 218/255.0} # Soft green
                        }
                    }
                },
                "index": 3
            }
        }
    ])
    
    body = {"requests": requests}
    service.spreadsheets().batchUpdate(spreadsheetId=SPREADSHEET_ID, body=body).execute()
    print("Синхронизация отчета с Google Таблицами выполнена успешно.")
