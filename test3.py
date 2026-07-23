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
for s in shifts:
    print(repr(s.date), repr(s.shift_name), repr(s.line))
