from pydantic import BaseModel, model_validator
from pydantic_core import PydanticUndefined
from typing import List, Optional
from datetime import date, datetime

class ORMBaseModel(BaseModel):
    @model_validator(mode='before')
    @classmethod
    def replace_nulls_with_defaults(cls, data):
        if not isinstance(data, dict):
            new_data = {}
            for name, field in cls.model_fields.items():
                val = getattr(data, name, None)
                if val is None:
                    if field.default is not None and field.default is not PydanticUndefined:
                        new_data[name] = field.default
                    elif field.default is PydanticUndefined:
                        if field.annotation == int or field.annotation == Optional[int]:
                            new_data[name] = 0
                        elif field.annotation == float or field.annotation == Optional[float]:
                            new_data[name] = 0.0
                        elif field.annotation == str or field.annotation == Optional[str]:
                            new_data[name] = ""
                        elif field.annotation == bool or field.annotation == Optional[bool]:
                            new_data[name] = False
                        else:
                            new_data[name] = None
                    else:
                        new_data[name] = None
                else:
                    new_data[name] = val
            return new_data
        else:
            for name, field in cls.model_fields.items():
                if data.get(name) is None:
                    if field.default is not None and field.default is not PydanticUndefined:
                        data[name] = field.default
                    elif field.default is PydanticUndefined:
                        if field.annotation == int or field.annotation == Optional[int]:
                            data[name] = 0
                        elif field.annotation == float or field.annotation == Optional[float]:
                            data[name] = 0.0
                        elif field.annotation == str or field.annotation == Optional[str]:
                            data[name] = ""
                        elif field.annotation == bool or field.annotation == Optional[bool]:
                            data[name] = False
            return data

class BatchBase(ORMBaseModel):
    batch_number: str
    product_name: str
    export_type: Optional[str] = "Эталон"
    status: str = "stacked"
    
    stacked_stacks: int = 0
    
    ds_condition: int = 0
    ds_first_grade: int = 0
    ds_defect: int = 0
    
    ds_defect_chip: int = 0
    ds_defect_scratch: int = 0
    ds_defect_bad_cut: int = 0
    ds_defect_stick_bottom: int = 0
    ds_defect_stick_top: int = 0
    ds_defect_broken: int = 0
    ds_defect_fell_box: int = 0
    ds_defect_dent: int = 0
    ds_defect_thickness: int = 0
    ds_defect_delamination: int = 0
    ds_defect_edge: int = 0
    
    qcd_condition: int = 0
    qcd_sorted_packs: int = 0
    qcd_first_grade: int = 0
    qcd_first_grade_note: Optional[str] = None
    qcd_defect: int = 0
    qcd_defect_note: Optional[str] = None
    
    qcd_defect_chip: int = 0
    qcd_defect_scratch: int = 0
    qcd_defect_bad_cut: int = 0
    qcd_defect_stick_bottom: int = 0
    qcd_defect_stick_top: int = 0
    qcd_defect_broken: int = 0
    qcd_defect_fell_box: int = 0
    qcd_defect_dent: int = 0
    qcd_defect_thickness: int = 0
    qcd_defect_delamination: int = 0
    qcd_defect_edge: int = 0
    
class BatchCreate(BatchBase):
    pass

class Batch(BatchBase):
    id: int
    shift_id: Optional[int] = 0

    class Config:
        from_attributes = True

class LFMReportBase(ORMBaseModel):
    product_name: str
    export_type: Optional[str] = "Эталон"
    lfm_sheets: int = 0
    lfm_wind_resets: int = 0
    formed_1st_grade: int = 0
    formed_defect: int = 0
    transferred_to_warehouse: int = 0

class LFMReportCreate(LFMReportBase):
    pass

class LFMReport(LFMReportBase):
    id: int
    shift_id: Optional[int] = 0

    class Config:
        from_attributes = True

class DowntimeBase(ORMBaseModel):
    start_time: str
    end_time: Optional[str] = None
    category: Optional[str] = None
    department: Optional[str] = None
    node: Optional[str] = "Основное оборудование"
    description: Optional[str] = None
    comment: Optional[str] = None
    media_urls: Optional[str] = None
    status: Optional[str] = "pending"
    is_equipment_downtime: Optional[bool] = True
    breakdowns: Optional[str] = None

class DowntimeCreate(DowntimeBase):
    pass

