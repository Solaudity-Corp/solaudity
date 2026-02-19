import type { AuditRecord, AuditStatus } from './types'
import { API_BASE_URL, clearAccessToken, getAccessToken } from '../auth'

function withApiHeaders(headersInit?: HeadersInit): Headers {
  const headers = new Headers(headersInit)
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const accessToken = getAccessToken()
  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`)
  }

  return headers
}

function handleUnauthorized(): void {
  clearAccessToken()

  if (typeof window === 'undefined') return

  if (window.location.pathname.toLowerCase() !== '/login') {
    window.history.replaceState(null, '', '/login')
  }
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export interface AuditStatusCounts {
  draft: number
  in_progress: number
  completed: number
  archived: number
}

export interface AuditListResponse {
  items: AuditRecord[]
  total: number
  counts: AuditStatusCounts
}

export interface AuditListParams {
  search?: string
  status?: AuditStatus
  chain?: string
  network?: string
  pinned?: boolean
  include_archived?: boolean
  limit?: number
  offset?: number
}

export interface CreateAuditPayload {
  owner_id?: string
  title: string
  slug?: string | null
  description?: string | null
  status: AuditStatus
  is_pinned: boolean
  chain?: string | null
  network?: string | null
  repo_url?: string | null
  commit_hash?: string | null
  docs_url?: string | null
  start_date?: string | null
  end_date?: string | null
}

export interface UpdateAuditPayload {
  title?: string
  slug?: string | null
  description?: string | null
  status?: AuditStatus
  is_pinned?: boolean
  chain?: string | null
  network?: string | null
  repo_url?: string | null
  commit_hash?: string | null
  docs_url?: string | null
  start_date?: string | null
  end_date?: string | null
}

export interface PinAuditPayload {
  is_pinned?: boolean
}

export interface OpenAuditPayload {
  opened_by?: string | null
}

export interface ExtractAuditFieldsPayload {
  text: string
  model?: string | null
  timeout_seconds?: number
}

export interface ExtractAuditFieldsRead {
  title: string | null
  slug: string | null
  description: string | null
  chain: string | null
  network: string | null
  repo_url: string | null
  commit_hash: string | null
  docs_url: string | null
  start_date: string | null
  end_date: string | null
}

export interface ExtractAuditFieldsResponse {
  provider: string
  model: string
  fields: ExtractAuditFieldsRead
}

export class ApiError extends Error {
  status: number
  detail: unknown

  constructor(status: number, detail: unknown) {
    super(formatErrorMessage(status, detail))
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

function formatErrorMessage(status: number, detail: unknown) {
  if (typeof detail === 'string' && detail.trim()) return detail

  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => {
        if (item && typeof item === 'object' && 'msg' in item && typeof item.msg === 'string') {
          return item.msg
        }
        return ''
      })
      .filter(Boolean)

    if (messages.length > 0) return messages.join(' ')
  }

  return `Request failed with status ${status}.`
}

function toQueryString(params: AuditListParams) {
  const search = new URLSearchParams()

  if (params.search) search.set('search', params.search)
  if (params.status) search.set('status', params.status)
  if (params.chain) search.set('chain', params.chain)
  if (params.network) search.set('network', params.network)
  if (typeof params.pinned === 'boolean') search.set('pinned', String(params.pinned))
  if (typeof params.include_archived === 'boolean') {
    search.set('include_archived', String(params.include_archived))
  }
  if (typeof params.limit === 'number') search.set('limit', String(params.limit))
  if (typeof params.offset === 'number') search.set('offset', String(params.offset))

  const value = search.toString()
  return value ? `?${value}` : ''
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: withApiHeaders(init?.headers),
  })

  const raw = await response.text()
  let parsed: unknown = null
  if (raw) {
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = raw
    }
  }

  if (!response.ok) {
    if (response.status === 401) {
      handleUnauthorized()
    }

    let detail: unknown = parsed
    if (parsed && typeof parsed === 'object' && 'detail' in parsed) {
      detail = (parsed as { detail: unknown }).detail
    }
    throw new ApiError(response.status, detail)
  }

  return parsed as T
}

export function listAudits(params: AuditListParams = {}) {
  return requestJson<AuditListResponse>(`/audits${toQueryString(params)}`)
}

export function getAudit(auditId: string) {
  return requestJson<AuditRecord>(`/audits/${auditId}`)
}

export function createAudit(payload: CreateAuditPayload) {
  return requestJson<AuditRecord>('/audits', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateAudit(auditId: string, payload: UpdateAuditPayload) {
  return requestJson<AuditRecord>(`/audits/${auditId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function setAuditPin(auditId: string, payload: PinAuditPayload = {}) {
  return requestJson<AuditRecord>(`/audits/${auditId}/pin`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function markAuditOpened(auditId: string, payload: OpenAuditPayload = {}) {
  return requestJson<AuditRecord>(`/audits/${auditId}/open`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function extractAuditFields(payload: ExtractAuditFieldsPayload) {
  return requestJson<ExtractAuditFieldsResponse>('/ai/extract-audit-fields', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

async function parseErrorResponse(response: Response): Promise<unknown> {
  const raw = await response.text()
  let parsed: unknown = null
  if (raw) {
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = raw
    }
  }

  if (parsed && typeof parsed === 'object' && 'detail' in parsed) {
    return (parsed as { detail: unknown }).detail
  }
  return parsed
}

export async function deleteAudit(auditId: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/audits/${auditId}/delete`, {
    method: 'POST',
    headers: withApiHeaders(),
  })

  if (response.status === 204) return

  if (response.status === 401) {
    handleUnauthorized()
  }

  const detail = await parseErrorResponse(response)

  throw new ApiError(response.status, detail)
}
