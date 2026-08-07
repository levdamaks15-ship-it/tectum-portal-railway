import sys

code = """
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
        "Дата смены", "№ партии", "Смена", "Продукт", "Формовка, шт", 
        "ГП (шт)", "первый сорт (шт)", "% 1 сорта", "примечание (1 сорт)", 
        "брак (шт)", "% брака", "примечание (брак)", "Перебрано пачек",
        "Скол", "Сдир", "Плохой рез", "Налип снизу", "Налип сверху", 
        "Сломан", "Упал коробки", "Вмятина", "Не соотв толщины", 
        "Расслоение", "Кромка не соотв"
    ]
    
    # Получаем партии, где СКК заполнил данные
    batches = db.query(models.Batch).filter(models.Batch.status == "qcd_checked").all()
    
    rows_data = [headers]
    for b in batches:
        shift_date = b.shift.date.strftime("%d.%m.%Y") if b.shift and b.shift.date else ""
        shift_name = b.shift.shift_name if b.shift else ""
        product_name = b.product_name or ""
        
        total_sheets = (b.qcd_sorted_packs or 0) * 126
        
        pct_first = (b.qcd_first_grade / total_sheets) if total_sheets > 0 else 0
        pct_defect = (b.qcd_defect / total_sheets) if total_sheets > 0 else 0
        
        rows_data.append([
            shift_date,
            b.batch_number or "",
            shift_name,
            product_name,
            total_sheets,
            "", # ГП убрали, оставил пустой для выравнивания
            b.qcd_first_grade or 0,
            pct_first,
            b.qcd_first_grade_note or "",
            b.qcd_defect or 0,
            pct_defect,
            b.qcd_defect_note or "",
            b.qcd_sorted_packs or 0,
            b.qcd_defect_chip or 0,
            b.qcd_defect_scratch or 0,
            b.qcd_defect_bad_cut or 0,
            b.qcd_defect_stick_bottom or 0,
            b.qcd_defect_stick_top or 0,
            b.qcd_defect_broken or 0,
            b.qcd_defect_fell_box or 0,
            b.qcd_defect_dent or 0,
            b.qcd_defect_thickness or 0,
            b.qcd_defect_delamination or 0,
            b.qcd_defect_edge or 0
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
                    "startColumnIndex": 7,
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
                    "startColumnIndex": 10,
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
"""
with open("d:/Antigravity_Project/tectum_portal_railway/google_sheets_integration.py", "a", encoding="utf-8") as f:
    f.write("\n" + code)
