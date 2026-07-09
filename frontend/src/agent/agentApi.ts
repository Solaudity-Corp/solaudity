import { API_BASE_URL, getAccessToken, logoutUser } from '../auth'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type AgentRunStatus = 'pending' | 'running' | 'done' | 'error'
export type AgentFindingStatus = 'verified' | 'refuted' | 'unverified' | 'needs_review'
export type AgentSeverity = 'High' | 'Medium' | 'Low' | 'Informational'

export interface AgentRun {
  id: string
  audit_id: string
  status: AgentRunStatus
  provider: string | null
  model: string | null
  phase: string | null
  started_at: string | null
  finished_at: string | null
  duration_ms: number | null
  count_verified: number
  count_refuted: number
  count_unverified: number
  count_needs_review: number
  error_message: string | null
  created_at: string
}

export interface AgentFinding {
  id: string
  run_id: string
  audit_id: string
  scope_contract_id: string | null
  title: string
  severity: AgentSeverity
  status: AgentFindingStatus
  category: string | null
  target_contract: string | null
  target_function: string | null
  root_cause: string | null
  description: string
  recommendation: string | null
  poc_code: string | null
  poc_output: string | null
  exploit_proven: boolean
  correlated_sources: string[] | null
  is_novel: boolean
  promoted_report_finding_id: string | null
  created_at: string
}

export interface AgentRunDetail extends AgentRun {
  findings: AgentFinding[]
}

// Streamed WebSocket event shapes (loosely typed; discriminated by `type`).
export interface AgentEvent {
  type: 'phase' | 'log' | 'issue' | 'prove' | 'forge' | 'finding' | 'done' | 'error' | 'closed'
  phase?: string
  message?: string
  stage?: string
  title?: string
  issue?: {
    title?: string; severity?: string; category?: string
    verdict?: string; exploitability?: string; reasoning?: string
  }
  output?: string
  passed?: boolean
  error_kind?: string
  finding?: AgentFinding
  summary?: { verified: number; refuted: number; unverified: number; needs_review: number; model?: string }
}

const BASE = API_BASE_URL ?? 'http://localhost:8001'

function authHeaders(): Record<string, string> {
  const token = getAccessToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const headers = { ...authHeaders(), ...(options.headers as Record<string, string> | undefined) }
  const res = await fetch(`${BASE}${path}`, { ...options, headers })
  if (!res.ok) {
    if (res.status === 401) logoutUser()
    let detail = `Request failed (${res.status})`
    try { const j = await res.json(); if (j?.detail) detail = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail) } catch { /* */ }
    throw new Error(detail)
  }
  return res
}

// ---------------------------------------------------------------------------
// REST
// ---------------------------------------------------------------------------
export async function createRun(auditId: string, opts: { model?: string | null; max_prove?: number } = {}): Promise<AgentRun> {
  const res = await apiFetch(`/ai-agent/audits/${auditId}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: opts.model ?? null, max_prove: opts.max_prove ?? 6 }),
  })
  return res.json()
}

export async function listRuns(auditId: string): Promise<AgentRun[]> {
  const res = await apiFetch(`/ai-agent/audits/${auditId}/runs`)
  return res.json()
}

export async function getRun(runId: string): Promise<AgentRunDetail> {
  const res = await apiFetch(`/ai-agent/runs/${runId}`)
  return res.json()
}

export async function promoteFinding(findingId: string): Promise<{ report_finding_id: string; agent_finding_id: string }> {
  const res = await apiFetch(`/ai-agent/findings/${findingId}/promote`, { method: 'POST' })
  return res.json()
}

export function buildAgentWsUrl(runId: string): string {
  const base = BASE.replace(/^http/, 'ws')
  const token = encodeURIComponent(getAccessToken() ?? '')
  return `${base}/ai-agent/ws/${runId}?token=${token}`
}
