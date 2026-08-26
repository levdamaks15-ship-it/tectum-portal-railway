import json
import re
from google.oauth2 import service_account
from googleapiclient.discovery import build

creds = service_account.Credentials.from_service_account_info(
    json.load(open('google_credentials.json', 'r', encoding='utf-8')),
    scopes=['https://www.googleapis.com/auth/spreadsheets']
)
service = build('sheets', 'v4', credentials=creds)
spreadsheet_id = '1K6Lk0fVfVpfC7gpvg8Hlpj0IgTF9j5woLOWKquyFewc'

# Считываем старые данные
res = service.spreadsheets().values().get(spreadsheetId=spreadsheet_id, range='Трекер задач!B11:G100').execute()
raw_rows = res.get('values', [])

# Парсим данные
active_tasks = []
archive_tasks = []

all_assignees = set(['Левда М.', 'Булеханов', 'Булаханов К.', 'Курилова', 'Сазонов', 'Носиков', 'Хохлов', 'Батырбекова', 'Маулен'])
all_zones = set(['Ремонт и зоны', 'Инфостенды', 'Обучение', 'Цифровой портал', 'СКК', 'Документация', 'Цилиндры', 'Дестакер', 'Дозировка', 'ЗО', 'Зона двигателей', 'Слесарная мастерская'])

task_idx = 1
for r in raw_rows:
    if not r or len(r) < 3:
        continue
    week = r[0] if len(r) > 0 else ''
    category = r[1] if len(r) > 1 else ''
    task_text = r[2] if len(r) > 2 else ''
    status = r[3] if len(r) > 3 else 'В очереди'
    priority = r[4] if len(r) > 4 else 'Средний'
    note = r[5] if len(r) > 5 else ''
    
    author = 'Левда М.'
    assignee = 'Левда М.'
    deadline = ''
    comment = note
    
    # Пытаемся извлечь ответственного и срок из примечания
    if 'Ответственный:' in note:
        m_resp = re.search(r'Ответственный:\s*([^,;]+)', note)
        if m_resp:
            assignee = m_resp.group(1).strip()
            all_assignees.add(assignee)
    if 'Срок:' in note:
        m_srok = re.search(r'Срок:\s*([^,;]+)', note)
        if m_srok:
            deadline = m_srok.group(1).strip()
            
    # Чистим примечание от "Ответственный: ... Срок: ..." если там больше ничего нет
    clean_comment = re.sub(r'Ответственный:[^,;]+', '', comment)
    clean_comment = re.sub(r'Срок:[^,;]+', '', clean_comment).strip(' ,;')
    
    # Стандартизируем статус
    norm_status = '⚪ В очереди'
    if status in ['Выполнено', '🟢 Выполнено']:
        norm_status = '🟢 Выполнено'
    elif status in ['В процессе', 'В работе', '🟡 В работе']:
        norm_status = '🟡 В работе'
    elif status in ['Перенесено']:
        norm_status = '🟡 В работе'
    elif status in ['Запланировано']:
        norm_status = '⚪ В очереди'
        
    task_id = f'TSK-{task_idx:02d}'
    task_idx += 1
    
    if category:
        all_zones.add(category)
        
    # Разделяем на архив (прошлые закрытые) и активные
    if norm_status == '🟢 Выполнено' and ('27.07' in week or '03.08' in week):
        archive_tasks.append([task_id, week, category, task_text, author, assignee, norm_status, clean_comment])
    else:
        active_tasks.append([task_id, category, task_text, author, assignee, deadline, norm_status, clean_comment])

print(f'Подготовлено: {len(active_tasks)} активных задач, {len(archive_tasks)} архивных задач.')

# 1. Получаем существующие листы
meta = service.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
existing_sheets = {s['properties']['title']: s['properties']['sheetId'] for s in meta.get('sheets', [])}

requests = []

# Добавляем лист "Справочники", если нет
if 'Справочники' not in existing_sheets:
    requests.append({'addSheet': {'properties': {'title': 'Справочники'}}})

# Добавляем лист "Архив", если нет
if 'Архив' not in existing_sheets:
    requests.append({'addSheet': {'properties': {'title': 'Архив'}}})

# Добавляем лист "План на неделю", если нет
if 'План на неделю' not in existing_sheets:
    requests.append({'addSheet': {'properties': {'title': 'План на неделю', 'index': 0}}})

if requests:
    res = service.spreadsheets().batchUpdate(spreadsheetId=spreadsheet_id, body={'requests': requests}).execute()
    meta = service.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
    existing_sheets = {s['properties']['title']: s['properties']['sheetId'] for s in meta.get('sheets', [])}

main_sheet_id = existing_sheets['План на неделю']
archive_sheet_id = existing_sheets['Архив']
ref_sheet_id = existing_sheets['Справочники']

