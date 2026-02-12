from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.api.audits.router import router as audits_router

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(audits_router)


@app.get("/health")
def health():
    return {"status": "ok"}


class LoginPayload(BaseModel):
    username: str
    password: str


@app.post("/auth/login")
def auth_login(payload: LoginPayload):
    if payload.username == "admin" and payload.password == "admin":
        return {
            "status": "ok",
            "user": {
                "username": "admin",
                "role": "admin",
            },
        }

    raise HTTPException(status_code=401, detail="invalid credentials")
