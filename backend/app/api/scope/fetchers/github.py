"""
GitHub repository fetcher.

Downloads Solidity files from GitHub repositories using the tarball API.
Supports:
- HTTPS URLs (https://github.com/owner/repo)
- SSH URLs (git@github.com:owner/repo.git)
- Specific branches, tags, or commit hashes
"""
from __future__ import annotations

import io
import os
import re
import tarfile
from urllib.parse import urlparse

import httpx
from dotenv import load_dotenv
from sqlmodel import Session

from app.models.scope import ScopeSource

from .base import (
    FetchError,
    create_contract_from_content,
    ensure_storage_dir,
    logger,
)

load_dotenv()

# ============================= Configuration =============================

GITHUB_MAX_SIZE_MB = 50  # Maximum archive size in MB
GITHUB_TIMEOUT = 60  # Request timeout in seconds
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")  # Optional: for higher rate limits


# ============================= URL Parsing =============================

def parse_github_url(url: str) -> tuple[str, str]:
    """Parse a GitHub URL and extract owner and repo name.
    
    Supports formats:
        - https://github.com/owner/repo
        - https://github.com/owner/repo.git
        - https://github.com/owner/repo/tree/branch
        - git@github.com:owner/repo.git
    
    Args:
        url: The GitHub repository URL.
        
    Returns:
        (owner, repo) tuple.
        
    Raises:
        FetchError: If URL is not a valid GitHub repo URL.
    """
    if not url:
        raise FetchError(
            message="GitHub URL is required",
            source_type="github",
        )
    
    # Handle SSH URLs (git@github.com:owner/repo.git)
    ssh_match = re.match(r"git@github\.com:([^/]+)/([^/]+?)(?:\.git)?$", url)
    if ssh_match:
        owner, repo = ssh_match.group(1), ssh_match.group(2)
        logger.debug(f"Parsed SSH URL: {owner}/{repo}")
        return owner, repo
    
    # Handle HTTPS URLs
    parsed = urlparse(url)
    if parsed.netloc not in ("github.com", "www.github.com"):
        raise FetchError(
            message="Not a valid GitHub URL",
            source_type="github",
            details=f"Expected github.com, got: {parsed.netloc}",
        )
    
    # Path should be /owner/repo or /owner/repo/...
    path_parts = [p for p in parsed.path.strip("/").split("/") if p]
    if len(path_parts) < 2:
        raise FetchError(
            message="Invalid GitHub repository URL",
            source_type="github",
            details=f"URL must include owner and repo: {url}",
        )
    
    owner = path_parts[0]
    repo = path_parts[1].removesuffix(".git")
    
    logger.debug(f"Parsed HTTPS URL: {owner}/{repo}")
    return owner, repo


# ============================= GitHub API =============================

def _build_headers() -> dict[str, str]:
    """Build request headers with optional authentication."""
    headers = {"Accept": "application/vnd.github.v3+json"}
    if GITHUB_TOKEN:
        headers["Authorization"] = f"Bearer {GITHUB_TOKEN}"
        logger.debug("Using GitHub token for authentication")
    return headers


def get_default_branch(owner: str, repo: str) -> str:
    """Get the default branch of a GitHub repository.
    
    Args:
        owner: Repository owner.
        repo: Repository name.
        
    Returns:
        Default branch name (e.g., "main", "master").
        
    Raises:
        FetchError: If the repository is not found or inaccessible.
    """
    logger.info(f"Getting default branch for {owner}/{repo}")
    
    try:
        response = httpx.get(
            f"https://api.github.com/repos/{owner}/{repo}",
            headers=_build_headers(),
            timeout=GITHUB_TIMEOUT,
        )
        response.raise_for_status()
        
        branch = response.json()["default_branch"]
        logger.info(f"Default branch: {branch}")
        return branch
        
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            raise FetchError(
                message="Repository not found",
                source_type="github",
                details=f"{owner}/{repo} does not exist or is private",
            ) from e
        if e.response.status_code == 403:
            # Check if it's rate limiting
            remaining = e.response.headers.get("X-RateLimit-Remaining", "?")
            raise FetchError(
                message="GitHub API rate limit exceeded",
                source_type="github",
                details=f"Remaining: {remaining}. Set GITHUB_TOKEN env var for higher limits.",
            ) from e
        raise FetchError(
            message="GitHub API error",
            source_type="github",
            details=f"HTTP {e.response.status_code}",
        ) from e
        
    except httpx.RequestError as e:
        raise FetchError(
            message="Failed to connect to GitHub",
            source_type="github",
            details=str(e),
        ) from e


