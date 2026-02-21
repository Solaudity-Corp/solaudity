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
