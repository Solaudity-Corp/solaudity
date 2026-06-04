from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any
from urllib import error, parse, request


SUPPORTED_AI_PROVIDERS = {"openai", "groq", "xai", "gemini", "claude"}

DEFAULT_MODELS = {
    "openai": "gpt-4o-mini",
    "groq": "llama-3.3-70b-versatile",
    "xai": "grok-2-latest",
    "gemini": "gemini-2.0-flash",
    "claude": "claude-sonnet-4-5-20250929",
}

OPENAI_COMPATIBLE_BASE_URL = {
    "openai": "https://api.openai.com",
    "groq": "https://api.groq.com/openai",
    "xai": "https://api.x.ai",
}

EXTRACTION_SYSTEM_PROMPT = """
You are a strict information extractor.
Extract audit fields from free text and return JSON only.

Rules:
- Return a single valid JSON object.
- Do not include markdown.
- Use null for missing values.
- Pive a prety consistant description 4 lines minimum and make it simple.
- Dates must use ISO format YYYY-MM-DD when present.
- make the slug from the title make it lowercase and replace spaces with dashes.

Expected JSON keys:
{
  "title": "string|null",
  "slug": "string|null",
  "description": "string|null",
  "chain": "string|null",
  "network": "string|null",
  "repo_url": "string|null",
  "commit_hash": "string|null",
  "docs_url": "string|null",
  "start_date": "string|null",
  "end_date": "string|null"
}
""".strip()


DOC_GENERATION_SYSTEM_PROMPT = """
You are a senior smart contract security auditor and documentation expert specializing in Solidity.
Your task is to generate precise, well-structured Markdown documentation for the provided Solidity code snippet.

The output MUST follow this exact structure — every section header must appear, even if the answer is "None" or "N/A":

# Summary
[Write 2–4 sentences describing the purpose of this contract or function, its role in the protocol, and the high-level behavior. Be concise and direct — no filler.]

# Description
[Provide a detailed walkthrough of the logic. Cover the full control flow, branching conditions, state transitions, and edge cases. This is written for security auditors — be technical and precise. Explain *what* the code does and *why* each step matters.]

# Parameters
[List each input parameter in the format: `- name (type): description`. If there are no parameters, write "None."]

# Return Values
[List each return value in the format: `- name (type): description`. If there are no return values, write "None."]

# State Changes
[List every storage variable read or written, in the format: `- variableName: read | written — explanation`. Describe what changes under what conditions. If no state is touched, write "None."]

# Access Control
[Describe all access restrictions: modifiers, require/revert checks, role-based guards, owner checks, etc. Be explicit about who can call this and under what conditions. If there are no restrictions, write "Unrestricted."]

# Events
[List all events emitted in the format: `- EventName(args): when and why it is emitted`. If no events are emitted, write "None."]

# Security Considerations
[List specific, technical security concerns an auditor should investigate. Include: potential reentrancy vectors, integer overflow/underflow risks, improper access control, front-running opportunities, oracle manipulation, unchecked return values, dangerous delegate calls, signature replay risks, etc. Be as specific as possible based on the code provided. If nothing stands out, write "No immediate concerns identified — standard review recommended."]

Rules:
- Output Markdown only. No code blocks containing the original source.
- Do not invent information — if something cannot be determined from the provided snippet, say so explicitly (e.g., "Cannot determine from snippet alone.").
- All section headers must appear in the final output in the exact order shown above.
- Write for a security-focused audience: concise, technical, and precise.
- Do not add extra sections or change section names.
""".strip()


