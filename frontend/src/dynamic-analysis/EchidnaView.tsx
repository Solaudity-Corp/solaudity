import { useCallback, useEffect, useState } from 'react'
import { css } from 'styled-system/css'
import { Box, Flex } from 'styled-system/jsx'
import {
  Play, Loader, Trash2,
  ChevronDown, ChevronRight, ChevronLeft,
  CheckCircle2, XCircle, AlertCircle,
  File, Folder, FolderOpen,
  Bug,
} from 'lucide-react'
import { useSidebarResize } from '../components/useSidebarResize'
import * as api from './echidnaApi'
import type { EchidnaRun, EchidnaRunDetail, EchidnaTestMode, EchidnaTestResult } from './echidnaApi'
import * as scopeApi from '../scope/api'

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------
const c = {
  bg: '#101014',
  panel: 'rgba(24, 24, 29, 0.82)',
  border: 'rgba(185, 185, 189, 0.14)',
  borderSoft: 'rgba(185, 185, 189, 0.22)',
  accent: 'rgba(245, 200, 60, 1)',
  accentFaint: 'rgba(245, 200, 60, 0.08)',
  accentBorder: 'rgba(245, 200, 60, 0.22)',
  text: 'rgba(231, 228, 239, 0.91)',
  textSub: 'rgba(231, 228, 239, 0.72)',
  muted: 'rgba(185, 185, 193, 0.55)',
  mono: "'Roboto Mono', ui-monospace, monospace",
  pass: 'rgba(88, 214, 171, 0.9)',
  passBg: 'rgba(88, 214, 171, 0.08)',
  passBorder: 'rgba(88, 214, 171, 0.22)',
  fail: 'rgba(255, 90, 90, 0.9)',
  failBg: 'rgba(255, 90, 90, 0.08)',
  failBorder: 'rgba(255, 90, 90, 0.22)',
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

function FileTreeItem({ node, depth, selectedId, onSelect }: {
  node: TreeNode
  depth: number
  selectedId: string
  onSelect: (sc: scopeApi.ScopeContract) => void
}) {
  const [open, setOpen] = useState(true)
  const isSelected = node.contract?.id === selectedId

  if (node.type === 'file') {
    return (
      <Flex
        align="center" gap="1"
        onClick={() => node.contract && onSelect(node.contract)}
        style={{
          paddingLeft: `${8 + depth * 14}px`,
          paddingTop: 4, paddingBottom: 4, paddingRight: 6,
          cursor: 'pointer', borderRadius: 4,
          background: isSelected ? c.accentFaint : 'transparent',
          fontSize: 11, fontFamily: c.mono, userSelect: 'none',
        }}
        className={css({ _hover: { background: 'rgba(255,255,255,0.05)' } })}
      >
        <div style={{
          width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
          border: `1.5px solid ${isSelected ? c.accent : 'rgba(185,185,189,0.3)'}`,
          background: isSelected ? 'rgba(245,200,60,0.2)' : 'transparent',
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
// Test mode definitions
// ---------------------------------------------------------------------------
type ModeDef = {
  id: EchidnaTestMode
  label: string
  detail: string
}

const MODES: ModeDef[] = [
  {
    id: 'property',
    label: 'Property',
    detail: 'Tests functions prefixed with echidna_ — tries to make them return false. Define your invariants as Solidity functions.',
  },
  {
    id: 'assertion',
    label: 'Assertion',
    detail: 'Detects assert() violations anywhere in the contract. Works without writing dedicated test functions.',
  },
  {
    id: 'overflow',
    label: 'Overflow',
    detail: 'Looks for arithmetic overflow/underflow bugs. Useful for contracts compiled without Solidity 0.8 SafeMath.',
  },
  {
    id: 'exploration',
    label: 'Exploration',
    detail: 'Coverage-only mode — no test properties needed. Maps all reachable code paths.',
  },
]

// ---------------------------------------------------------------------------
// Test result row
// ---------------------------------------------------------------------------
function TestResultRow({ result }: { result: EchidnaTestResult }) {
  const [open, setOpen] = useState(false)
  const passed = result.status === 'passed'
  const failed = result.status === 'failed' || result.status === 'error'

  return (
    <Box style={{
      borderRadius: 8, border: `1px solid ${failed ? c.failBorder : c.border}`,
      background: open ? 'rgba(28,28,36,0.7)' : 'rgba(20,20,26,0.5)',
      marginBottom: 6, overflow: 'hidden',
    }}>
      <Flex
        align="center" gap="2"
        onClick={() => setOpen(o => !o)}
        style={{ padding: '8px 10px', cursor: 'pointer', userSelect: 'none' }}
        className={css({ _hover: { background: 'rgba(255,255,255,0.03)' } })}
      >
        <span style={{ color: c.muted, flexShrink: 0 }}>
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </span>
        {passed && <CheckCircle2 size={13} style={{ color: c.pass, flexShrink: 0 }} />}
        {failed && <XCircle size={13} style={{ color: c.fail, flexShrink: 0 }} />}
        {!passed && !failed && <AlertCircle size={13} style={{ color: c.muted, flexShrink: 0 }} />}
        <span style={{
          fontSize: 11, fontFamily: c.mono, flex: 1,
          color: passed ? c.pass : failed ? c.fail : c.muted,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {result.name || '(unnamed)'}
        </span>
        <span style={{
          fontSize: 9, fontFamily: c.mono, flexShrink: 0, letterSpacing: '0.06em',
          padding: '1px 6px', borderRadius: 4, fontWeight: 700,
          color: passed ? c.pass : failed ? c.fail : c.muted,
          background: passed ? c.passBg : failed ? c.failBg : 'transparent',
          border: `1px solid ${passed ? c.passBorder : failed ? c.failBorder : c.border}`,
        }}>
          {result.status.toUpperCase()}
        </span>
      </Flex>

      {open && (
        <Box style={{ padding: '8px 12px 10px', borderTop: `1px solid ${c.border}` }}>
          {result.error && (
            <Box style={{ fontSize: 12, color: c.fail, fontFamily: c.mono, lineHeight: 1.6, marginBottom: 8, whiteSpace: 'pre-wrap' }}>
              {result.error}
            </Box>
          )}
          {result.call_sequence && result.call_sequence.length > 0 && (
            <Box>
              <span style={{ fontSize: 10, color: c.muted, fontFamily: c.mono, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                Counterexample — call sequence
              </span>
              <Box style={{ marginTop: 6 }}>
                {result.call_sequence.map((step, i) => (
                  <Box key={i} style={{
                    padding: '5px 8px', borderRadius: 5, marginBottom: 4,
                    background: 'rgba(255,90,90,0.05)', border: `1px solid ${c.failBorder}`,
                    fontSize: 11, fontFamily: c.mono,
                  }}>
                    <span style={{ color: c.fail, marginRight: 6 }}>#{i + 1}</span>
                    {step.call?.dst && (
                      <span style={{ color: c.muted }}>{step.call.dst}.</span>
                    )}
                    {step.call?.data && (
                      <span style={{ color: c.textSub }}>{step.call.data.slice(0, 10)}…</span>
                    )}
                    {step.call?.value && step.call.value !== '0x0' && (
                      <span style={{ color: c.accent, marginLeft: 8 }}>value={step.call.value}</span>
                    )}
                  </Box>
                ))}
              </Box>
            </Box>
          )}
          {!result.error && !result.call_sequence?.length && (
            <span style={{ fontSize: 12, color: c.muted, fontFamily: c.mono }}>
              {passed ? 'No violations found after full campaign.' : 'No additional detail available.'}
            </span>
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
  run: EchidnaRun
  isSelected: boolean
  onSelect: () => void
  onDelete: () => void
}) {
  const mode = MODES.find(m => m.id === run.test_mode)
  const when = new Date(run.created_at).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })

  return (
    <Flex direction="column" gap="1" onClick={onSelect} style={{
      padding: '7px 10px', cursor: 'pointer', borderRadius: 6,
      background: isSelected ? c.accentFaint : 'transparent',
      border: `1px solid ${isSelected ? c.accentBorder : 'transparent'}`,
      userSelect: 'none',
    }}
    className={css({ _hover: { background: 'rgba(255,255,255,0.04)' } })}
    >
      <Flex align="center" justify="space-between">
        <span style={{ fontSize: 11, fontFamily: c.mono, color: isSelected ? c.accent : c.text }}>
          {mode?.label ?? run.test_mode}
        </span>
        <Flex align="center" gap="2">
          {run.status === 'running' && <Loader size={10} style={{ color: c.accent, animation: 'spin 1s linear infinite' }} />}
          {run.status === 'done' && (
            <Flex gap="1">
              {run.count_failed > 0 && (
                <span style={{ fontSize: 9, fontFamily: c.mono, color: c.fail }}>{run.count_failed}✗</span>
              )}
              {run.count_passed > 0 && (
                <span style={{ fontSize: 9, fontFamily: c.mono, color: c.pass }}>{run.count_passed}✓</span>
              )}
              {run.count_passed === 0 && run.count_failed === 0 && (
                <span style={{ fontSize: 9, fontFamily: c.mono, color: c.muted }}>—</span>
              )}
            </Flex>
          )}
          {run.status === 'error' && <span style={{ fontSize: 9, color: c.fail, fontFamily: c.mono }}>ERR</span>}
          <button
            type="button"
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
// Main view
// ---------------------------------------------------------------------------
interface EchidnaViewProps {
  auditId: string
}

export function EchidnaView({ auditId }: EchidnaViewProps) {
  const [contracts, setContracts] = useState<scopeApi.ScopeContract[]>([])
  const [selectedContractId, setSelectedContractId] = useState<string>('')
  const [loadingContracts, setLoadingContracts] = useState(true)
  const { effectiveWidth, sidebarOpen, setSidebarOpen, isResizing, handleResizerMouseDown } = useSidebarResize({ defaultWidth: 220 })

  const [activeMode, setActiveMode] = useState<EchidnaTestMode>('property')
  const [timeoutSecs, setTimeoutSecs] = useState(60)
  const [seed, setSeed] = useState<string>('')
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)

  const [runs, setRuns] = useState<EchidnaRun[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [runDetail, setRunDetail] = useState<EchidnaRunDetail | null>(null)

  // Load contracts
  useEffect(() => {
    let active = true
    setLoadingContracts(true)
    scopeApi.listContracts(auditId, true)
      .then(res => {
        if (!active) return
        const sols = res.filter(c => c.file_path.endsWith('.sol'))
        setContracts(sols)
        if (sols.length > 0) setSelectedContractId(sols[0].id)
      })
      .catch(() => {})
      .finally(() => { if (active) setLoadingContracts(false) })
    return () => { active = false }
  }, [auditId])

  // Load run history when contract changes
  const loadRuns = useCallback((contractId: string) => {
    if (!contractId) return
    api.listRunsForContract(auditId, contractId)
      .then(setRuns)
      .catch(() => {})
  }, [auditId])

  useEffect(() => {
    if (selectedContractId) loadRuns(selectedContractId)
  }, [selectedContractId, loadRuns])

  const handleSelectContract = useCallback((sc: scopeApi.ScopeContract) => {
    setSelectedContractId(sc.id)
    setRuns([])
    setSelectedRunId(null)
    setRunDetail(null)
    setRunError(null)
    loadRuns(sc.id)
  }, [loadRuns])

  const handleSelectRun = useCallback((runId: string) => {
    setSelectedRunId(runId)
    setLoadingDetail(true)
    api.getRun(runId)
      .then(setRunDetail)
      .catch(() => setRunDetail(null))
      .finally(() => setLoadingDetail(false))
  }, [])

  const handleDeleteRun = useCallback((runId: string) => {
    api.deleteRun(runId).then(() => {
      setRuns(prev => prev.filter(r => r.id !== runId))
      if (selectedRunId === runId) {
        setSelectedRunId(null)
        setRunDetail(null)
      }
    }).catch(() => {})
  }, [selectedRunId])

  const handleRun = useCallback(() => {
    if (!selectedContractId || running) return
    setRunning(true)
    setRunError(null)
    const seedNum = seed.trim() ? parseInt(seed.trim(), 10) : undefined
    api.triggerRun(auditId, selectedContractId, activeMode, timeoutSecs, seedNum)
      .then(detail => {
        setRuns(prev => [detail, ...prev])
        setSelectedRunId(detail.id)
        setRunDetail(detail)
      })
      .catch(err => setRunError(err instanceof Error ? err.message : 'Run failed'))
      .finally(() => setRunning(false))
  }, [auditId, selectedContractId, activeMode, timeoutSecs, seed, running])

  const treeNodes = buildFileTree(contracts)
  const activeModeDef = MODES.find(m => m.id === activeMode)!
  const selectedContract = contracts.find(c => c.id === selectedContractId)

  return (
    <Flex style={{ width: '100%', minHeight: 480, gap: 0 }}>
      {/* Sidebar */}
      {sidebarOpen && (
        <Box style={{
          width: effectiveWidth, minWidth: effectiveWidth, maxWidth: effectiveWidth,
          borderRadius: '14px 0 0 14px',
          border: `1px solid ${c.border}`,
          background: c.panel,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          transition: isResizing ? 'none' : 'width 0.2s ease',
        }}>
          <Flex align="center" justify="space-between" style={{
            padding: '10px 12px 8px',
            borderBottom: `1px solid ${c.border}`,
          }}>
            <span style={{ fontSize: 10, fontFamily: c.mono, color: c.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Contracts
            </span>
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: c.muted, padding: 2 }}
              className={css({ _hover: { color: c.text } })}
            >
              <ChevronLeft size={12} />
            </button>
          </Flex>
          <Box style={{ flex: 1, overflowY: 'auto', padding: '6px 4px' }}>
            {loadingContracts
              ? <Flex align="center" justify="center" style={{ padding: 20 }}>
                  <Loader size={14} style={{ color: c.muted, animation: 'spin 1s linear infinite' }} />
                </Flex>
              : treeNodes.length === 0
                ? <span style={{ fontSize: 11, color: c.muted, padding: '8px 12px', display: 'block', fontFamily: c.mono }}>No .sol files in scope</span>
                : treeNodes.map(n => (
                    <FileTreeItem key={n.path} node={n} depth={0} selectedId={selectedContractId} onSelect={handleSelectContract} />
                  ))
            }
          </Box>
        </Box>
      )}

      {/* Resize handle */}
      {sidebarOpen && (
        <Box
          onMouseDown={handleResizerMouseDown}
          style={{
            width: 4, cursor: 'col-resize', flexShrink: 0,
            background: isResizing ? 'rgba(245,200,60,0.35)' : 'transparent',
            transition: 'background 0.15s',
          }}
          className={css({ _hover: { background: 'rgba(245,200,60,0.2)' } })}
        />
      )}

      {/* Main panel */}
      <Flex direction="column" style={{
        flex: 1, minWidth: 0,
        borderRadius: sidebarOpen ? '0 14px 14px 0' : 14,
        border: `1px solid ${c.border}`,
        background: c.panel,
        overflow: 'hidden',
      }}>
        {/* Header */}
        <Flex align="center" gap="2" style={{
          padding: '10px 16px',
          borderBottom: `1px solid ${c.border}`,
          flexShrink: 0,
        }}>
          {!sidebarOpen && (
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: c.muted, padding: 2, marginRight: 4 }}
              className={css({ _hover: { color: c.text } })}
            >
              <ChevronRight size={12} />
            </button>
          )}
          <Bug size={14} style={{ color: c.accent, flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: c.text }}>Echidna Fuzzer</span>
          {selectedContract && (
            <span style={{ fontSize: 11, fontFamily: c.mono, color: c.muted, marginLeft: 4 }}>
              — {selectedContract.file_path.split('/').pop()}
            </span>
          )}
        </Flex>

        <Flex style={{ flex: 1, minHeight: 0 }}>
          {/* Config + history column */}
          <Flex direction="column" style={{
            width: 240, minWidth: 240,
            borderRight: `1px solid ${c.border}`,
            overflow: 'hidden',
          }}>
            {/* Test mode selector */}
            <Box style={{ padding: '12px 12px 0' }}>
              <span style={{ fontSize: 10, fontFamily: c.mono, color: c.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Test mode
              </span>
              <Flex direction="column" gap="1" style={{ marginTop: 8 }}>
                {MODES.map(mode => {
                  const isActive = activeMode === mode.id
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => setActiveMode(mode.id)}
                      style={{
                        textAlign: 'left', padding: '6px 10px', borderRadius: 6,
                        border: `1px solid ${isActive ? c.accentBorder : 'transparent'}`,
                        background: isActive ? c.accentFaint : 'transparent',
                        cursor: 'pointer', fontSize: 11, fontFamily: c.mono,
                        color: isActive ? c.accent : c.textSub,
                        fontWeight: isActive ? 600 : 400,
                        transition: 'all 0.12s',
                      }}
                      className={css({ _hover: { background: 'rgba(255,255,255,0.04)' } })}
                    >
                      {mode.label}
                    </button>
                  )
                })}
              </Flex>
            </Box>

            {/* Mode detail */}
            <Box style={{ padding: '8px 12px', margin: '8px 12px 0', borderRadius: 7, background: 'rgba(245,200,60,0.04)', border: `1px solid ${c.accentBorder}` }}>
              <p style={{ fontSize: 10, color: c.muted, fontFamily: c.mono, lineHeight: 1.65, margin: 0 }}>
                {activeModeDef.detail}
              </p>
            </Box>

            {/* Timeout + Seed */}
            <Box style={{ padding: '12px 12px 0' }}>
              <span style={{ fontSize: 10, fontFamily: c.mono, color: c.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Options
              </span>
              <Flex direction="column" gap="6px" style={{ marginTop: 8 }}>
                <Flex align="center" justify="space-between">
                  <span style={{ fontSize: 11, fontFamily: c.mono, color: c.textSub }}>Timeout (s)</span>
                  <input
                    type="number"
                    value={timeoutSecs}
                    min={10}
                    max={600}
                    onChange={e => setTimeoutSecs(Number(e.target.value))}
                    style={{
                      width: 68, padding: '3px 7px', borderRadius: 5,
                      background: 'rgba(20,20,24,0.9)',
                      border: `1px solid ${c.border}`,
                      color: c.text, fontSize: 11, fontFamily: c.mono,
                      outline: 'none',
                    }}
                  />
                </Flex>
                <Flex align="center" justify="space-between">
                  <span style={{ fontSize: 11, fontFamily: c.mono, color: c.textSub }}>Seed</span>
                  <input
                    type="text"
                    value={seed}
                    placeholder="random"
                    onChange={e => setSeed(e.target.value)}
                    style={{
                      width: 68, padding: '3px 7px', borderRadius: 5,
                      background: 'rgba(20,20,24,0.9)',
                      border: `1px solid ${c.border}`,
                      color: c.text, fontSize: 11, fontFamily: c.mono,
                      outline: 'none',
                    }}
                  />
                </Flex>
              </Flex>
            </Box>

            {/* Run button */}
            <Box style={{ padding: '12px 12px 0' }}>
              <button
                type="button"
                onClick={handleRun}
                disabled={running || !selectedContractId}
                style={{
                  width: '100%', padding: '9px 12px',
                  borderRadius: 8, border: `1px solid ${c.accentBorder}`,
                  background: running || !selectedContractId ? 'rgba(245,200,60,0.05)' : c.accentFaint,
                  cursor: running || !selectedContractId ? 'not-allowed' : 'pointer',
                  color: running || !selectedContractId ? c.muted : c.accent,
                  fontSize: 12, fontWeight: 600, fontFamily: c.mono,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  transition: 'all 0.15s',
                }}
                className={css({ _hover: { background: 'rgba(245,200,60,0.12) !important' } })}
              >
                {running
                  ? <><Loader size={12} style={{ animation: 'spin 1s linear infinite' }} /> Running…</>
                  : <><Play size={12} /> Run Echidna</>
                }
              </button>
              {runError && (
                <Box style={{ marginTop: 8, padding: '6px 8px', borderRadius: 6, background: 'rgba(255,90,90,0.08)', border: '1px solid rgba(255,90,90,0.22)' }}>
                  <span style={{ fontSize: 11, color: c.fail, fontFamily: c.mono, lineHeight: 1.5 }}>{runError}</span>
                </Box>
              )}
            </Box>

            {/* Run history */}
            <Box style={{ flex: 1, overflowY: 'auto', padding: '12px 8px 8px' }}>
              <span style={{ fontSize: 10, fontFamily: c.mono, color: c.muted, textTransform: 'uppercase', letterSpacing: '0.08em', paddingLeft: 4 }}>
                History
              </span>
              <Box style={{ marginTop: 6 }}>
                {runs.length === 0
                  ? <span style={{ fontSize: 11, color: c.muted, fontFamily: c.mono, padding: '4px 4px', display: 'block' }}>No runs yet</span>
                  : runs.map(run => (
                      <RunEntry
                        key={run.id}
                        run={run}
                        isSelected={run.id === selectedRunId}
                        onSelect={() => handleSelectRun(run.id)}
                        onDelete={() => handleDeleteRun(run.id)}
                      />
                    ))
                }
              </Box>
            </Box>
          </Flex>

          {/* Results panel */}
          <Box style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '16px' }}>
            {!selectedContractId && (
              <Flex align="center" justify="center" style={{ minHeight: 300 }}>
                <span style={{ fontSize: 13, color: c.muted, fontFamily: c.mono }}>Select a contract to begin</span>
              </Flex>
            )}
            {selectedContractId && !selectedRunId && !running && (
              <Flex direction="column" align="center" justify="center" style={{ minHeight: 300, gap: 12 }}>
                <Bug size={32} style={{ color: 'rgba(245,200,60,0.2)' }} />
                <span style={{ fontSize: 13, color: c.muted, fontFamily: c.mono }}>Run Echidna to start fuzzing</span>
                <span style={{ fontSize: 11, color: 'rgba(185,185,193,0.35)', fontFamily: c.mono, textAlign: 'center', maxWidth: 360 }}>
                  In <b style={{ color: c.muted }}>property</b> mode, add functions named <b style={{ color: c.muted, fontFamily: c.mono }}>echidna_*</b> that return <b style={{ color: c.muted, fontFamily: c.mono }}>bool</b>.
                  Echidna will try to find inputs that make them return false.
                </span>
              </Flex>
            )}
            {loadingDetail && (
              <Flex align="center" justify="center" style={{ minHeight: 300 }}>
                <Loader size={18} style={{ color: c.accent, animation: 'spin 1s linear infinite' }} />
              </Flex>
            )}
            {runDetail && !loadingDetail && (
              <Box>
                {/* Run summary bar */}
                <Flex align="center" gap="3" style={{
                  padding: '8px 12px', borderRadius: 8, marginBottom: 16,
                  background: 'rgba(20,20,26,0.7)',
                  border: `1px solid ${c.border}`,
                }}>
                  <span style={{ fontSize: 11, fontFamily: c.mono, color: c.muted }}>
                    {MODES.find(m => m.id === runDetail.test_mode)?.label} · {runDetail.timeout_seconds}s
                  </span>
                  {runDetail.duration_ms !== null && (
                    <span style={{ fontSize: 11, fontFamily: c.mono, color: c.muted }}>
                      {(runDetail.duration_ms / 1000).toFixed(1)}s
                    </span>
                  )}
                  {runDetail.echidna_version && (
                    <span style={{ fontSize: 10, fontFamily: c.mono, color: 'rgba(185,185,193,0.35)' }}>
                      {runDetail.echidna_version}
                    </span>
                  )}
                  <Box style={{ flex: 1 }} />
                  {runDetail.count_passed > 0 && (
                    <span style={{ fontSize: 11, fontFamily: c.mono, color: c.pass }}>
                      {runDetail.count_passed} passed
                    </span>
                  )}
                  {runDetail.count_failed > 0 && (
                    <span style={{ fontSize: 11, fontFamily: c.mono, color: c.fail }}>
                      {runDetail.count_failed} failed
                    </span>
                  )}
                  <span style={{
                    fontSize: 9, fontFamily: c.mono, fontWeight: 700, letterSpacing: '0.06em',
                    padding: '2px 7px', borderRadius: 4,
                    color: runDetail.status === 'done' ? (runDetail.count_failed > 0 ? c.fail : c.pass)
                          : runDetail.status === 'error' ? c.fail : c.muted,
                    background: runDetail.status === 'done' ? (runDetail.count_failed > 0 ? c.failBg : c.passBg) : 'transparent',
                    border: `1px solid ${runDetail.status === 'done' ? (runDetail.count_failed > 0 ? c.failBorder : c.passBorder) : c.border}`,
                  }}>
                    {runDetail.status.toUpperCase()}
                  </span>
                </Flex>

                {/* Error message */}
                {runDetail.error_message && (
                  <Box style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 8, background: c.failBg, border: `1px solid ${c.failBorder}` }}>
                    <span style={{ fontSize: 11, fontFamily: c.mono, color: c.fail, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                      {runDetail.error_message}
                    </span>
                  </Box>
                )}

                {/* Test results */}
                {runDetail.test_results && runDetail.test_results.length > 0 && (
                  <Box>
                    <span style={{ fontSize: 10, fontFamily: c.mono, color: c.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                      Test results
                    </span>
                    <Box style={{ marginTop: 8 }}>
                      {/* Failed first */}
                      {runDetail.test_results
                        .slice()
                        .sort((a, b) => {
                          const rank = (s: string) => s === 'failed' || s === 'error' ? 0 : s === 'passed' ? 1 : 2
                          return rank(a.status) - rank(b.status)
                        })
                        .map((result, i) => (
                          <TestResultRow key={i} result={result} />
                        ))
                      }
                    </Box>
                  </Box>
                )}

                {/* No results parsed — show raw output */}
                {(!runDetail.test_results || runDetail.test_results.length === 0) && runDetail.raw_stdout && (
                  <Box>
                    <span style={{ fontSize: 10, fontFamily: c.mono, color: c.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                      Raw output
                    </span>
                    <Box style={{
                      marginTop: 8, padding: '10px 12px', borderRadius: 8,
                      background: 'rgba(14,14,18,0.8)', border: `1px solid ${c.border}`,
                      maxHeight: 400, overflowY: 'auto',
                    }}>
                      <pre style={{ fontSize: 11, fontFamily: c.mono, color: c.textSub, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                        {runDetail.raw_stdout}
                      </pre>
                    </Box>
                  </Box>
                )}
              </Box>
            )}
          </Box>
        </Flex>
      </Flex>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </Flex>
  )
}
