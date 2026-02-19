from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.api.auth import auth
from app.api.audits.router import router as audits_router
from app.api.ai.router import router as ai_router

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


@app.get("/health")
def health():
    return {"status": "ok"}

