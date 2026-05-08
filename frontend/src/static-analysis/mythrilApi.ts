import { API_BASE_URL, getAccessToken, logoutUser } from '../auth'

const BASE = `${API_BASE_URL}/static-analysis/mythril`

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

export type MythrilPreset = 'standard' | 'deep' | 'thorough'
export type MythrilStatus = 'pending' | 'running' | 'done' | 'error'
export type MythrilSeverity = 'High' | 'Medium' | 'Low'

export interface MythrilIssue {
  id: string
  run_id: string
  audit_id: string
  scope_contract_id: string
  swc_id: string | null
  title: string
  severity: MythrilSeverity
  contract: string | null
  function_name: string | null
  filename: string | null
  lineno: number | null
  code: string | null
  description: string
  address: number | null
  min_gas_used: number | null
  max_gas_used: number | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx_sequence: any | null
  source_map: string | null
  created_at: string
}

export interface MythrilRun {
  id: string
  audit_id: string
  scope_contract_id: string
  preset: MythrilPreset
  status: MythrilStatus
  mythril_version: string | null
  exit_code: number | null
  started_at: string | null
  finished_at: string | null
  duration_ms: number | null
  count_high: number
  count_medium: number
  count_low: number
  error_message: string | null
  created_at: string
}

export interface MythrilRunDetail extends MythrilRun {
  issues: MythrilIssue[]
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export async function triggerRun(
  auditId: string,
  contractId: string,
  preset: MythrilPreset = 'standard',
): Promise<MythrilRunDetail> {
  const res = await apiFetch(
    `${BASE}/audits/${auditId}/contracts/${contractId}/run?preset=${preset}`,
    { method: 'POST' },
  )
  return res.json()
}

export async function listRunsForAudit(auditId: string): Promise<MythrilRun[]> {
  const res = await apiFetch(`${BASE}/audits/${auditId}/runs`)
  return res.json()
}

export async function listRunsForContract(auditId: string, contractId: string): Promise<MythrilRun[]> {
  const res = await apiFetch(`${BASE}/audits/${auditId}/contracts/${contractId}/runs`)
  return res.json()
}

export async function getRun(runId: string): Promise<MythrilRunDetail> {
  const res = await apiFetch(`${BASE}/runs/${runId}`)
  return res.json()
}

export async function deleteRun(runId: string): Promise<void> {
  await apiFetch(`${BASE}/runs/${runId}`, { method: 'DELETE' })
}