def download_tarball(owner: str, repo: str, ref: str) -> bytes:
    """Download a tarball of a GitHub repository at a specific ref.
    
    Args:
        owner: Repository owner.
        repo: Repository name.
        ref: Git reference (branch name, tag, or commit SHA).
        
    Returns:
        Raw tarball content.
        
    Raises:
        FetchError: If download fails or file is too large.
    """
    url = f"https://github.com/{owner}/{repo}/archive/{ref}.tar.gz"
    logger.info(f"Downloading tarball: {url}")
    
    try:
        with httpx.stream(
            "GET",
            url,
            headers=_build_headers(),
            timeout=GITHUB_TIMEOUT,
            follow_redirects=True,
        ) as response:
            response.raise_for_status()
            
            # Check Content-Length if available
            content_length = response.headers.get("Content-Length")
            if content_length:
                size_mb = int(content_length) / (1024 * 1024)
                logger.debug(f"Archive size: {size_mb:.1f} MB")
                if size_mb > GITHUB_MAX_SIZE_MB:
                    raise FetchError(
                        message="Repository archive is too large",
                        source_type="github",
                        details=f"{size_mb:.1f} MB exceeds limit of {GITHUB_MAX_SIZE_MB} MB",
                    )
            
            # Download with size limit
            chunks = []
            total_size = 0
            max_bytes = GITHUB_MAX_SIZE_MB * 1024 * 1024
            
            for chunk in response.iter_bytes():
                total_size += len(chunk)
                if total_size > max_bytes:
                    raise FetchError(
                        message="Repository archive is too large",
                        source_type="github",
                        details=f"Exceeded {GITHUB_MAX_SIZE_MB} MB during download",
                    )
                chunks.append(chunk)
            
            logger.info(f"Downloaded {total_size / 1024:.1f} KB")
            return b"".join(chunks)
            
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            raise FetchError(
                message="Git reference not found",
                source_type="github",
                details=f"Branch/tag/commit '{ref}' does not exist",
            ) from e
        raise FetchError(
            message="Failed to download repository",
            source_type="github",
            details=f"HTTP {e.response.status_code}",
        ) from e
        
    except httpx.RequestError as e:
        raise FetchError(
            message="Failed to download from GitHub",
            source_type="github",
            details=str(e),
        ) from e


def extract_sol_files(tarball: bytes) -> list[tuple[str, bytes]]:
    """Extract .sol files from a tarball.
    
    Args:
        tarball: Raw tarball bytes (gzip compressed).
        
    Returns:
        List of (relative_path, content) tuples.
    """
    sol_files = []
    
    try:
        with tarfile.open(fileobj=io.BytesIO(tarball), mode="r:gz") as tar:
            for member in tar.getmembers():
                if not member.isfile():
                    continue
                if not member.name.endswith(".sol"):
                    continue
                
                # Extract relative path (remove root folder created by GitHub)
                # GitHub tarballs have structure: repo-branch/path/to/file.sol
                parts = member.name.split("/", 1)
                if len(parts) < 2:
                    continue
                relative_path = parts[1]
                
                # Read file content
                f = tar.extractfile(member)
                if f is None:
                    continue
                content = f.read()
                
                sol_files.append((relative_path, content))
                
    except tarfile.TarError as e:
        raise FetchError(
            message="Failed to extract archive",
            source_type="github",
            details=str(e),
        ) from e
    
    logger.info(f"Extracted {len(sol_files)} .sol files")
    return sol_files


# ============================= Main Fetcher =============================

def fetch_github(session: Session, source: ScopeSource) -> int:
    """Fetch Solidity files from a GitHub repository.
    
    Downloads the repository as a tarball, extracts .sol files,
    and creates ScopeContract entries for each.
    
    Args:
        session: Database session.
        source: The ScopeSource record to fetch.
        
    Returns:
        Number of contracts created.
        
    Raises:
        FetchError: If fetching fails.
    """
    logger.info(f"Starting GitHub fetch for source {source.id}")
    
    # Parse URL
    owner, repo = parse_github_url(source.url or "")
    
    # Determine ref to download
    ref = source.commit_hash or source.branch
    if not ref:
        ref = get_default_branch(owner, repo)
    
    logger.info(f"Fetching {owner}/{repo} @ {ref}")
    
    # Download tarball
    tarball = download_tarball(owner, repo, ref)
    
    # Extract .sol files
    sol_files = extract_sol_files(tarball)
    
    if not sol_files:
        logger.warning(f"No .sol files found in {owner}/{repo}")
        return 0
    
    # Ensure storage directory exists
    ensure_storage_dir(source.audit_id)
    
    # Create contract entries
    contracts_created = 0
    for relative_path, content in sol_files:
        contract = create_contract_from_content(
            session=session,
            source=source,
            file_path=relative_path,
            content=content,
            scope_reason="auto-imported from GitHub",
        )
        if contract:
            contracts_created += 1
    
    logger.info(f"Created {contracts_created} contracts from GitHub")
    return contracts_created
