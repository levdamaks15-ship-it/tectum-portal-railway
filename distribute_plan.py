import openpyxl
from datetime import datetime

def generate_plan():
    file_path = "monthly_plan_board.xlsx"
    wb = openpyxl.load_workbook(file_path)
    ws = wb.active
    
    total_plan = 0
    updated_rows = 0
    
    # Iterate through rows starting from Row 2 (headers are in Row 1)
    for row in ws.iter_rows(min_row=2):
        date_cell = row[0]
        shift_cell = row[2]
        plan_cell = row[6]
        
        date_val = date_cell.value
        if not date_val:
            continue
            
        if isinstance(date_val, datetime):
            dt = date_val.date()
        elif isinstance(date_val, str):
            try:
                dt = datetime.strptime(date_val, "%d.%m.%Y").date()
            except ValueError:
                try:
                    dt = datetime.strptime(date_val, "%Y-%m-%d").date()
                except ValueError:
                    continue
        else:
            continue
            
        shift_name = str(shift_cell.value).strip() if shift_cell.value else "День"
        
        # Calculate plan sheets based on factory standard norms:
        # - Monday Day = 0
        # - Normal Day = 2700
        # - Night = 3300
        if dt.weekday() == 0 and shift_name == "День":
            plan_sheets = 0
        else:
            plan_sheets = 2700 if shift_name == "День" else 3300
            
        plan_cell.value = plan_sheets
        total_plan += plan_sheets
        updated_rows += 1
        
    wb.save(file_path)
    print(f"Successfully updated {updated_rows} rows in {file_path} in-place.")
    print(f"Total plan: {total_plan} sheets.")

if __name__ == '__main__':
    generate_plan()
