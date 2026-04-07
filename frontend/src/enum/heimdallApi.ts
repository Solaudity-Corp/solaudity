import { API_BASE_URL, getAccessToken } from '../auth'

function getAuthHeader(): Record<string, string> {
  const token = getAccessToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function fetchJSON<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...getAuthHeader(),
    ...((options.headers as Record<string, string>) ?? {}),
  }
  const res = await fetch(url, { ...options, headers })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const d = await res.json()
      detail = d.detail ?? detail
    } catch { /* ignore */ }
    throw Object.assign(new Error(detail), { status: res.status })
  }
  return res.json()
}

const BASE = `${API_BASE_URL}/enum/heimdall`

// ---------------------------------------------------------------------------
// Decompile — reverse EVM bytecode into pseudo-Solidity + ABI
// ---------------------------------------------------------------------------
export interface DecompileResult {
  pseudo_code: string | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  abi: any[] | null
}

export async function decompile(scopeAddressId: string): Promise<DecompileResult> {
  const p = new URLSearchParams({ scope_address_id: scopeAddressId })
  return fetchJSON<DecompileResult>(`${BASE}/decompile?${p}`, { method: 'POST' })
}

// ---------------------------------------------------------------------------
// CFG — control flow graph (DOT format)
// ---------------------------------------------------------------------------
export interface CfgResult {
  cfg_dot: string | null
}

export async function getCfg(scopeAddressId: string): Promise<CfgResult> {
  const p = new URLSearchParams({ scope_address_id: scopeAddressId })
  return fetchJSON<CfgResult>(`${BASE}/cfg?${p}`, { method: 'POST' })
}

// ---------------------------------------------------------------------------
// Disassemble — EVM opcodes
// ---------------------------------------------------------------------------
export interface DisassembleResult {
  opcodes: string | null
}

export async function disassemble(scopeAddressId: string): Promise<DisassembleResult> {
  const p = new URLSearchParams({ scope_address_id: scopeAddressId })
  return fetchJSON<DisassembleResult>(`${BASE}/disassemble?${p}`, { method: 'POST' })
}
