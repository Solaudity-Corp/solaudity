import { API_BASE_URL, getAccessToken, logoutUser } from '../auth'

const AI = `${API_BASE_URL}/ai`

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = getAccessToken()
  return token ? { Authorization: `Bearer ${token}`, ...extra } : extra
}

async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const headers = { ...authHeaders(), ...(options.headers as Record<string, string> || {}) }
  const res = await fetch(url, { ...options, headers })
  if (!res.ok) {
    if (res.status === 401) logoutUser()
    let detail = res.statusText
    try { const d = await res.json(); detail = d.detail ?? detail } catch { /* ignore */ }
    throw Object.assign(new Error(detail), { status: res.status })
  }
  return res
}

const SCOPE = `${API_BASE_URL}/scope`

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScopeContractRead {
  id: string
  audit_id: string
  file_path: string
  file_name: string
  sloc: number | null
  is_in_scope: boolean
  compiler_version: string | null
  license: string | null
  content_hash: string | null
  created_at: string
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export async function listContracts(auditId: string): Promise<ScopeContractRead[]> {
  const res = await apiFetch(`${SCOPE}/audits/${auditId}/contracts`)
  const data = await res.json()
  return data.items ?? data
}

export async function getContractContent(contractId: string): Promise<string> {
  const res = await apiFetch(`${SCOPE}/contracts/${contractId}/content`)
  return res.text()
}

export async function saveContractContent(contractId: string, content: string): Promise<void> {
  await apiFetch(`${SCOPE}/contracts/${contractId}/content`, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body: content,
  })
}

// ---------------------------------------------------------------------------
// AI Doc
// ---------------------------------------------------------------------------

export interface AiDocRecord {
  id: string
  audit_id: string
  contract_id: string | null
  address_id: string | null
  content: string
  provider: string
  model: string
  created_at: string
}

export interface GenerateDocResponse {
  provider: string
  model: string
  doc: AiDocRecord
}

export async function generateDoc(params: {
  audit_id: string
  code_text: string
  contract_id?: string | null
  address_id?: string | null
  model?: string | null
  timeout_seconds?: number
}): Promise<GenerateDocResponse> {
  const res = await apiFetch(`${AI}/generate-doc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  return res.json()
}

export interface AiDocListResponse {
  items: AiDocRecord[]
  total: number
}

export async function listDocsForContract(contractId: string): Promise<AiDocListResponse> {
  const res = await apiFetch(`${AI}/docs/contract/${contractId}`)
  return res.json()
}

export async function listDocsForAddress(addressId: string): Promise<AiDocListResponse> {
  const res = await apiFetch(`${AI}/docs/address/${addressId}`)
  return res.json()
}
