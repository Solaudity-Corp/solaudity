import { API_BASE_URL, getAccessToken, logoutUser } from '../auth'

const BASE = `${API_BASE_URL}/static-analysis/kevm`

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

export type KEVMStatus   = 'pending' | 'running' | 'done' | 'error'
export type KEVMSeverity = 'error' | 'warning' | 'info'
export type KEVMSchedule = 'CANCUN' | 'SHANGHAI' | 'MERGE' | 'LONDON' | 'BERLIN' | 'ISTANBUL' | 'DEFAULT'

export interface KEVMFinding {
  id: string
  run_id: string
  audit_id: string
  severity: KEVMSeverity
  category: string | null
  message: string
  created_at: string
}

export interface KEVMRun {
  id: string
  audit_id: string
  scope_contract_id: string | null
  status: KEVMStatus
  schedule: string
  exit_code: number | null
  started_at: string | null
  finished_at: string | null
  duration_ms: number | null
  count_warnings: number
  count_errors: number
  error_message: string | null
  created_at: string
}

export interface KEVMRunDetail extends KEVMRun {
  findings: KEVMFinding[]
}

export async function triggerRun(
  auditId: string,
  contractId: string,
  schedule: KEVMSchedule = 'CANCUN',
): Promise<KEVMRunDetail> {
  const res = await apiFetch(
    `${BASE}/audits/${auditId}/contracts/${contractId}/run?schedule=${schedule}`,
    { method: 'POST' },
  )
  return res.json()
}

export async function listRunsForContract(auditId: string, contractId: string): Promise<KEVMRun[]> {
  const res = await apiFetch(`${BASE}/audits/${auditId}/contracts/${contractId}/runs`)
  return res.json()
}

export async function getRun(runId: string): Promise<KEVMRunDetail> {
  const res = await apiFetch(`${BASE}/runs/${runId}`)
  return res.json()
}

export async function deleteRun(runId: string): Promise<void> {
  await apiFetch(`${BASE}/runs/${runId}`, { method: 'DELETE' })
}
