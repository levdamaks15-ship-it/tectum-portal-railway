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
    batch_number = Column(String, default="", nullable=True)
    product_name = Column(String, default="", nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    
    # План
    plan_sheets = Column(Integer, default=0)
    plan_tons = Column(Float, default=0.0)
    
    # --- 1. Склад (Приход сырья) ---
    # Поля прихода сырья вынесены в отдельную таблицу RawMaterialReceipt
    
    # ЗО ФАКТ РАСХОД
    zo_chrysotile_4_20 = Column(Float, default=0)
    zo_chrysotile_4_20_silo1 = Column(Float, default=0)
    zo_chrysotile_4_20_silo2 = Column(Float, default=0)
    zo_chrysotile_4_20_silo3 = Column(Float, default=0)
    zo_chrysotile_4_20_silo4 = Column(Float, default=0)
    
    zo_chrysotile_5_65 = Column(Float, default=0)
    zo_chrysotile_5_65_silo1 = Column(Float, default=0)
    zo_chrysotile_5_65_silo2 = Column(Float, default=0)
    zo_chrysotile_5_65_silo3 = Column(Float, default=0)
    zo_chrysotile_5_65_silo4 = Column(Float, default=0)
    
    zo_chrysotile_6_40 = Column(Float, default=0)
    zo_chrysotile_6_40_silo1 = Column(Float, default=0)
    zo_chrysotile_6_40_silo2 = Column(Float, default=0)
    zo_chrysotile_6_40_silo3 = Column(Float, default=0)
    zo_chrysotile_6_40_silo4 = Column(Float, default=0)
    
    zo_cement = Column(Float, default=0)  # Legacy total
    zo_cement_silo1 = Column(Float, default=0)
    zo_cement_silo2 = Column(Float, default=0)
    zo_cement_silo3 = Column(Float, default=0)
    zo_cement_silo4 = Column(Float, default=0)
    
    zo_cellulose = Column(Float, default=0)
    zo_cellulose_silo1 = Column(Float, default=0)
    zo_cellulose_silo2 = Column(Float, default=0)
    zo_cellulose_silo3 = Column(Float, default=0)
    zo_cellulose_silo4 = Column(Float, default=0)
    
    zo_crushed_slate = Column(Float, default=0)
    zo_crushed_slate_silo1 = Column(Float, default=0)
    zo_crushed_slate_silo2 = Column(Float, default=0)
    zo_crushed_slate_silo3 = Column(Float, default=0)
    zo_crushed_slate_silo4 = Column(Float, default=0)
    
    zo_asbozurit = Column(Float, default=0)
    zo_asbozurit_silo1 = Column(Float, default=0)
    zo_asbozurit_silo2 = Column(Float, default=0)
    zo_asbozurit_silo3 = Column(Float, default=0)
    zo_asbozurit_silo4 = Column(Float, default=0)
    
    zo_fiberglass = Column(Float, default=0)
    zo_fiberglass_silo1 = Column(Float, default=0)
    zo_fiberglass_silo2 = Column(Float, default=0)
    zo_fiberglass_silo3 = Column(Float, default=0)
    zo_fiberglass_silo4 = Column(Float, default=0)
    
    zo_laprol = Column(Float, default=0)
    zo_laprol_silo1 = Column(Float, default=0)
    zo_laprol_silo2 = Column(Float, default=0)
    zo_laprol_silo3 = Column(Float, default=0)
    zo_laprol_silo4 = Column(Float, default=0)
    
    zo_asbocarton = Column(Float, default=0)
    zo_asbocarton_silo1 = Column(Float, default=0)
    zo_asbocarton_silo2 = Column(Float, default=0)
    zo_asbocarton_silo3 = Column(Float, default=0)
    zo_asbocarton_silo4 = Column(Float, default=0)
    
    zo_asb_drain = Column(Float, default=0)
    zo_cem_drain = Column(Float, default=0)
    lfm_asb_drain = Column(Float, default=0)
    lfm_cem_drain = Column(Float, default=0)
    zo_batches = Column(Integer, default=0)
    
    zo_submitted = Column(Boolean, default=False)

    
    master = relationship("Master")
    batches = relationship("Batch", back_populates="shift", order_by="Batch.id")
    lfm_reports = relationship("LFMReport", back_populates="shift", order_by="LFMReport.id")
    downtimes = relationship("Downtime", back_populates="shift", order_by="Downtime.start_time")
    receipts = relationship("RawMaterialReceipt", back_populates="shift", cascade="all, delete-orphan", order_by="RawMaterialReceipt.id")

class RawMaterialReceipt(Base):
    __tablename__ = "raw_material_receipts"
    id = Column(Integer, primary_key=True, index=True)
    shift_id = Column(Integer, ForeignKey("shifts.id"))
    master_id = Column(Integer, ForeignKey("masters.id"), nullable=True)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow)
    
    master = relationship("Master")
    
    chrysotile_4_20 = Column(Float, default=0.0)
    chrysotile_5_65 = Column(Float, default=0.0)
    chrysotile_6_40 = Column(Float, default=0.0)
    
    cement_silo1 = Column(Float, default=0.0)
    cement_silo2 = Column(Float, default=0.0)
    cement_silo3 = Column(Float, default=0.0)
    cement_silo4 = Column(Float, default=0.0)
    
    cellulose = Column(Float, default=0.0)
    crushed_slate = Column(Float, default=0.0)
    asbozurit = Column(Float, default=0.0)
    asbocarton = Column(Float, default=0.0)
    pallets = Column(Float, default=0.0)
    fiberglass = Column(Float, default=0.0)
    laprol = Column(Float, default=0.0)
    
    shift = relationship("Shift", back_populates="receipts")

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
    comment = Column(String, nullable=True)
    media_urls = Column(String, nullable=True) # JSON string
    is_active = Column(Boolean, default=True)
    lost_tons = Column(Float, default=0.0)
    lost_tenge = Column(Float, default=0.0)
    status = Column(String, default="pending") # pending, resolved
    is_equipment_downtime = Column(Boolean, default=True)
    breakdowns = Column(String, nullable=True) # JSON string of breakdown objects
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

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
    qcd_sorted_packs = Column(Integer, default=0)
    qcd_first_grade = Column(Integer, default=0)
    qcd_first_grade_note = Column(String, nullable=True)
    qcd_defect = Column(Integer, default=0)
    qcd_defect_note = Column(String, nullable=True)
    
    # Детализация брака (СКК)
    qcd_defect_chip = Column(Integer, default=0)
    qcd_defect_scratch = Column(Integer, default=0)
    qcd_defect_bad_cut = Column(Integer, default=0)
    qcd_defect_stick_bottom = Column(Integer, default=0)
    qcd_defect_stick_top = Column(Integer, default=0)
    qcd_defect_broken = Column(Integer, default=0)
    qcd_defect_fell_box = Column(Integer, default=0)
    qcd_defect_dent = Column(Integer, default=0)
    qcd_defect_thickness = Column(Integer, default=0)
    qcd_defect_delamination = Column(Integer, default=0)
    qcd_defect_edge = Column(Integer, default=0)
    
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

