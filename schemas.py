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
    node: str
    description: str
    media_urls: Optional[str] = None
    status: Optional[str] = "pending"

class DowntimeCreate(DowntimeBase):
    pass

class Downtime(DowntimeBase):
    id: int
    shift_id: int
    duration: int
    lost_tons: float
    lost_tenge: float
    status: str

    class Config:
        from_attributes = True

class ShiftBase(BaseModel):
    date: date
    shift_name: str
    line: str
    
    receipt_chrysotile_4_20: float = 0.0
    receipt_chrysotile_5_65: float = 0.0
    receipt_chrysotile_6_40: Optional[float] = 0
    receipt_cement: Optional[float] = 0
    receipt_cellulose: Optional[float] = 0
    receipt_crushed_slate: Optional[float] = 0
    receipt_asbozurit: Optional[float] = 0
    receipt_fiberglass: Optional[float] = 0
    
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
    zo_batches: Optional[int] = 0
    
    zo_submitted: Optional[bool] = False

class ShiftCreate(ShiftBase):
    master_id: int

class Shift(ShiftBase):
    id: int
    master_id: int
    status: str
    batches: List[Batch] = []
    lfm_reports: List[LFMReport] = []
    downtimes: List[Downtime] = []

    class Config:
        from_attributes = True

class MasterBase(BaseModel):
    name: str
    role: str

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
    batches: int = 0
    submitted: bool = False

class ProductNormBase(BaseModel):
    product_name: str
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

class ProductNorm(ProductNormBase):
    id: int

    class Config:
        from_attributes = True

class MaterialDeviation(BaseModel):
    material: str
    actual: float
    theoretical: float
    deviation: float

class RawMaterialReport(BaseModel):
    shift_id: int
    total_deviation_kg: float
    details: List[MaterialDeviation]