DECOMPILED_DOC_SYSTEM_PROMPT = """
You are a senior EVM security researcher specializing in bytecode reverse engineering and black-box contract auditing.
You are analyzing pseudo-Solidity that was automatically decompiled from raw EVM bytecode by a decompiler (heimdall).

Critical context you must keep in mind:
- This is NOT original source code. It is machine-reconstructed from bytecode.
- Variable and function names (e.g. stor0, arg0, v1) are auto-generated placeholders — they do not reflect the original intent.
- Storage slot names (stor0, stor1, ...) represent raw EVM storage positions.
- Some logic may be imprecise, incomplete, or misrepresented due to decompiler limitations.
- Focus exclusively on OBSERVABLE BEHAVIOR and PATTERNS, not on naming or style.

Generate structured security-focused documentation in the following exact format — every section must appear:

# Summary
[2–4 sentences on what this contract appears to do based on bytecode behavior. Mention the number of identified function selectors. State clearly that this is decompiled output.]

# Function Analysis
[For each identified function: its 4-byte selector (if visible), apparent purpose inferred from behavior, parameter types, return values, and notable patterns. Use bullet points in this format:
- `0xXXXXXXXX` — description of behavior, inputs, outputs.]

# Storage Layout
[List every storage slot referenced and what it likely holds based on read/write patterns. Use this format:
- `stor0` — appears to store X (e.g. owner address, ERC-20 balance mapping, fee value).
If purpose is unclear, say so explicitly.]

# Access Control Patterns
[Describe every access restriction found: hardcoded address comparisons, caller checks, owner-like guard patterns. For each: which function(s) it protects and how the check is implemented.]

# Value Flows
[Describe all ETH and token movements: payable functions, msg.value usage, balance reads/writes, transfer patterns, and any conditions that gate value movement.]

# Security Observations
[List specific, technical security risks visible in the decompiled output. Consider: reentrancy vectors, unchecked external calls, delegatecall/callcode usage, selfdestruct presence, integer arithmetic without overflow protection, hardcoded addresses, missing zero-address checks, signature/replay risks. Reference specific behaviors, not generic advice.]

# Decompiler Limitations
[Identify areas where the decompilation is visibly incomplete, ambiguous, or unreliable — e.g. missing function bodies, unresolved jumps, unclear storage types, potential false patterns introduced by the decompiler.]

Rules:
- Output Markdown only. Do not reproduce the full decompiled code.
- All section headers must appear in the exact order shown above.
- Write for a security researcher doing a black-box audit with no access to the original source.
- Always qualify findings as based on decompiled output — they may contain inaccuracies.
- Do not invent information. If something cannot be determined from the bytecode, say so explicitly.
""".strip()


class AIProviderError(RuntimeError):
    """Raised for provider-level or prompt-processing failures."""

    pass


@dataclass
class ExtractedAuditFields:
    """Internal normalized extraction result.

    Attributes:
        title: Audit title.
        slug: URL-friendly slug.
        description: Audit/project description.
        chain: Blockchain family/context.
        network: Target network/environment.
        repo_url: Source repository URL.
        commit_hash: Commit hash being assessed.
        docs_url: Documentation URL.
        start_date: Start date as string (expected YYYY-MM-DD when present).
        end_date: End date as string (expected YYYY-MM-DD when present).
    """
    title: str | None = None
    slug: str | None = None
    description: str | None = None
    chain: str | None = None
    network: str | None = None
    repo_url: str | None = None
    commit_hash: str | None = None
    docs_url: str | None = None
    start_date: str | None = None
    end_date: str | None = None

    @classmethod
    def from_raw(cls, payload: dict[str, Any]) -> "ExtractedAuditFields":
        """Build typed extraction output from raw JSON payload."""
        return cls(
            title=_as_optional_text(payload.get("title")),
            slug=_as_optional_text(payload.get("slug")),
            description=_as_optional_text(payload.get("description")),
            chain=_as_optional_text(payload.get("chain")),
            network=_as_optional_text(payload.get("network")),
            repo_url=_as_optional_text(payload.get("repo_url")),
            commit_hash=_as_optional_text(payload.get("commit_hash")),
            docs_url=_as_optional_text(payload.get("docs_url")),
            start_date=_as_optional_text(payload.get("start_date")),
            end_date=_as_optional_text(payload.get("end_date")),
        )


def _as_optional_text(value: Any) -> str | None:
    """Convert any value to trimmed text, returning None for empty values."""
    if value is None:
        return None
    if not isinstance(value, str):
        value = str(value)
    normalized = value.strip()
    return normalized or None


def _parse_extraction_json(content: str) -> dict[str, Any]:
    """Parse JSON payload, with fallback extraction if model adds extra text."""
    try:
        data = json.loads(content)
        if isinstance(data, dict):
            return data
    except json.JSONDecodeError:
        pass

    match = re.search(r"\{.*\}", content, flags=re.DOTALL)
    if not match:
        raise AIProviderError("Model response did not contain JSON.")

    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError as exc:
        raise AIProviderError("Model returned invalid JSON.") from exc

    if not isinstance(data, dict):
        raise AIProviderError("Model JSON response must be an object.")
    return data


def _build_messages(user_text: str) -> list[dict[str, str]]:
    """Create shared system/user chat message list for extraction prompts."""
    return [
        {"role": "system", "content": EXTRACTION_SYSTEM_PROMPT},
        {"role": "user", "content": user_text},
    ]


def _normalize_error_payload(payload: str, *, max_len: int = 280) -> str:
    """Convert provider error payload to single line text with safe length."""
    text = " ".join(payload.strip().split())
    if not text:
        return "<empty response>"
    if len(text) <= max_len:
        return text
    return f"{text[:max_len]}..."


