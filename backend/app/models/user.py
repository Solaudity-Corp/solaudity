from sqlmodel import Field, SQLModel
from datetime import datetime, timezone
from pydantic import field_validator

# The UserBase class is not a table itself, but serves as a base for the User class.
# It allows us to seperate the common fields from the table-specific 
# fields, which can be useful for data validation and serialization.
# Basically, is the schema (API shape) of the User, while the User class is the actual table definition.
class UserBase(SQLModel):
    email : str = Field(index=True, unique=True)
    username : str = Field(index=True, unique=True)
    
# The User class is the actual table definition, it inherits from UserBase
# This allows us to have a clear separation between the schema (UserBase) and the table definition (User).
class User(UserBase, table=True):
    id: int | None = Field(default=None, primary_key=True)
    password_hash : str = Field(max_length=60)
    date_created : datetime = Field(default_factory=datetime.now(timezone.utc))
    updated_at : datetime = Field(default_factory=datetime.now(timezone.utc))
    
    
class UserCreate(UserBase):
    password : str = Field(min_length=8, max_length=128)
    
    @field_validator("password")
    @classmethod
    def validate_password(cls, value:str) -> str:
        # Password must have one digit, upper and lower case char
        checks = [
            any(c.islower() for c in value),
            any(c.isupper() for c in value),
            any(c.isdigit() for c in value)
        ]
        
        if sum(checks) < 3 :
            raise ValueError(
                "Password must contain at least :"
                "lower, upper and digits"
            )
            
        return value