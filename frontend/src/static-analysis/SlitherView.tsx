import { useCallback, useEffect, useState } from 'react'
import { css } from 'styled-system/css'
import { Box, Flex } from 'styled-system/jsx'
import { Play, Loader, Trash2, ChevronDown, ChevronRight, ChevronLeft, AlertTriangle, Info, Zap, Shield, Code2, File, Folder, FolderOpen } from 'lucide-react'
import { useSidebarResize } from '../components/useSidebarResize'
import * as api from './slitherApi'
import type { SlitherPreset, SlitherRun, SlitherFinding, SlitherImpact } from './slitherApi'
import * as scopeApi from '../scope/api'

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------
const c = {
  bg: '#101014',
  panel: 'rgba(24, 24, 29, 0.82)',
  border: 'rgba(185, 185, 189, 0.14)',
  borderSoft: 'rgba(185, 185, 189, 0.22)',
  accent: '#58D6AB',
  accentFaint: 'rgba(88, 214, 171, 0.08)',
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
  info: 'rgba(100, 160, 255, 0.9)',
  infoBg: 'rgba(100, 160, 255, 0.06)',
  infoBorder: 'rgba(100, 160, 255, 0.18)',
  optim: 'rgba(88, 214, 171, 0.8)',
  optimBg: 'rgba(88, 214, 171, 0.06)',
  optimBorder: 'rgba(88, 214, 171, 0.18)',
}