def _build_http_error_message(*, provider: str | None, status_code: int, payload: str) -> str:
    """Build readable provider error messages with provider-specific hints."""
    normalized = payload.lower()
    if provider == "groq" and "error code: 1010" in normalized:
        return (
            "Groq rejected this request (Cloudflare 1010). "
            "This is usually a network/IP restriction, not an invalid API key. "
            "Try another network/server location or switch provider."
        )

    short_payload = _normalize_error_payload(payload)
    return f"Provider HTTP {status_code}: {short_payload}"


def _post_json(
    url: str,
    payload: dict[str, Any],
    headers: dict[str, str],
    timeout_seconds: int,
    *,
    provider: str | None = None,
) -> dict[str, Any]:
    """Send JSON POST request and return parsed JSON response."""
    body = json.dumps(payload).encode("utf-8")
    request_headers = {
        "Accept": "application/json",
        # Cloudflare-backed providers may reject default urllib signatures.
        "User-Agent": "SolaudityBackend/1.0",
        **headers,
    }
    parsed_url = parse.urlparse(url)
    if parsed_url.scheme not in ("https", "http"):
        raise ValueError(f"Unsupported URL scheme: {parsed_url.scheme!r}")
    req = request.Request(url=url, method="POST", headers=request_headers, data=body)

    try:
        # nosemgrep
        with request.urlopen(req, timeout=timeout_seconds) as response:  # nosec B310
            raw = response.read().decode("utf-8")
    except error.HTTPError as exc:
        err_payload = exc.read().decode("utf-8", errors="replace")
        raise AIProviderError(
            _build_http_error_message(
                provider=provider,
                status_code=exc.code,
                payload=err_payload,
            )
        ) from exc
    except error.URLError as exc:
        raise AIProviderError(f"Provider network error: {exc}") from exc

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise AIProviderError("Provider response was not valid JSON.") from exc

    if not isinstance(parsed, dict):
        raise AIProviderError("Provider response must be a JSON object.")
    return parsed


def _call_openai_compatible(
    *,
    provider: str,
    api_key: str,
    model: str,
    user_text: str,
    timeout_seconds: int,
) -> str:
    """Call OpenAI-compatible chat completions APIs and return message text."""
    base_url = OPENAI_COMPATIBLE_BASE_URL[provider]
    url = f"{base_url}/v1/chat/completions"
    payload = {
        "model": model,
        "temperature": 0,
        "messages": _build_messages(user_text),
        "response_format": {"type": "json_object"},
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    parsed = _post_json(
        url,
        payload,
        headers,
        timeout_seconds,
        provider=provider,
    )

    choices = parsed.get("choices")
    if not isinstance(choices, list) or not choices:
        raise AIProviderError("Provider response did not include choices.")

    message = choices[0].get("message", {})
    content = message.get("content")
    if not isinstance(content, str) or not content.strip():
        raise AIProviderError("Provider response did not include message content.")

    return content


def _call_gemini(
    *,
    api_key: str,
    model: str,
    user_text: str,
    timeout_seconds: int,
) -> str:
    """Call Gemini generateContent API and return first candidate text."""
    encoded_key = parse.quote(api_key, safe="")
    model_name = parse.quote(model, safe="")
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"{model_name}:generateContent?key={encoded_key}"
    )

    payload = {
        "system_instruction": {
            "parts": [{"text": EXTRACTION_SYSTEM_PROMPT}],
        },
        "contents": [
            {"role": "user", "parts": [{"text": user_text}]},
        ],
        "generationConfig": {"temperature": 0},
    }
    headers = {
        "Content-Type": "application/json",
    }

    parsed = _post_json(
        url,
        payload,
        headers,
        timeout_seconds,
        provider="gemini",
    )
    candidates = parsed.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        raise AIProviderError("Gemini response did not include candidates.")

    parts = candidates[0].get("content", {}).get("parts", [])
    if not isinstance(parts, list) or not parts:
        raise AIProviderError("Gemini response did not include content parts.")

    text = parts[0].get("text")
    if not isinstance(text, str) or not text.strip():
        raise AIProviderError("Gemini response did not include text.")

    return text


def _call_claude(
    *,
    api_key: str,
    model: str,
    user_text: str,
    timeout_seconds: int,
) -> str:
    """Call Anthropic Messages API and return first text block."""
    url = "https://api.anthropic.com/v1/messages"
    payload = {
        "model": model,
        "max_tokens": 1024,
        "system": EXTRACTION_SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": user_text}],
    }
    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
    }

    parsed = _post_json(url, payload, headers, timeout_seconds, provider="claude")

    content = parsed.get("content")
    if not isinstance(content, list) or not content:
        raise AIProviderError("Claude response did not include content blocks.")

    text = content[0].get("text")
    if not isinstance(text, str) or not text.strip():
        raise AIProviderError("Claude response did not include text.")

    return text


