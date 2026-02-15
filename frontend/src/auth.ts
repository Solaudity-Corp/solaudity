export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, '')
  ?? 'http://localhost:8001'

const ACCESS_TOKEN_STORAGE_KEY = 'solaudity_access_token'

export interface AuthTokenResponse {
  access_token: string
  token_type: string
}

export interface RegisterPayload {
  username: string
  email: string
  password: string
}

export interface UserRead {
  id: number
  username: string
  email: string
  date_created: string
  updated_at: string
}

export class AuthApiError extends Error {
  status: number
  detail: unknown

  constructor(status: number, detail: unknown) {
    super(formatErrorMessage(status, detail))
    this.name = 'AuthApiError'
    this.status = status
    this.detail = detail
  }
}

function formatErrorMessage(status: number, detail: unknown): string {
  if (typeof detail === 'string' && detail.trim()) return detail

  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => {
        if (item && typeof item === 'object' && 'msg' in item && typeof item.msg === 'string') {
          return item.msg
        }
        return ''
      })
      .filter(Boolean)

    if (messages.length > 0) return messages.join(' ')
  }

  return `Request failed with status ${status}.`
}

function getParsedDetail(payload: unknown): unknown {
  if (payload && typeof payload === 'object' && 'detail' in payload) {
    return (payload as { detail: unknown }).detail
  }
  return payload
}

async function requestAuthJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  })

  const raw = await response.text()
  let parsed: unknown = null
  if (raw) {
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = raw
    }
  }

  if (!response.ok) {
    throw new AuthApiError(response.status, getParsedDetail(parsed))
  }

  return parsed as T
}

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

export function getAccessToken(): string | null {
  if (!canUseStorage()) return null
  const token = window.localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY)
  if (!token) return null
  const normalized = token.trim()
  return normalized.length > 0 ? normalized : null
}

export function setAccessToken(token: string): void {
  if (!canUseStorage()) return
  window.localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, token)
}

export function clearAccessToken(): void {
  if (!canUseStorage()) return
  window.localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY)
}

export function hasAccessToken(): boolean {
  return getAccessToken() !== null
}

export async function loginUser(username: string, password: string): Promise<AuthTokenResponse> {
  const payload = await requestAuthJson<AuthTokenResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      username: username.trim(),
      password,
    }),
  })

  if (!payload.access_token || typeof payload.access_token !== 'string') {
    throw new Error('Login succeeded but no JWT access token was returned.')
  }

  setAccessToken(payload.access_token)
  return payload
}

export function registerUser(payload: RegisterPayload): Promise<UserRead> {
  return requestAuthJson<UserRead>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      username: payload.username.trim(),
      email: payload.email.trim(),
      password: payload.password,
    }),
  })
}
