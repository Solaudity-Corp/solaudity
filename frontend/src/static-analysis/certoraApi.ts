import { API_BASE_URL, getAccessToken, logoutUser } from '../auth'

const BASE = `${API_BASE_URL}/static-analysis/certora`

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

export type CertoraStatus = 'pending' | 'running' | 'done' | 'error'
export type CertoraRuleStatus = 'PASS' | 'FAIL' | 'TIMEOUT' | 'UNKNOWN' | 'SANITY_FAIL'

export interface CertoraSpec {
  id: string
  audit_id: string
  scope_contract_id: string | null
  filename: string
  storage_key: string
  created_at: string
}

export interface CertoraRule {
  id: string
  run_id: string
  audit_id: string
  name: string
  status: CertoraRuleStatus
  duration_ms: number | null
  message: string | null
  created_at: string
}

export interface CertoraRun {
  id: string
  audit_id: string
  scope_contract_id: string | null
  spec_id: string
  status: CertoraStatus
  tool_version: string | null
  exit_code: number | null
  started_at: string | null
  finished_at: string | null
  duration_ms: number | null
  count_pass: number
  count_fail: number
  count_timeout: number
  count_unknown: number
  error_message: string | null
  created_at: string
}

export interface CertoraRunDetail extends CertoraRun {
  rules: CertoraRule[]
}

export async function uploadSpec(auditId: string, contractId: string, file: File): Promise<CertoraSpec> {
  const form = new FormData()
  form.append('file', file)
  const res = await apiFetch(
    `${BASE}/audits/${auditId}/contracts/${contractId}/specs`,
    { method: 'POST', body: form },
  )
  return res.json()
}

export async function listSpecs(auditId: string, contractId: string): Promise<CertoraSpec[]> {
  const res = await apiFetch(`${BASE}/audits/${auditId}/contracts/${contractId}/specs`)
  return res.json()
}

export async function deleteSpec(specId: string): Promise<void> {
  await apiFetch(`${BASE}/specs/${specId}`, { method: 'DELETE' })
}

export async function triggerRun(auditId: string, contractId: string, specId: string): Promise<CertoraRunDetail> {
  const res = await apiFetch(
    `${BASE}/audits/${auditId}/contracts/${contractId}/specs/${specId}/run`,
    { method: 'POST' },
  )
  return res.json()
}

export async function listRunsForContract(auditId: string, contractId: string): Promise<CertoraRun[]> {
  const res = await apiFetch(`${BASE}/audits/${auditId}/contracts/${contractId}/runs`)
  return res.json()
}

export async function getRun(runId: string): Promise<CertoraRunDetail> {
  const res = await apiFetch(`${BASE}/runs/${runId}`)
  return res.json()
}

export async function deleteRun(runId: string): Promise<void> {
  await apiFetch(`${BASE}/runs/${runId}`, { method: 'DELETE' })
}
