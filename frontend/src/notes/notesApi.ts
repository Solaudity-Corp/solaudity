import { API_BASE_URL, getAccessToken, logoutUser } from '../auth'

async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getAccessToken()
  const headers: Record<string, string> = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers as Record<string, string> ?? {}),
  }
  const res = await fetch(url, { ...options, headers })
  if (!res.ok) {
    if (res.status === 401) logoutUser()
    let detail = res.statusText
    try { const d = await res.json(); detail = d.detail ?? detail } catch { /* ignore */ }
    throw Object.assign(new Error(detail), { status: res.status })
  }
  return res
}

export interface AuditNote {
  content: string
  updated_at: string | null
}

export async function getNote(auditId: string): Promise<AuditNote> {
  const res = await apiFetch(`${API_BASE_URL}/audits/${auditId}/note`)
  return res.json()
}

export async function saveNote(auditId: string, content: string): Promise<AuditNote> {
  const res = await apiFetch(`${API_BASE_URL}/audits/${auditId}/note`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  })
  return res.json()
}
