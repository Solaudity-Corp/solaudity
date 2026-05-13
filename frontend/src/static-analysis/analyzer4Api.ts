import { API_BASE_URL, getAccessToken, logoutUser } from '../auth'

const BASE = `${API_BASE_URL}/static-analysis/analyzer4`

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

export type Analyzer4Status = 'pending' | 'running' | 'done' | 'error'
export type Analyzer4IssueType = 'H' | 'M' | 'L' | 'NC' | 'GAS'

export interface Analyzer4Finding {
  id: string
  run_id: string
  audit_id: string
  scope_contract_id: string | null
  issue_type: Analyzer4IssueType
  title: string
  description: string | null
  filename: string | null
  line: number | null
  end_line: number | null
  created_at: string
}

export interface Analyzer4Run {
  id: string
  audit_id: string
  scope_contract_id: string | null
  status: Analyzer4Status
  tool_version: string | null
  exit_code: number | null
  started_at: string | null
  finished_at: string | null
  duration_ms: number | null
  count_high: number
  count_medium: number
  count_low: number
  count_nc: number
  count_gas: number
  error_message: string | null
  created_at: string
}

export interface Analyzer4RunDetail extends Analyzer4Run {
  findings: Analyzer4Finding[]
}

export async function triggerRun(auditId: string, contractId: string): Promise<Analyzer4RunDetail> {
  const res = await apiFetch(`${BASE}/audits/${auditId}/contracts/${contractId}/run`, { method: 'POST' })
  return res.json()
}

export async function listRunsForContract(auditId: string, contractId: string): Promise<Analyzer4Run[]> {
  const res = await apiFetch(`${BASE}/audits/${auditId}/contracts/${contractId}/runs`)
  return res.json()
}

export async function getRun(runId: string): Promise<Analyzer4RunDetail> {
  const res = await apiFetch(`${BASE}/runs/${runId}`)
  return res.json()
}

export async function deleteRun(runId: string): Promise<void> {
  await apiFetch(`${BASE}/runs/${runId}`, { method: 'DELETE' })
}
