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

shifts = db.query(Shift).filter(Shift.date == d).all()
with open('test_out.json', 'w', encoding='utf-8') as f:
    json.dump([[repr(s.date), s.shift_name, s.line] for s in shifts], f, ensure_ascii=False)
