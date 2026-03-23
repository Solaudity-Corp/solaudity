import { API_BASE_URL, getAccessToken } from '../auth'

function getAuthHeader(): Record<string, string> {
  const token = getAccessToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: getAuthHeader() })
  if (!res.ok) {
    let detail = res.statusText
    try { const d = await res.json(); detail = d.detail ?? detail } catch { /* ignore */ }
    throw Object.assign(new Error(detail), { status: res.status })
  }
  return res.text()
}

function buildParams(ids: string[]): URLSearchParams {
  const p = new URLSearchParams()
  ids.forEach(id => p.append('scope_contract_id', id))
  return p
}

const BASE = `${API_BASE_URL}/enum/surya`

// ---------------------------------------------------------------------------
// Graph — DOT call graph
// ---------------------------------------------------------------------------
export interface GraphOptions {
  simple?: boolean
  modifiers?: boolean
  libraries?: boolean
}

export async function getGraph(auditId: string, opts: GraphOptions = {}, ids: string[] = []): Promise<string> {
  const p = buildParams(ids)
  if (opts.simple)              p.set('simple', 'true')
  if (opts.modifiers)           p.set('modifiers', 'true')
  if (opts.libraries === false) p.set('libraries', 'false')
  return fetchText(`${BASE}/audits/${auditId}/graph?${p}`)
}

// ---------------------------------------------------------------------------
// Inheritance — DOT inheritance graph
// ---------------------------------------------------------------------------
export async function getInheritance(auditId: string, ids: string[] = []): Promise<string> {
  return fetchText(`${BASE}/audits/${auditId}/inheritance?${buildParams(ids)}`)
}

// ---------------------------------------------------------------------------
// Ftrace — function call trace
// ---------------------------------------------------------------------------
export async function getFtrace(
  auditId: string,
  scopeContractId: string,
  fn: string,
  visibility: 'all' | 'internal' | 'external' = 'all',
): Promise<string> {
  const p = new URLSearchParams({ scope_contract_id: scopeContractId, function: fn, visibility })
  return fetchText(`${BASE}/audits/${auditId}/ftrace?${p}`)
}

// ---------------------------------------------------------------------------
// Describe — contract summary
// ---------------------------------------------------------------------------
export async function getDescribe(auditId: string, ids: string[] = []): Promise<string> {
  return fetchText(`${BASE}/audits/${auditId}/describe?${buildParams(ids)}`)
}

// ---------------------------------------------------------------------------
// Dependencies — C3 linearisation
// ---------------------------------------------------------------------------
export async function getDependencies(auditId: string, scopeContractId: string): Promise<string> {
  const p = new URLSearchParams({ scope_contract_id: scopeContractId })
  return fetchText(`${BASE}/audits/${auditId}/dependencies?${p}`)
}

// ---------------------------------------------------------------------------
// Flatten — inlined source (single file, no id filter)
// ---------------------------------------------------------------------------
export async function getFlatten(auditId: string, scopeContractId: string): Promise<string> {
  const p = new URLSearchParams({ scope_contract_id: scopeContractId })
  return fetchText(`${BASE}/audits/${auditId}/flatten?${p}`)
}

// ---------------------------------------------------------------------------
// Parse — AST output (single file, no id filter)
// ---------------------------------------------------------------------------
export async function getParse(auditId: string, scopeContractId: string, asJson = false): Promise<string> {
  const p = new URLSearchParams({ scope_contract_id: scopeContractId })
  if (asJson) p.set('as_json', 'true')
  return fetchText(`${BASE}/audits/${auditId}/parse?${p}`)
}

// ---------------------------------------------------------------------------
// MD Report — markdown documentation
// ---------------------------------------------------------------------------
export async function getMdReport(auditId: string, ids: string[] = []): Promise<string> {
  return fetchText(`${BASE}/audits/${auditId}/mdreport?${buildParams(ids)}`)
}
