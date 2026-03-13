"""
Blockchain explorer fetcher (Etherscan API v2).

Downloads verified smart contract source code from blockchain explorers.
Supports all chains accessible via Etherscan API v2:
- Ethereum (Etherscan)
- Arbitrum (Arbiscan)
- Polygon (Polygonscan)
- BNB Chain (BSCScan)
- Base (Basescan)
- Optimism (Optimistic Etherscan)

Ref: https://docs.etherscan.io/v2-migration
"""
from __future__ import annotations

import json

import httpx
from sqlmodel import Session

from app.models.scope import ScopeSource, SourceType

from .base import (
    FetchError,
    create_contract_from_content,
    ensure_storage_dir,
    logger,
)

# ============================= Configuration =============================

# Etherscan API v2 - single endpoint for all chains
ETHERSCAN_API_V2_URL = "https://api.etherscan.io/v2/api"
EXPLORER_TIMEOUT = 30  # Request timeout in seconds

# Map source types to chain IDs for Etherscan API v2
EXPLORER_CHAIN_IDS: dict[SourceType, int] = {
    SourceType.etherscan: 1,        # Ethereum Mainnet
    SourceType.arbiscan: 42161,     # Arbitrum One
    SourceType.polygonscan: 137,    # Polygon Mainnet
    SourceType.bscscan: 56,         # BNB Smart Chain
    SourceType.basescan: 8453,      # Base
    SourceType.optimism: 10,        # Optimism
}

# Human-readable chain names for error messages
CHAIN_NAMES: dict[SourceType, str] = {
    SourceType.etherscan: "Ethereum",
    SourceType.arbiscan: "Arbitrum",
    SourceType.polygonscan: "Polygon",
    SourceType.bscscan: "BNB Chain",
    SourceType.basescan: "Base",
    SourceType.optimism: "Optimism",
}


# ============================= Address Validation =============================

def validate_eth_address(address: str) -> str:
    """Validate and normalize an Ethereum address.
    
    Args:
        address: The address to validate.
        
    Returns:
        Normalized address (lowercase with 0x prefix).
        
    Raises:
        FetchError: If the address is invalid.
    """
    if not address:
        raise FetchError(
            message="Contract address is required",
            source_type="explorer",
        )
    
    # Normalize: add 0x if missing, lowercase
    addr = address.strip().lower()
    if not addr.startswith("0x"):
        addr = "0x" + addr
    
    # Check length (0x + 40 hex chars)
    if len(addr) != 42:
        raise FetchError(
            message="Invalid contract address format",
            source_type="explorer",
            details=f"Expected 42 characters (0x + 40 hex), got {len(addr)}: {address}",
        )
    
    # Check hex characters
    try:
        int(addr, 16)
    except ValueError:
        raise FetchError(
            message="Invalid contract address",
            source_type="explorer",
            details=f"Address contains non-hexadecimal characters: {address}",
        )
    
    logger.debug(f"Validated address: {addr}")
    return addr


# ============================= Source Code Parsing =============================

def parse_source_code(source_code: str) -> list[tuple[str, str]]:
    """Parse source code from explorer API response.
    
    Handles multiple formats:
    1. Single file: plain Solidity code
    2. Multi-file JSON: {"sources": {"file.sol": {"content": "..."}}}
    3. Double-braced JSON: {{...}} (Etherscan wrapping)
    
    Args:
        source_code: Raw source code string from API.
        
    Returns:
        List of (filename, content) tuples.
    """
    # Single file case: plain Solidity code
    if not source_code.startswith("{"):
        logger.debug("Parsing as single-file contract")
        return [("Contract.sol", source_code)]
    
    # Multi-file case: JSON format
    # Etherscan wraps Standard JSON Input in double braces: {{...}}
    if source_code.startswith("{{"):
        logger.debug("Detected double-braced JSON, unwrapping")
        source_code = source_code[1:-1]
    
    try:
        parsed = json.loads(source_code)
    except json.JSONDecodeError as e:
        logger.warning(f"Failed to parse JSON source code: {e}")
        return [("Contract.sol", source_code)]
    
    # Standard JSON input format: {"language": "Solidity", "sources": {...}}
    if "sources" in parsed:
        sources = parsed["sources"]
        files = []
        for filename, file_data in sources.items():
            content = file_data.get("content", "")
            if content:
                files.append((filename, content))
        logger.debug(f"Parsed Standard JSON Input: {len(files)} files")
        return files
    
    # Alternative format: direct {"filename.sol": {"content": "..."}}
    files = []
    for filename, file_data in parsed.items():
        if isinstance(file_data, dict) and "content" in file_data:
            files.append((filename, file_data["content"]))
        elif isinstance(file_data, str):
            files.append((filename, file_data))
    
    if files:
        logger.debug(f"Parsed alternative JSON format: {len(files)} files")
        return files
    
    # Fallback: treat as single file
    logger.warning("Could not parse JSON structure, treating as single file")
    return [("Contract.sol", source_code)]


