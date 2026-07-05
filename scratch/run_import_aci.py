import sys
import os

# Add the project root to the path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import SessionLocal
import import_aci_excel

def run_import():
    db = SessionLocal()
    excel_path = os.path.join("docs", "excel", "рапорт_АЦИ 10.06.26..xlsx")
    try:
        print(f"Starting import from {excel_path}...")
        result = import_aci_excel.import_aci_excel_data(excel_path, db)
        print("Import completed successfully!")
        print(f"Result: {result}")
    except Exception as e:
        print(f"Import failed: {e}")
    finally:
        db.close()

if __name__ == '__main__':
    run_import()
