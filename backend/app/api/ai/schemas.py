from pydantic import BaseModel, Field


class ExtractAuditFieldsRequest(BaseModel):
    text: str = Field(min_length=1, max_length=50_000)
    model: str | None = Field(default=None, max_length=120)
    timeout_seconds: int = Field(default=30, ge=5, le=120)


class ExtractAuditFieldsRead(BaseModel):
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
    provider: str
    model: str
    fields: ExtractAuditFieldsRead

