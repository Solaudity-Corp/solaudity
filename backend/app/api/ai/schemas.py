from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class ExtractAuditFieldsRequest(BaseModel):
    """Payload for AI-based audit field extraction.

    Fields:
        text: Raw source text to parse (notes, briefs, links, etc.).
        model: Optional provider-specific model override.
        timeout_seconds: HTTP timeout for provider call in seconds.
    """
    text: str = Field(min_length=1, max_length=50_000)
    model: str | None = Field(default=None, max_length=120)
    timeout_seconds: int = Field(default=30, ge=5, le=120)


class ExtractAuditFieldsRead(BaseModel):
    """Normalized extracted audit fields returned by the model.

    Fields:
        title: Audit title.
        slug: URL-friendly slug.
        description: Project/audit description.
        chain: Blockchain family.
        network: Blockchain network/environment.
        repo_url: Source repository URL.
        commit_hash: Commit hash under review.
        docs_url: Documentation URL.
        start_date: Audit start date (YYYY-MM-DD when provided).
        end_date: Audit end date (YYYY-MM-DD when provided).
    """
    title: str | None
    slug: str | None
    description: str | None
    chain: str | None
    network: str | None
    repo_url: str | None
    commit_hash: str | None
    docs_url: str | None
    start_date: str | None
    end_date: str | None


class ExtractAuditFieldsResponse(BaseModel):
    """Top-level extraction response.

    Fields:
        provider: Provider used for extraction.
        model: Model name used for extraction.
        fields: Parsed/normalized audit field values.
    """
    provider: str
    model: str
    fields: ExtractAuditFieldsRead


class GenerateDocRequest(BaseModel):
    """Payload for AI-based Markdown documentation generation.

    Fields:
        audit_id: The audit this doc belongs to.
        code_text: Raw Solidity code or selected text snippet to document.
        contract_id: Optional FK to the scope_contracts record this doc covers.
        address_id: Optional FK to the scope_addresses record this doc covers.
        model: Optional provider-specific model override.
        timeout_seconds: HTTP timeout for provider call in seconds.
    """
    audit_id: UUID
    code_text: str = Field(min_length=1, max_length=100_000)
    contract_id: UUID | None = Field(default=None)
    address_id: UUID | None = Field(default=None)
    model: str | None = Field(default=None, max_length=120)
    timeout_seconds: int = Field(default=60, ge=5, le=180)


class GenerateDocRead(BaseModel):
    """Persisted AI doc record returned after generation.

    Fields:
        id: UUID of the created ai_docs row.
        audit_id: Parent audit.
        contract_id: Linked contract, if any.
        address_id: Linked address, if any.
        content: Generated Markdown documentation.
        provider: Provider used for generation.
        model: Model used for generation.
        created_at: Timestamp of creation.
    """
    id: UUID
    audit_id: UUID
    contract_id: UUID | None
    address_id: UUID | None
    content: str
    provider: str
    model: str
    created_at: datetime


class GenerateDocResponse(BaseModel):
    """Top-level response for doc generation.

    Fields:
        provider: Provider used.
        model: Model used.
        doc: The created doc record.
    """
    provider: str
    model: str
    doc: GenerateDocRead


class OpenRouterModelsRequest(BaseModel):
    """Payload for listing OpenRouter models.

    Fields:
        api_key: Optional key to preview models with before saving it to the
            profile. Falls back to the user's stored key when omitted.
    """
    api_key: str | None = Field(default=None, max_length=512)


class OpenRouterModel(BaseModel):
    """A single model entry from the OpenRouter catalog.

    Fields:
        id: Provider-namespaced model slug (e.g. ``openai/gpt-4o``).
        name: Human-readable display name.
        context_length: Maximum context window in tokens, when known.
        is_free: True when both prompt and completion pricing are zero.
    """
    id: str
    name: str
    context_length: int | None = None
    is_free: bool = False


class OpenRouterModelsResponse(BaseModel):
    """List of models available on OpenRouter (free models first).

    Fields:
        items: Ordered list of models (free first, then alphabetical).
        total: Total count.
    """
    items: list[OpenRouterModel]
    total: int


class AiDocListResponse(BaseModel):
    """List of AI doc records for a contract or audit.

    Fields:
        items: Ordered list of docs (newest first).
        total: Total count.
    """
    items: list[GenerateDocRead]
    total: int