class DocumentCategory(Base):
    __tablename__ = "document_categories"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String)
    parent_id = Column(Integer, ForeignKey("document_categories.id"), nullable=True)
    password_hash = Column(String, nullable=True)
    google_drive_folder_id = Column(String, nullable=True)

class Document(Base):
    __tablename__ = "documents"
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String)
    category_id = Column(Integer, ForeignKey("document_categories.id"))
    file_path = Column(String, nullable=True)
    mime_type = Column(String, nullable=True)
    uploaded_at = Column(DateTime, default=datetime.datetime.utcnow)
    google_drive_id = Column(String, nullable=True)
    google_drive_url = Column(String, nullable=True)
    r2_key = Column(String, nullable=True) # Key in Cloudflare R2 bucket
    docspace_file_id = Column(Integer, nullable=True) # ID of the document in ONLYOFFICE DocSpace
    koofr_path = Column(String, nullable=True) # Path in Koofr Cloud
    koofr_link = Column(String, nullable=True) # Sharing/View Link in Koofr Cloud
    yandex_path = Column(String, nullable=True) # Remote path in Yandex Disk
    yandex_url = Column(String, nullable=True) # Public edit/view URL in Yandex Disk
    external_url = Column(String, nullable=True) # Внешняя ссылка (OneDrive, Google Docs, etc)
    
    # Versioning & Check-out fields
    version_number = Column(Integer, default=1)
    locked_by_user = Column(String, nullable=True) # Имя сотрудника, взявшего файл на редактирование
    locked_at = Column(DateTime, nullable=True)    # Время блокировки
    last_modified_by = Column(String, nullable=True) # Кто загрузил последнюю версию

    versions = relationship("DocumentVersion", back_populates="document", cascade="all, delete-orphan", order_by="DocumentVersion.version_number.desc()")

