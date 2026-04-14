import { API_BASE_URL, getAccessToken, logoutUser } from '../auth'

const BASE = `${API_BASE_URL}/solc-versions`

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

export type SolcVersionStatus = 'idle' | 'installing' | 'installed' | 'error'

export interface SolcVersion {
  version: string
  status: SolcVersionStatus
}

export async function listSolcVersions(): Promise<SolcVersion[]> {
  const res = await apiFetch(BASE)
  return res.json()
}

export async function installSolcVersion(version: string): Promise<void> {
  await apiFetch(`${BASE}/${version}/install`, { method: 'POST' })
}