// ---------------------------------------------------------------------------
// File tree (mirrors the CodeView pattern but for single-select)
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
          background: isSelected ? 'rgba(88,214,171,0.10)' : 'transparent',
          fontSize: 11, fontFamily: c.mono, userSelect: 'none',
        }}
        className={css({ _hover: { background: 'rgba(255,255,255,0.05)' } })}
      >
        {/* radio dot */}
        <div style={{
          width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
          border: `1.5px solid ${isSelected ? c.accent : 'rgba(185,185,189,0.3)'}`,
          background: isSelected ? 'rgba(88,214,171,0.2)' : 'transparent',
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
        align="center"
        gap="1"
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
// Preset definitions — the 5 tabs
// ---------------------------------------------------------------------------
type PresetDef = {
  id: SlitherPreset
  label: string
  icon: React.ReactNode
  detail: string
}

const PRESETS: PresetDef[] = [
  {
    id: 'all',
    label: 'All Detectors',
    icon: <Zap size={13} />,
    detail: 'Runs the full suite of 90+ detectors across all impact levels. Best for a thorough first pass.',
  },
  {
    id: 'high_medium',
    label: 'High & Medium',
    icon: <AlertTriangle size={13} />,
    detail: 'Excludes Optimization, Informational and Low — surfaces only actionable security issues.',
  },
  {
    id: 'reentrancy',
    label: 'Reentrancy',
    icon: <Shield size={13} />,
    detail: 'Runs: reentrancy-eth, reentrancy-no-eth, reentrancy-benign, reentrancy-events, reentrancy-unlimited-gas, reentrancy-balance.',
  },
  {
    id: 'access_control',
    label: 'Access Control',
    icon: <Shield size={13} />,
    detail: 'Targets: tx-origin misuse, suicidal patterns, unprotected upgrades, arbitrary ETH/ERC20 sends.',
  },
  {
    id: 'code_quality',
    label: 'Code Quality',
    icon: <Code2 size={13} />,
    detail: 'Runs: naming-convention, dead-code, unused-state, unused-return, low-level-calls, missing-zero-check.',
  },
]

// ---------------------------------------------------------------------------
// Impact badge
// ---------------------------------------------------------------------------
function ImpactBadge({ impact }: { impact: SlitherImpact }) {
  const styles: Record<SlitherImpact, { color: string; bg: string; border: string; label: string }> = {
    High:          { color: c.high,   bg: c.highBg,   border: c.highBorder,   label: 'HIGH' },
    Medium:        { color: c.medium, bg: c.mediumBg, border: c.mediumBorder, label: 'MED' },
    Low:           { color: c.low,    bg: c.lowBg,    border: c.lowBorder,    label: 'LOW' },
    Informational: { color: c.info,   bg: c.infoBg,   border: c.infoBorder,   label: 'INFO' },
    Optimization:  { color: c.optim,  bg: c.optimBg,  border: c.optimBorder,  label: 'OPT' },
  }
  const s = styles[impact]
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
// Finding row (collapsible)
// ---------------------------------------------------------------------------
function FindingRow({ finding }: { finding: SlitherFinding }) {
  const [open, setOpen] = useState(false)
  const firstEl = finding.elements?.[0]
  const firstFile = firstEl?.source_mapping?.filename_short ?? null
  const lines = firstEl?.source_mapping?.lines ?? []
  const lineInfo = lines.length > 0 ? `L${lines[0]}${lines.length > 1 ? `–${lines[lines.length - 1]}` : ''}` : null

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
        <ImpactBadge impact={finding.impact} />
        <span style={{ fontSize: 11, fontFamily: c.mono, color: c.accent, flexShrink: 0 }}>
          {finding.check}
        </span>
        <span style={{ fontSize: 11, color: c.textSub, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {finding.description.split('\n')[0]}
        </span>
        {firstFile && (
          <span style={{ fontSize: 10, fontFamily: c.mono, color: c.muted, flexShrink: 0 }}>
            {firstFile}{lineInfo ? `:${lineInfo}` : ''}
          </span>
        )}
        <span style={{
          fontSize: 9, fontFamily: c.mono, color: c.muted, flexShrink: 0,
          padding: '1px 5px', borderRadius: 3, border: `1px solid ${c.border}`,
        }}>
          {finding.confidence}
        </span>
      </Flex>

      {open && (
        <Box style={{ padding: '8px 12px 10px', borderTop: `1px solid ${c.border}` }}>
          <Box style={{ fontSize: 12, color: c.textSub, lineHeight: 1.6, marginBottom: 8, whiteSpace: 'pre-wrap' }}>
            {finding.description}
          </Box>
          {finding.elements && finding.elements.length > 0 && (
            <Box>
              <span style={{ fontSize: 10, color: c.muted, fontFamily: c.mono, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                Locations
              </span>
              <Flex gap="2" wrap="wrap" style={{ marginTop: 4 }}>
                {finding.elements.map((el, i) => (
                  <span key={i} style={{
                    fontSize: 10, fontFamily: c.mono, color: c.info,
                    background: c.infoBg, border: `1px solid ${c.infoBorder}`,
                    borderRadius: 4, padding: '2px 6px',
                  }}>
                    {el.name && <span style={{ color: c.text }}>{el.name} </span>}
                    {el.source_mapping?.filename_short && (
                      <span style={{ color: c.muted }}>
                        {el.source_mapping.filename_short}
                        {el.source_mapping.lines?.length ? `:${el.source_mapping.lines[0]}` : ''}
                      </span>
                    )}
                  </span>
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
  run: SlitherRun
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
      background: isSelected ? 'rgba(88,214,171,0.07)' : 'transparent',
      border: `1px solid ${isSelected ? 'rgba(88,214,171,0.2)' : 'transparent'}`,
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
                <span style={{ fontSize: 9, fontFamily: c.mono, color: c.optim }}>✓</span>
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
interface SlitherViewProps {
  auditId: string
}

export function SlitherView({ auditId }: SlitherViewProps) {
  const [contracts, setContracts] = useState<scopeApi.ScopeContract[]>([])
  const [selectedContractId, setSelectedContractId] = useState<string>('')
  const [loadingContracts, setLoadingContracts] = useState(true)
  const { effectiveWidth, sidebarOpen, setSidebarOpen, isResizing, handleResizerMouseDown } = useSidebarResize({ defaultWidth: 220 })

  const [activePreset, setActivePreset] = useState<SlitherPreset>('all')
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)

  const [runs, setRuns] = useState<SlitherRun[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [loadingRun, setLoadingRun] = useState(false)
  const [runDetail, setRunDetail] = useState<{ run: SlitherRun; findings: SlitherFinding[] } | null>(null)

  const [filterImpact, setFilterImpact] = useState<SlitherImpact | 'all'>('all')

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
      .then(d => { if (active) setRunDetail({ run: d, findings: d.findings }) })
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

  const findings = runDetail?.findings ?? []
  const filtered = filterImpact === 'all' ? findings : findings.filter(f => f.impact === filterImpact)
  const impactOrder: SlitherImpact[] = ['High', 'Medium', 'Low', 'Informational', 'Optimization']
  const sorted = [...filtered].sort((a, b) => impactOrder.indexOf(a.impact) - impactOrder.indexOf(b.impact))
  const activePresetDef = PRESETS.find(p => p.id === activePreset)!

  return (
    <Box style={{ width: '100%' }}>
      {/* Header */}
      <Flex align="center" gap="3" style={{ marginBottom: 16 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: c.text }}>Slither</span>
        <a
          href="https://github.com/crytic/slither"
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: 10, color: c.muted, fontFamily: c.mono, textDecoration: 'none' }}
          className={css({ _hover: { color: 'rgba(88,214,171,0.8)', textDecoration: 'underline' } })}
        >
          powered by Trail of Bits
        </a>
        {runDetail?.run.slither_version && (
          <span style={{ fontSize: 10, color: c.muted, fontFamily: c.mono, marginLeft: 'auto' }}>
            v{runDetail.run.slither_version}
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
          {/* Sidebar header with collapse toggle */}
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
                  <Box style={{ padding: '10px 10px', fontSize: 11, color: c.muted, fontFamily: c.mono }}>Loading…</Box>
                ) : contracts.length === 0 ? (
                  <Box style={{ padding: '10px 10px', fontSize: 11, color: c.muted }}>No contracts in scope</Box>
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
                background: isResizing ? 'rgba(88,214,171,0.45)' : 'transparent',
                transition: 'background 0.15s ease',
              }}
              className={css({ _hover: { background: 'rgba(88,214,171,0.35) !important' } })}
            />
          )}
        </Flex>{/* end left panel */}

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
                color: running || !selectedContractId ? 'rgba(88,214,171,0.35)' : c.accent,
                background: running || !selectedContractId ? 'rgba(88,214,171,0.04)' : c.accentFaint,
                border: `1px solid ${running || !selectedContractId ? 'rgba(88,214,171,0.12)' : 'rgba(88,214,171,0.3)'}`,
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
                <span style={{ fontSize: 13, color: c.muted, fontFamily: c.mono }}>Select a preset and press Run</span>
                <span style={{ fontSize: 11, color: c.muted, fontFamily: c.mono }}>
                  Results are exported as <code style={{ color: c.accent }}>--json -</code> and parsed automatically
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
                      : `${findings.length} finding${findings.length !== 1 ? 's' : ''}`}
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

                  {/* Impact filter chips */}
                  {findings.length > 0 && (
                    <Flex gap="1" wrap="wrap" style={{ marginLeft: 'auto' }}>
                      {(['all', 'High', 'Medium', 'Low', 'Informational', 'Optimization'] as const).map(imp => {
                        const count = imp === 'all' ? findings.length : findings.filter(f => f.impact === imp).length
                        if (imp !== 'all' && count === 0) return null
                        const isActive = filterImpact === imp
                        return (
                          <button key={imp} onClick={() => setFilterImpact(imp)} style={{
                            fontSize: 9, fontFamily: c.mono, fontWeight: isActive ? 700 : 400,
                            padding: '2px 7px', borderRadius: 4, cursor: 'pointer', border: '1px solid',
                            color: isActive ? c.accent : c.muted,
                            background: isActive ? c.accentFaint : 'transparent',
                            borderColor: isActive ? 'rgba(88,214,171,0.3)' : c.border,
                          }}>
                            {imp === 'all' ? `All (${count})` : `${imp} (${count})`}
                          </button>
                        )
                      })}
                    </Flex>
                  )}
                </Flex>

                {sorted.length === 0 && (
                  <Flex align="center" justify="center" style={{ minHeight: 120 }}>
                    <span style={{ fontSize: 12, color: c.muted, fontFamily: c.mono }}>
                      {findings.length === 0 ? '✓ No findings' : 'No findings for this filter'}
                    </span>
                  </Flex>
                )}

                {sorted.map(finding => <FindingRow key={finding.id} finding={finding} />)}
              </>
            )}
          </Box>
        </Flex>
      </Flex>

      <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
    </Box>
  )
}