class DocumentVersion(Base):
    __tablename__ = "document_versions"
    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("documents.id"))
    version_number = Column(Integer, default=1)
    file_path = Column(String, nullable=False)
    file_size = Column(Integer, default=0)
    mime_type = Column(String, nullable=True)
    author_name = Column(String, default="Сотрудник")
    comment = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    document = relationship("Document", back_populates="versions")

class Task(Base):
    __tablename__ = "tasks"
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    description = Column(String, nullable=True)
    category = Column(String, nullable=True) # "СКК", "Ремонт и зоны", "Цифровой портал", "Обучение", "Документация", "Инфостенды", "Цилиндры", "ТОиР", "Охрана труда"
    priority = Column(String, default="Средний") # "Высокий", "Средний", "Низкий", "Критический"
    status = Column(String, default="Запланировано") # "Запланировано", "В процессе", "Выполнено", "Перенесено", "Отменено"
    assigned_master_id = Column(Integer, ForeignKey("masters.id"), nullable=True)
    assignee_custom = Column(String, nullable=True)
    creator_name = Column(String, nullable=True)
    due_date = Column(Date, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    week_label = Column(String, nullable=True, index=True) # например, "Неделя с 17.08.2026"
    attached_document_id = Column(Integer, ForeignKey("documents.id"), nullable=True)
    google_doc_url = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    assigned_master = relationship("Master", foreign_keys=[assigned_master_id])
    attached_document = relationship("Document", foreign_keys=[attached_document_id])

class ChecklistEmployee(Base):
    __tablename__ = "checklist_employees"
    id = Column(Integer, primary_key=True, index=True)
    num = Column(Integer, nullable=True)
    shift_group = Column(String, index=True) # "1-я смена", "2-я смена", "3-я смена", "4-я смена", "Котельная", "Дневной персонал"
    position = Column(String, index=True)    # "Мастер", "Машинист", "Оператор дестакера" и т.д.
    name = Column(String, index=True)        # ФИО
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

class ShiftScheduleEntry(Base):
    __tablename__ = "shift_schedule_entries"
    id = Column(Integer, primary_key=True, index=True)
    date_str = Column(String, index=True)    # "01.08.2026"
    day_of_week = Column(String)             # "Сб", "Пн" и т.д.
    shift1_status = Column(String)           # "О", "В", "Н", "Д"
    shift2_status = Column(String)
    shift3_status = Column(String)
    shift4_status = Column(String)
    day_shift_group = Column(String)         # "Смена 4" (08:00 - 19:00)
    night_shift_group = Column(String)       # "Смена 3" (19:00 - 08:00)

class ChecklistSubmission(Base):
    __tablename__ = "checklist_submissions"
    id = Column(Integer, primary_key=True, index=True)
    template_code = Column(String, index=True) # "master_shift", "worker_shift_handover", "day_inspection"
    template_title = Column(String)            # "Чек-лист мастера смены", "Чек-лист приема-передачи смены"
    date_str = Column(String, index=True)      # "19.08.2026"
    shift_name = Column(String)                # "День", "Ночь", "Дневная"
    shift_group = Column(String, nullable=True) # "Смена 1", "Смена 2" и т.д.
    department = Column(String, nullable=True) # Участок: "ЛФМ", "Дестакер", "ЗО", "Котельная", "Общий"
    
    # Принимающий / Проверяющий
    inspector_name = Column(String, index=True)
    inspector_position = Column(String, nullable=True)
    
    # Сдающий
    submitter_name = Column(String, nullable=True, index=True)
    submitter_position = Column(String, nullable=True)
    
    status = Column(String, default="completed") # "completed", "with_remarks"
    remarks_count = Column(Integer, default=0)
    notes = Column(String, nullable=True)       # Общие примечания / замечания
    
    # Содержимое пунктов проверки (JSON)
    items_data = Column(String)                 # JSON array: [{ index, title, status: "ok"|"fail", comment }]
    
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    google_synced = Column(Boolean, default=False)
    google_sync_error = Column(String, nullable=True)