# ============================= API Functions =============================

def fetch_source_code(
    source_type: SourceType,
    contract_address: str,
    etherscan_api_key: str | None = None,
) -> dict:
    """Fetch verified source code from Etherscan API v2.
    
    Args:
        source_type: The type of explorer (etherscan, arbiscan, etc.).
        contract_address: The contract address to fetch.
        
    Returns:
        API response result containing source code and metadata.
        
    Raises:
        FetchError: If fetching fails or contract is not verified.
    """
    chain_id = EXPLORER_CHAIN_IDS.get(source_type)
    chain_name = CHAIN_NAMES.get(source_type, source_type.value)
    
    if not chain_id:
        raise FetchError(
            message="Unsupported blockchain explorer",
            source_type="explorer",
            details=f"No chain ID configured for: {source_type.value}",
        )
    
    if not etherscan_api_key:
        raise FetchError(
            message="Etherscan API key not configured",
            source_type="explorer",
            details="Add your Etherscan API key in your account settings",
        )

    logger.info(f"Fetching source code from {chain_name} for {contract_address}")

    # Build API v2 request
    params = {
        "chainid": chain_id,
        "module": "contract",
        "action": "getsourcecode",
        "address": contract_address,
        "apikey": etherscan_api_key,
    }
    
    try:
        response = httpx.get(
            ETHERSCAN_API_V2_URL,
            params=params,
            timeout=EXPLORER_TIMEOUT,
        )
        response.raise_for_status()
        data = response.json()
        
    except httpx.HTTPStatusError as e:
        raise FetchError(
            message=f"{chain_name} API returned an error",
            source_type="explorer",
            details=f"HTTP {e.response.status_code}",
        ) from e
        
    except httpx.RequestError as e:
        raise FetchError(
            message=f"Failed to connect to {chain_name} API",
            source_type="explorer",
            details=str(e),
        ) from e
    
    # Check API response status
    if data.get("status") != "1":
        msg = data.get("message", "Unknown error")
        result = data.get("result", "")
        
        # Provide helpful error messages
        if "rate limit" in str(result).lower():
            raise FetchError(
                message="API rate limit exceeded",
                source_type="explorer",
                details="Wait a moment and try again, or upgrade your API key",
            )
        if "invalid api" in str(result).lower():
            raise FetchError(
                message="Invalid API key",
                source_type="explorer",
                details="Check your Etherscan API key in account settings",
            )
        
        raise FetchError(
            message=f"{chain_name} API error: {msg}",
            source_type="explorer",
            details=str(result) if result else None,
        )
    
    results = data.get("result", [])
    if not results or not isinstance(results, list):
        raise FetchError(
            message="No data returned from explorer",
            source_type="explorer",
            details=f"Unexpected response format from {chain_name}",
        )
    
    contract_data = results[0]
    
    # Check if contract is verified
    source_code = contract_data.get("SourceCode", "")
    if not source_code:
        raise FetchError(
            message="Contract is not verified",
            source_type="explorer",
            details=f"Contract {contract_address} has no verified source code on {chain_name}",
        )
    
    contract_name = contract_data.get("ContractName", "Unknown")
    logger.info(f"Found verified contract: {contract_name}")
    
    return contract_data


# ============================= Lightweight Status Check =============================