def extract_audit_fields(
    *,
    user_text: str,
    provider: str,
    api_key: str,
    model: str | None = None,
    timeout_seconds: int = 30,
) -> ExtractedAuditFields:
    """
    Provider-agnostic extraction entrypoint used by API service layer.

    Args:
        user_text: Raw free text containing audit context/details.
        provider: Provider key (openai, groq, xai, gemini).
        api_key: User API key for the selected provider.
        model: Optional explicit model override. Uses provider default when omitted.
        timeout_seconds: Provider HTTP timeout in seconds.

    Returns:
        ExtractedAuditFields: Normalized structured fields extracted from free text.

    Raises:
        AIProviderError: For unsupported providers, invalid input, HTTP/network failures,
            malformed provider responses, or invalid JSON from the model.
    """
    provider_name = provider.strip().lower()
    if provider_name not in SUPPORTED_AI_PROVIDERS:
        raise AIProviderError(
            "Unsupported provider. Allowed values: "
            f"{', '.join(sorted(SUPPORTED_AI_PROVIDERS))}"
        )

    if not user_text.strip():
        raise AIProviderError("user_text cannot be empty.")
    if not api_key.strip():
        raise AIProviderError("api_key cannot be empty.")

    selected_model = (model or DEFAULT_MODELS[provider_name]).strip()
    if not selected_model:
        raise AIProviderError("model cannot be empty.")

    if provider_name in OPENAI_COMPATIBLE_BASE_URL:
        raw_content = _call_openai_compatible(
            provider=provider_name,
            api_key=api_key,
            model=selected_model,
            user_text=user_text,
            timeout_seconds=timeout_seconds,
        )
    elif provider_name == "claude":
        raw_content = _call_claude(
            api_key=api_key,
            model=selected_model,
            user_text=user_text,
            timeout_seconds=timeout_seconds,
        )
    else:
        raw_content = _call_gemini(
            api_key=api_key,
            model=selected_model,
            user_text=user_text,
            timeout_seconds=timeout_seconds,
        )

    payload = _parse_extraction_json(raw_content)
    return ExtractedAuditFields.from_raw(payload)


def _call_provider_raw(
    *,
    provider: str,
    api_key: str,
    model: str,
    system_prompt: str,
    user_text: str,
    timeout_seconds: int,
    max_tokens: int = 4096,
) -> str:
    """Generic provider dispatch that returns raw text (not JSON-parsed).

    Used for free-form generation tasks like documentation where the output
    is Markdown, not JSON.
    """
    provider_name = provider.strip().lower()

    if provider_name in OPENAI_COMPATIBLE_BASE_URL:
        base_url = OPENAI_COMPATIBLE_BASE_URL[provider_name]
        url = f"{base_url}/v1/chat/completions"
        payload = {
            "model": model,
            "temperature": 0.2,
            "max_tokens": max_tokens,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_text},
            ],
        }
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        parsed = _post_json(url, payload, headers, timeout_seconds, provider=provider_name)
        choices = parsed.get("choices")
        if not isinstance(choices, list) or not choices:
            raise AIProviderError("Provider response did not include choices.")
        content = choices[0].get("message", {}).get("content")
        if not isinstance(content, str) or not content.strip():
            raise AIProviderError("Provider response did not include message content.")
        return content

    elif provider_name == "claude":
        url = "https://api.anthropic.com/v1/messages"
        payload = {
            "model": model,
            "max_tokens": max_tokens,
            "system": system_prompt,
            "messages": [{"role": "user", "content": user_text}],
        }
        headers = {
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        }
        parsed = _post_json(url, payload, headers, timeout_seconds, provider="claude")
        content_blocks = parsed.get("content")
        if not isinstance(content_blocks, list) or not content_blocks:
            raise AIProviderError("Claude response did not include content blocks.")
        text = content_blocks[0].get("text")
        if not isinstance(text, str) or not text.strip():
            raise AIProviderError("Claude response did not include text.")
        return text

    elif provider_name == "gemini":
        encoded_key = parse.quote(api_key, safe="")
        model_name = parse.quote(model, safe="")
        url = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model_name}:generateContent?key={encoded_key}"
        )
        payload = {
            "system_instruction": {"parts": [{"text": system_prompt}]},
            "contents": [{"role": "user", "parts": [{"text": user_text}]}],
            "generationConfig": {"temperature": 0.2, "maxOutputTokens": max_tokens},
        }
        headers = {"Content-Type": "application/json"}
        parsed = _post_json(url, payload, headers, timeout_seconds, provider="gemini")
        candidates = parsed.get("candidates")
        if not isinstance(candidates, list) or not candidates:
            raise AIProviderError("Gemini response did not include candidates.")
        parts = candidates[0].get("content", {}).get("parts", [])
        if not isinstance(parts, list) or not parts:
            raise AIProviderError("Gemini response did not include content parts.")
        text = parts[0].get("text")
        if not isinstance(text, str) or not text.strip():
            raise AIProviderError("Gemini response did not include text.")
        return text

    else:
        raise AIProviderError(
            "Unsupported provider. Allowed values: "
            f"{', '.join(sorted(SUPPORTED_AI_PROVIDERS))}"
        )


