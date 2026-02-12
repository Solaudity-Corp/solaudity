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

function createId(seed: string) {
  return `${seed.slice(0, 8)}-${seed.slice(8, 12)}-${seed.slice(12, 16)}-${seed.slice(16, 20)}-${seed.slice(20, 32)}`
}

export const mockAudits: AuditRecord[] = [
  {
    id: createId('2b6cf892ad8145f0b86b237f0b6f42d2'),
    owner_id: createId('f54a9c35f6d641a597de8d2f7dc2e9bf'),
    title: 'Aave V3 Fork Treasury Flow',
    slug: 'aave-v3-fork-treasury-flow',
    description:
      'Security review of vault accounting, liquidation paths, and upgrade controls for a custom Aave V3 deployment.',
    status: 'in_progress',
    is_pinned: true,
    chain: 'base',
    network: 'mainnet',
    repo_url: 'https://github.com/example/aave-v3-fork',
    commit_hash: '4d72f7e8db0a1f0ba4e12f181cfc6f9c1aee5284',
    docs_url: 'https://docs.example.com/aave-fork',
    start_date: '2026-02-06',
    end_date: '2026-02-20',
    created_at: '2026-02-06T09:12:00Z',
    updated_at: '2026-02-12T09:34:00Z',
    last_opened_at: '2026-02-12T10:12:00Z',
    last_opened_by: createId('41d93e4fabec4558a8424fd8fa7d4f62'),
    attachments: [
      {
        id: createId('af08be52df87440f8d3e5d5a50f6eb3c'),
        audit_id: createId('2b6cf892ad8145f0b86b237f0b6f42d2'),
        uploaded_by: createId('41d93e4fabec4558a8424fd8fa7d4f62'),
        original_name: 'scope-v2.pdf',
        storage_key: 'audits/2b6cf892/scope-v2.pdf',
        sha256: 'd5f81f7a2e2d6f6d54fcf4f61030f954882d553f1239097f91ea7c3081ed8f62',
        size_bytes: 823100,
        mime_type: 'application/pdf',
        file_ext: 'pdf',
      },
      {
        id: createId('e3d5534d1ec944f4a2f93a658d5b3cf1'),
        audit_id: createId('2b6cf892ad8145f0b86b237f0b6f42d2'),
        uploaded_by: createId('41d93e4fabec4558a8424fd8fa7d4f62'),
        original_name: 'threat-model.png',
        storage_key: 'audits/2b6cf892/threat-model.png',
        sha256: 'f2c09f86ea3599ed31fdb53b286ff8b3c93d57ce7f0fbd4f1345316e06ce3f89',
        size_bytes: 193448,
        mime_type: 'image/png',
        file_ext: 'png',
      },
    ],
  },
  {
    id: createId('7df6125b3f9643a5a30ed9e374de503f'),
    owner_id: createId('f54a9c35f6d641a597de8d2f7dc2e9bf'),
    title: 'HELLO Protocol Core',
    slug: 'hello-protocol-core',
    description:
      'Review of token emission logic, role-based permissions, and emergency stop behavior in protocol core contracts.',
    status: 'in_progress',
    is_pinned: false,
    chain: 'ethereum',
    network: 'mainnet',
    repo_url: 'https://github.com/example/hello-protocol',
    commit_hash: '2cbf9f8d8e4bc7d6d9d405c9d9d8de80fd9f1b87',
    docs_url: 'https://docs.example.com/hello-protocol/security',
    start_date: '2026-02-09',
    end_date: '2026-02-21',
    created_at: '2026-02-08T17:41:00Z',
    updated_at: '2026-02-12T08:03:00Z',
    last_opened_at: '2026-02-12T08:05:00Z',
    last_opened_by: createId('f54a9c35f6d641a597de8d2f7dc2e9bf'),
    attachments: [
      {
        id: createId('18871efec5d64cbf9713a161e6af68d3'),
        audit_id: createId('7df6125b3f9643a5a30ed9e374de503f'),
        uploaded_by: createId('f54a9c35f6d641a597de8d2f7dc2e9bf'),
        original_name: 'contracts.zip',
        storage_key: 'audits/7df6125b/contracts.zip',
        sha256: 'd0f497f7e4d0ee2a14e7840ae73d27f31f211175f97f8b0e573f10da5c1ad2cc',
        size_bytes: 4920011,
        mime_type: 'application/zip',
        file_ext: 'zip',
      },
    ],
  },
  {
    id: createId('ad0545cb0c8c4ec69e6b6483257d4654'),
    owner_id: createId('92a7af6f85f341c78cff0f85f055f50a'),
    title: 'Aave V2 Migration Replay',
    slug: 'aave-v2-migration-replay',
    description:
      'Completed validation pass on migration scripts and replay attack surfaces during pool state transfer.',
    status: 'completed',
    is_pinned: false,
    chain: 'arbitrum',
    network: 'mainnet',
    repo_url: 'https://github.com/example/aave-v2-migration',
    commit_hash: '8d7b67dd9cb3e31253ac4f3e89cc04ab4761346e',
    docs_url: 'https://docs.example.com/aave-v2-migration',
    start_date: '2026-01-10',
    end_date: '2026-01-22',
    created_at: '2026-01-08T07:11:00Z',
    updated_at: '2026-01-23T10:20:00Z',
    last_opened_at: '2026-02-01T10:20:00Z',
    last_opened_by: createId('92a7af6f85f341c78cff0f85f055f50a'),
    attachments: [
      {
        id: createId('8cd891d3dbd4448baa355f538d4166c8'),
        audit_id: createId('ad0545cb0c8c4ec69e6b6483257d4654'),
        uploaded_by: createId('92a7af6f85f341c78cff0f85f055f50a'),
        original_name: 'final-report.pdf',
        storage_key: 'audits/ad0545cb/final-report.pdf',
        sha256: '932b26f5d88ce2282f3d18d18f567f52f57e6eae6877f63ec5d981393316d7a1',
        size_bytes: 1378091,
        mime_type: 'application/pdf',
        file_ext: 'pdf',
      },
    ],
  },
  {
    id: createId('b2234a7649e0420ba3c304b6d76407f5'),
    owner_id: createId('f54a9c35f6d641a597de8d2f7dc2e9bf'),
    title: 'Tron Lending Adapter',
    slug: 'tron-lending-adapter',
    description:
      'Draft mission for cross-chain adapter contracts. Pending scope confirmation and protocol architecture notes.',
    status: 'draft',
    is_pinned: false,
    chain: 'tron',
    network: 'testnet',
    repo_url: 'https://github.com/example/tron-lending-adapter',
    commit_hash: 'b92f31e3f59a282df2b548f18820bf7f39fd1c1a',
    docs_url: 'https://notion.example.com/tron-adapter/audit',
    start_date: null,
    end_date: null,
    created_at: '2026-02-12T07:28:00Z',
    updated_at: '2026-02-12T07:45:00Z',
    last_opened_at: null,
    last_opened_by: null,
    attachments: [],
  },
]

export function createDraftAudit(seed: number): AuditRecord {
  const now = new Date().toISOString()
  const identifier =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : createId(`${Date.now()}${seed}`.padEnd(32, '0').slice(0, 32))

  return {
    id: identifier,
    owner_id: createId('f54a9c35f6d641a597de8d2f7dc2e9bf'),
    title: `New audit ${seed}`,
    slug: null,
    description: 'Draft audit created locally. Connect backend endpoint to persist this record.',
    status: 'draft',
    is_pinned: false,
    chain: null,
    network: null,
    repo_url: null,
    commit_hash: null,
    docs_url: null,
    start_date: null,
    end_date: null,
    created_at: now,
    updated_at: now,
    last_opened_at: now,
    last_opened_by: createId('f54a9c35f6d641a597de8d2f7dc2e9bf'),
    attachments: [],
  }
}
