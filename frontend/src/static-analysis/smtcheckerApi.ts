import { API_BASE_URL, getAccessToken, logoutUser } from '../auth'

const BASE = `${API_BASE_URL}/static-analysis/smtchecker`

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

export type SMTCheckerStatus   = 'pending' | 'running' | 'done' | 'error'
export type SMTCheckerSeverity = 'error' | 'warning' | 'info'
export type SMTCheckerEngine   = 'chc' | 'bmc' | 'all'

export interface SMTCheckerFinding {
  id: string
  run_id: string
  audit_id: string
  severity: SMTCheckerSeverity
  target: string | null
  message: string
  formatted_message: string | null
  filename: string | null
  line: number | null
  col: number | null
  created_at: string
}

export interface SMTCheckerRun {
  id: string
  audit_id: string
  scope_contract_id: string | null
  status: SMTCheckerStatus
  engine: SMTCheckerEngine
  exit_code: number | null
  started_at: string | null
  finished_at: string | null
  duration_ms: number | null
  count_warnings: number
  count_errors: number
  error_message: string | null
  created_at: string
}

export interface SMTCheckerRunDetail extends SMTCheckerRun {
  findings: SMTCheckerFinding[]
}

export async function triggerRun(
  auditId: string,
  contractId: string,
  engine: SMTCheckerEngine = 'chc',
): Promise<SMTCheckerRunDetail> {
  const res = await apiFetch(
    `${BASE}/audits/${auditId}/contracts/${contractId}/run?engine=${engine}`,
    { method: 'POST' },
  )
  return res.json()
}

export async function listRunsForContract(auditId: string, contractId: string): Promise<SMTCheckerRun[]> {
  const res = await apiFetch(`${BASE}/audits/${auditId}/contracts/${contractId}/runs`)
  return res.json()
}

export async function getRun(runId: string): Promise<SMTCheckerRunDetail> {
  const res = await apiFetch(`${BASE}/runs/${runId}`)
  return res.json()
}

export async function deleteRun(runId: string): Promise<void> {
  await apiFetch(`${BASE}/runs/${runId}`, { method: 'DELETE' })
}