# Наполняем Лист Справочники
ref_data = [
    ['Сотрудник', 'Email для уведомлений', 'Зоны / Подразделения'],
    ['Левда М.', 'maksim@tectum.ru', 'Ремонт и зоны'],
    ['Булеханов', 'bulehanov@tectum.ru', 'Цилиндры'],
    ['Булаханов К.', 'bulahanov@tectum.ru', 'СКК'],
    ['Курилова', 'kurilova@tectum.ru', 'Инфостенды'],
    ['Сазонов', 'sazonov@tectum.ru', 'Обучение'],
    ['Носиков', 'nosikov@tectum.ru', 'Цифровой портал'],
    ['Хохлов', 'hohlov@tectum.ru', 'Дозировка'],
    ['Батырбекова', 'batyrbekova@tectum.ru', 'ЗО'],
    ['Маулен', 'maulen@tectum.ru', 'Зона двигателей'],
    ['', '', 'Дестакер'],
    ['', '', 'Документация'],
    ['', '', 'Слесарная мастерская'],
    ['', '', 'Механическая служба'],
    ['', '', 'Электрослужба'],
]

# Наполняем Лист Архив
archive_header = [['ID', 'Неделя / Период', 'Зона / Узел', 'Суть задачи', 'Автор', 'Исполнитель', 'Статус', 'Комментарий / Факт']]
archive_rows = archive_header + archive_tasks

# Наполняем Лист План на неделю
main_header = [
    ['', '📅 Текущая неделя:', 'Неделя 35 (25.08 - 31.08)', '', '', '', '', ''],
    ['', '', '', '', '', '', '', ''],
    ['ID', 'Зона / Узел', 'Суть задачи', 'Автор', 'Исполнитель', 'Срок', 'Статус', 'Комментарий / Факт']
]
main_rows = main_header + active_tasks

# Записываем значения
service.spreadsheets().values().update(spreadsheetId=spreadsheet_id, range='Справочники!A1:C20', valueInputOption='USER_ENTERED', body={'values': ref_data}).execute()
service.spreadsheets().values().update(spreadsheetId=spreadsheet_id, range='Архив!A1:H100', valueInputOption='USER_ENTERED', body={'values': archive_rows}).execute()
service.spreadsheets().values().update(spreadsheetId=spreadsheet_id, range='План на неделю!A1:H100', valueInputOption='USER_ENTERED', body={'values': main_rows}).execute()