class Downtime(DowntimeBase):
    id: int
    shift_id: Optional[int] = 0
    duration: Optional[int] = 0
    lost_tons: Optional[float] = 0.0
    lost_tenge: Optional[float] = 0.0
    status: Optional[str] = "pending"
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class ShiftBase(ORMBaseModel):
    date: date
    shift_name: str
    line: str
    batch_number: Optional[str] = None
    product_name: Optional[str] = None
    export_type: Optional[str] = "Эталон"
    created_at: Optional[datetime] = None
    
    plan_sheets: Optional[int] = 0
    plan_tons: Optional[float] = 0.0

    
    zo_chrysotile_4_20: Optional[float] = 0
    zo_chrysotile_4_20_silo1: Optional[float] = 0
    zo_chrysotile_4_20_silo2: Optional[float] = 0
    zo_chrysotile_4_20_silo3: Optional[float] = 0
    zo_chrysotile_4_20_silo4: Optional[float] = 0
    
    zo_chrysotile_5_65: Optional[float] = 0
    zo_chrysotile_5_65_silo1: Optional[float] = 0
    zo_chrysotile_5_65_silo2: Optional[float] = 0
    zo_chrysotile_5_65_silo3: Optional[float] = 0
    zo_chrysotile_5_65_silo4: Optional[float] = 0
    
    zo_chrysotile_6_40: Optional[float] = 0
    zo_chrysotile_6_40_silo1: Optional[float] = 0
    zo_chrysotile_6_40_silo2: Optional[float] = 0
    zo_chrysotile_6_40_silo3: Optional[float] = 0
    zo_chrysotile_6_40_silo4: Optional[float] = 0
    
    zo_cement: Optional[float] = 0
    zo_cement_silo1: Optional[float] = 0
    zo_cement_silo2: Optional[float] = 0
    zo_cement_silo3: Optional[float] = 0
    zo_cement_silo4: Optional[float] = 0
    
    zo_cellulose: Optional[float] = 0
    zo_cellulose_silo1: Optional[float] = 0
    zo_cellulose_silo2: Optional[float] = 0
    zo_cellulose_silo3: Optional[float] = 0
    zo_cellulose_silo4: Optional[float] = 0
    
    zo_crushed_slate: Optional[float] = 0
    zo_crushed_slate_silo1: Optional[float] = 0
    zo_crushed_slate_silo2: Optional[float] = 0
    zo_crushed_slate_silo3: Optional[float] = 0
    zo_crushed_slate_silo4: Optional[float] = 0
    
    zo_asbozurit: Optional[float] = 0
    zo_asbozurit_silo1: Optional[float] = 0
    zo_asbozurit_silo2: Optional[float] = 0
    zo_asbozurit_silo3: Optional[float] = 0
    zo_asbozurit_silo4: Optional[float] = 0
    
    zo_fiberglass: Optional[float] = 0
    zo_fiberglass_silo1: Optional[float] = 0
    zo_fiberglass_silo2: Optional[float] = 0
    zo_fiberglass_silo3: Optional[float] = 0
    zo_fiberglass_silo4: Optional[float] = 0
    
    zo_laprol: Optional[float] = 0
    zo_laprol_silo1: Optional[float] = 0
    zo_laprol_silo2: Optional[float] = 0
    zo_laprol_silo3: Optional[float] = 0
    zo_laprol_silo4: Optional[float] = 0
    
    zo_asbocarton: Optional[float] = 0
    zo_asbocarton_silo1: Optional[float] = 0
    zo_asbocarton_silo2: Optional[float] = 0
    zo_asbocarton_silo3: Optional[float] = 0
    zo_asbocarton_silo4: Optional[float] = 0
    zo_asb_drain: Optional[float] = 0
    zo_cem_drain: Optional[float] = 0
    lfm_asb_drain: Optional[float] = 0
    lfm_cem_drain: Optional[float] = 0
    zo_batches: Optional[int] = 0
    
    zo_submitted: Optional[bool] = False


class RawMaterialReceiptBase(ORMBaseModel):
    master_id: Optional[int] = None
    chrysotile_4_20: float = 0.0
    chrysotile_5_65: float = 0.0
    chrysotile_6_40: float = 0.0
    cement_silo1: float = 0.0
    cement_silo2: float = 0.0
    cement_silo3: float = 0.0
    cement_silo4: float = 0.0
    cellulose: float = 0.0
    crushed_slate: float = 0.0
    asbozurit: float = 0.0
    asbocarton: float = 0.0
    pallets: float = 0.0
    fiberglass: float = 0.0
    laprol: float = 0.0

