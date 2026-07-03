import os
import sys
from dotenv import load_dotenv

# Add project root to python path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv()

from database import SessionLocal
import models
import excel_exporter
import m365_integration

def run_test():
    db = SessionLocal()
    try:
        print("1. Testing create_initial_directories_xlsx...")
        dir_bytes = excel_exporter.create_initial_directories_xlsx(db)
        print(f"Generated directory template size: {len(dir_bytes)} bytes")
        
        print("\n2. Testing check_file_exists_on_sharepoint...")
        exists = m365_integration.check_file_exists_on_sharepoint("Справочники_Tectum.xlsx", folder="Shifts")
        print(f"File Справочники_Tectum.xlsx exists on SharePoint: {exists}")
        
        # If it doesn't exist, try uploading the template
        if not exists:
            print("\n2.1. Uploading initial Справочники_Tectum.xlsx to SharePoint...")
            url = m365_integration.upload_file_to_sharepoint(dir_bytes, "Справочники_Tectum.xlsx", folder="Shifts")
            print(f"Successfully uploaded template. SharePoint URL: {url}")
            
            print("\n2.2. Checking existence again...")
            exists_now = m365_integration.check_file_exists_on_sharepoint("Справочники_Tectum.xlsx", folder="Shifts")
            print(f"File exists now: {exists_now}")
            
        print("\n3. Testing download_file_from_sharepoint...")
        dl_bytes = m365_integration.download_file_from_sharepoint("Справочники_Tectum.xlsx", folder="Shifts")
        print(f"Downloaded file size: {len(dl_bytes)} bytes")
        
        print("\n4. Testing sync_directories_from_excel_bytes...")
        excel_exporter.sync_directories_from_excel_bytes(dl_bytes, db)
        print("Reference directories synced successfully from SharePoint Excel.")
        
        print("\n5. Testing generate_shift_excel_passport...")
        # Get first shift from db
        shift = db.query(models.Shift).first()
        if shift:
            print(f"Generating passport for shift ID: {shift.id} (Date: {shift.date})")
            pass_bytes, filename = excel_exporter.generate_shift_excel_passport(shift.id, db)
            print(f"Passport file size: {len(pass_bytes)} bytes, Filename: {filename}")
            
            print("\n6. Testing passport upload to SharePoint...")
            sp_url = m365_integration.upload_file_to_sharepoint(pass_bytes, filename, folder="Shifts")
            print(f"Passport uploaded successfully to SharePoint! URL: {sp_url}")
            
            # Save to db
            shift.sharepoint_url = sp_url
            db.commit()
            print("Successfully saved sharepoint_url to database.")
        else:
            print("No shifts found in database to test passport generation.")
            
        print("\nALL TESTS PASSED SUCCESSFULLY!")
        
    except Exception as e:
        print(f"\nTEST FAILED WITH ERROR: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    run_test()
