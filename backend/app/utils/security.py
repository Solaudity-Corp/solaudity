import bcrypt


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

