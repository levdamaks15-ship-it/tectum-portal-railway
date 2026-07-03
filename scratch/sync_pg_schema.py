import os
import sys
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv()

db_url = os.getenv("DATABASE_URL")
if not db_url:
    print("No DATABASE_URL set.")
    sys.exit(1)

if db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql://", 1)

engine = create_engine(db_url)

# Add missing columns to downtimes if they don't exist
with engine.connect() as conn:
    # Check if department column exists in downtimes
    res = conn.execute(text("""
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name='downtimes' AND column_name='department';
    """)).fetchone()
    
    if not res:
        print("Adding column 'department' to table 'downtimes'...")
        conn.execute(text("ALTER TABLE downtimes ADD COLUMN department VARCHAR;"))
        conn.commit()
        print("Column 'department' added successfully.")
    else:
        print("Column 'department' already exists in 'downtimes'.")

    # Check if is_equipment_downtime column exists in downtimes
    res_eq = conn.execute(text("""
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name='downtimes' AND column_name='is_equipment_downtime';
    """)).fetchone()
    
    if not res_eq:
        print("Adding column 'is_equipment_downtime' to table 'downtimes'...")
        conn.execute(text("ALTER TABLE downtimes ADD COLUMN is_equipment_downtime BOOLEAN DEFAULT TRUE;"))
        conn.commit()
        print("Column 'is_equipment_downtime' added successfully.")
    else:
        print("Column 'is_equipment_downtime' already exists in 'downtimes'.")
        
    # Check other tables if necessary
    # Let's check downtime_directory table columns
    res_dir = conn.execute(text("""
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name='downtime_directory' AND column_name='department';
    """)).fetchone()
    if not res_dir:
        print("Creating table downtime_directory...")
        from database import Base
        import models
        Base.metadata.create_all(bind=engine)
        print("Metadata create_all run.")
        
    # Check if category column exists in downtime_directory
    res_cat = conn.execute(text("""
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name='downtime_directory' AND column_name='category';
    """)).fetchone()
    if not res_cat:
        print("Adding column 'category' to table 'downtime_directory'...")
        conn.execute(text("ALTER TABLE downtime_directory ADD COLUMN category VARCHAR;"))
        conn.commit()
        print("Column 'category' added successfully.")

    # Check Shift columns for Asbocarton and Drains
    for col in ['zo_asbocarton', 'lfm_asb_drain', 'lfm_cem_drain']:
        res_shift_col = conn.execute(text(f"""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name='shifts' AND column_name='{col}';
        """)).fetchone()
        if not res_shift_col:
            print(f"Adding column '{col}' to table 'shifts'...")
            conn.execute(text(f"ALTER TABLE shifts ADD COLUMN {col} DOUBLE PRECISION DEFAULT 0.0;"))
            conn.commit()
            print(f"Column '{col}' added successfully.")
        else:
            print(f"Column '{col}' already exists in 'shifts'.")

    # Check Shift column for sharepoint_url
    res_sp_col = conn.execute(text("""
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name='shifts' AND column_name='sharepoint_url';
    """)).fetchone()
    if not res_sp_col:
        print("Adding column 'sharepoint_url' to table 'shifts'...")
        conn.execute(text("ALTER TABLE shifts ADD COLUMN sharepoint_url VARCHAR(500);"))
        conn.commit()
        print("Column 'sharepoint_url' added successfully.")
    else:
        print("Column 'sharepoint_url' already exists in 'shifts'.")