class RawMaterialReceiptCreate(RawMaterialReceiptBase):
    pass

class RawMaterialReceipt(RawMaterialReceiptBase):
    id: int
    shift_id: Optional[int] = 0
    timestamp: Optional[datetime] = None

    class Config:
        from_attributes = True

class RawMaterialReceiptUpdate(ORMBaseModel):
    master_id: Optional[int] = None
    chrysotile_4_20: Optional[float] = None
    chrysotile_5_65: Optional[float] = None
    chrysotile_6_40: Optional[float] = None
    cement_silo1: Optional[float] = None
    cement_silo2: Optional[float] = None
    cement_silo3: Optional[float] = None
    cement_silo4: Optional[float] = None
    cellulose: Optional[float] = None
    crushed_slate: Optional[float] = None
    asbozurit: Optional[float] = None
    asbocarton: Optional[float] = None
    pallets: Optional[float] = None
    fiberglass: Optional[float] = None
    laprol: Optional[float] = None

class RawMaterialReceiptAdminResponse(RawMaterialReceipt):
    shift_date: Optional[str] = None
    shift_name: Optional[str] = None
    shift_line: Optional[str] = None
    master_name: Optional[str] = None

class ShiftCreate(ShiftBase):
    master_id: int

class Shift(ShiftBase):
    id: int
    master_id: Optional[int] = 0
    status: Optional[str] = "active"
    sharepoint_url: Optional[str] = None
    batches: List[Batch] = []
    lfm_reports: List[LFMReport] = []
    downtimes: List[Downtime] = []
    receipts: List[RawMaterialReceipt] = []
    master: Optional['Master'] = None

    class Config:
        from_attributes = True

class MasterBase(ORMBaseModel):
    name: str
    role: str
    email: Optional[str] = None

class MasterCreate(MasterBase):
    pin: str

class Master(MasterBase):
    id: int

    class Config:
        from_attributes = True

class ZOUpdate(ORMBaseModel):
    chrysotile_4_20: float
    chrysotile_5_65: float
    chrysotile_6_40: float
    cement_silo1: float = 0
    cement_silo2: float = 0
    cement_silo3: float = 0
    cement_silo4: float = 0
    cellulose: float
    crushed_slate: float
    asbozurit: float
    fiberglass: float
    laprol: float = 0
    asbocarton: float = 0
    batches: int = 0
    submitted: bool = False

