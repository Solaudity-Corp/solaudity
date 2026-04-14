import { API_BASE_URL, getAccessToken, logoutUser } from '../auth'

const BASE = `${API_BASE_URL}/static-analysis/slither`

function authHeaders(): Record<string, string> {
  const token = getAccessToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SlitherPreset = 'all' | 'high_medium' | 'reentrancy' | 'access_control' | 'code_quality'
export type SlitherStatus = 'pending' | 'running' | 'done' | 'error'
export type SlitherImpact = 'High' | 'Medium' | 'Low' | 'Informational' | 'Optimization'
export type SlitherConfidence = 'High' | 'Medium' | 'Low'

export interface SlitherElement {
  type: string
  name: string
  source_mapping?: {
    lines: number[]
    filename_short: string
    filename_absolute?: string
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type_specific_fields?: any
}

export interface SlitherFinding {
  id: string
  run_id: string
  audit_id: string
  scope_contract_id: string
  check: string
  impact: SlitherImpact
  confidence: SlitherConfidence
  description: string
  markdown: string | null
  elements: SlitherElement[] | null
  slither_id: string | null
  created_at: string
}

export interface SlitherRun {
  id: string
  audit_id: string
  scope_contract_id: string
  preset: SlitherPreset
  status: SlitherStatus
  slither_version: string | null
  exit_code: number | null
  started_at: string | null
  finished_at: string | null
  duration_ms: number | null
  count_high: number
  count_medium: number
  count_low: number
  count_informational: number
  count_optimization: number
  error_message: string | null
  created_at: string
}

export interface SlitherRunDetail extends SlitherRun {
  findings: SlitherFinding[]
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export async function triggerRun(
  auditId: string,
  contractId: string,
  preset: SlitherPreset = 'all',
): Promise<SlitherRunDetail> {
  const res = await apiFetch(
    `${BASE}/audits/${auditId}/contracts/${contractId}/run?preset=${preset}`,
    { method: 'POST' },
  )
  return res.json()
}

export async function listRunsForAudit(auditId: string): Promise<SlitherRun[]> {
  const res = await apiFetch(`${BASE}/audits/${auditId}/runs`)
  return res.json()
}

export async function listRunsForContract(auditId: string, contractId: string): Promise<SlitherRun[]> {
  const res = await apiFetch(`${BASE}/audits/${auditId}/contracts/${contractId}/runs`)
  return res.json()
}

export async function getRun(runId: string): Promise<SlitherRunDetail> {
  const res = await apiFetch(`${BASE}/runs/${runId}`)
  return res.json()
}

export async function deleteRun(runId: string): Promise<void> {
  await apiFetch(`${BASE}/runs/${runId}`, { method: 'DELETE' })
}
