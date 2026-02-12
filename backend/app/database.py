import os
from pathlib import Path
from typing import Generator
from dotenv import load_dotenv
from sqlmodel import SQLModel, Session, create_engine

load_dotenv()
# Get the database path from the environment variable
# For local development, you can set it in a .env file
# For docker you can set it in the docker-compose.yml
DB_PATH = os.getenv("DB_PATH")

if not DB_PATH:
	raise RuntimeError(
		"DB_PATH is not set. Example: DB_PATH=/data/solaudity.db (Docker) or an absolute path in local dev."
	)

db_path = Path(DB_PATH)
DATABASE_URL = f"sqlite:///{db_path}"

# This is the SQLAlchemy engine
engine = create_engine(
	DATABASE_URL,
	connect_args={"check_same_thread": False},
)


# Creates a new session for interacting with the database
def get_session() -> Generator[Session, None, None]:
	with Session(engine) as session:
		yield session

# This function creates the database tables based on the SQLModel metadata
def create_database():
    SQLModel.metadata.create_all(engine)