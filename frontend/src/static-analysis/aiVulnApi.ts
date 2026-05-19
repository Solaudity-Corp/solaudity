import { API_BASE_URL, getAccessToken, logoutUser } from '../auth'

const BASE = `${API_BASE_URL}/ai`

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

export interface VulnTypeInfo {
  id: string
  title: string
  description: string
}

export interface VulnScan {
  id: string
  audit_id: string
  contract_id: string
  vuln_type: string
  provider: string
  model: string
  content: string
  created_at: string
}

export async function listVulnTypes(): Promise<VulnTypeInfo[]> {
  const res = await apiFetch(`${BASE}/vuln-types`)
  const data = await res.json()
  return data.items
}

export async function runVulnScan(
  auditId: string,
  contractId: string,
  vulnType: string,
  model?: string,
): Promise<VulnScan> {
  const res = await apiFetch(`${BASE}/vuln-scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audit_id: auditId,
      contract_id: contractId,
      vuln_type: vulnType,
      model: model ?? null,
      timeout_seconds: 120,
    }),
  })
  const data = await res.json()
  return data.scan
}

export async function listVulnScansForContract(contractId: string): Promise<VulnScan[]> {
  const res = await apiFetch(`${BASE}/vuln-scans/contract/${contractId}`)
  const data = await res.json()
  return data.items
}
