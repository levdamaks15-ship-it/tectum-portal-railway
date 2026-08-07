from datetime import timedelta

def get_iso_week_key(d):
    # Returns (year, week) tuple for grouping
    if not d:
        return (0, 0)
    return d.isocalendar()[:2]

def get_week_label(d):
    if not d:
        return ""
    monday = d - timedelta(days=d.weekday())
    sunday = monday + timedelta(days=6)
    return f"Отчет продукции с {monday.strftime('%d.%m')}- по {sunday.strftime('%d.%m.%y')}г"

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
                            "rowCount": 2000,
                            "columnCount": 25,
                            "frozenRowCount": 1
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
        "первый сорт (шт)", "% ", "примечание", 
        "брак (шт)", "%  ", "примечание "
    ]
    # Indices:
    # 0: № партии
    # 1: Смены
    # 2: Продукт
    # 3: Формовка, шт
    # 4: первый сорт (шт)
    # 5: %
    # 6: примечание
    # 7: брак (шт)
    # 8: %
    # 9: примечание
    
    batches = db.query(models.Batch).join(models.Shift).order_by(models.Shift.date.asc(), models.Batch.batch_number.asc()).all()
    
    rows_data = [headers]
    summary_bold_rows = []
    
    if not batches:
        return
        
    current_week = None
    week_stats = {}  # {product_name: {"total": 0, "first": 0, "defect": 0}}
    
    def append_week_summaries(stats_dict):
        # Добавляем пустую строку для отступа
        rows_data.append(["" for _ in range(10)])
        for prod, stats in stats_dict.items():
            tot = stats["total"]
            f = stats["first"]
            d = stats["defect"]
            pf = (f / tot) if tot > 0 else 0
            pd = (d / tot) if tot > 0 else 0
            rows_data.append([
                "", "", f"{prod}:", tot, f, pf, "", d, pd, ""
            ])
            summary_bold_rows.append(len(rows_data) - 1)
        # Еще одна пустая строка после итогов
        rows_data.append(["" for _ in range(10)])

    for b in batches:
        shift_date = b.shift.date if b.shift else None
        week_key = get_iso_week_key(shift_date)
        
        if current_week is not None and current_week != week_key:
            append_week_summaries(week_stats)
            week_stats = {}
            
        current_week = week_key
        
        shift_name = b.shift.shift_name if b.shift else ""
        product_name = b.product_name or "Неизвестный продукт"
        
        if product_name not in week_stats:
            week_stats[product_name] = {"total": 0, "first": 0, "defect": 0}
            
        ds_cond = b.ds_condition or 0
        ds_first = b.ds_first_grade or 0
        ds_def = b.ds_defect or 0
        total_sheets = ds_cond + ds_first + ds_def
        
        week_stats[product_name]["total"] += total_sheets
        week_stats[product_name]["first"] += ds_first
        week_stats[product_name]["defect"] += ds_def
        
        pct_first = (ds_first / total_sheets) if total_sheets > 0 else 0
        pct_defect = (ds_def / total_sheets) if total_sheets > 0 else 0
        note_first = ""
        
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
            ds_first,
            pct_first,
            note_first,
            ds_def,
            pct_defect,
            note_defect
        ])
        
    # Append remaining summaries for the last week
    if week_stats:
        append_week_summaries(week_stats)
        
    service.spreadsheets().values().clear(
        spreadsheetId=SPREADSHEET_ID,
        range=f"'{sheet_name}'!A1:Z2000"
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
            "updateSheetProperties": {
                "properties": {
                    "sheetId": sheet_id,
                    "gridProperties": {
                        "frozenRowCount": 1
                    }
                },
                "fields": "gridProperties.frozenRowCount"
            }
        },
        {
            "setBasicFilter": {
                "filter": {
                    "range": {
                        "sheetId": sheet_id,
                        "startRowIndex": 0,
                        "endRowIndex": max(len(rows_data), 2),
                        "startColumnIndex": 0,
                        "endColumnIndex": len(headers)
                    }
                }
            }
        },
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
                    "startColumnIndex": 5,
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
                    "startColumnIndex": 8,
                    "endColumnIndex": 9
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
    
    # Bold formatting for summary rows
    for r_idx in summary_bold_rows:
        requests.append({
            "repeatCell": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": r_idx,
                    "endRowIndex": r_idx + 1,
                    "startColumnIndex": 2, # Apply bold starting from "Продукт"
                    "endColumnIndex": len(headers)
                },
                "cell": {
                    "userEnteredFormat": {
                        "textFormat": {
                            "bold": True
                        }
                    }
                },
                "fields": "userEnteredFormat.textFormat.bold"
            }
        })
        
    # Send requests in batches of 10 to avoid payload size issues just in case, though it's usually fine up to 1000s
    service.spreadsheets().batchUpdate(spreadsheetId=SPREADSHEET_ID, body={"requests": requests}).execute()
    print("Отчет СКК с итогами успешно экспортирован.")
