import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAccessToken, setAccessToken } from '../src/auth'
import {
  getDependencies,
  getDescribe,
  getFlatten,
  getFtrace,
  getGraph,
  getInheritance,
  getMdReport,
  getParse,
} from '../src/enum/suryaApi'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE = 'http://localhost:8001/enum/surya'

function textResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain' },
  })
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('suryaApi', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    clearAccessToken()
  })

  // -------------------------------------------------------------------------
  // getGraph
  // -------------------------------------------------------------------------

  describe('getGraph', () => {
    it('sends the correct base URL with no options and no ids', async () => {
      fetchMock.mockResolvedValue(textResponse('digraph {}'))

      await getGraph('audit-1')

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe(`${BASE}/audits/audit-1/graph?`)
    })

    it('appends scope_contract_id params for each id in the list', async () => {
      fetchMock.mockResolvedValue(textResponse('digraph {}'))

      await getGraph('audit-1', {}, ['contract-a', 'contract-b'])

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
      const parsed = new URL(url)
      expect(parsed.searchParams.getAll('scope_contract_id')).toEqual(['contract-a', 'contract-b'])
    })

    it('sets simple=true when the simple flag is on', async () => {
      fetchMock.mockResolvedValue(textResponse('digraph {}'))

      await getGraph('audit-1', { simple: true })

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(new URL(url).searchParams.get('simple')).toBe('true')
    })

    it('sets modifiers=true when the modifiers flag is on', async () => {
      fetchMock.mockResolvedValue(textResponse('digraph {}'))

      await getGraph('audit-1', { modifiers: true })

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(new URL(url).searchParams.get('modifiers')).toBe('true')
    })

    it('sets libraries=false when libraries is explicitly false', async () => {
      fetchMock.mockResolvedValue(textResponse('digraph {}'))

      await getGraph('audit-1', { libraries: false })

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(new URL(url).searchParams.get('libraries')).toBe('false')
    })

    it('does not set the libraries param when libraries is true (default truthy)', async () => {
      fetchMock.mockResolvedValue(textResponse('digraph {}'))

      await getGraph('audit-1', { libraries: true })

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(new URL(url).searchParams.get('libraries')).toBeNull()
    })

    it('combines all flags and ids in a single call', async () => {
      fetchMock.mockResolvedValue(textResponse('digraph {}'))

      await getGraph('audit-42', { simple: true, modifiers: true, libraries: false }, ['c1', 'c2'])

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
      const params = new URL(url).searchParams
      expect(params.get('simple')).toBe('true')
      expect(params.get('modifiers')).toBe('true')
      expect(params.get('libraries')).toBe('false')
      expect(params.getAll('scope_contract_id')).toEqual(['c1', 'c2'])
    })

    it('returns the response text', async () => {
      fetchMock.mockResolvedValue(textResponse('digraph { A -> B }'))

      const result = await getGraph('audit-1')

      expect(result).toBe('digraph { A -> B }')
    })
  })

  // -------------------------------------------------------------------------
  // getInheritance
  // -------------------------------------------------------------------------

  describe('getInheritance', () => {
    it('sends the correct base URL with no ids', async () => {
      fetchMock.mockResolvedValue(textResponse('digraph {}'))

      await getInheritance('audit-2')

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe(`${BASE}/audits/audit-2/inheritance?`)
    })

    it('appends scope_contract_id for each id', async () => {
      fetchMock.mockResolvedValue(textResponse('digraph {}'))

      await getInheritance('audit-2', ['contract-x', 'contract-y', 'contract-z'])

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
      const params = new URL(url).searchParams
      expect(params.getAll('scope_contract_id')).toEqual(['contract-x', 'contract-y', 'contract-z'])
    })

    it('returns the response text', async () => {
      fetchMock.mockResolvedValue(textResponse('digraph { X -> Y }'))

      const result = await getInheritance('audit-2', ['contract-x'])

      expect(result).toBe('digraph { X -> Y }')
    })
  })

  // -------------------------------------------------------------------------
  // getFtrace
  // -------------------------------------------------------------------------

  describe('getFtrace', () => {
    it('sends scope_contract_id, function and visibility params', async () => {
      fetchMock.mockResolvedValue(textResponse('trace output'))

      await getFtrace('audit-3', 'contract-abc', 'transfer', 'external')

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
      const params = new URL(url).searchParams
      expect(url.startsWith(`${BASE}/audits/audit-3/ftrace?`)).toBe(true)
      expect(params.get('scope_contract_id')).toBe('contract-abc')
      expect(params.get('function')).toBe('transfer')
      expect(params.get('visibility')).toBe('external')
    })

    it('defaults visibility to "all" when not provided', async () => {
      fetchMock.mockResolvedValue(textResponse('trace output'))

      await getFtrace('audit-3', 'contract-abc', 'approve')

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(new URL(url).searchParams.get('visibility')).toBe('all')
    })

    it('supports "internal" visibility', async () => {
      fetchMock.mockResolvedValue(textResponse('trace output'))

      await getFtrace('audit-3', 'contract-abc', 'approve', 'internal')

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(new URL(url).searchParams.get('visibility')).toBe('internal')
    })

    it('returns the response text', async () => {
      fetchMock.mockResolvedValue(textResponse('function trace here'))

      const result = await getFtrace('audit-3', 'contract-abc', 'transfer', 'all')

      expect(result).toBe('function trace here')
    })
  })

  // -------------------------------------------------------------------------
  // getDescribe
  // -------------------------------------------------------------------------

  describe('getDescribe', () => {
    it('sends the correct URL with no ids', async () => {
      fetchMock.mockResolvedValue(textResponse('description'))

      await getDescribe('audit-4')

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe(`${BASE}/audits/audit-4/describe?`)
    })

    it('appends scope_contract_id for each id', async () => {
      fetchMock.mockResolvedValue(textResponse('description'))

      await getDescribe('audit-4', ['id-1', 'id-2'])

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(new URL(url).searchParams.getAll('scope_contract_id')).toEqual(['id-1', 'id-2'])
    })

    it('returns the response text', async () => {
      fetchMock.mockResolvedValue(textResponse('contract summary'))

      const result = await getDescribe('audit-4', ['id-1'])

      expect(result).toBe('contract summary')
    })
  })

  // -------------------------------------------------------------------------
  // getDependencies
  // -------------------------------------------------------------------------

  describe('getDependencies', () => {
    it('sends the correct URL with a single scope_contract_id', async () => {
      fetchMock.mockResolvedValue(textResponse('deps output'))

      await getDependencies('audit-5', 'contract-dep')

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
      const params = new URL(url).searchParams
      expect(url.startsWith(`${BASE}/audits/audit-5/dependencies?`)).toBe(true)
      expect(params.get('scope_contract_id')).toBe('contract-dep')
    })

    it('returns the response text', async () => {
      fetchMock.mockResolvedValue(textResponse('linearization output'))

      const result = await getDependencies('audit-5', 'contract-dep')

      expect(result).toBe('linearization output')
    })
  })

  // -------------------------------------------------------------------------
  // getFlatten
  // -------------------------------------------------------------------------

  describe('getFlatten', () => {
    it('sends the correct URL with a single scope_contract_id', async () => {
      fetchMock.mockResolvedValue(textResponse('flattened source'))

      await getFlatten('audit-6', 'contract-flat')

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
      const params = new URL(url).searchParams
      expect(url.startsWith(`${BASE}/audits/audit-6/flatten?`)).toBe(true)
      expect(params.get('scope_contract_id')).toBe('contract-flat')
    })

    it('returns the response text', async () => {
      fetchMock.mockResolvedValue(textResponse('// inlined source'))

      const result = await getFlatten('audit-6', 'contract-flat')

      expect(result).toBe('// inlined source')
    })
  })

  // -------------------------------------------------------------------------
  // getParse
  // -------------------------------------------------------------------------

  describe('getParse', () => {
    it('sends scope_contract_id without as_json by default', async () => {
      fetchMock.mockResolvedValue(textResponse('ast output'))

      await getParse('audit-7', 'contract-parse')

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
      const params = new URL(url).searchParams
      expect(url.startsWith(`${BASE}/audits/audit-7/parse?`)).toBe(true)
      expect(params.get('scope_contract_id')).toBe('contract-parse')
      expect(params.get('as_json')).toBeNull()
    })

    it('sets as_json=true when asJson is true', async () => {
      fetchMock.mockResolvedValue(textResponse('{}'))

      await getParse('audit-7', 'contract-parse', true)

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(new URL(url).searchParams.get('as_json')).toBe('true')
    })

    it('does not set as_json when asJson is false', async () => {
      fetchMock.mockResolvedValue(textResponse('ast output'))

      await getParse('audit-7', 'contract-parse', false)

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(new URL(url).searchParams.get('as_json')).toBeNull()
    })

    it('returns the response text', async () => {
      fetchMock.mockResolvedValue(textResponse('parsed ast'))

      const result = await getParse('audit-7', 'contract-parse')

      expect(result).toBe('parsed ast')
    })
  })

  // -------------------------------------------------------------------------
  // getMdReport
  // -------------------------------------------------------------------------

  describe('getMdReport', () => {
    it('sends the correct URL with no ids', async () => {
      fetchMock.mockResolvedValue(textResponse('# Report'))

      await getMdReport('audit-8')

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe(`${BASE}/audits/audit-8/mdreport?`)
    })

    it('appends scope_contract_id for each id', async () => {
      fetchMock.mockResolvedValue(textResponse('# Report'))

      await getMdReport('audit-8', ['r1', 'r2', 'r3'])

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(new URL(url).searchParams.getAll('scope_contract_id')).toEqual(['r1', 'r2', 'r3'])
    })

    it('returns the response text', async () => {
      fetchMock.mockResolvedValue(textResponse('# Markdown Report'))

      const result = await getMdReport('audit-8', ['r1'])

      expect(result).toBe('# Markdown Report')
    })
  })

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe('error handling', () => {
    it('throws an error when the response is not ok (404)', async () => {
      fetchMock.mockResolvedValue(new Response('Not Found', { status: 404, statusText: 'Not Found' }))

      await expect(getGraph('audit-err')).rejects.toThrow()
    })

    it('attaches the HTTP status to the thrown error', async () => {
      fetchMock.mockResolvedValue(new Response('Server Error', { status: 500, statusText: 'Internal Server Error' }))

      const err = await getGraph('audit-err').catch((e: unknown) => e)

      expect(err).toBeInstanceOf(Error)
      expect((err as Error & { status: number }).status).toBe(500)
    })

    it('uses detail from a JSON error body as the error message', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ detail: 'Contract not found in scope' }, 422),
      )

      const err = await getGraph('audit-err').catch((e: unknown) => e)

      expect((err as Error).message).toBe('Contract not found in scope')
    })

    it('falls back to statusText when the error body has no detail field', async () => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ other: 'field' }), {
          status: 400,
          statusText: 'Bad Request',
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      const err = await getGraph('audit-err').catch((e: unknown) => e)

      expect((err as Error).message).toBe('Bad Request')
    })

    it('falls back to statusText when the response body is not valid JSON', async () => {
      fetchMock.mockResolvedValue(
        new Response('not json at all', { status: 503, statusText: 'Service Unavailable' }),
      )

      const err = await getGraph('audit-err').catch((e: unknown) => e)

      expect((err as Error).message).toBe('Service Unavailable')
    })
  })

  // -------------------------------------------------------------------------
  // Auth header
  // -------------------------------------------------------------------------

  describe('auth header', () => {
    it('sends no Authorization header when no token is stored', async () => {
      fetchMock.mockResolvedValue(textResponse('ok'))

      await getGraph('audit-auth')

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      const headers = new Headers(init.headers)
      expect(headers.get('Authorization')).toBeNull()
    })

    it('sends the Bearer token when one is stored in localStorage', async () => {
      setAccessToken('my-secret-jwt')
      fetchMock.mockResolvedValue(textResponse('ok'))

      await getGraph('audit-auth')

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      const headers = new Headers(init.headers)
      expect(headers.get('Authorization')).toBe('Bearer my-secret-jwt')
    })

    it('sends the auth header on getInheritance', async () => {
      setAccessToken('token-abc')
      fetchMock.mockResolvedValue(textResponse('digraph {}'))

      await getInheritance('audit-auth', ['c1'])

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(new Headers(init.headers).get('Authorization')).toBe('Bearer token-abc')
    })

    it('sends the auth header on getFtrace', async () => {
      setAccessToken('token-xyz')
      fetchMock.mockResolvedValue(textResponse('trace'))

      await getFtrace('audit-auth', 'c1', 'fn')

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(new Headers(init.headers).get('Authorization')).toBe('Bearer token-xyz')
    })

    it('sends the auth header on getDescribe', async () => {
      setAccessToken('token-desc')
      fetchMock.mockResolvedValue(textResponse('desc'))

      await getDescribe('audit-auth', ['c1'])

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(new Headers(init.headers).get('Authorization')).toBe('Bearer token-desc')
    })

    it('sends the auth header on getDependencies', async () => {
      setAccessToken('token-dep')
      fetchMock.mockResolvedValue(textResponse('deps'))

      await getDependencies('audit-auth', 'c1')

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(new Headers(init.headers).get('Authorization')).toBe('Bearer token-dep')
    })

    it('sends the auth header on getFlatten', async () => {
      setAccessToken('token-flat')
      fetchMock.mockResolvedValue(textResponse('flat'))

      await getFlatten('audit-auth', 'c1')

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(new Headers(init.headers).get('Authorization')).toBe('Bearer token-flat')
    })

    it('sends the auth header on getParse', async () => {
      setAccessToken('token-parse')
      fetchMock.mockResolvedValue(textResponse('ast'))

      await getParse('audit-auth', 'c1')

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(new Headers(init.headers).get('Authorization')).toBe('Bearer token-parse')
    })

    it('sends the auth header on getMdReport', async () => {
      setAccessToken('token-md')
      fetchMock.mockResolvedValue(textResponse('# md'))

      await getMdReport('audit-auth', ['c1'])

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(new Headers(init.headers).get('Authorization')).toBe('Bearer token-md')
    })
  })
})
