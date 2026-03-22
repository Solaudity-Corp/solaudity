import os
from datetime import datetime, timedelta, timezone

import bcrypt
import dotenv
import jwt
dotenv.load_dotenv()

SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError("SECRET_KEY is not set. Example: SECRET_KEY=your_secret_key_here")

ALGORITHM = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", 30))

def hash_password(password:str) -> str:
    """Hash a password using bcrypt."""
    salt = bcrypt.gensalt()
    password_bytes = password.encode('utf-8')    
    return bcrypt.hashpw(password_bytes, salt).decode('utf-8')


def verify_password(password:str, hash:str) -> bool:
    """
    Verify a password against a hash.
    Returns boolean.
    """
    return bcrypt.checkpw(password.encode('utf-8'), hash.encode('utf-8'))

def create_access_token(data: dict) -> str:
    """Create a JWT access token.
    Data : dict = The data to encode in the token.
    Must include username.
    Returns the encoded JWT token as a string.
    """
    to_encode = data.copy()
    
    to_encode.update({"exp": datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)})
    
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    
    
def verify_access_token(token:str) -> dict:
    """Verify a JWT access token and return the decoded data. 
    Raises an exception if the token is invalid or expired.
    
    token : str = The JWT token to verify.
    
    Returns the decoded token data as a dictionary if valid, or None if invalid.
    """
    
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        
        if username is None: 
            return None
        
        return payload
    
    except jwt.InvalidTokenError:
        return None
