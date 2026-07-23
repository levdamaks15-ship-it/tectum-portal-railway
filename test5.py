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

d = datetime.date(2026, 7, 22)
shift_name = "День"
line = "Линия 2"

shift = db.query(Shift).filter(
    Shift.date == d,
    Shift.shift_name == shift_name,
    Shift.line == line
).first()

if shift:
    print(f"Found shift! ID: {shift.id}")
else:
    print("Shift NOT found!")
