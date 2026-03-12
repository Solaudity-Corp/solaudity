"""
Shared utilities and base classes for source fetchers.

This module provides common functionality used by all fetchers:
- FetchError exception with clear error messages
- File utilities (hash, SLOC counting, metadata extraction)
- Storage management
- Logging configuration
"""
from __future__ import annotations

import hashlib
import logging
import os
import re
from pathlib import Path
from uuid import UUID, uuid4

from dotenv import load_dotenv
from sqlmodel import Session, select

from app.models.scope import ScopeContract, ScopeSource

load_dotenv()

# Configure logging for fetchers
logger = logging.getLogger("fetchers")
logger.setLevel(logging.DEBUG)

# Add console handler if not already present
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setLevel(logging.DEBUG)
    formatter = logging.Formatter(
        "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
    )
    handler.setFormatter(formatter)
    logger.addHandler(handler)


# ============================= Storage Configuration =============================

CONTRACTS_STORAGE_DIR = Path(os.getenv("CONTRACTS_STORAGE_DIR", "/data/contracts"))


# ============================= Exceptions =============================

class FetchError(Exception):
    """Raised when fetching from an external source fails.
    
    Provides clear, user-friendly error messages with context about what failed.
    
    Attributes:
        message: Human-readable error description
        source_type: Type of source that failed (github, etherscan, etc.)
        details: Additional technical details for debugging
    """
    
    def __init__(
        self,
        message: str,
        source_type: str | None = None,
        details: str | None = None,
    ):
        self.message = message
        self.source_type = source_type
        self.details = details
        
        # Build full message
        full_msg = message
        if details:
            full_msg = f"{message} ({details})"
        
        super().__init__(full_msg)
        
        # Log the error
        logger.error(f"FetchError [{source_type}]: {full_msg}")


# ============================= File Utilities =============================

def compute_sha256(content: bytes) -> str:
    """Compute SHA256 hash of file content.
    
    Args:
        content: Raw bytes of the file content.
        
    Returns:
        Hexadecimal string of the SHA256 hash.
    """
    return hashlib.sha256(content).hexdigest()


def count_sloc(content: str) -> int:
    """Count Source Lines of Code (excluding blank lines and comments).
    
    Args:
        content: The Solidity source code as a string.
        
    Returns:
        The number of source lines of code.
    """
    lines = content.split("\n")
    sloc = 0
    in_multiline_comment = False
    
    for line in lines:
        stripped = line.strip()
        
        # Handle multiline comments
        if "/*" in stripped and "*/" in stripped:
            stripped = re.sub(r"/\*.*?\*/", "", stripped).strip()
        elif "/*" in stripped:
            in_multiline_comment = True
            continue
        elif "*/" in stripped:
            in_multiline_comment = False
            continue
        
        if in_multiline_comment:
            continue
        
        # Skip empty lines and single-line comments
        if not stripped or stripped.startswith("//"):
            continue
        
        sloc += 1
    
    return sloc


def extract_solidity_version(content: str) -> str | None:
    """Extract pragma solidity version from source code.
    
    Args:
        content: The Solidity source code as a string.
        
    Returns:
        The extracted Solidity version string (e.g. "^0.8.0") or None.
    """
    match = re.search(r"pragma\s+solidity\s+([^;]+);", content)
    if match:
        return match.group(1).strip()
    return None


def extract_license(content: str) -> str | None:
    """Extract SPDX license identifier from source code.
    
    Args:
        content: The Solidity source code as a string.
        
    Returns:
        The extracted license identifier (e.g. "MIT") or None.
    """
    match = re.search(r"SPDX-License-Identifier:\s*(\S+)", content)
    if match:
        return match.group(1).strip()
    return None


def ensure_storage_dir(audit_id: UUID) -> Path:
    """Ensure the storage directory for an audit exists.
    
    Args:
        audit_id: Unique identifier for the audit.
        
    Returns:
        Path to the storage directory.
    """
    storage_dir = CONTRACTS_STORAGE_DIR / str(audit_id)
    storage_dir.mkdir(parents=True, exist_ok=True)
    return storage_dir


def save_contract_file(
    audit_id: UUID,
    content: bytes,
) -> tuple[str, Path]:
    """Save contract content to storage and return storage key.
    
    Args:
        audit_id: Audit this contract belongs to.
        content: Raw file content as bytes.
        
    Returns:
        Tuple of (storage_key, storage_path).
        
    Raises:
        FetchError: If file cannot be written.
    """
    ensure_storage_dir(audit_id)
    
    file_uuid = uuid4()
    storage_key = f"{audit_id}/{file_uuid}.sol"
    storage_path = CONTRACTS_STORAGE_DIR / storage_key
    
    try:
        storage_path.write_bytes(content)
        logger.debug(f"Saved contract file: {storage_key}")
        return storage_key, storage_path
    except OSError as e:
        raise FetchError(
            message="Failed to save contract file",
            details=str(e),
        ) from e


def create_contract_from_content(
    session: Session,
    source: ScopeSource,
    file_path: str,
    content: bytes,
    scope_reason: str,
    compiler_version: str | None = None,
    license_id: str | None = None,
) -> ScopeContract | None:
    """Create a ScopeContract record from file content.
    
    Handles all the common logic: hashing, SLOC counting, metadata extraction,
    file storage, and record creation.
    
    Args:
        session: Database session.
        source: Parent ScopeSource.
        file_path: Relative path of the file.
        content: Raw file content as bytes.
        scope_reason: Reason for scope status.
        compiler_version: Override compiler version (uses pragma if None).
        license_id: Override license (uses SPDX if None).
        
    Returns:
        Created ScopeContract or None if file is invalid.
    """
    # Decode content
    try:
        content_str = content.decode("utf-8")
    except UnicodeDecodeError:
        logger.warning(f"Skipping non-UTF8 file: {file_path}")
        return None
    
    # Skip empty files
    if not content_str.strip():
        logger.debug(f"Skipping empty file: {file_path}")
        return None
    
    # Compute metadata
    content_hash = compute_sha256(content)
    
    # Skip if this exact file content already exists in this audit
    existing = session.exec(
        select(ScopeContract).where(
            ScopeContract.audit_id == source.audit_id,
            ScopeContract.content_hash == content_hash,
        )
    ).first()
    if existing:
        logger.debug(f"Skipping duplicate file: {file_path}")
        return None
    
    sloc = count_sloc(content_str)
    
    # Extract or use provided metadata
    file_compiler = extract_solidity_version(content_str) or compiler_version
    file_license = extract_license(content_str) or license_id
    
    # Save file to storage
    try:
        storage_key, _ = save_contract_file(source.audit_id, content)
    except FetchError:
        logger.warning(f"Failed to save file: {file_path}")
        return None
    
    # Normalize file path
    normalized_path = file_path.lstrip("./")
    file_name = Path(normalized_path).name
    
    # Create contract record
    contract = ScopeContract(
        audit_id=source.audit_id,
        source_id=source.id,
        file_path=normalized_path,
        file_name=file_name,
        content_hash=content_hash,
        storage_key=storage_key,
        sloc=sloc,
        is_in_scope=False,
        scope_reason=scope_reason,
        compiler_version=file_compiler,
        license=file_license,
    )
    
    session.add(contract)
    logger.debug(f"Created contract: {file_name} ({sloc} SLOC)")
    
    return contract
