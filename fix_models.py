with open('models.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Add master_id to RawMaterialReceipt
old_receipt_model = '''class RawMaterialReceipt(Base):
    __tablename__ = "raw_material_receipts"
    id = Column(Integer, primary_key=True, index=True)
    shift_id = Column(Integer, ForeignKey("shifts.id"))
    timestamp = Column(DateTime, default=datetime.datetime.utcnow)'''

new_receipt_model = '''class RawMaterialReceipt(Base):
    __tablename__ = "raw_material_receipts"
    id = Column(Integer, primary_key=True, index=True)
    shift_id = Column(Integer, ForeignKey("shifts.id"))
    master_id = Column(Integer, ForeignKey("masters.id"), nullable=True)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow)
    
    master = relationship("Master")'''

content = content.replace(old_receipt_model, new_receipt_model)

with open('models.py', 'w', encoding='utf-8') as f:
    f.write(content)
