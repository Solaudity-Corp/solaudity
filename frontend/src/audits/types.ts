export type AuditStatus = 'draft' | 'in_progress' | 'completed' | 'archived'

export interface AuditAttachmentRecord {
  id: string
  audit_id: string
  uploaded_by: string
  original_name: string
  storage_key: string
  sha256: string
  size_bytes: number
  mime_type: string
  file_ext: string
}

export interface AuditRecord {
  id: string
  owner_id: string
  title: string
  slug: string | null
  description: string | null
  status: AuditStatus
  is_pinned: boolean
  chain: string | null
  network: string | null
  repo_url: string | null
  commit_hash: string | null
  docs_url: string | null
  start_date: string | null
  end_date: string | null
  created_at: string
  updated_at: string
  last_opened_at: string | null
  last_opened_by: string | null
  attachments: AuditAttachmentRecord[]
}

