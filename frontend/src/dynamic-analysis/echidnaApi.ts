import { API_BASE_URL, getAccessToken, logoutUser } from '../auth'

const BASE = `${API_BASE_URL}/dynamic-analysis/echidna`

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

export type EchidnaStatus = 'pending' | 'running' | 'done' | 'error'
export type EchidnaTestMode = 'property' | 'assertion' | 'overflow' | 'exploration'

export interface EchidnaTestResult {
  name: string
  status: 'passed' | 'failed' | 'error' | 'unknown'
  call_sequence: EchidnaCall[] | null
  error: string | null
}

export interface EchidnaCall {
  call?: {
    src?: string
    dst?: string
    value?: string
    gas?: string
    data?: string
  }
  block?: {
    number?: string
    timestamp?: string
  }
}

export interface EchidnaRun {
  id: string
  audit_id: string
  scope_contract_id: string
  test_mode: EchidnaTestMode
  timeout_seconds: number
  seed: number | null
  status: EchidnaStatus
  echidna_version: string | null
  exit_code: number | null
  started_at: string | null
  finished_at: string | null
  duration_ms: number | null
  count_passed: number
  count_failed: number
  error_message: string | null
  created_at: string
}

export interface EchidnaRunDetail extends EchidnaRun {
  test_results: EchidnaTestResult[] | null
  raw_stdout: string | null
  raw_stderr: string | null
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export async function triggerRun(
  auditId: string,
  contractId: string,
  testMode: EchidnaTestMode = 'property',
  timeoutSeconds = 60,
  seed?: number,
): Promise<EchidnaRunDetail> {
  const params = new URLSearchParams({
    test_mode: testMode,
    timeout_seconds: String(timeoutSeconds),
  })
  if (seed !== undefined) params.set('seed', String(seed))
  const res = await apiFetch(
    `${BASE}/audits/${auditId}/contracts/${contractId}/run?${params}`,
    { method: 'POST' },
  )
  return res.json()
}

export async function listRunsForAudit(auditId: string): Promise<EchidnaRun[]> {
  const res = await apiFetch(`${BASE}/audits/${auditId}/runs`)
  return res.json()
}

export async function listRunsForContract(auditId: string, contractId: string): Promise<EchidnaRun[]> {
  const res = await apiFetch(`${BASE}/audits/${auditId}/contracts/${contractId}/runs`)
  return res.json()
}

export async function getRun(runId: string): Promise<EchidnaRunDetail> {
  const res = await apiFetch(`${BASE}/runs/${runId}`)
  return res.json()
}

export async function deleteRun(runId: string): Promise<void> {
  await apiFetch(`${BASE}/runs/${runId}`, { method: 'DELETE' })
}
