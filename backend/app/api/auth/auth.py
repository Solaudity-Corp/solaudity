from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlmodel import Session, select
from app.database import get_session
from app.models.user import User, UserCreate, UserRead, UserLogin
from app.utils.security import hash_password, verify_password, create_access_token, verify_access_token

router = APIRouter(prefix="/api/auth", tags=["auth"])

# From where FastAPI looks for the token
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

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
            detail="Invalid credentials"
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