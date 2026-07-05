import sys
import os

# Add the project root to the path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import SessionLocal
import excel_exporter
import m365_integration
import models

def upload_summary():
    db = SessionLocal()
    try:
        print("Generating flat report from DB...")
        file_bytes = excel_exporter.generate_flat_report(db)
        
        filename = "Сводный_отчет_Tectum.xlsx"
        # Save locally as well
        local_path = os.path.join("static", filename)
        with open(local_path, "wb") as f:
            f.write(file_bytes)
        print(f"Saved local copy to {local_path}")
        
        print("Uploading to SharePoint folder 'Reports'...")
        web_url = m365_integration.upload_file_to_sharepoint(file_bytes, filename, folder="Reports")
        print(f"Successfully uploaded to SharePoint! URL: {web_url}")
        
        print("Updating shifts with new sharepoint_url...")
        shifts = db.query(models.Shift).all()
        for s in shifts:
            s.sharepoint_url = web_url
        db.commit()
        print(f"Updated {len(shifts)} shifts.")
        
    except Exception as e:
        print(f"Upload failed: {e}")
    finally:
        db.close()

if __name__ == '__main__':
    upload_summary()
