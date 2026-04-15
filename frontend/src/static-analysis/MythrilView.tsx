import { useCallback, useEffect, useState } from 'react'
import { css } from 'styled-system/css'
import { Box, Flex } from 'styled-system/jsx'
import { Play, Loader, Trash2, ChevronDown, ChevronRight, ChevronLeft, Info, File, Folder, FolderOpen, Zap, Layers, Search, Download } from 'lucide-react'
import { useSidebarResize } from '../components/useSidebarResize'
import * as api from './mythrilApi'
import type { MythrilPreset, MythrilRun, MythrilIssue, MythrilSeverity } from './mythrilApi'
import * as scopeApi from '../scope/api'
import { listTools } from '../tools/toolsApi'

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------
const c = {
  bg: '#101014',
  panel: 'rgba(24, 24, 29, 0.82)',
  border: 'rgba(185, 185, 189, 0.14)',
  borderSoft: 'rgba(185, 185, 189, 0.22)',
  accent: '#b48cff',
  accentFaint: 'rgba(180, 140, 255, 0.08)',
  text: 'rgba(231, 228, 239, 0.91)',
  textSub: 'rgba(231, 228, 239, 0.72)',
  muted: 'rgba(185, 185, 193, 0.55)',
  mono: "'Roboto Mono', ui-monospace, monospace",
  high: 'rgba(255, 90, 90, 0.9)',
  highBg: 'rgba(255, 90, 90, 0.08)',
  highBorder: 'rgba(255, 90, 90, 0.22)',
  medium: 'rgba(255, 150, 80, 0.9)',
  mediumBg: 'rgba(255, 150, 80, 0.08)',
  mediumBorder: 'rgba(255, 150, 80, 0.22)',
  low: 'rgba(255, 200, 60, 0.9)',
  lowBg: 'rgba(255, 200, 60, 0.06)',
  lowBorder: 'rgba(255, 200, 60, 0.18)',
}

// ---------------------------------------------------------------------------
// File tree
// ---------------------------------------------------------------------------
interface TreeNode {
  type: 'dir' | 'file'
  name: string
  path: string
  children?: TreeNode[]
  contract?: scopeApi.ScopeContract
}

