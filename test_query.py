import sys
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import datetime
import json

from models import Shift, Base
from database import engine

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
db = SessionLocal()

# Check shifts from the DB for July 22, 2026
shifts = db.query(Shift).filter(Shift.date == datetime.date(2026, 7, 22)).all()
print("Shifts for 2026-07-22:")
for s in shifts:
    print(f"ID: {s.id}, Name: '{s.shift_name}', Line: '{s.line}'")
