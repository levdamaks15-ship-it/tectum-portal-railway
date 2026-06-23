import openpyxl

wb = openpyxl.load_workbook('docs/excel/рапорт_АЦИ 10.06.26..xlsx', data_only=True)
sheet = wb['инфо']
for row in sheet.iter_rows(min_row=1, max_row=20, values_only=True):
    print(row)