# Форматирование и валидация
format_requests = [
    # Лист План на неделю: стили шапки
    {
        'repeatCell': {
            'range': {'sheetId': main_sheet_id, 'startRowIndex': 0, 'endRowIndex': 1, 'startColumnIndex': 1, 'endColumnIndex': 3},
            'cell': {
                'userEnteredFormat': {
                    'textFormat': {'bold': True, 'fontSize': 11},
                    'backgroundColor': {'red': 0.9, 'green': 0.92, 'blue': 0.95}
                }
            },
            'fields': 'userEnteredFormat(textFormat,backgroundColor)'
        }
    },
    {
        'repeatCell': {
            'range': {'sheetId': main_sheet_id, 'startRowIndex': 2, 'endRowIndex': 3, 'startColumnIndex': 0, 'endColumnIndex': 8},
            'cell': {
                'userEnteredFormat': {
                    'textFormat': {'bold': True, 'foregroundColor': {'red': 1.0, 'green': 1.0, 'blue': 1.0}, 'fontSize': 10},
                    'backgroundColor': {'red': 0.12, 'green': 0.16, 'blue': 0.23},
                    'horizontalAlignment': 'CENTER'
                }
            },
            'fields': 'userEnteredFormat(textFormat,backgroundColor,horizontalAlignment)'
        }
    },
    # Установка ширины колонок в "План на неделю"
    {'updateDimensionProperties': {'range': {'sheetId': main_sheet_id, 'dimension': 'COLUMNS', 'startIndex': 0, 'endIndex': 1}, 'properties': {'pixelSize': 75}, 'fields': 'pixelSize'}},
    {'updateDimensionProperties': {'range': {'sheetId': main_sheet_id, 'dimension': 'COLUMNS', 'startIndex': 1, 'endIndex': 2}, 'properties': {'pixelSize': 140}, 'fields': 'pixelSize'}},
    {'updateDimensionProperties': {'range': {'sheetId': main_sheet_id, 'dimension': 'COLUMNS', 'startIndex': 2, 'endIndex': 3}, 'properties': {'pixelSize': 360}, 'fields': 'pixelSize'}},
    {'updateDimensionProperties': {'range': {'sheetId': main_sheet_id, 'dimension': 'COLUMNS', 'startIndex': 3, 'endIndex': 4}, 'properties': {'pixelSize': 120}, 'fields': 'pixelSize'}},
    {'updateDimensionProperties': {'range': {'sheetId': main_sheet_id, 'dimension': 'COLUMNS', 'startIndex': 4, 'endIndex': 5}, 'properties': {'pixelSize': 130}, 'fields': 'pixelSize'}},
    {'updateDimensionProperties': {'range': {'sheetId': main_sheet_id, 'dimension': 'COLUMNS', 'startIndex': 5, 'endIndex': 6}, 'properties': {'pixelSize': 90}, 'fields': 'pixelSize'}},
    {'updateDimensionProperties': {'range': {'sheetId': main_sheet_id, 'dimension': 'COLUMNS', 'startIndex': 6, 'endIndex': 7}, 'properties': {'pixelSize': 130}, 'fields': 'pixelSize'}},
    {'updateDimensionProperties': {'range': {'sheetId': main_sheet_id, 'dimension': 'COLUMNS', 'startIndex': 7, 'endIndex': 8}, 'properties': {'pixelSize': 260}, 'fields': 'pixelSize'}},
    
    # Валидация для Зоны (колонка B = 1)
    {
        'setDataValidation': {
            'range': {'sheetId': main_sheet_id, 'startRowIndex': 3, 'endRowIndex': 100, 'startColumnIndex': 1, 'endColumnIndex': 2},
            'rule': {
                'condition': {'type': 'ONE_OF_RANGE', 'values': [{'userEnteredValue': '=Справочники!$C$2:$C$25'}]},
                'showCustomUi': True,
                'strict': False
            }
        }
    },
    # Валидация для Автора (D = 3) и Исполнителя (E = 4)
    {
        'setDataValidation': {
            'range': {'sheetId': main_sheet_id, 'startRowIndex': 3, 'endRowIndex': 100, 'startColumnIndex': 3, 'endColumnIndex': 5},
            'rule': {
                'condition': {'type': 'ONE_OF_RANGE', 'values': [{'userEnteredValue': '=Справочники!$A$2:$A$20'}]},
                'showCustomUi': True,
                'strict': False
            }
        }
    },
    # Валидация для Статуса (G = 6)
    {
        'setDataValidation': {
            'range': {'sheetId': main_sheet_id, 'startRowIndex': 3, 'endRowIndex': 100, 'startColumnIndex': 6, 'endColumnIndex': 7},
            'rule': {
                'condition': {
                    'type': 'ONE_OF_LIST',
                    'values': [
                        {'userEnteredValue': '⚪ В очереди'},
                        {'userEnteredValue': '🟡 В работе'},
                        {'userEnteredValue': '🟢 Выполнено'},
                        {'userEnteredValue': '🔴 Проблема'}
                    ]
                },
                'showCustomUi': True,
                'strict': True
            }
        }
    },
    
    # Условное форматирование: Зеленый цвет при Выполнено
    {
        'addConditionalFormatRule': {
            'rule': {
                'ranges': [{'sheetId': main_sheet_id, 'startRowIndex': 3, 'endRowIndex': 100, 'startColumnIndex': 0, 'endColumnIndex': 8}],
                'booleanRule': {
                    'condition': {'type': 'CUSTOM_FORMULA', 'values': [{'userEnteredValue': '=$G4="🟢 Выполнено"'}]},
                    'format': {
                        'backgroundColor': {'red': 0.86, 'green': 0.98, 'blue': 0.90},
                        'textFormat': {'foregroundColor': {'red': 0.08, 'green': 0.40, 'blue': 0.20}}
                    }
                }
            },
            'index': 0
        }
    },
    # Условное форматирование: Желтый цвет при В работе
    {
        'addConditionalFormatRule': {
            'rule': {
                'ranges': [{'sheetId': main_sheet_id, 'startRowIndex': 3, 'endRowIndex': 100, 'startColumnIndex': 0, 'endColumnIndex': 8}],
                'booleanRule': {
                    'condition': {'type': 'CUSTOM_FORMULA', 'values': [{'userEnteredValue': '=$G4="🟡 В работе"'}]},
                    'format': {
                        'backgroundColor': {'red': 0.99, 'green': 0.98, 'blue': 0.88}
                    }
                }
            },
            'index': 1
        }
    },
    # Условное форматирование: Красный цвет при Проблема
    {
        'addConditionalFormatRule': {
            'rule': {
                'ranges': [{'sheetId': main_sheet_id, 'startRowIndex': 3, 'endRowIndex': 100, 'startColumnIndex': 0, 'endColumnIndex': 8}],
                'booleanRule': {
                    'condition': {'type': 'CUSTOM_FORMULA', 'values': [{'userEnteredValue': '=$G4="🔴 Проблема"'}]},
                    'format': {
                        'backgroundColor': {'red': 0.99, 'green': 0.88, 'blue': 0.88},
                        'textFormat': {'foregroundColor': {'red': 0.60, 'green': 0.10, 'blue': 0.10}, 'bold': True}
                    }
                }
            },
            'index': 2
        }
    },
    # Стили листа Архив
    {
        'repeatCell': {
            'range': {'sheetId': archive_sheet_id, 'startRowIndex': 0, 'endRowIndex': 1, 'startColumnIndex': 0, 'endColumnIndex': 8},
            'cell': {
                'userEnteredFormat': {
                    'textFormat': {'bold': True, 'foregroundColor': {'red': 1.0, 'green': 1.0, 'blue': 1.0}, 'fontSize': 10},
                    'backgroundColor': {'red': 0.28, 'green': 0.33, 'blue': 0.41},
                    'horizontalAlignment': 'CENTER'
                }
            },
            'fields': 'userEnteredFormat(textFormat,backgroundColor,horizontalAlignment)'
        }
    }
]

service.spreadsheets().batchUpdate(spreadsheetId=spreadsheet_id, body={'requests': format_requests}).execute()
print('Успешно обновлена Google Таблица!')
