from sqlalchemy import Column, Integer, String, Float, ForeignKey, DateTime, Date, Boolean
from sqlalchemy.orm import relationship
import datetime
from database import Base

class Master(Base):
    __tablename__ = "masters"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    email = Column(String, unique=True, index=True, nullable=True) # Corporate email for SSO
    pin = Column(String)  # 4-значный ПИН-код
    role = Column(String, default="master") # master, zo, lfm, stacker, destacker, qcd

class Shift(Base):
    __tablename__ = "shifts"
    id = Column(Integer, primary_key=True, index=True)
    date = Column(Date)
    shift_name = Column(String) # "День", "Ночь"
    master_id = Column(Integer, ForeignKey("masters.id"))
    line = Column(String) # "Линия 1", "Линия 2"
    status = Column(String, default="active") # active, closed
    sharepoint_url = Column(String(500), nullable=True)
    
    # План
    plan_sheets = Column(Integer, default=0)
    plan_tons = Column(Float, default=0.0)
    
    # --- 1. Склад (Приход сырья) ---
    receipt_chrysotile_4_20 = Column(Float, default=0.0)
    receipt_chrysotile_5_65 = Column(Float, default=0.0)
    receipt_chrysotile_6_40 = Column(Float, default=0)
    receipt_cement = Column(Float, default=0)
    receipt_cellulose = Column(Float, default=0)
    receipt_crushed_slate = Column(Float, default=0)
    receipt_asbozurit = Column(Float, default=0)
    receipt_asbocarton = Column(Float, default=0.0)
    receipt_pallets = Column(Float, default=0.0)
    receipt_fiberglass = Column(Float, default=0)
    receipt_laprol = Column(Float, default=0)
    
    # ЗО ФАКТ РАСХОД
    zo_chrysotile_4_20 = Column(Float, default=0)
    zo_chrysotile_5_65 = Column(Float, default=0)
    zo_chrysotile_6_40 = Column(Float, default=0)
    zo_cement = Column(Float, default=0)  # Legacy total
    zo_cement_silo1 = Column(Float, default=0)
    zo_cement_silo2 = Column(Float, default=0)
    zo_cement_silo3 = Column(Float, default=0)
    zo_cement_silo4 = Column(Float, default=0)
    zo_cellulose = Column(Float, default=0)
    zo_crushed_slate = Column(Float, default=0)
    zo_asbozurit = Column(Float, default=0)
    zo_fiberglass = Column(Float, default=0)
    zo_laprol = Column(Float, default=0)
    zo_asbocarton = Column(Float, default=0)
    zo_asb_drain = Column(Float, default=0)
    zo_cem_drain = Column(Float, default=0)
    lfm_asb_drain = Column(Float, default=0)
    lfm_cem_drain = Column(Float, default=0)
    zo_batches = Column(Integer, default=0)
    
    zo_submitted = Column(Boolean, default=False)

    
    master = relationship("Master")
    batches = relationship("Batch", back_populates="shift")
    lfm_reports = relationship("LFMReport", back_populates="shift")
    downtimes = relationship("Downtime", back_populates="shift")

class Downtime(Base):
    __tablename__ = "downtimes"
    id = Column(Integer, primary_key=True, index=True)
    shift_id = Column(Integer, ForeignKey("shifts.id"))
    start_time = Column(String)
    end_time = Column(String, nullable=True)
    duration = Column(Integer, default=0)
    category = Column(String, nullable=True)
    department = Column(String, nullable=True)
    node = Column(String)
    description = Column(String, nullable=True)
    media_urls = Column(String, nullable=True) # JSON string
    is_active = Column(Boolean, default=True)
    lost_tons = Column(Float, default=0.0)
    lost_tenge = Column(Float, default=0.0)
    status = Column(String, default="pending") # pending, resolved
    is_equipment_downtime = Column(Boolean, default=True)

    shift = relationship("Shift", back_populates="downtimes")

class LFMReport(Base):
    __tablename__ = "lfm_reports"
    id = Column(Integer, primary_key=True, index=True)
    shift_id = Column(Integer, ForeignKey("shifts.id"))
    product_name = Column(String)
    lfm_sheets = Column(Integer)
    lfm_wind_resets = Column(Integer)
    formed_1st_grade = Column(Integer, default=0)
    formed_defect = Column(Integer, default=0)
    transferred_to_warehouse = Column(Integer, default=0)
    
    shift = relationship("Shift", back_populates="lfm_reports")

