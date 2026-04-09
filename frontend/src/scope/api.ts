
import { API_BASE_URL, getAccessToken } from '../auth'

interface ApiErrorData {
    detail?: string | Array<{ msg?: string }>
}

// API Error class
export class ApiError extends Error {
    status: number
    data?: ApiErrorData

    constructor(status: number, message: string, data?: ApiErrorData) {
        super(message)
        this.name = 'ApiError'
        this.status = status
        this.data = data
    }
}

// Helper to extract message from errors
export function getMessageFromError(error: unknown): string {
    if (error instanceof ApiError) {
        if (error.data?.detail && typeof error.data.detail === 'string') {
            return error.data.detail
        }
        if (Array.isArray(error.data?.detail) && error.data.detail.length > 0) {
            const first = error.data.detail[0]
            if (first.msg) return first.msg
        }
        return error.message
    }
    if (error instanceof Error) return error.message
    return String(error)
}

function getAuthHeader(): Record<string, string> {
    const token = getAccessToken()
    return token ? { Authorization: `Bearer ${token}` } : {}
}

async function fetchWithAuth(url: string, options: RequestInit = {}) {
    const customHeaders = (options.headers as Record<string, string>) || {}
    const headers = {
        ...getAuthHeader(),
        ...customHeaders,
    }

    const response = await fetch(url, { ...options, headers })

    if (!response.ok) {
        let errorData
        try {
            errorData = await response.json()
        } catch {
            // Ignore JSON parse errors for non-JSON responses
        }
        throw new ApiError(response.status, response.statusText, errorData)
    }

    return response
}

const API_BASE = `${API_BASE_URL}/scope`

// --- Types ---

export interface ScopeSource {
    id: string
    audit_id: string
    source_type: 'github' | 'etherscan' | 'upload'
    url?: string
    branch?: string
    commit_hash?: string
    contract_address?: string
    chain_id?: number
    platform_name?: string
    contest_id?: string
    fetch_status: 'pending' | 'success' | 'error'
    fetched_at?: string
    error_message?: string
    created_at: string
}

export interface ScopeSourceCreate {
    source_type: 'github' | 'etherscan' | 'upload'
    url?: string
    branch?: string
    commit_hash?: string
    contract_address?: string
    chain_id?: number
    platform_name?: string
    contest_id?: string
}

export interface ScopeAddress {
    id: string
    audit_id: string
    address: string
    chain_id: number
    label: string
    address_type: string
    role_name?: string
    proxy_type?: string
    implementation_address?: string
    contract_id?: string
    notes?: string
    is_verified: boolean
    is_contract: boolean
    bytecode?: string
    decompiled_sol?: string | null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    abi_json?: any[] | null
    created_at: string
}

export interface ScopeAddressCreate {
    address: string
    chain_id?: number
    label: string
    address_type?: string
    role_name?: string
    proxy_type?: string
    implementation_address?: string
    contract_id?: string
    notes?: string
    is_contract?: boolean
    bytecode?: string
}

export interface ScopeContract {
    id: string
    audit_id: string
    source_id?: string
    file_path: string
    file_name: string
    sloc: number
    is_in_scope: boolean
    scope_reason?: string
    compiler_version?: string
    license?: string
    created_at: string
}

export interface ScopeContractListResponse {
    items: ScopeContract[]
    total: number
    in_scope_count: number
    out_of_scope_count: number
}

// --- API Functions ---

// Sources
export async function listSources(auditId: string): Promise<{ items: ScopeSource[] }> {
    const res = await fetchWithAuth(`${API_BASE}/audits/${auditId}/sources`)
    return res.json()
}

export async function createSource(auditId: string, payload: ScopeSourceCreate): Promise<ScopeSource> {
    const res = await fetchWithAuth(`${API_BASE}/audits/${auditId}/sources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    })
    return res.json()
}

export async function triggerSourceFetch(sourceId: string): Promise<ScopeSource> {
    const res = await fetchWithAuth(`${API_BASE}/sources/${sourceId}/fetch`, {
        method: 'POST',
    })
    return res.json()
}

export async function deleteSource(sourceId: string): Promise<void> {
    await fetchWithAuth(`${API_BASE}/sources/${sourceId}`, {
        method: 'DELETE',
    })
}

// Addresses
export async function listAddresses(auditId: string): Promise<{ items: ScopeAddress[] }> {
    const res = await fetchWithAuth(`${API_BASE}/audits/${auditId}/addresses`)
    return res.json()
}

export async function createAddress(auditId: string, payload: ScopeAddressCreate): Promise<ScopeAddress> {
    const res = await fetchWithAuth(`${API_BASE}/audits/${auditId}/addresses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    })
    return res.json()
}

export async function fetchVerifiedCode(addressId: string): Promise<ScopeAddress> {
    const res = await fetchWithAuth(`${API_BASE}/addresses/${addressId}/fetch-verified`, {
        method: 'POST',
    })
    return res.json()
}

export async function deleteAddress(addressId: string): Promise<void> {
    await fetchWithAuth(`${API_BASE}/addresses/${addressId}`, {
        method: 'DELETE',
    })
}

export async function updateAddress(addressId: string, payload: Partial<ScopeAddressCreate>): Promise<ScopeAddress> {
    const res = await fetchWithAuth(`${API_BASE}/addresses/${addressId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    })
    return res.json()
}

export async function deleteAuditScope(auditId: string): Promise<void> {
    await fetchWithAuth(`${API_BASE}/audits/${auditId}/scope`, {
        method: 'DELETE',
    })
}

export async function updateContract(contractId: string, payload: { is_in_scope?: boolean; scope_reason?: string }): Promise<ScopeContract> {
    const res = await fetchWithAuth(`${API_BASE}/contracts/${contractId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    })
    return res.json()
}

// Contracts / Uploads
export async function listContracts(auditId: string, inScope?: boolean): Promise<ScopeContractListResponse> {
    const url = inScope !== undefined
        ? `${API_BASE}/audits/${auditId}/contracts?in_scope=${inScope}`
        : `${API_BASE}/audits/${auditId}/contracts`
    const res = await fetchWithAuth(url)
    return res.json()
}

export async function uploadContract(auditId: string, file: File, sourceId?: string, filePath?: string): Promise<ScopeContractListResponse> {
    const formData = new FormData()
    formData.append('files', file)
    formData.append('is_in_scope', 'false')
    if (sourceId) {
        formData.append('source_id', sourceId)
    }
    if (filePath) {
        formData.append('file_path', filePath)
    }

    const headers: Record<string, string> = getAuthHeader()
    // Do not set Content-Type header manually for FormData, fetch does it automatically with boundary rules

    const response = await fetch(`${API_BASE}/audits/${auditId}/contracts/upload`, {
        method: 'POST',
        headers,
        body: formData,
    })

    if (!response.ok) {
        let errorData
        try {
            errorData = await response.json()
        } catch {
            // Ignore JSON parse errors for non-JSON responses
        }
        throw new ApiError(response.status, response.statusText, errorData)
    }

    return response.json()
}