class MasterUpdate(ORMBaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    pin: Optional[str] = None
    email: Optional[str] = None

class ProductNormBase(ORMBaseModel):
    product_name: str
    weight_kg: float = 0.0
    norm_chrysotile_4_20: float = 0.0
    norm_chrysotile_5_65: float = 0.0
    norm_chrysotile_6_40: float = 0.0
    norm_cement: float = 0.0
    norm_cellulose: float = 0.0
    norm_crushed_slate: float = 0.0
    norm_asbozurit: float = 0.0
    norm_fiberglass: float = 0.0

class ProductNormCreate(ProductNormBase):
    pass

class ProductNormUpdate(ORMBaseModel):
    product_name: Optional[str] = None
    weight_kg: Optional[float] = None
    norm_chrysotile_4_20: Optional[float] = None
    norm_chrysotile_5_65: Optional[float] = None
    norm_chrysotile_6_40: Optional[float] = None
    norm_cement: Optional[float] = None
    norm_cellulose: Optional[float] = None
    norm_crushed_slate: Optional[float] = None
    norm_asbozurit: Optional[float] = None
    norm_fiberglass: Optional[float] = None

class ProductNorm(ProductNormBase):
    id: int

    class Config:
        from_attributes = True

class MaterialDeviation(ORMBaseModel):
    material: str
    actual: float
    theoretical: float
    deviation: float
    unit_actual: Optional[float] = 0.0
    unit_theoretical: Optional[float] = 0.0
    unit_deviation: Optional[float] = 0.0

class RawMaterialReport(ORMBaseModel):
    shift_id: int
    total_deviation_kg: float
    details: List[MaterialDeviation]

class MonthlyPlanBoardBase(ORMBaseModel):
    date: date
    shift_name: str
    shift_number: int
    line: Optional[str] = "ЛФМ-1"
    plan_sheets: int = 0
    fact_sheets: int = 0
    first_grade: int = 0
    defect: int = 0

class MonthlyPlanBoardCreate(MonthlyPlanBoardBase):
    master_id: Optional[int] = None

class MonthlyPlanBoard(MonthlyPlanBoardBase):
    id: int
    master_id: Optional[int] = None
    master: Optional[Master] = None

    class Config:
        from_attributes = True

class DowntimeDirectoryBase(ORMBaseModel):
    department: str
    node: str
    breakdown: str
    category: Optional[str] = None
    comment: Optional[str] = None

class DowntimeDirectoryCreate(DowntimeDirectoryBase):
    pass

class DowntimeDirectory(DowntimeDirectoryBase):
    id: int

    class Config:
        from_attributes = True


class RawMaterialsBulkUpdate(ORMBaseModel):
    zo_chrysotile_4_20: float = 0.0
    zo_chrysotile_5_65: float = 0.0
    zo_chrysotile_6_40: float = 0.0
    zo_cement_silo1: float = 0.0
    zo_cement_silo2: float = 0.0
    zo_cement_silo3: float = 0.0
    zo_cement_silo4: float = 0.0
    zo_cellulose: float = 0.0
    zo_crushed_slate: float = 0.0
    zo_asbozurit: float = 0.0
    zo_fiberglass: float = 0.0
    zo_laprol: float = 0.0
    zo_asbocarton: float = 0.0
    zo_asb_drain: float = 0.0
    zo_cem_drain: float = 0.0
    zo_batches: int = 0


class ShiftReportCreate(ORMBaseModel):
    date: date
    shift_name: str
    line: str
    master_id: int
    batch_number: str
    product_name: str
    export_type: Optional[str] = "Эталон"
    
    # Производство / ЛФМ
    lfm_sheets: int = 0
    lfm_wind_resets: int = 0
    zo_batches: int = 0
    
    # Переборка / Брак
    warehouse_gp: int = 0
    first_grade: int = 0
    has_defect: str = "no"
    
    # Детализация брака (Дестакер)
    ds_defect_chip: int = 0
    ds_defect_scratch: int = 0
    ds_defect_bad_cut: int = 0
    ds_defect_stick_bottom: int = 0
    ds_defect_stick_top: int = 0
    ds_defect_broken: int = 0
    ds_defect_fell_box: int = 0
    ds_defect_dent: int = 0
    ds_defect_thickness: int = 0
    ds_defect_delamination: int = 0
    ds_defect_edge: int = 0
    
    # Итоговый брак СКК
    qcd_defect: int = 0

    # Расход сырья (ЗО)
    zo_chrysotile_4_20: float = 0.0
    zo_chrysotile_4_20_silo1: float = 0.0
    zo_chrysotile_4_20_silo2: float = 0.0
    zo_chrysotile_4_20_silo3: float = 0.0
    zo_chrysotile_4_20_silo4: float = 0.0
    
    zo_chrysotile_5_65: float = 0.0
    zo_chrysotile_5_65_silo1: float = 0.0
    zo_chrysotile_5_65_silo2: float = 0.0
    zo_chrysotile_5_65_silo3: float = 0.0
    zo_chrysotile_5_65_silo4: float = 0.0
    
    zo_chrysotile_6_40: float = 0.0
    zo_chrysotile_6_40_silo1: float = 0.0
    zo_chrysotile_6_40_silo2: float = 0.0
    zo_chrysotile_6_40_silo3: float = 0.0
    zo_chrysotile_6_40_silo4: float = 0.0
    
    zo_cement_silo1: float = 0.0
    zo_cement_silo2: float = 0.0
    zo_cement_silo3: float = 0.0
    zo_cement_silo4: float = 0.0
    
    zo_cellulose: float = 0.0
    zo_cellulose_silo1: float = 0.0
    zo_cellulose_silo2: float = 0.0
    zo_cellulose_silo3: float = 0.0
    zo_cellulose_silo4: float = 0.0
    
    zo_crushed_slate: float = 0.0
    zo_crushed_slate_silo1: float = 0.0
    zo_crushed_slate_silo2: float = 0.0
    zo_crushed_slate_silo3: float = 0.0
    zo_crushed_slate_silo4: float = 0.0
    
    zo_asbozurit: float = 0.0
    zo_asbozurit_silo1: float = 0.0
    zo_asbozurit_silo2: float = 0.0
    zo_asbozurit_silo3: float = 0.0
    zo_asbozurit_silo4: float = 0.0
    
    zo_fiberglass: float = 0.0
    zo_fiberglass_silo1: float = 0.0
    zo_fiberglass_silo2: float = 0.0
    zo_fiberglass_silo3: float = 0.0
    zo_fiberglass_silo4: float = 0.0
    
    zo_laprol: float = 0.0
    zo_laprol_silo1: float = 0.0
    zo_laprol_silo2: float = 0.0
    zo_laprol_silo3: float = 0.0
    zo_laprol_silo4: float = 0.0
    
    zo_asbocarton: float = 0.0
    zo_asbocarton_silo1: float = 0.0
    zo_asbocarton_silo2: float = 0.0
    zo_asbocarton_silo3: float = 0.0
    zo_asbocarton_silo4: float = 0.0
    
    zo_asb_drain: float = 0.0
    zo_cem_drain: float = 0.0


class AdminShiftReportUpdate(ORMBaseModel):
    date: Optional[str] = None
    shift_name: Optional[str] = None
    line: Optional[str] = None
    master_id: Optional[int] = None
    batch_number: Optional[str] = None
    product_name: Optional[str] = None
    export_type: Optional[str] = None
    status: Optional[str] = None
    
    # Производство / ЛФМ
    lfm_sheets: Optional[int] = None
    lfm_wind_resets: Optional[int] = None
    zo_batches: Optional[int] = None
    
    # Переборка / Брак
    warehouse_gp: Optional[int] = None
    first_grade: Optional[int] = None
    has_defect: Optional[str] = None
    
    # Детализация брака (Дестакер)
    ds_defect_chip: Optional[int] = None
    ds_defect_scratch: Optional[int] = None
    ds_defect_bad_cut: Optional[int] = None
    ds_defect_stick_bottom: Optional[int] = None
    ds_defect_stick_top: Optional[int] = None
    ds_defect_broken: Optional[int] = None
    ds_defect_fell_box: Optional[int] = None
    ds_defect_dent: Optional[int] = None
    ds_defect_thickness: Optional[int] = None
    ds_defect_delamination: Optional[int] = None
    ds_defect_edge: Optional[int] = None
    
    # Итоговый брак СКК
    qcd_defect: Optional[int] = None

    # Расход сырья (ЗО)
    zo_chrysotile_4_20: Optional[float] = None
    zo_chrysotile_4_20_silo1: Optional[float] = None
    zo_chrysotile_4_20_silo2: Optional[float] = None
    zo_chrysotile_4_20_silo3: Optional[float] = None
    zo_chrysotile_4_20_silo4: Optional[float] = None
    
    zo_chrysotile_5_65: Optional[float] = None
    zo_chrysotile_5_65_silo1: Optional[float] = None
    zo_chrysotile_5_65_silo2: Optional[float] = None
    zo_chrysotile_5_65_silo3: Optional[float] = None
    zo_chrysotile_5_65_silo4: Optional[float] = None
    
    zo_chrysotile_6_40: Optional[float] = None
    zo_chrysotile_6_40_silo1: Optional[float] = None
    zo_chrysotile_6_40_silo2: Optional[float] = None
    zo_chrysotile_6_40_silo3: Optional[float] = None
    zo_chrysotile_6_40_silo4: Optional[float] = None
    
    zo_cement_silo1: Optional[float] = None
    zo_cement_silo2: Optional[float] = None
    zo_cement_silo3: Optional[float] = None
    zo_cement_silo4: Optional[float] = None
    
    zo_cellulose: Optional[float] = None
    zo_cellulose_silo1: Optional[float] = None
    zo_cellulose_silo2: Optional[float] = None
    zo_cellulose_silo3: Optional[float] = None
    zo_cellulose_silo4: Optional[float] = None
    
    zo_crushed_slate: Optional[float] = None
    zo_crushed_slate_silo1: Optional[float] = None
    zo_crushed_slate_silo2: Optional[float] = None
    zo_crushed_slate_silo3: Optional[float] = None
    zo_crushed_slate_silo4: Optional[float] = None
    
    zo_asbozurit: Optional[float] = None
    zo_asbozurit_silo1: Optional[float] = None
    zo_asbozurit_silo2: Optional[float] = None
    zo_asbozurit_silo3: Optional[float] = None
    zo_asbozurit_silo4: Optional[float] = None
    
    zo_fiberglass: Optional[float] = None
    zo_fiberglass_silo1: Optional[float] = None
    zo_fiberglass_silo2: Optional[float] = None
    zo_fiberglass_silo3: Optional[float] = None
    zo_fiberglass_silo4: Optional[float] = None
    
    zo_laprol: Optional[float] = None
    zo_laprol_silo1: Optional[float] = None
    zo_laprol_silo2: Optional[float] = None
    zo_laprol_silo3: Optional[float] = None
    zo_laprol_silo4: Optional[float] = None
    
    zo_asbocarton: Optional[float] = None
    zo_asbocarton_silo1: Optional[float] = None
    zo_asbocarton_silo2: Optional[float] = None
    zo_asbocarton_silo3: Optional[float] = None
    zo_asbocarton_silo4: Optional[float] = None
    
    zo_asb_drain: Optional[float] = None
    zo_cem_drain: Optional[float] = None


# --- TASK TRACKER SCHEMAS ---
class TaskBase(ORMBaseModel):
    code: Optional[str] = ""
    zone: Optional[str] = "Бережливое производство"
    title: str
    title_kz: Optional[str] = ""
    photo_link: Optional[str] = ""
    author_name: Optional[str] = ""
    assignee_name: Optional[str] = ""
    due_date_str: Optional[str] = ""
    status: Optional[str] = "⚪ В очереди"
    comment: Optional[str] = ""
    month_label: Optional[str] = ""
    week_label: Optional[str] = ""
    is_archived: Optional[bool] = False
    pin_code: Optional[str] = None
    
    # Legacy / Compatibility fields
    description: Optional[str] = ""
    category: Optional[str] = ""
    priority: Optional[str] = "Средний"
    assigned_master_id: Optional[int] = None
    assignee_custom: Optional[str] = ""
    creator_name: Optional[str] = ""
    due_date: Optional[date] = None
    attached_document_id: Optional[int] = None
    google_doc_url: Optional[str] = ""

class TaskCreate(TaskBase):
    pass

class TaskUpdate(ORMBaseModel):
    code: Optional[str] = None
    zone: Optional[str] = None
    title: Optional[str] = None
    title_kz: Optional[str] = None
    photo_link: Optional[str] = None
    author_name: Optional[str] = None
    assignee_name: Optional[str] = None
    due_date_str: Optional[str] = None
    status: Optional[str] = None
    comment: Optional[str] = None
    month_label: Optional[str] = None
    week_label: Optional[str] = None
    is_archived: Optional[bool] = None
    pin_code: Optional[str] = None
    
    # Legacy
    description: Optional[str] = None
    category: Optional[str] = None
    priority: Optional[str] = None
    assigned_master_id: Optional[int] = None
    assignee_custom: Optional[str] = None
    creator_name: Optional[str] = None
    due_date: Optional[date] = None
    completed_at: Optional[datetime] = None
    attached_document_id: Optional[int] = None
    google_doc_url: Optional[str] = None

class TaskResponse(TaskBase):
    id: int
    completed_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    assigned_master_name: Optional[str] = ""
    attached_document_title: Optional[str] = ""

    class Config:
        from_attributes = True


# --- PLANNER SETTINGS SCHEMAS ---
class PlannerEmployeeBase(ORMBaseModel):
    name: str
    email: Optional[str] = ""
    pin_code: Optional[str] = ""
    is_active: Optional[bool] = True
    sort_order: Optional[int] = 0

class PlannerEmployeeCreate(PlannerEmployeeBase):
    pass

class PlannerEmployeeUpdate(ORMBaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    pin_code: Optional[str] = None
    is_active: Optional[bool] = None
    sort_order: Optional[int] = None

class PlannerEmployeeResponse(PlannerEmployeeBase):
    id: int
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class PlannerZoneBase(ORMBaseModel):
    name: str
    is_active: Optional[bool] = True
    sort_order: Optional[int] = 0

class PlannerZoneCreate(PlannerZoneBase):
    pass

class PlannerZoneUpdate(ORMBaseModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None
    sort_order: Optional[int] = None

class PlannerZoneResponse(PlannerZoneBase):
    id: int
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


