from fastapi import FastAPI, HTTPException
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

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

