"""
Source fetchers for external code repositories and blockchain explorers.

This package provides a unified interface for fetching Solidity source code from:
- GitHub repositories
- Blockchain explorers (Etherscan, Arbiscan, Polygonscan, BSCScan, Basescan, Optimism)

Usage:
    from app.api.scope.fetchers import fetch_source
    
    contracts_count = fetch_source(session, source)
"""
from __future__ import annotations

from sqlmodel import Session

from app.models.scope import ScopeSource, SourceType

from .base import FetchError, logger
from .explorer import fetch_explorer
from .github import fetch_github

__all__ = [
    "fetch_source",
    "FetchError",
    "fetch_github",
    "fetch_explorer",
]

# Source types that use the explorer fetcher
EXPLORER_SOURCE_TYPES = frozenset({
    SourceType.etherscan,
    SourceType.arbiscan,
    SourceType.polygonscan,
    SourceType.bscscan,
    SourceType.basescan,
    SourceType.optimism,
})


def fetch_source(session: Session, source: ScopeSource, etherscan_api_key: str | None = None) -> int:
    """Fetch source code from an external source.
    
    Dispatches to the appropriate fetcher based on source_type.
    This is the main entry point for fetching external sources.
    
    Args:
        session: Database session for creating contracts.
        source: The ScopeSource to fetch.
        
    Returns:
        Number of contracts created.
        
    Raises:
        FetchError: If fetching fails with a clear error message.
        NotImplementedError: If source type is not yet supported.
    """
    logger.info(f"Dispatching fetch for source {source.id} (type: {source.source_type.value})")
    
    if source.source_type == SourceType.github:
        return fetch_github(session, source)
    
    elif source.source_type in EXPLORER_SOURCE_TYPES:
        return fetch_explorer(session, source, etherscan_api_key)
    
    elif source.source_type == SourceType.upload:
        # Upload sources don't need fetching
        logger.info("Upload source - nothing to fetch")
        return 0
    
    elif source.source_type == SourceType.bug_bounty:
        raise NotImplementedError(
            f"Bug bounty fetcher not implemented yet. "
            f"Platform: {source.platform_name or 'unknown'}"
        )
    
    else:
        raise NotImplementedError(f"Unknown source type: {source.source_type.value}")
