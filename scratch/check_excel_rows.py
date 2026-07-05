import openpyxl

wb = openpyxl.load_workbook("docs/excel/рапорт_АЦИ 10.06.26..xlsx", data_only=True)
ws = wb["рапорт"]

valid_rows = []
for row in ws.iter_rows(values_only=True):
    # row[1] is batch_number, row[5] is product, row[4] is master
    if row[0] and row[1] and row[5]:
        valid_rows.append(row)

print(f"Total valid rows with batch & product: {len(valid_rows)}")
print("\nLast 15 valid rows:")
for row in valid_rows[-15:]:
    print(row[:6])