def generate_doc(
    *,
    code_text: str,
    provider: str,
    api_key: str,
    model: str | None = None,
    timeout_seconds: int = 60,
) -> str:
    """Generate structured Markdown documentation for a Solidity code snippet.

    Args:
        code_text: The raw Solidity code or selected text to document.
        provider: Provider key (openai, groq, xai, gemini, claude).
        api_key: User API key for the selected provider.
        model: Optional explicit model override. Uses provider default when omitted.
        timeout_seconds: Provider HTTP timeout in seconds.

    Returns:
        str: AI-generated Markdown documentation string.

    Raises:
        AIProviderError: For unsupported providers, invalid input, HTTP/network failures,
            or empty responses from the model.
    """
    provider_name = provider.strip().lower()
    if provider_name not in SUPPORTED_AI_PROVIDERS:
        raise AIProviderError(
            "Unsupported provider. Allowed values: "
            f"{', '.join(sorted(SUPPORTED_AI_PROVIDERS))}"
        )
    if not code_text.strip():
        raise AIProviderError("code_text cannot be empty.")
    if not api_key.strip():
        raise AIProviderError("api_key cannot be empty.")

    selected_model = (model or DEFAULT_MODELS[provider_name]).strip()
    if not selected_model:
        raise AIProviderError("model cannot be empty.")

    user_message = (
        "Generate documentation for the following Solidity code:\n\n"
        f"```solidity\n{code_text}\n```"
    )

    return _call_provider_raw(
        provider=provider_name,
        api_key=api_key,
        model=selected_model,
        system_prompt=DOC_GENERATION_SYSTEM_PROMPT,
        user_text=user_message,
        timeout_seconds=timeout_seconds,
        max_tokens=4096,
    )


def generate_doc_decompiled(
    *,
    code_text: str,
    provider: str,
    api_key: str,
    model: str | None = None,
    timeout_seconds: int = 60,
) -> str:
    """Generate structured Markdown analysis for heimdall-decompiled EVM bytecode.

    Uses DECOMPILED_DOC_SYSTEM_PROMPT which is tuned for pseudo-Solidity output
    with storage slots (stor0/stor1), 4-byte selectors, and machine-generated patterns.

    Args:
        code_text: Decompiled pseudo-Solidity text from heimdall.
        provider: Provider key (openai, groq, xai, gemini, claude).
        api_key: User API key for the selected provider.
        model: Optional explicit model override. Uses provider default when omitted.
        timeout_seconds: Provider HTTP timeout in seconds.

    Returns:
        str: AI-generated Markdown analysis string.

    Raises:
        AIProviderError: For unsupported providers, invalid input, HTTP/network failures,
            or empty responses from the model.
    """
    provider_name = provider.strip().lower()
    if provider_name not in SUPPORTED_AI_PROVIDERS:
        raise AIProviderError(
            "Unsupported provider. Allowed values: "
            f"{', '.join(sorted(SUPPORTED_AI_PROVIDERS))}"
        )
    if not code_text.strip():
        raise AIProviderError("code_text cannot be empty.")
    if not api_key.strip():
        raise AIProviderError("api_key cannot be empty.")

    selected_model = (model or DEFAULT_MODELS[provider_name]).strip()
    if not selected_model:
        raise AIProviderError("model cannot be empty.")

    user_message = (
        "Analyze the following decompiled EVM bytecode (pseudo-Solidity output from heimdall):\n\n"
        f"```solidity\n{code_text}\n```"
    )

    return _call_provider_raw(
        provider=provider_name,
        api_key=api_key,
        model=selected_model,
        system_prompt=DECOMPILED_DOC_SYSTEM_PROMPT,
        user_text=user_message,
        timeout_seconds=timeout_seconds,
        max_tokens=4096,
    )
