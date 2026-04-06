import { API_BASE_URL, getAccessToken, logoutUser } from '../auth'

function getAuthHeader(): Record<string, string> {
  const token = getAccessToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function fetchWithAuth(url: string, options: RequestInit = {}) {
  const headers = { ...getAuthHeader(), ...(options.headers as Record<string, string> || {}) }
  const res = await fetch(url, { ...options, headers })
  if (!res.ok) {
    if (res.status === 401) logoutUser()
    let data
    try { data = await res.json() } catch { /* ignore */ }
    throw Object.assign(new Error(res.statusText), { status: res.status, data })
  }
  return res
}

const BASE = `${API_BASE_URL}/enum/solparsing`

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ParseStatus = 'pending' | 'parsing' | 'parsed' | 'analyzed' | 'error'
export type ContractKind = 'contract' | 'library' | 'interface' | 'abstract'
export type Visibility = 'public' | 'external' | 'internal' | 'private'
export type Mutability = 'pure' | 'view' | 'payable' | 'nonpayable'
export type CallType = 'internal' | 'external' | 'delegatecall' | 'staticcall' | 'library_call'

export interface ParsedContractRead {
  id: string
  audit_id: string
  scope_contract_id: string
  name: string
  contract_kind: ContractKind
  inheritance: string[] | null
  source_line_start: number | null
  source_line_end: number | null
  slither_id: string | null
  parse_status: ParseStatus
  error_message: string | null
  parsed_at: string | null
  analyzed_at: string | null
  created_at: string
}

export interface FnParam { name: string; type: string }
export interface EventParam { name: string; type: string; indexed: boolean }

export interface ParsedFunctionRead {
  id: string
  audit_id: string
  parsed_contract_id: string
  name: string
  selector: string | null
  visibility: Visibility | null
  mutability: Mutability | null
  is_constructor: boolean
  is_fallback: boolean
  is_receive: boolean
  params: FnParam[] | null
  return_params: FnParam[] | null
  modifiers_applied: string[] | null
  natspec: Record<string, unknown> | null
  source_line_start: number | null
  source_line_end: number | null
  reads_var_ids: string[] | null
  writes_var_ids: string[] | null
  has_reentrancy: boolean | null
  is_entry_point: boolean | null
  slither_id: string | null
  created_at: string
}

export interface ParsedStateVariableRead {
  id: string
  audit_id: string
  parsed_contract_id: string
  name: string
  type_str: string
  visibility: Visibility | null
  is_constant: boolean
  is_immutable: boolean
  storage_slot: number | null
  initial_value: string | null
  natspec: Record<string, unknown> | null
  source_line_start: number | null
  source_line_end: number | null
  slither_id: string | null
  created_at: string
}

export interface ParsedEventRead {
  id: string
  audit_id: string
  parsed_contract_id: string
  name: string
  params: EventParam[] | null
  topic0: string | null
  natspec: Record<string, unknown> | null
  source_line_start: number | null
  source_line_end: number | null
  slither_id: string | null
  created_at: string
}

export interface ParsedModifierRead {
  id: string
  audit_id: string
  parsed_contract_id: string
  name: string
  visibility: Visibility | null
  params: FnParam[] | null
  natspec: Record<string, unknown> | null
  source_line_start: number | null
  source_line_end: number | null
  slither_id: string | null
  created_at: string
}

export interface CallEdgeRead {
  id: string
  audit_id: string
  caller_function_id: string
  callee_function_id: string | null
  call_type: CallType
  is_cross_contract: boolean
  callee_expression: string | null
  callee_signature: string | null
  source_line: number | null
  created_at: string
}

export interface CallGraphResponse {
  edges: CallEdgeRead[]
  functions: ParsedFunctionRead[]
  total_edges: number
  total_functions: number
}

export interface ParseTriggerResponse {
  message: string
  scope_contract_id: string
  contracts_found: number
}

export interface AnalyzeTriggerResponse {
  message: string
  contract: ParsedContractRead
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export async function listParsedContracts(auditId: string): Promise<{ items: ParsedContractRead[]; total: number }> {
  const res = await fetchWithAuth(`${BASE}/audits/${auditId}/contracts`)
  return res.json()
}

export async function listParsedContractsForFile(auditId: string, scopeContractId: string): Promise<{ items: ParsedContractRead[]; total: number }> {
  const res = await fetchWithAuth(`${BASE}/audits/${auditId}/scope-contracts/${scopeContractId}/contracts`)
  return res.json()
}

export async function triggerParse(auditId: string, scopeContractId: string): Promise<ParseTriggerResponse> {
  const res = await fetchWithAuth(`${BASE}/audits/${auditId}/scope-contracts/${scopeContractId}/parse`, { method: 'POST' })
  return res.json()
}

export async function triggerAnalyze(parsedContractId: string): Promise<AnalyzeTriggerResponse> {
  const res = await fetchWithAuth(`${BASE}/contracts/${parsedContractId}/analyze`, { method: 'POST' })
  return res.json()
}

export async function listFunctions(parsedContractId: string): Promise<{ items: ParsedFunctionRead[]; total: number }> {
  const res = await fetchWithAuth(`${BASE}/contracts/${parsedContractId}/functions`)
  return res.json()
}

export async function listStateVariables(parsedContractId: string): Promise<{ items: ParsedStateVariableRead[]; total: number }> {
  const res = await fetchWithAuth(`${BASE}/contracts/${parsedContractId}/state-variables`)
  return res.json()
}

export async function listEvents(parsedContractId: string): Promise<{ items: ParsedEventRead[]; total: number }> {
  const res = await fetchWithAuth(`${BASE}/contracts/${parsedContractId}/events`)
  return res.json()
}

export async function listModifiers(parsedContractId: string): Promise<{ items: ParsedModifierRead[]; total: number }> {
  const res = await fetchWithAuth(`${BASE}/contracts/${parsedContractId}/modifiers`)
  return res.json()
}

export async function getCallGraph(auditId: string): Promise<CallGraphResponse> {
  const res = await fetchWithAuth(`${BASE}/audits/${auditId}/call-graph`)
  return res.json()
}

export async function getFunctionCallers(functionId: string): Promise<CallEdgeRead[]> {
  const res = await fetchWithAuth(`${BASE}/functions/${functionId}/callers`)
  return res.json()
}

export async function getFunctionCallees(functionId: string): Promise<CallEdgeRead[]> {
  const res = await fetchWithAuth(`${BASE}/functions/${functionId}/callees`)
  return res.json()
}
