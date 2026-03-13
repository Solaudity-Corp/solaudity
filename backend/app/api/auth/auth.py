from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel
from sqlmodel import Session, select

from app.database import get_session
from app.models.user import User, UserCreate, UserRead, UserLogin
from app.utils.security import hash_password, verify_password, create_access_token, verify_access_token

router = APIRouter(prefix="/api/auth", tags=["auth"])

# From where FastAPI looks for the token
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")
SUPPORTED_AI_PROVIDERS = {"claude", "openai", "groq", "xai", "gemini"}


class UserAIConfigRead(BaseModel):
    ai_provider: str | None
    ai_api_key: str | None
    has_api_key: bool


class UserAIConfigUpdate(BaseModel):
    ai_provider: str | None = None
    ai_api_key: str | None = None


class UserAIProviderRead(BaseModel):
    ai_provider: str | None


class UserAIProviderUpdate(BaseModel):
    ai_provider: str | None = None


class UserAPIKeyRead(BaseModel):
    ai_api_key: str | None
    has_api_key: bool


class UserAPIKeyUpdate(BaseModel):
    ai_api_key: str | None = None


class EtherscanAPIKeyRead(BaseModel):
    etherscan_api_key: str | None
    has_api_key: bool


class EtherscanAPIKeyUpdate(BaseModel):
    etherscan_api_key: str | None = None


class UserProfileUpdate(BaseModel):
    email: str | None = None


def _normalize_ai_provider(ai_provider: str | None) -> str | None:
    """Normalize and validate provider name; returns None to clear the value."""
    if ai_provider is None:
        return None

    normalized = ai_provider.strip().lower()
    if not normalized:
        return None

    if normalized not in SUPPORTED_AI_PROVIDERS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "Unsupported ai_provider. "
                f"Allowed values: {', '.join(sorted(SUPPORTED_AI_PROVIDERS))}"
            ),
        )

    return normalized


def _normalize_ai_api_key(ai_api_key: str | None) -> str | None:
    """Trim and validate API key length; returns None for empty/cleared values."""
    if ai_api_key is None:
        return None

    normalized = ai_api_key.strip()
    if not normalized:
        return None

    if len(normalized) > 512:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="ai_api_key is too long. Maximum length is 512 characters.",
        )

    return normalized


def _normalize_etherscan_api_key(key: str | None) -> str | None:
    if key is None:
        return None
    normalized = key.strip()
    if not normalized:
        return None
    if len(normalized) > 512:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="etherscan_api_key is too long. Maximum length is 512 characters.",
        )
    return normalized


def _normalize_email(email: str | None) -> str:
    """Trim and validate email before persisting profile changes."""
    if email is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="email is required.",
        )

    normalized = email.strip()
    if not normalized:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="email must not be empty.",
        )
    if len(normalized) > 320:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="email is too long. Maximum length is 320 characters.",
        )

    return normalized


def _touch_user(current_user: User) -> None:
    """Update the user's modified timestamp before persisting changes."""
    current_user.updated_at = datetime.now(timezone.utc)


def _save_user(session: Session, current_user: User) -> User:
    """Persist and refresh the current user entity in one place."""
    _touch_user(current_user)
    session.add(current_user)
    session.commit()
    session.refresh(current_user)
    return current_user


def get_user_ai_provider(current_user: User) -> str | None:
    """Read the current user's configured AI provider."""
    return current_user.ai_provider


def get_user_api_key(current_user: User) -> str | None:
    """Read the current user's stored AI API key."""
    return current_user.ai_api_key


def set_user_email(session: Session, current_user: User, email: str | None) -> User:
    """Set email for authenticated user with uniqueness validation."""
    normalized_email = _normalize_email(email)
    existing_user = session.exec(
        select(User).where(
            (User.email == normalized_email) & (User.id != current_user.id)
        )
    ).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered.",
        )

    current_user.email = normalized_email
    return _save_user(session, current_user)


def set_user_ai_provider(session: Session, current_user: User, ai_provider: str | None) -> User:
    """Set or clear AI provider for the authenticated user."""
    current_user.ai_provider = _normalize_ai_provider(ai_provider)
    return _save_user(session, current_user)


