import { API_BASE_URL, getAccessToken } from '../auth'

const base = () => API_BASE_URL ?? 'http://localhost:8001'
const headers = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${getAccessToken() ?? ''}`,
})

export interface Finding {
  id: string
  audit_id: string
  order: number
  title: string
  severity: string
  description: string
  scope: string
  proof_of_concept: string
  recommendation: string
  status: string
  created_at: string
  updated_at: string
}

export interface FindingWithAudit extends Finding {
  audit_title: string
}

export async function listFindings(auditId: string): Promise<Finding[]> {
  const res = await fetch(`${base()}/reports/audits/${auditId}/findings`, { headers: headers() })
  if (!res.ok) throw new Error(await res.text())
  const data = await res.json()
  return data.items
}

export async function createFinding(auditId: string, body: Omit<Finding, 'audit_id' | 'created_at' | 'updated_at'>): Promise<Finding> {
  const res = await fetch(`${base()}/reports/audits/${auditId}/findings`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function updateFinding(findingId: string, body: Partial<Omit<Finding, 'id' | 'audit_id' | 'created_at' | 'updated_at'>>): Promise<Finding> {
  const res = await fetch(`${base()}/reports/findings/${findingId}`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function deleteFinding(findingId: string): Promise<void> {
  const res = await fetch(`${base()}/reports/findings/${findingId}`, {
    method: 'DELETE',
    headers: headers(),
  })
  if (!res.ok) throw new Error(await res.text())
}

export async function allFindings(): Promise<FindingWithAudit[]> {
  const res = await fetch(`${base()}/reports/all`, { headers: headers() })
  if (!res.ok) throw new Error(await res.text())
  const data = await res.json()
  return data.items
}
