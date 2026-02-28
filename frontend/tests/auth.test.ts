import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AuthApiError,
  clearAccessToken,
  getAccessToken,
  getCurrentUser,
  hasAccessToken,
  loginUser,
  setAccessToken,
  updateUserProfile,
} from '../src/auth'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('auth helpers', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    window.localStorage.clear()
    window.history.replaceState(null, '', '/')
  })

  it('stores and clears the access token', () => {
    expect(hasAccessToken()).toBe(false)

    setAccessToken('jwt-token')

    expect(getAccessToken()).toBe('jwt-token')
    expect(hasAccessToken()).toBe(true)

    clearAccessToken()

    expect(getAccessToken()).toBeNull()
    expect(hasAccessToken()).toBe(false)
  })

  it('stores the JWT returned by login', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ access_token: 'jwt-token', token_type: 'bearer' }),
    )

    const response = await loginUser('alice', 'StrongPass1')

    expect(response.access_token).toBe('jwt-token')
    expect(getAccessToken()).toBe('jwt-token')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:8001/api/auth/login')
    expect(init.method).toBe('POST')
  })

  it('redirects to login when an authenticated request is made without a token', async () => {
    window.history.replaceState(null, '', '/profile')

    await expect(getCurrentUser()).rejects.toBeInstanceOf(AuthApiError)

    expect(window.location.pathname).toBe('/login')
  })

  it('adds the bearer token to authenticated profile updates', async () => {
    setAccessToken('jwt-token')
    fetchMock.mockResolvedValue(
      jsonResponse({
        id: 1,
        username: 'alice',
        email: 'new@example.com',
        date_created: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
      }),
    )

    await updateUserProfile({ email: 'new@example.com' })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = new Headers(init.headers)

    expect(headers.get('Authorization')).toBe('Bearer jwt-token')
    expect(headers.get('Content-Type')).toBe('application/json')
  })
})