class Batch(Base):
    __tablename__ = "batches"
    id = Column(Integer, primary_key=True, index=True)
    shift_id = Column(Integer, ForeignKey("shifts.id")) # Смена, в которую партия была создана Стакером
    batch_number = Column(String) # например, "0154"
    product_name = Column(String) # "8 волн"
    status = Column(String, default="stacked") # "stacked", "destacked", "qcd_checked"
    
    # --- 4. Стакер (Укладчик) ---
    stacked_stacks = Column(Integer, default=0) # Уложено в стопах
    
    # --- 5. Разборщик (Destacker) ---
    ds_condition = Column(Integer, default=0) # Кондиция
    ds_first_grade = Column(Integer, default=0) # 1 сорт
    ds_defect = Column(Integer, default=0) # Итого брак Разборщика (сумма 11 полей ниже)
    
    # Детализация брака (Дестакер)
    ds_defect_chip = Column(Integer, default=0) # Скол
    ds_defect_scratch = Column(Integer, default=0) # Сдир
    ds_defect_bad_cut = Column(Integer, default=0) # Плохой рез
    ds_defect_stick_bottom = Column(Integer, default=0) # Налип снизу
    ds_defect_stick_top = Column(Integer, default=0) # Налип сверху пленка
    ds_defect_broken = Column(Integer, default=0) # Сломан
    ds_defect_fell_box = Column(Integer, default=0) # Упал коробки
    ds_defect_dent = Column(Integer, default=0) # Вмятина
    ds_defect_thickness = Column(Integer, default=0) # Не соотв. толщины
    ds_defect_delamination = Column(Integer, default=0) # Расслоение
    ds_defect_edge = Column(Integer, default=0) # Кромка не соотв.
    
    # --- 6. СКК (ОТК) ---
    qcd_condition = Column(Integer, default=0) 
    qcd_first_grade = Column(Integer, default=0)
    qcd_defect = Column(Integer, default=0)
    
    shift = relationship("Shift", back_populates="batches")

class ProductNorm(Base):
    __tablename__ = "product_norms"
    id = Column(Integer, primary_key=True, index=True)
    product_name = Column(String, unique=True, index=True)
    weight_kg = Column(Float, default=0.0)
    
    norm_chrysotile_4_20 = Column(Float, default=0.0)
    norm_chrysotile_5_65 = Column(Float, default=0.0)
    norm_chrysotile_6_40 = Column(Float, default=0.0)
    norm_cement = Column(Float, default=0.0)
    norm_cellulose = Column(Float, default=0.0)
    norm_crushed_slate = Column(Float, default=0.0)
    norm_asbozurit = Column(Float, default=0.0)
    norm_fiberglass = Column(Float, default=0.0)

class MonthlyPlanBoard(Base):
    __tablename__ = "monthly_plan_board"
    id = Column(Integer, primary_key=True, index=True)
    date = Column(Date, index=True)
    shift_name = Column(String) # "День", "Ночь"
    master_id = Column(Integer, ForeignKey("masters.id"))
    shift_number = Column(Integer) # Смена из Excel
    line = Column(String) # "ЛФМ-1" или "ЛФМ-2"
    plan_sheets = Column(Integer, default=0)
    fact_sheets = Column(Integer, default=0)
    first_grade = Column(Integer, default=0)
    defect = Column(Integer, default=0)

    master = relationship("Master")

class AuditLog(Base):
    __tablename__ = "audit_logs"
    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow)
    user_name = Column(String, nullable=True)
    action = Column(String)  # "CREATE", "UPDATE", "DELETE", "IMPORT"
    target_table = Column(String)
    target_id = Column(Integer, nullable=True)
    details = Column(String, nullable=True)

class DowntimeDirectory(Base):
    __tablename__ = "downtime_directory"
    id = Column(Integer, primary_key=True, index=True)
    department = Column(String)
    node = Column(String)
    breakdown = Column(String)
    category = Column(String, nullable=True)
    comment = Column(String, nullable=True)


