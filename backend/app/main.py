import os

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.api.auth import auth
from app.api.audits.router import router as audits_router
from app.api.ai.router import router as ai_router
from app.api.scope.router import router as scope_router
from app.api.enum.solparsing.router import router as solparsing_router
from app.api.enum.surya.router import router as surya_router
from app.api.libraries.router import router as libraries_router
from app.api.enum.heimdall.router import router as heimdall_router

app = FastAPI()

_ALLOWED_ORIGINS = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:5173,http://localhost:8001",
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response: Response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response


# Register auth router
app.include_router(auth.router)
app.include_router(audits_router)
app.include_router(ai_router)
app.include_router(scope_router)
app.include_router(solparsing_router)
app.include_router(surya_router)
app.include_router(libraries_router)
app.include_router(heimdall_router)


@app.get("/health")
def health():
    return {"status": "ok"}

