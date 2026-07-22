from pydantic import BaseModel
from typing import List, Optional
from datetime import date

class BatchBase(BaseModel):
    batch_number: str
    product_name: str
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
    qcd_first_grade: int = 0
    qcd_defect: int = 0
    
class BatchCreate(BatchBase):
    pass

class Batch(BatchBase):
    id: int
    shift_id: int

    class Config:
        from_attributes = True

class LFMReportBase(BaseModel):
    product_name: str
    lfm_sheets: int = 0
    lfm_wind_resets: int = 0
    formed_1st_grade: int = 0
    formed_defect: int = 0
    transferred_to_warehouse: int = 0

class LFMReportCreate(LFMReportBase):
    pass

class LFMReport(LFMReportBase):
    id: int
    shift_id: int

    class Config:
        from_attributes = True

class DowntimeBase(BaseModel):
    start_time: str
    end_time: Optional[str] = None
    category: Optional[str] = None
    department: Optional[str] = None
    node: str
    description: Optional[str] = None
    media_urls: Optional[str] = None
    status: Optional[str] = "pending"
    is_equipment_downtime: Optional[bool] = True

class DowntimeCreate(DowntimeBase):
    pass

class Downtime(DowntimeBase):
    id: int
    shift_id: int
    duration: int
    lost_tons: Optional[float] = 0.0
    lost_tenge: Optional[float] = 0.0
    status: str

    class Config:
        from_attributes = True

class ShiftBase(BaseModel):
    date: date
    shift_name: str
    line: str
    
    plan_sheets: Optional[int] = 0
    plan_tons: Optional[float] = 0.0
    
    zo_chrysotile_4_20: Optional[float] = 0
    zo_chrysotile_5_65: Optional[float] = 0
    zo_chrysotile_6_40: Optional[float] = 0
    zo_cement: Optional[float] = 0
    zo_cement_silo1: Optional[float] = 0
    zo_cement_silo2: Optional[float] = 0
    zo_cement_silo3: Optional[float] = 0
    zo_cement_silo4: Optional[float] = 0
    zo_cellulose: Optional[float] = 0
    zo_crushed_slate: Optional[float] = 0
    zo_asbozurit: Optional[float] = 0
    zo_fiberglass: Optional[float] = 0
    zo_laprol: Optional[float] = 0
    zo_asbocarton: Optional[float] = 0
    zo_asb_drain: Optional[float] = 0
    zo_cem_drain: Optional[float] = 0
    lfm_asb_drain: Optional[float] = 0
    lfm_cem_drain: Optional[float] = 0
    zo_batches: Optional[int] = 0
    
    zo_submitted: Optional[bool] = False


class RawMaterialReceiptBase(BaseModel):
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
    shift_id: int
    timestamp: str

    class Config:
        from_attributes = True

class ShiftCreate(ShiftBase):
    master_id: int

class Shift(ShiftBase):
    id: int
    master_id: int
    status: str
    sharepoint_url: Optional[str] = None
    batches: List[Batch] = []
    lfm_reports: List[LFMReport] = []
    downtimes: List[Downtime] = []
    receipts: List[RawMaterialReceipt] = []
    master: Optional['Master'] = None

    class Config:
        from_attributes = True

class MasterBase(BaseModel):
    name: str
    role: str
    email: Optional[str] = None

class MasterCreate(MasterBase):
    pin: str

class Master(MasterBase):
    id: int

    class Config:
        from_attributes = True

class ZOUpdate(BaseModel):
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

class MasterUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    pin: Optional[str] = None
    email: Optional[str] = None

class ProductNormBase(BaseModel):
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

class ProductNormUpdate(BaseModel):
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

class MaterialDeviation(BaseModel):
    material: str
    actual: float
    theoretical: float
    deviation: float
    unit_actual: Optional[float] = 0.0
    unit_theoretical: Optional[float] = 0.0
    unit_deviation: Optional[float] = 0.0

class RawMaterialReport(BaseModel):
    shift_id: int
    total_deviation_kg: float
    details: List[MaterialDeviation]

class MonthlyPlanBoardBase(BaseModel):
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

class DowntimeDirectoryBase(BaseModel):
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


class RawMaterialsBulkUpdate(BaseModel):
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


class ShiftReportCreate(BaseModel):
    date: date
    shift_name: str
    line: str
    master_id: int
    batch_number: str
    product_name: str
    
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