def check_contract_status(
    source_type: SourceType,
    contract_address: str,
    etherscan_api_key: str | None = None,
) -> dict:
    """Check whether an address is a contract and whether it has verified source code.

    Uses a single ``getsourcecode`` call — no source files are downloaded.

    Returns:
        ``{"is_contract": bool, "is_verified": bool}``
    """
    chain_id = EXPLORER_CHAIN_IDS.get(source_type)
    if not chain_id or not etherscan_api_key:
        return {"is_contract": False, "is_verified": False}

    params = {
        "chainid": chain_id,
        "module": "contract",
        "action": "getsourcecode",
        "address": contract_address,
        "apikey": etherscan_api_key,
    }

    try:
        response = httpx.get(ETHERSCAN_API_V2_URL, params=params, timeout=EXPLORER_TIMEOUT)
        response.raise_for_status()
        data = response.json()
    except Exception:
        return {"is_contract": False, "is_verified": False}

    if data.get("status") != "1":
        return {"is_contract": False, "is_verified": False}

    results = data.get("result", [])
    if not results or not isinstance(results, list):
        return {"is_contract": False, "is_verified": False}

    contract_data = results[0]
    source_code = contract_data.get("SourceCode", "")

    is_verified = bool(source_code)

    # Use eth_getCode for a definitive contract check — "0x" means EOA, anything else is a contract
    bytecode = fetch_bytecode(source_type, contract_address, etherscan_api_key)
    is_contract = bytecode is not None

    # Return bytecode only for unverified contracts (verified ones get full source via fetch_verified_code)
    return {
        "is_contract": is_contract,
        "is_verified": is_verified,
        "bytecode": bytecode if is_contract and not is_verified else None,
    }


def fetch_bytecode(
    source_type: SourceType,
    contract_address: str,
    etherscan_api_key: str | None = None,
) -> str | None:
    """Fetch the deployed bytecode for a contract address via the Etherscan proxy.

    Returns the hex bytecode string, or ``None`` if unavailable / not a contract.
    """
    chain_id = EXPLORER_CHAIN_IDS.get(source_type)
    if not chain_id or not etherscan_api_key:
        return None

    params = {
        "chainid": chain_id,
        "module": "proxy",
        "action": "eth_getCode",
        "address": contract_address,
        "tag": "latest",
        "apikey": etherscan_api_key,
    }

    try:
        response = httpx.get(ETHERSCAN_API_V2_URL, params=params, timeout=EXPLORER_TIMEOUT)
        response.raise_for_status()
        data = response.json()
    except Exception:
        return None

    result = data.get("result", "0x")
    # "0x" means the address is an EOA (no code)
    if result and result != "0x":
        return result
    return None


# ============================= Main Fetcher =============================

def fetch_explorer(session: Session, source: ScopeSource, etherscan_api_key: str | None = None) -> int:
    """Fetch verified source code from a blockchain explorer.
    
    Downloads verified contract source code and creates ScopeContract entries.
    
    Args:
        session: Database session.
        source: The ScopeSource record to fetch.
        
    Returns:
        Number of contracts created.
        
    Raises:
        FetchError: If fetching fails.
    """
    logger.info(f"Starting explorer fetch for source {source.id}")
    
    chain_name = CHAIN_NAMES.get(source.source_type, source.source_type.value)
    
    # Validate contract address
    contract_address = validate_eth_address(source.contract_address or "")
    
    # Fetch source code from explorer API
    contract_data = fetch_source_code(source.source_type, contract_address, etherscan_api_key)
    
    # Parse source code (handles single and multi-file)
    source_code = contract_data.get("SourceCode", "")
    files = parse_source_code(source_code)
    
    if not files:
        logger.warning(f"No source files parsed for {contract_address}")
        return 0
    
    # Extract metadata from API response
    contract_name = contract_data.get("ContractName", "Unknown")
    compiler_version = contract_data.get("CompilerVersion")
    license_type = contract_data.get("LicenseType")
    
    # Clean compiler version (remove "v" prefix if present)
    if compiler_version and compiler_version.startswith("v"):
        compiler_version = compiler_version[1:]
    
    logger.info(f"Contract: {contract_name}, Compiler: {compiler_version}, Files: {len(files)}")
    
    # Ensure storage directory exists
    ensure_storage_dir(source.audit_id)
    
    # Create contract entries
    contracts_created = 0
    scope_reason = f"auto-imported from {chain_name} ({contract_name})"
    
    for filename, content in files:
        # Convert string content to bytes
        content_bytes = content.encode("utf-8")
        
        contract = create_contract_from_content(
            session=session,
            source=source,
            file_path=filename,
            content=content_bytes,
            scope_reason=scope_reason,
            compiler_version=compiler_version,
            license_id=license_type,
        )
        if contract:
            contracts_created += 1
    
    logger.info(f"Created {contracts_created} contracts from {chain_name}")
    return contracts_created
