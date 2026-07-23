with open('main.py', 'r', encoding='utf-8') as f:
    c = f.read()

# Remove response_model from get_active_shifts
c = c.replace(
    '@app.get("/api/shifts/active", response_model=list[schemas.Shift])',
    '@app.get("/api/shifts/active")'
)
# Remove response_model from get_all_shifts
c = c.replace(
    '@app.get("/api/shifts/all", response_model=list[schemas.Shift])',
    '@app.get("/api/shifts/all")'
)
# Remove response_model from get_single_shift
c = c.replace(
    '@app.get("/api/shifts/{shift_id}", response_model=schemas.Shift)',
    '@app.get("/api/shifts/{shift_id}")'
)
# Remove response_model from get_shift_by_params
c = c.replace(
    '@app.get("/api/shifts/by_params", response_model=schemas.Shift)',
    '@app.get("/api/shifts/by_params")'
)
# Remove response_model from create_shift
c = c.replace(
    '@app.post("/api/shifts/", response_model=schemas.Shift)',
    '@app.post("/api/shifts/")'
)

with open('main.py', 'w', encoding='utf-8') as f:
    f.write(c)
print("Done - removed response_model from shift endpoints")