def set_user_api_key(session: Session, current_user: User, ai_api_key: str | None) -> User:
    """Set or clear AI API key for the authenticated user."""
    current_user.ai_api_key = _normalize_ai_api_key(ai_api_key)
    return _save_user(session, current_user)


def clear_user_api_key(session: Session, current_user: User) -> User:
    """Explicitly remove the stored AI API key for the user."""
    current_user.ai_api_key = None
    return _save_user(session, current_user)


def set_user_ai_config(
    session: Session,
    current_user: User,
    ai_provider: str | None,
    ai_api_key: str | None,
) -> User:
    """Update provider and API key together with shared validation."""
    current_user.ai_provider = _normalize_ai_provider(ai_provider)
    current_user.ai_api_key = _normalize_ai_api_key(ai_api_key)
    return _save_user(session, current_user)


def get_user_ai_config(current_user: User) -> UserAIConfigRead:
    """Return a normalized response shape for user's AI configuration."""
    return UserAIConfigRead(
        ai_provider=current_user.ai_provider,
        ai_api_key=current_user.ai_api_key,
        has_api_key=bool(current_user.ai_api_key),
    )


def get_supported_ai_providers() -> list[str]:
    """Return stable sorted provider list for frontend selection."""
    return sorted(SUPPORTED_AI_PROVIDERS)

async def get_current_user(
  token: str = Depends(oauth2_scheme),
  session : Session = Depends(get_session)  
) -> User:
    """
    Used by all protected routes (must be logged in) to check user.
    This function will extract the info from the JWT and verifies it.
    """
    creds_execption = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Unvalid Credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    # Verify token and get payload
    payload = verify_access_token(token)
    if payload is None:
        raise creds_execption
    # Extract user name
    username = payload.get("sub")
    if username is None:
        raise creds_execption
    # Checks if username is valid in database
    db_user = session.exec(select(User).where(User.username == username)).first()
    if db_user is None:
        raise creds_execption

    
    return db_user
    
    

@router.post("/register", response_model=UserRead)
def register_user(user_in: UserCreate, session: Session = Depends(get_session)):
    """
    Register a new user.
    - Checks if the username is already taken. 
    - Hashes the password before storing it. 
    - Returns the created user (without the password hash).

    user_in: UserCreate = The user data sent in the request body. Contains username, email and password (plaintext).
    
    session: Session = The database session, injected by FastAPI's dependency system.
    """
    
    # 1. Check if user already exists
    existing_user = session.exec(
        select(User).where((User.username == user_in.username) | (User.email == user_in.email))
        ).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Username already registered")

    # 2. Hash the password and create the User object
    db_user = User(
        username=user_in.username,
        email=user_in.email,
        password_hash=hash_password(user_in.password) # Using your new function!
    )
    
    # 3. Save to DB
    session.add(db_user)
    session.commit()
    session.refresh(db_user)
    return db_user

@router.post("/login")
def auth_user(user_in: UserLogin, session: Session = Depends(get_session)):
    """
    Login user with username and password.
    Checks if the user exists and if the password_hash is correct.
    Returns user info if credentials are valid.
    
    user_in: UserLogin = The login data sent in the request body. Contains username and password (plaintext).
    session: Session = The database session, injected by FastAPI's dependency system.
    """
    db_user = session.exec(select(User).where(User.username == user_in.username)).first()
    
    if not db_user or not verify_password(user_in.password,db_user.password_hash) :
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password."
        )
        
    jwt_token = create_access_token(data={"sub": db_user.username})        
    # OAuth2 standard is to return the token in this format
    return {"access_token": jwt_token, "token_type": "bearer"}

@router.get("/me", response_model=UserRead)
def read_users_me(current_user: User = Depends(get_current_user)):
    """
    Get the current logged in user.
    Requires a valid JWT token in the Authorization header.
    
    The browser calls this to get the logged-in user's details. For example, after 20min 
    to check if the user is still logged in
    
    current_user: User = The current user, injected by FastAPI's dependency system using the get_current_user function.
    """
    return current_user


@router.patch("/me/profile", response_model=UserRead)
def update_user_profile(
    payload: UserProfileUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """
    Update editable user profile fields (currently email).
    """
    if "email" not in payload.model_fields_set:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="email field must be provided.",
        )
    return set_user_email(session=session, current_user=current_user, email=payload.email)


