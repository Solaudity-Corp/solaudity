import { API_BASE_URL, getAccessToken } from '../auth'

function authHeaders(): Record<string, string> {
  const token = getAccessToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const headers = { ...authHeaders(), ...(options.headers as Record<string, string> || {}) }
  const res = await fetch(url, { ...options, headers })
  if (!res.ok) {
    let detail = res.statusText
    try { const d = await res.json(); detail = d.detail ?? detail } catch { /* ignore */ }
    throw Object.assign(new Error(detail), { status: res.status })
  }
  return res
}

const BASE = `${API_BASE_URL}/libraries`

export type LibraryStatus = 'idle' | 'downloading' | 'downloaded' | 'error'

export interface Library {
  id: string
  display_name: string
  description: string
  status: LibraryStatus
}

export async function listLibraries(): Promise<Library[]> {
  const res = await apiFetch(BASE)
  return res.json()
}

export async function installLibrary(id: string): Promise<void> {
  await apiFetch(`${BASE}/${id}/install`, { method: 'POST' })
}
