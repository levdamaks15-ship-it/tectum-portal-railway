with open('schemas.py', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace('class RawMaterialReceiptBase(BaseModel):\\n    master_id: Optional[int] = None', 'class RawMaterialReceiptBase(BaseModel):\n    master_id: Optional[int] = None')

with open('schemas.py', 'w', encoding='utf-8') as f:
    f.write(content)