@router.get("/ai-providers", response_model=list[str])
def read_ai_providers():
    """
    Return AI providers supported by the backend adapter.
    """
    return get_supported_ai_providers()


@router.get("/me/ai-config", response_model=UserAIConfigRead)
def read_user_ai_config(current_user: User = Depends(get_current_user)):
    """
    Return AI provider + API key for the currently authenticated user.
    """
    return get_user_ai_config(current_user)


@router.put("/me/ai-config", response_model=UserAIConfigRead)
def update_user_ai_config(
    payload: UserAIConfigUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """
    Update AI provider and/or API key for the currently authenticated user.
    """
    has_provider = "ai_provider" in payload.model_fields_set
    has_api_key = "ai_api_key" in payload.model_fields_set

    if not has_provider and not has_api_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provide at least one field: ai_provider and/or ai_api_key.",
        )

    next_provider = payload.ai_provider if has_provider else get_user_ai_provider(current_user)
    next_api_key = payload.ai_api_key if has_api_key else get_user_api_key(current_user)

    updated_user = set_user_ai_config(
        session=session,
        current_user=current_user,
        ai_provider=next_provider,
        ai_api_key=next_api_key,
    )
    return get_user_ai_config(updated_user)


@router.get("/me/ai-provider", response_model=UserAIProviderRead)
def read_user_ai_provider(current_user: User = Depends(get_current_user)):
    """
    Return only the AI provider for the currently authenticated user.
    """
    return UserAIProviderRead(ai_provider=get_user_ai_provider(current_user))


@router.patch("/me/ai-provider", response_model=UserAIProviderRead)
def update_user_ai_provider(
    payload: UserAIProviderUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """
    Update (or clear) the AI provider for the currently authenticated user.
    """
    updated_user = set_user_ai_provider(
        session=session,
        current_user=current_user,
        ai_provider=payload.ai_provider,
    )
    return UserAIProviderRead(ai_provider=get_user_ai_provider(updated_user))


@router.get("/me/ai-api-key", response_model=UserAPIKeyRead)
def read_user_ai_api_key(current_user: User = Depends(get_current_user)):
    """
    Return only the AI API key for the currently authenticated user.
    """
    api_key = get_user_api_key(current_user)
    return UserAPIKeyRead(ai_api_key=api_key, has_api_key=bool(api_key))


@router.patch("/me/ai-api-key", response_model=UserAPIKeyRead)
def update_user_ai_api_key(
    payload: UserAPIKeyUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """
    Update (or clear) the AI API key for the currently authenticated user.
    """
    if "ai_api_key" not in payload.model_fields_set:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ai_api_key field must be provided.",
        )

    updated_user = set_user_api_key(
        session=session,
        current_user=current_user,
        ai_api_key=payload.ai_api_key,
    )
    api_key = get_user_api_key(updated_user)
    return UserAPIKeyRead(ai_api_key=api_key, has_api_key=bool(api_key))


@router.delete("/me/ai-api-key", response_model=UserAPIKeyRead)
def delete_user_ai_api_key(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """
    Clear the AI API key for the currently authenticated user.
    """
    updated_user = clear_user_api_key(session=session, current_user=current_user)
    return UserAPIKeyRead(ai_api_key=updated_user.ai_api_key, has_api_key=False)


@router.get("/me/etherscan-api-key", response_model=EtherscanAPIKeyRead)
def read_user_etherscan_api_key(current_user: User = Depends(get_current_user)):
    """Return the Etherscan API key for the currently authenticated user."""
    key = current_user.etherscan_api_key
    return EtherscanAPIKeyRead(etherscan_api_key=key, has_api_key=bool(key))


@router.patch("/me/etherscan-api-key", response_model=EtherscanAPIKeyRead)
def update_user_etherscan_api_key(
    payload: EtherscanAPIKeyUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Update (or clear) the Etherscan API key for the currently authenticated user."""
    current_user.etherscan_api_key = _normalize_etherscan_api_key(payload.etherscan_api_key)
    updated_user = _save_user(session, current_user)
    key = updated_user.etherscan_api_key
    return EtherscanAPIKeyRead(etherscan_api_key=key, has_api_key=bool(key))
