with open('main.py', 'r', encoding='utf-8') as f:
    c = f.read()

# Add exception handler after app = FastAPI(...)
old = '''app = FastAPI(title="Tectum Enterprise Portal", lifespan=lifespan)
app.add_middleware('''

new = '''app = FastAPI(title="Tectum Enterprise Portal", lifespan=lifespan)

import traceback as _tb
from fastapi.responses import JSONResponse as _JSONResponse

@app.exception_handler(Exception)
async def global_exception_handler(request, exc: Exception):
    return _JSONResponse(
        status_code=500,
        content={"detail": str(exc), "traceback": _tb.format_exc()}
    )

app.add_middleware('''

c = c.replace(old, new, 1)
print("Handler added:", old not in c)

with open('main.py', 'w', encoding='utf-8') as f:
    f.write(c)
print("Done")