function buildFileTree(contracts: scopeApi.ScopeContract[]): TreeNode[] {
  const root: TreeNode = { type: 'dir', name: '', path: '', children: [] }
  for (const sc of contracts) {
    const parts = sc.file_path.replace(/^\//, '').split('/')
    let node = root
    for (let i = 0; i < parts.length - 1; i++) {
      const name = parts[i]
      let child = node.children!.find(n => n.type === 'dir' && n.name === name)
      if (!child) {
        child = { type: 'dir', name, path: parts.slice(0, i + 1).join('/'), children: [] }
        node.children!.push(child)
      }
      node = child
    }
    node.children!.push({ type: 'file', name: parts[parts.length - 1], path: sc.file_path, contract: sc })
  }
  return root.children ?? []
}

interface FileTreeItemProps {
  node: TreeNode
  depth: number
  selectedId: string
  onSelect: (sc: scopeApi.ScopeContract) => void
}

function FileTreeItem({ node, depth, selectedId, onSelect }: FileTreeItemProps) {
  const [open, setOpen] = useState(true)
  const isSelected = node.contract?.id === selectedId

  if (node.type === 'file') {
    return (
      <Flex
        align="center"
        gap="1"
        onClick={() => node.contract && onSelect(node.contract)}
        style={{
          paddingLeft: `${8 + depth * 14}px`,
          paddingTop: 4, paddingBottom: 4, paddingRight: 6,
          cursor: 'pointer', borderRadius: 4,
          background: isSelected ? 'rgba(180,140,255,0.10)' : 'transparent',
          fontSize: 11, fontFamily: c.mono, userSelect: 'none',
        }}
        className={css({ _hover: { background: 'rgba(255,255,255,0.05)' } })}
      >
        <div style={{
          width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
          border: `1.5px solid ${isSelected ? c.accent : 'rgba(185,185,189,0.3)'}`,
          background: isSelected ? 'rgba(180,140,255,0.2)' : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'all 0.12s',
        }}>
          {isSelected && <div style={{ width: 4, height: 4, borderRadius: '50%', background: c.accent }} />}
        </div>
        <File size={11} style={{ color: '#f5a623', flexShrink: 0 }} />
        <span style={{
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          color: isSelected ? c.accent : c.muted,
          fontWeight: isSelected ? 600 : 400,
        }}>
          {node.name}
        </span>
      </Flex>
    )
  }

  return (
    <Box>
      <Flex
        align="center" gap="1"
        onClick={() => setOpen(o => !o)}
        style={{
          paddingLeft: `${6 + depth * 14}px`,
          paddingTop: 4, paddingBottom: 4, paddingRight: 6,
          cursor: 'pointer', fontSize: 11, fontFamily: c.mono,
          userSelect: 'none', fontWeight: 600,
        }}
        className={css({ _hover: { background: 'rgba(255,255,255,0.04)' } })}
      >
        {open
          ? <ChevronDown size={10} style={{ flexShrink: 0, color: c.muted }} />
          : <ChevronRight size={10} style={{ flexShrink: 0, color: c.muted }} />}
        <Box style={{ color: '#f5a623', display: 'flex', flexShrink: 0 }}>
          {open ? <FolderOpen size={13} /> : <Folder size={13} />}
        </Box>
        <span style={{ color: c.textSub }}>{node.name}</span>
      </Flex>
      {open && node.children?.map(child => (
        <FileTreeItem key={child.path} node={child} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} />
      ))}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Preset definitions
// ---------------------------------------------------------------------------
type PresetDef = {
  id: MythrilPreset
  label: string
  icon: React.ReactNode
  detail: string
}

const PRESETS: PresetDef[] = [
  {
    id: 'standard',
    label: 'Standard',
    icon: <Search size={13} />,
    detail: '3 transactions — fast scan covering most common vulnerability patterns.',
  },
  {
    id: 'deep',
    label: 'Deep',
    icon: <Layers size={13} />,
    detail: '4 transactions — explores more execution paths, catches state-dependent issues.',
  },
  {
    id: 'thorough',
    label: 'Thorough',
    icon: <Zap size={13} />,
    detail: '5 transactions + extended timeout — maximum coverage, slower but most complete.',
  },
]

// ---------------------------------------------------------------------------
// Severity badge
// ---------------------------------------------------------------------------
function SeverityBadge({ severity }: { severity: MythrilSeverity }) {
  const styles: Record<MythrilSeverity, { color: string; bg: string; border: string; label: string }> = {
    High:   { color: c.high,   bg: c.highBg,   border: c.highBorder,   label: 'HIGH' },
    Medium: { color: c.medium, bg: c.mediumBg, border: c.mediumBorder, label: 'MED' },
    Low:    { color: c.low,    bg: c.lowBg,    border: c.lowBorder,    label: 'LOW' },
  }
  const s = styles[severity]
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '1px 6px', borderRadius: 4, fontSize: 9, fontWeight: 700,
      fontFamily: c.mono, letterSpacing: '0.06em', flexShrink: 0,
      color: s.color, background: s.bg, border: `1px solid ${s.border}`,
    }}>
      {s.label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// SWC badge
// ---------------------------------------------------------------------------
function SwcBadge({ swcId }: { swcId: string | null }) {
  if (!swcId) return null
  return (
    <span style={{
      fontSize: 9, fontFamily: c.mono, color: c.accent,
      background: c.accentFaint, border: `1px solid rgba(180,140,255,0.2)`,
      borderRadius: 4, padding: '1px 5px', flexShrink: 0,
    }}>
      SWC-{swcId}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Issue row (collapsible)
// ---------------------------------------------------------------------------
function IssueRow({ issue }: { issue: MythrilIssue }) {
  const [open, setOpen] = useState(false)
  const steps = issue.tx_sequence?.steps ?? []

  return (
    <Box style={{
      borderRadius: 8, border: `1px solid ${c.border}`,
      background: open ? 'rgba(28,28,36,0.7)' : 'rgba(20,20,26,0.5)',
      marginBottom: 6, overflow: 'hidden', transition: 'background 0.12s',
    }}>
      <Flex
        align="center" gap="2"
        onClick={() => setOpen(o => !o)}
        style={{ padding: '7px 10px', cursor: 'pointer', userSelect: 'none' }}
        className={css({ _hover: { background: 'rgba(255,255,255,0.03)' } })}
      >
        <span style={{ color: c.muted, flexShrink: 0 }}>
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </span>
        <SeverityBadge severity={issue.severity} />
        <SwcBadge swcId={issue.swc_id} />
        <span style={{ fontSize: 11, fontFamily: c.mono, color: c.accent, flexShrink: 0 }}>
          {issue.title}
        </span>
        <span style={{ fontSize: 11, color: c.textSub, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {issue.function_name && <span style={{ color: c.muted }}>{issue.function_name} · </span>}
          {issue.description.split('\n')[0]}
        </span>
        {issue.filename && (
          <span style={{ fontSize: 10, fontFamily: c.mono, color: c.muted, flexShrink: 0 }}>
            {issue.filename}{issue.lineno ? `:${issue.lineno}` : ''}
          </span>
        )}
      </Flex>

      {open && (
        <Box style={{ padding: '8px 12px 10px', borderTop: `1px solid ${c.border}` }}>
          {/* Description */}
          <Box style={{ fontSize: 12, color: c.textSub, lineHeight: 1.6, marginBottom: 10, whiteSpace: 'pre-wrap' }}>
            {issue.description}
          </Box>

          {/* Vulnerable code snippet */}
          {issue.code && (
            <Box style={{ marginBottom: 10 }}>
              <span style={{ fontSize: 10, color: c.muted, fontFamily: c.mono, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                Code
              </span>
              <Box style={{
                marginTop: 4, padding: '6px 10px', borderRadius: 6,
                background: 'rgba(16,16,20,0.8)', border: `1px solid ${c.border}`,
                fontFamily: c.mono, fontSize: 11, color: c.text, whiteSpace: 'pre-wrap', overflowX: 'auto',
              }}>
                {issue.code}
              </Box>
            </Box>
          )}

          {/* Location + gas row */}
          <Flex gap="3" wrap="wrap" style={{ marginBottom: steps.length > 0 ? 10 : 0 }}>
            {issue.contract && (
              <span style={{ fontSize: 10, fontFamily: c.mono, color: c.muted }}>
                <span style={{ color: c.textSub }}>Contract: </span>{issue.contract}
              </span>
            )}
            {issue.function_name && (
              <span style={{ fontSize: 10, fontFamily: c.mono, color: c.muted }}>
                <span style={{ color: c.textSub }}>Function: </span>{issue.function_name}
              </span>
            )}
            {issue.address != null && (
              <span style={{ fontSize: 10, fontFamily: c.mono, color: c.muted }}>
                <span style={{ color: c.textSub }}>PC: </span>0x{issue.address.toString(16)}
              </span>
            )}
            {issue.min_gas_used != null && issue.max_gas_used != null && (
              <span style={{ fontSize: 10, fontFamily: c.mono, color: c.muted }}>
                <span style={{ color: c.textSub }}>Gas: </span>{issue.min_gas_used}–{issue.max_gas_used}
              </span>
            )}
          </Flex>

          {/* Transaction sequence */}
          {steps.length > 0 && (
            <Box>
              <span style={{ fontSize: 10, color: c.muted, fontFamily: c.mono, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                Transaction Sequence
              </span>
              <Flex direction="column" gap="1" style={{ marginTop: 5 }}>
                {steps.map((step: { name?: string; origin?: string; calldata?: string; value?: string }, i: number) => (
                  <Flex key={i} align="flex-start" gap="2" style={{
                    padding: '4px 8px', borderRadius: 5,
                    background: 'rgba(16,16,20,0.6)', border: `1px solid ${c.border}`,
                    fontSize: 10, fontFamily: c.mono,
                  }}>
                    <span style={{ color: c.muted, flexShrink: 0, minWidth: 16 }}>{i + 1}.</span>
                    <Flex direction="column" gap="0.5">
                      <span style={{ color: c.accent }}>{step.name ?? 'deploy'}</span>
                      {step.origin && (
                        <span style={{ color: c.muted }}>
                          from: <span style={{ color: c.textSub }}>{step.origin.slice(0, 10)}…</span>
                        </span>
                      )}
                      {step.calldata && step.calldata !== '0x' && (
                        <span style={{ color: c.muted, wordBreak: 'break-all' }}>
                          data: <span style={{ color: 'rgba(180,140,255,0.6)' }}>{step.calldata.slice(0, 34)}{step.calldata.length > 34 ? '…' : ''}</span>
                        </span>
                      )}
                    </Flex>
                  </Flex>
                ))}
              </Flex>
            </Box>
          )}
        </Box>
      )}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Run history entry
// ---------------------------------------------------------------------------
function RunEntry({ run, isSelected, onSelect, onDelete }: {
  run: MythrilRun
  isSelected: boolean
  onSelect: () => void
  onDelete: () => void
}) {
  const preset = PRESETS.find(p => p.id === run.preset)
  const when = new Date(run.created_at).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })

  return (
    <Flex direction="column" gap="1" onClick={onSelect} style={{
      padding: '7px 10px', cursor: 'pointer', borderRadius: 6,
      background: isSelected ? 'rgba(180,140,255,0.07)' : 'transparent',
      border: `1px solid ${isSelected ? 'rgba(180,140,255,0.2)' : 'transparent'}`,
      userSelect: 'none',
    }}
    className={css({ _hover: { background: 'rgba(255,255,255,0.04)' } })}
    >
      <Flex align="center" justify="space-between">
        <span style={{ fontSize: 11, fontFamily: c.mono, color: isSelected ? c.accent : c.text }}>
          {preset?.label ?? run.preset}
        </span>
        <Flex align="center" gap="2">
          {run.status === 'running' && <Loader size={10} style={{ color: c.accent, animation: 'spin 1s linear infinite' }} />}
          {run.status === 'done' && (
            <Flex gap="1">
              {run.count_high > 0 && <span style={{ fontSize: 9, fontFamily: c.mono, color: c.high }}>{run.count_high}H</span>}
              {run.count_medium > 0 && <span style={{ fontSize: 9, fontFamily: c.mono, color: c.medium }}>{run.count_medium}M</span>}
              {run.count_low > 0 && <span style={{ fontSize: 9, fontFamily: c.mono, color: c.low }}>{run.count_low}L</span>}
              {run.count_high === 0 && run.count_medium === 0 && run.count_low === 0 && (
                <span style={{ fontSize: 9, fontFamily: c.mono, color: 'rgba(180,140,255,0.7)' }}>✓</span>
              )}
            </Flex>
          )}
          {run.status === 'error' && <span style={{ fontSize: 9, color: c.high, fontFamily: c.mono }}>ERR</span>}
          <button
            onClick={e => { e.stopPropagation(); onDelete() }}
            title="Delete run"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: c.muted, display: 'flex', padding: 2 }}
            className={css({ _hover: { color: 'rgba(255,90,90,0.8)' } })}
          >
            <Trash2 size={10} />
          </button>
        </Flex>
      </Flex>
      <span style={{ fontSize: 9, fontFamily: c.mono, color: c.muted }}>{when}</span>
    </Flex>
  )
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
interface MythrilViewProps {
  auditId: string
  onOpenTools?: () => void
}

export function MythrilView({ auditId, onOpenTools }: MythrilViewProps) {
  const [mythrilInstalled, setMythrilInstalled] = useState<boolean | null>(null)

  useEffect(() => {
    listTools()
      .then(tools => {
        const m = tools.find(t => t.id === 'mythril')
        setMythrilInstalled(m?.status === 'installed')
      })
      .catch(() => setMythrilInstalled(true)) // assume installed on API error
  }, [])
  const [contracts, setContracts] = useState<scopeApi.ScopeContract[]>([])
  const [selectedContractId, setSelectedContractId] = useState<string>('')
  const [loadingContracts, setLoadingContracts] = useState(true)
  const { effectiveWidth, sidebarOpen, setSidebarOpen, isResizing, handleResizerMouseDown } = useSidebarResize({ defaultWidth: 220 })

  const [activePreset, setActivePreset] = useState<MythrilPreset>('standard')
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)

  const [runs, setRuns] = useState<MythrilRun[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [loadingRun, setLoadingRun] = useState(false)
  const [runDetail, setRunDetail] = useState<{ run: MythrilRun; issues: MythrilIssue[] } | null>(null)

  const [filterSeverity, setFilterSeverity] = useState<MythrilSeverity | 'all'>('all')

  // Load contracts
  useEffect(() => {
    let active = true
    setLoadingContracts(true)
    scopeApi.listContracts(auditId, true)
      .then(res => {
        if (!active) return
        setContracts(res.items)
        if (res.items[0]) setSelectedContractId(res.items[0].id)
      })
      .catch(() => {})
      .finally(() => { if (active) setLoadingContracts(false) })
    return () => { active = false }
  }, [auditId])

  // Load runs when contract changes
  useEffect(() => {
    if (!selectedContractId) return
    let active = true
    setRuns([])
    setSelectedRunId(null)
    setRunDetail(null)
    api.listRunsForContract(auditId, selectedContractId)
      .then(r => { if (active) { setRuns(r); setSelectedRunId(r[0]?.id ?? null) } })
      .catch(() => {})
    return () => { active = false }
  }, [auditId, selectedContractId])

  // Load selected run detail
  useEffect(() => {
    if (!selectedRunId) { setRunDetail(null); return }
    let active = true
    setLoadingRun(true)
    api.getRun(selectedRunId)
      .then(d => { if (active) setRunDetail({ run: d, issues: d.issues }) })
      .catch(() => {})
      .finally(() => { if (active) setLoadingRun(false) })
    return () => { active = false }
  }, [selectedRunId])

  const handleRun = useCallback(async () => {
    if (!selectedContractId || running) return
    setRunning(true)
    setRunError(null)
    try {
      const detail = await api.triggerRun(auditId, selectedContractId, activePreset)
      setRuns(prev => [detail, ...prev])
      setSelectedRunId(detail.id)
    } catch (e) {
      setRunError((e as Error).message)
    } finally {
      setRunning(false)
    }
  }, [auditId, selectedContractId, activePreset, running])

  const handleDeleteRun = useCallback(async (runId: string) => {
    try {
      await api.deleteRun(runId)
      setRuns(prev => prev.filter(r => r.id !== runId))
      if (selectedRunId === runId) {
        const next = runs.find(r => r.id !== runId)
        setSelectedRunId(next?.id ?? null)
      }
    } catch { /* ignore */ }
  }, [selectedRunId, runs])

  const issues = runDetail?.issues ?? []
  const filtered = filterSeverity === 'all' ? issues : issues.filter(i => i.severity === filterSeverity)
  const severityOrder: MythrilSeverity[] = ['High', 'Medium', 'Low']
  const sorted = [...filtered].sort((a, b) => severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity))
  const activePresetDef = PRESETS.find(p => p.id === activePreset)!

  if (mythrilInstalled === false) {
    return (
      <Box style={{ width: '100%' }}>
        <Flex align="center" gap="3" style={{ marginBottom: 16 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: c.text }}>Mythril</span>
        </Flex>
        <Flex
          align="center" justify="center" direction="column" gap="4"
          style={{
            height: 'calc(100vh - 320px)', minHeight: 400,
            border: `1px solid ${c.border}`, borderRadius: 12,
            background: c.panel,
          }}
        >
          <Flex align="center" justify="center" style={{
            width: 56, height: 56, borderRadius: 14,
            background: c.accentFaint,
            border: `1px solid rgba(180,140,255,0.22)`,
          }}>
            <Download size={24} style={{ color: c.accent }} />
          </Flex>
          <Flex direction="column" align="center" gap="1">
            <span style={{ fontSize: 15, fontWeight: 600, color: c.text }}>Mythril is not installed</span>
            <span style={{ fontSize: 12, color: c.muted, fontFamily: c.mono, textAlign: 'center', maxWidth: 360 }}>
              Install it from the Tools panel. On ARM64 Linux this may take 15–30 min (z3 compiles from source).
            </span>
          </Flex>
          <button
            type="button"
            onClick={onOpenTools}
            style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '8px 20px', borderRadius: 8, fontSize: 12.5, fontWeight: 600,
              fontFamily: c.mono, cursor: 'pointer',
              color: c.accent, background: c.accentFaint,
              border: `1px solid rgba(180,140,255,0.32)`,
              transition: 'all 0.15s',
            }}
          >
            <Download size={13} /> Download
          </button>
        </Flex>
        <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
      </Box>
    )
  }

  return (
    <Box style={{ width: '100%' }}>
      {/* Header */}
      <Flex align="center" gap="3" style={{ marginBottom: 16 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: c.text }}>Mythril</span>
        <a
          href="https://github.com/ConsenSysDiligence/mythril"
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: 10, color: c.muted, fontFamily: c.mono, textDecoration: 'none' }}
          className={css({ _hover: { color: 'rgba(180,140,255,0.8)', textDecoration: 'underline' } })}
        >
          powered by ConsenSys Diligence
        </a>
        {runDetail?.run.mythril_version && (
          <span style={{ fontSize: 10, color: c.muted, fontFamily: c.mono, marginLeft: 'auto' }}>
            v{runDetail.run.mythril_version}
          </span>
        )}
      </Flex>

      <Flex gap="0" style={{
        height: 'calc(100vh - 320px)', minHeight: 520,
        cursor: isResizing ? 'col-resize' : undefined,
        userSelect: isResizing ? 'none' : undefined,
      }}>

        {/* Left panel */}
        <Flex direction="column" style={{
          width: sidebarOpen ? effectiveWidth : 32,
          flexShrink: 0,
          borderRight: `1px solid ${c.borderSoft}`,
          overflow: 'hidden',
          transition: isResizing ? 'none' : 'width 0.2s ease',
          position: 'relative',
        }}>
          {/* Sidebar header */}
          <Flex align="center" justify={sidebarOpen ? 'space-between' : 'center'} style={{
            padding: sidebarOpen ? '8px 8px 5px' : '8px 0 5px',
            borderBottom: `1px solid ${c.border}`,
            flexShrink: 0,
          }}>
            {sidebarOpen && (
              <span style={{ fontSize: 10, color: c.muted, fontFamily: c.mono, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                Files
              </span>
            )}
            <button
              onClick={() => setSidebarOpen(o => !o)}
              title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 20, height: 20, borderRadius: 4, border: 'none',
                background: 'transparent', cursor: 'pointer', color: c.muted, flexShrink: 0,
              }}
            >
              {sidebarOpen ? <ChevronLeft size={13} /> : <ChevronRight size={13} />}
            </button>
          </Flex>

          {sidebarOpen && (
            <>
              {/* File tree */}
              <Box style={{ flex: 1, overflowY: 'auto', padding: '4px 0', minHeight: 0 }}>
                {loadingContracts ? (
                  <Box style={{ padding: '10px', fontSize: 11, color: c.muted, fontFamily: c.mono }}>Loading…</Box>
                ) : contracts.length === 0 ? (
                  <Box style={{ padding: '10px', fontSize: 11, color: c.muted }}>No contracts in scope</Box>
                ) : (
                  buildFileTree(contracts).map(node => (
                    <FileTreeItem
                      key={node.path}
                      node={node}
                      depth={0}
                      selectedId={selectedContractId}
                      onSelect={sc => setSelectedContractId(sc.id)}
                    />
                  ))
                )}
              </Box>

              {/* Run history */}
              <Flex direction="column" style={{ flexShrink: 0, maxHeight: '38%', borderTop: `1px solid ${c.border}`, padding: '6px 8px 8px' }}>
                <span style={{
                  fontSize: 10, color: c.muted, fontFamily: c.mono, textTransform: 'uppercase',
                  letterSpacing: '0.07em', display: 'block', marginBottom: 5, flexShrink: 0,
                }}>Run history</span>
                {runs.length === 0 ? (
                  <span style={{ fontSize: 11, color: c.muted, fontFamily: c.mono }}>No runs yet</span>
                ) : (
                  <Flex direction="column" gap="1" style={{ overflowY: 'auto' }}>
                    {runs.map(run => (
                      <RunEntry
                        key={run.id}
                        run={run}
                        isSelected={run.id === selectedRunId}
                        onSelect={() => setSelectedRunId(run.id)}
                        onDelete={() => handleDeleteRun(run.id)}
                      />
                    ))}
                  </Flex>
                )}
              </Flex>
            </>
          )}

          {/* Resize handle */}
          {sidebarOpen && (
            <Box
              onMouseDown={handleResizerMouseDown}
              title="Drag to resize"
              style={{
                position: 'absolute', top: 0, right: -3, width: 6, bottom: 0,
                cursor: 'col-resize', zIndex: 20,
                background: isResizing ? 'rgba(180,140,255,0.45)' : 'transparent',
                transition: 'background 0.15s ease',
              }}
              className={css({ _hover: { background: 'rgba(180,140,255,0.35) !important' } })}
            />
          )}
        </Flex>

        {/* Right panel */}
        <Flex direction="column" style={{ flex: 1, paddingLeft: sidebarOpen ? 16 : 12, overflow: 'hidden' }}>

          {/* Preset tabs */}
          <Flex gap="1" style={{ flexShrink: 0, borderBottom: `1px solid ${c.border}`, flexWrap: 'wrap' }}>
            {PRESETS.map(preset => {
              const isActive = activePreset === preset.id
              return (
                <button
                  key={preset.id}
                  onClick={() => setActivePreset(preset.id)}
                  title={preset.detail}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    padding: '6px 11px', fontSize: 11,
                    fontWeight: isActive ? 600 : 400,
                    color: isActive ? c.accent : c.muted,
                    background: isActive ? c.accentFaint : 'transparent',
                    border: 'none',
                    borderBottom: isActive ? `2px solid ${c.accent}` : '2px solid transparent',
                    cursor: 'pointer', fontFamily: c.mono, transition: 'color 0.12s', whiteSpace: 'nowrap',
                  }}
                  className={css({ _hover: { color: 'rgba(231,228,239,0.9)' } })}
                >
                  {preset.icon}{preset.label}
                </button>
              )
            })}
          </Flex>

          {/* Preset hint + run button */}
          <Flex align="center" gap="3" style={{
            padding: '8px 0', borderBottom: `1px solid ${c.border}`,
            flexShrink: 0, flexWrap: 'wrap',
          }}>
            <Flex align="center" gap="1.5" style={{ flex: 1, minWidth: 0 }}>
              <Info size={11} style={{ color: c.muted, flexShrink: 0 }} />
              <span style={{
                fontSize: 11, color: c.muted, fontFamily: c.mono,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {activePresetDef.detail}
              </span>
            </Flex>
            <button
              onClick={handleRun}
              disabled={running || !selectedContractId}
              style={{
                flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5,
                padding: '5px 14px', borderRadius: 7, fontSize: 11, fontWeight: 600,
                fontFamily: c.mono,
                cursor: running || !selectedContractId ? 'not-allowed' : 'pointer',
                color: running || !selectedContractId ? 'rgba(180,140,255,0.35)' : c.accent,
                background: running || !selectedContractId ? 'rgba(180,140,255,0.04)' : c.accentFaint,
                border: `1px solid ${running || !selectedContractId ? 'rgba(180,140,255,0.12)' : 'rgba(180,140,255,0.3)'}`,
                transition: 'all 0.15s',
              }}
            >
              {running
                ? <><Loader size={11} style={{ animation: 'spin 1s linear infinite' }} /> Running…</>
                : <><Play size={11} /> Run</>}
            </button>
            {runError && <span style={{ fontSize: 11, color: c.high, fontFamily: c.mono }}>{runError}</span>}
          </Flex>

          {/* Results */}
          <Box style={{ flex: 1, overflowY: 'auto', paddingTop: 10 }}>
            {loadingRun && (
              <Flex align="center" justify="center" style={{ height: '100%', color: c.muted, gap: 8 }}>
                <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} />
                <span style={{ fontSize: 13, fontFamily: c.mono }}>Loading results…</span>
              </Flex>
            )}

            {!loadingRun && !runDetail && (
              <Flex align="center" justify="center" direction="column" gap="2" style={{ height: '100%' }}>
                <span style={{ fontSize: 13, color: c.muted, fontFamily: c.mono }}>Select a depth preset and press Run</span>
                <span style={{ fontSize: 11, color: c.muted, fontFamily: c.mono }}>
                  Results are exported as <code style={{ color: c.accent }}>-o json</code> and parsed automatically
                </span>
              </Flex>
            )}

            {!loadingRun && runDetail && (
              <>
                {/* Summary bar */}
                <Flex align="center" gap="3" wrap="wrap" style={{
                  marginBottom: 12, padding: '8px 12px', borderRadius: 8,
                  background: c.panel, border: `1px solid ${c.border}`,
                }}>
                  <span style={{ fontSize: 11, fontFamily: c.mono, color: c.muted }}>
                    {runDetail.run.status === 'error'
                      ? '⚠ run failed'
                      : `${issues.length} issue${issues.length !== 1 ? 's' : ''}`}
                  </span>
                  {runDetail.run.duration_ms != null && (
                    <span style={{ fontSize: 10, fontFamily: c.mono, color: c.muted }}>
                      {(runDetail.run.duration_ms / 1000).toFixed(1)}s
                    </span>
                  )}
                  {runDetail.run.error_message && (
                    <span style={{ fontSize: 11, color: c.high, fontFamily: c.mono }}>
                      {runDetail.run.error_message}
                    </span>
                  )}

                  {/* Severity filter chips */}
                  {issues.length > 0 && (
                    <Flex gap="1" wrap="wrap" style={{ marginLeft: 'auto' }}>
                      {(['all', 'High', 'Medium', 'Low'] as const).map(sev => {
                        const count = sev === 'all' ? issues.length : issues.filter(i => i.severity === sev).length
                        if (sev !== 'all' && count === 0) return null
                        const isActive = filterSeverity === sev
                        return (
                          <button key={sev} onClick={() => setFilterSeverity(sev)} style={{
                            fontSize: 9, fontFamily: c.mono, fontWeight: isActive ? 700 : 400,
                            padding: '2px 7px', borderRadius: 4, cursor: 'pointer', border: '1px solid',
                            color: isActive ? c.accent : c.muted,
                            background: isActive ? c.accentFaint : 'transparent',
                            borderColor: isActive ? 'rgba(180,140,255,0.3)' : c.border,
                          }}>
                            {sev === 'all' ? `All (${count})` : `${sev} (${count})`}
                          </button>
                        )
                      })}
                    </Flex>
                  )}
                </Flex>

                {sorted.length === 0 && (
                  <Flex align="center" justify="center" style={{ minHeight: 120 }}>
                    <span style={{ fontSize: 12, color: c.muted, fontFamily: c.mono }}>
                      {issues.length === 0 ? '✓ No issues found' : 'No issues for this filter'}
                    </span>
                  </Flex>
                )}

                {sorted.map(issue => <IssueRow key={issue.id} issue={issue} />)}
              </>
            )}
          </Box>
        </Flex>
      </Flex>

      <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
    </Box>
  )
}
