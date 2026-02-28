import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAccessToken, getAccessToken, setAccessToken } from '../src/auth'
import { ApiError, createAudit, deleteAudit, listAudits } from '../src/audits/api'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('audits api helpers', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    clearAccessToken()
    window.history.replaceState(null, '', '/')
  })

  it('builds the audits list query string and sends the auth header', async () => {
    setAccessToken('jwt-token')
    fetchMock.mockResolvedValue(
      jsonResponse({
        items: [],
        total: 0,
        counts: { draft: 0, in_progress: 0, completed: 0, archived: 0 },
      }),
    )

    await listAudits({
      search: 'sol',
      status: 'draft',
      pinned: true,
      include_archived: false,
      limit: 5,
      offset: 10,
    })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = new Headers(init.headers)

    expect(url).toBe('http://localhost:8001/audits?search=sol&status=draft&pinned=true&include_archived=false&limit=5&offset=10')
    expect(headers.get('Authorization')).toBe('Bearer jwt-token')
  })

  it('creates an audit with JSON headers and the bearer token', async () => {
    setAccessToken('jwt-token')
    fetchMock.mockResolvedValue(
      jsonResponse({
        id: '00000000-0000-0000-0000-000000000123',
        owner_id: '00000000-0000-0000-0000-000000000001',
        title: 'New Audit',
        slug: 'new-audit',
        description: null,
        status: 'draft',
        is_pinned: false,
        chain: null,
        network: null,
        repo_url: null,
        commit_hash: null,
        docs_url: null,
        start_date: null,
        end_date: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        last_opened_at: null,
        last_opened_by: null,
        attachments: [],
      }, 201),
    )

    await createAudit({
      title: 'New Audit',
      status: 'draft',
      is_pinned: false,
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = new Headers(init.headers)

    expect(headers.get('Authorization')).toBe('Bearer jwt-token')
    expect(headers.get('Content-Type')).toBe('application/json')
    expect(init.method).toBe('POST')
  })

  it('treats a 204 delete response as success', async () => {
    setAccessToken('jwt-token')
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await expect(deleteAudit('audit-id')).resolves.toBeUndefined()
  })

  it('clears the token and redirects on unauthorized audit requests', async () => {
    setAccessToken('jwt-token')
    window.history.replaceState(null, '', '/menu/audits')
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'Invalid credentials' }, 401))

    await expect(listAudits()).rejects.toBeInstanceOf(ApiError)

    expect(getAccessToken()).toBeNull()
    expect(window.location.pathname).toBe('/login')
  })
})
