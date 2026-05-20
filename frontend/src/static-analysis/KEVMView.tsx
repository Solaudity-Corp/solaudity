import { useCallback, useEffect, useState } from 'react'
import { css } from 'styled-system/css'
import { Box, Flex } from 'styled-system/jsx'
import { Play, Loader, Trash2, ChevronDown, ChevronRight, File, Folder, FolderOpen, Download } from 'lucide-react'
import { useSidebarResize } from '../components/useSidebarResize'
import * as api from './kevmApi'
import type { KEVMSchedule, KEVMRun, KEVMFinding } from './kevmApi'
import { listTools } from '../tools/toolsApi'
import * as scopeApi from '../scope/api'

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
  err: 'rgba(255, 90, 90, 0.9)',
  errBg: 'rgba(255, 90, 90, 0.08)',
  errBorder: 'rgba(255, 90, 90, 0.22)',
  warn: 'rgba(255, 190, 60, 0.9)',
  warnBg: 'rgba(255, 190, 60, 0.07)',
  warnBorder: 'rgba(255, 190, 60, 0.22)',
  info: 'rgba(100, 180, 255, 0.9)',
  infoBg: 'rgba(100, 180, 255, 0.06)',
  infoBorder: 'rgba(100, 180, 255, 0.18)',
  ok: 'rgba(80, 220, 130, 0.9)',
  okBg: 'rgba(80, 220, 130, 0.07)',
  okBorder: 'rgba(80, 220, 130, 0.22)',
}

const CATEGORY_STYLE: Record<string, { color: string; bg: string; border: string }> = {
  invalid_opcode:      { color: c.err,  bg: c.errBg,  border: c.errBorder },
  stack_underflow:     { color: c.err,  bg: c.errBg,  border: c.errBorder },
  stack_overflow:      { color: c.err,  bg: c.errBg,  border: c.errBorder },
  static_violation:    { color: c.err,  bg: c.errBg,  border: c.errBorder },
  rejected:            { color: c.err,  bg: c.errBg,  border: c.errBorder },
  analysis_failed:     { color: c.err,  bg: c.errBg,  border: c.errBorder },
  internal_error:      { color: c.err,  bg: c.errBg,  border: c.errBorder },
  revert:              { color: c.warn, bg: c.warnBg,  border: c.warnBorder },
  out_of_gas:          { color: c.warn, bg: c.warnBg,  border: c.warnBorder },
  precompile_failure:  { color: c.warn, bg: c.warnBg,  border: c.warnBorder },
  execution_success:   { color: c.ok,   bg: c.okBg,    border: c.okBorder },
  no_issues:           { color: c.ok,   bg: c.okBg,    border: c.okBorder },
}

function severityStyle(severity: string) {
  if (severity === 'error')   return { color: c.err,  bg: c.errBg,  border: c.errBorder }
  if (severity === 'warning') return { color: c.warn, bg: c.warnBg, border: c.warnBorder }
  return { color: c.info, bg: c.infoBg, border: c.infoBorder }
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
  node: TreeNode; depth: number; selectedId: string; onSelect: (sc: scopeApi.ScopeContract) => void
}) {
  const [open, setOpen] = useState(true)
  const isSelected = node.contract?.id === selectedId

  if (node.type === 'file') {
    return (
      <Flex align="center" gap="1"
        onClick={() => node.contract && onSelect(node.contract)}
        style={{
          paddingLeft: `${8 + depth * 14}px`, paddingTop: 4, paddingBottom: 4, paddingRight: 6,
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
        }}>
          {isSelected && <div style={{ width: 4, height: 4, borderRadius: '50%', background: c.accent }} />}
        </div>
        <File size={11} style={{ color: '#f5a623', flexShrink: 0 }} />
        <span style={{
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          color: isSelected ? c.accent : c.muted, fontWeight: isSelected ? 600 : 400,
        }}>
          {node.name}
        </span>
      </Flex>
    )
  }

  return (
    <Box>
      <Flex align="center" gap="1" onClick={() => setOpen(o => !o)}
        style={{
          paddingLeft: `${6 + depth * 14}px`, paddingTop: 4, paddingBottom: 4, paddingRight: 6,
          cursor: 'pointer', fontSize: 11, fontFamily: c.mono, userSelect: 'none', fontWeight: 600,
        }}
        className={css({ _hover: { background: 'rgba(255,255,255,0.04)' } })}
      >
        {open ? <ChevronDown size={10} style={{ flexShrink: 0, color: c.muted }} />
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
// Schedule selector
// ---------------------------------------------------------------------------
const SCHEDULES: KEVMSchedule[] = ['CANCUN', 'SHANGHAI', 'LONDON', 'BERLIN', 'ISTANBUL', 'DEFAULT']

function ScheduleSelect({ value, onChange }: { value: KEVMSchedule; onChange: (v: KEVMSchedule) => void }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value as KEVMSchedule)}
      style={{
        background: 'rgba(30,30,38,0.9)', border: `1px solid ${c.border}`,
        borderRadius: 6, color: c.textSub, fontSize: 11, fontFamily: c.mono,
        padding: '4px 8px', cursor: 'pointer', outline: 'none',
      }}
    >
      {SCHEDULES.map(s => <option key={s} value={s}>{s}</option>)}
    </select>
  )
}

// ---------------------------------------------------------------------------
// Category badge
// ---------------------------------------------------------------------------
function CategoryBadge({ category, severity }: { category: string | null; severity: string }) {
  const style = category && CATEGORY_STYLE[category]
    ? CATEGORY_STYLE[category]
    : severityStyle(severity)

  const label = (category ?? severity).replace(/_/g, ' ').toUpperCase()

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '1px 6px', borderRadius: 4, fontSize: 9, fontWeight: 700,
      fontFamily: c.mono, letterSpacing: '0.06em', flexShrink: 0,
      color: style.color, background: style.bg, border: `1px solid ${style.border}`,
    }}>
      {label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Finding row
// ---------------------------------------------------------------------------
function FindingRow({ finding }: { finding: KEVMFinding }) {
  const [open, setOpen] = useState(false)
  return (
    <Box style={{
      borderRadius: 8, border: `1px solid ${c.border}`,
      background: open ? 'rgba(28,28,36,0.7)' : 'rgba(20,20,26,0.5)',
      marginBottom: 6, overflow: 'hidden',
    }}>
      <Flex align="center" gap="2" onClick={() => setOpen(o => !o)}
        style={{ padding: '7px 10px', cursor: 'pointer', userSelect: 'none' }}
        className={css({ _hover: { background: 'rgba(255,255,255,0.03)' } })}
      >
        <span style={{ color: c.muted, flexShrink: 0 }}>
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </span>
        <CategoryBadge category={finding.category} severity={finding.severity} />
        <span style={{
          fontSize: 11, color: c.textSub, flex: 1,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {finding.message}
        </span>
      </Flex>
      {open && (
        <Box style={{
          padding: '8px 14px 10px', borderTop: `1px solid ${c.border}`,
          fontSize: 11, fontFamily: c.mono, color: c.textSub,
          whiteSpace: 'pre-wrap', lineHeight: 1.7, background: 'rgba(14,14,18,0.6)',
        }}>
          {finding.message}
        </Box>
      )}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Run row
// ---------------------------------------------------------------------------
function RunRow({ run, selected, onSelect, onDelete }: {
  run: KEVMRun; selected: boolean; onSelect: () => void; onDelete: () => void
}) {
  const dur = run.duration_ms != null ? `${(run.duration_ms / 1000).toFixed(1)}s` : null
  const statusColor = run.status === 'error' ? c.err
    : run.status === 'running' ? c.accent
    : run.count_errors > 0 ? c.warn
    : c.ok

  return (
    <Flex align="center" gap="2" onClick={onSelect}
      style={{
        padding: '7px 10px', borderRadius: 7, cursor: 'pointer', userSelect: 'none',
        background: selected ? 'rgba(180,140,255,0.08)' : 'rgba(20,20,26,0.4)',
        border: `1px solid ${selected ? 'rgba(180,140,255,0.22)' : c.border}`,
        marginBottom: 4,
      }}
      className={css({ _hover: { background: 'rgba(255,255,255,0.03)' } })}
    >
      <span style={{
        width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
        background: statusColor, boxShadow: `0 0 4px ${statusColor}`,
      }} />
      <span style={{
        fontFamily: c.mono, fontSize: 10, color: c.muted, flexShrink: 0,
        background: 'rgba(180,140,255,0.08)', border: `1px solid rgba(180,140,255,0.15)`,
        borderRadius: 4, padding: '1px 5px',
      }}>
        {run.schedule}
      </span>
      <span style={{ fontSize: 10, color: c.muted, flex: 1 }}>
        {new Date(run.created_at).toLocaleString()}
      </span>
      {run.count_errors > 0 && (
        <span style={{ fontSize: 9, color: c.err, fontFamily: c.mono }}>
          {run.count_errors}E
        </span>
      )}
      {run.count_warnings > 0 && (
        <span style={{ fontSize: 9, color: c.warn, fontFamily: c.mono, marginLeft: 3 }}>
          {run.count_warnings}W
        </span>
      )}
      {dur && <span style={{ fontSize: 9, color: c.muted, marginLeft: 4 }}>{dur}</span>}
      <span onClick={e => { e.stopPropagation(); onDelete() }}
        style={{ color: c.muted, cursor: 'pointer', flexShrink: 0, marginLeft: 2, display: 'flex' }}
        className={css({ _hover: { color: c.err } })}
      >
        <Trash2 size={12} />
      </span>
    </Flex>
  )
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------
export default function KEVMView({ auditId, onOpenTools }: { auditId: string; onOpenTools?: () => void }) {
  const [kevmStatus, setKevmStatus] = useState<'unknown' | 'installed' | 'not_installed' | 'not_supported'>('unknown')

  useEffect(() => {
    listTools()
      .then(tools => {
        const t = tools.find(t => t.id === 'kevm')
        if (!t || t.status === 'installed') setKevmStatus('installed')
        else if (t.status === 'not_supported') setKevmStatus('not_supported')
        else setKevmStatus('not_installed')
      })
      .catch(() => setKevmStatus('installed'))
  }, [])
  const [contracts, setContracts] = useState<scopeApi.ScopeContract[]>([])
  const [selectedContract, setSelectedContract] = useState<scopeApi.ScopeContract | null>(null)
  const [schedule, setSchedule] = useState<KEVMSchedule>('CANCUN')
  const [runs, setRuns] = useState<KEVMRun[]>([])
  const [selectedRun, setSelectedRun] = useState<KEVMRun | null>(null)
  const [findings, setFindings] = useState<KEVMFinding[]>([])
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { sidebarWidth, handleResizerMouseDown } = useSidebarResize({ defaultWidth: 220 })

  useEffect(() => {
    scopeApi.listContracts(auditId).then(r => setContracts(r.items)).catch(() => {})
  }, [auditId])

  const loadRuns = useCallback(async (contractId: string) => {
    try {
      const data = await api.listRunsForContract(auditId, contractId)
      setRuns(data)
    } catch { /* ignore */ }
  }, [auditId])

  useEffect(() => {
    if (selectedContract) loadRuns(selectedContract.id)
  }, [selectedContract, loadRuns])

  const handleSelectRun = async (run: KEVMRun) => {
    setSelectedRun(run)
    try {
      const detail = await api.getRun(run.id)
      setFindings(detail.findings)
    } catch { setFindings([]) }
  }

  const handleRun = async () => {
    if (!selectedContract || running) return
    setError(null)
    setRunning(true)
    try {
      const detail = await api.triggerRun(auditId, selectedContract.id, schedule)
      setRuns(prev => [detail, ...prev])
      setSelectedRun(detail)
      setFindings(detail.findings)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Run failed')
    } finally {
      setRunning(false)
    }
  }

  const handleDeleteRun = async (run: KEVMRun) => {
    try {
      await api.deleteRun(run.id)
      setRuns(prev => prev.filter(r => r.id !== run.id))
      if (selectedRun?.id === run.id) { setSelectedRun(null); setFindings([]) }
    } catch { /* ignore */ }
  }

  const tree = buildFileTree(contracts)

  if (kevmStatus === 'not_supported') {
    return (
      <Box style={{ padding: 24, width: '100%' }}>
        <Flex
          align="center" justify="center" direction="column" gap="4"
          style={{
            height: 'calc(100vh - 320px)', minHeight: 400,
            border: `1px solid rgba(185,185,189,0.1)`, borderRadius: 12,
            background: 'rgba(255,255,255,0.01)',
          }}
        >
          <Flex align="center" justify="center" style={{
            width: 56, height: 56, borderRadius: 14,
            background: 'rgba(185,185,193,0.06)',
            border: `1px solid rgba(185,185,189,0.14)`,
          }}>
            <Download size={24} style={{ color: 'rgba(185,185,193,0.4)' }} />
          </Flex>
          <Flex direction="column" align="center" gap="2">
            <span style={{ fontSize: 15, fontWeight: 600, color: 'rgba(185,185,193,0.7)' }}>
              KEVM is not supported on this system
            </span>
            <span style={{ fontSize: 12, color: 'rgba(185,185,193,0.45)', fontFamily: c.mono, textAlign: 'center', maxWidth: 440, lineHeight: 1.6 }}>
              KEVM requires Nix, which cannot run on ARM64 Linux inside Docker.
              Deploy on an AMD64 host to use this tool.
            </span>
          </Flex>
        </Flex>
        <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
      </Box>
    )
  }

  if (kevmStatus === 'not_installed') {
    return (
      <Box style={{ padding: 24, width: '100%' }}>
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
            <span style={{ fontSize: 15, fontWeight: 600, color: c.text }}>KEVM is not installed</span>
            <span style={{ fontSize: 12, color: c.muted, fontFamily: c.mono, textAlign: 'center', maxWidth: 400 }}>
              Install it from the Tools panel. Requires Nix + kup (~1–2 GB download, runs offline after).
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
    <Flex style={{ height: '100%', background: c.bg, overflow: 'hidden' }}>
      {/* Sidebar */}
      <Box style={{
        width: sidebarWidth, minWidth: 140, maxWidth: 360, flexShrink: 0,
        borderRight: `1px solid ${c.border}`, overflow: 'auto',
        background: 'rgba(16,16,20,0.7)', padding: '10px 0',
      }}>
        <Box style={{ padding: '0 10px 8px', fontSize: 10, fontWeight: 700,
          letterSpacing: '0.08em', color: c.muted, textTransform: 'uppercase' }}>
          Contracts
        </Box>
        {tree.map(node => (
          <FileTreeItem key={node.path} node={node} depth={0}
            selectedId={selectedContract?.id ?? ''}
            onSelect={sc => { setSelectedContract(sc); setSelectedRun(null); setFindings([]) }}
          />
        ))}
      </Box>

      {/* Resize handle */}
      <Box onMouseDown={handleResizerMouseDown} style={{
        width: 4, cursor: 'col-resize', flexShrink: 0,
        background: 'transparent', transition: 'background 0.15s',
      }} className={css({ _hover: { background: 'rgba(180,140,255,0.15)' } })} />

      {/* Main panel */}
      <Box style={{ flex: 1, overflow: 'auto', padding: '16px 18px' }}>
        {!selectedContract ? (
          <Flex align="center" justify="center" style={{ height: '60%', color: c.muted, fontSize: 13 }}>
            Select a contract to run KEVM analysis
          </Flex>
        ) : (
          <Box style={{ maxWidth: 820 }}>
            {/* Header */}
            <Flex align="center" gap="3" style={{ marginBottom: 16 }}>
              <Box style={{ flex: 1 }}>
                <Box style={{ fontSize: 13, fontWeight: 600, color: c.text, fontFamily: c.mono }}>
                  {selectedContract.file_path.split('/').pop()}
                </Box>
                <Box style={{ fontSize: 10, color: c.muted, marginTop: 2 }}>
                  KEVM — Formal EVM Model (K Semantics)
                </Box>
              </Box>
              <ScheduleSelect value={schedule} onChange={setSchedule} />
              <button onClick={handleRun} disabled={running}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 14px', borderRadius: 7, cursor: running ? 'not-allowed' : 'pointer',
                  background: running ? 'rgba(180,140,255,0.08)' : 'rgba(180,140,255,0.15)',
                  border: `1px solid rgba(180,140,255,${running ? '0.12' : '0.28'})`,
                  color: running ? c.muted : c.accent, fontSize: 12, fontWeight: 600,
                  transition: 'all 0.15s',
                }}
              >
                {running
                  ? <><Loader size={13} style={{ animation: 'spin 1s linear infinite' }} /> Running…</>
                  : <><Play size={13} /> Run KEVM</>}
              </button>
            </Flex>

            {error && (
              <Box style={{
                padding: '8px 12px', borderRadius: 7, marginBottom: 12,
                background: c.errBg, border: `1px solid ${c.errBorder}`,
                fontSize: 11, color: c.err, fontFamily: c.mono,
              }}>
                {error}
              </Box>
            )}

            {/* Run history */}
            {runs.length > 0 && (
              <Box style={{ marginBottom: 16 }}>
                <Box style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
                  color: c.muted, textTransform: 'uppercase', marginBottom: 8 }}>
                  Run History
                </Box>
                {runs.map(r => (
                  <RunRow key={r.id} run={r}
                    selected={selectedRun?.id === r.id}
                    onSelect={() => handleSelectRun(r)}
                    onDelete={() => handleDeleteRun(r)}
                  />
                ))}
              </Box>
            )}

            {/* Findings */}
            {selectedRun && (
              <Box>
                <Flex align="center" gap="2" style={{ marginBottom: 10 }}>
                  <Box style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
                    color: c.muted, textTransform: 'uppercase' }}>
                    Findings
                  </Box>
                  <span style={{ fontSize: 10, color: c.muted }}>
                    ({findings.length})
                  </span>
                  {selectedRun.status === 'error' && selectedRun.error_message && (
                    <span style={{ fontSize: 10, color: c.err, marginLeft: 8 }}>
                      {selectedRun.error_message}
                    </span>
                  )}
                </Flex>

                {findings.length === 0 ? (
                  <Box style={{
                    padding: '14px 16px', borderRadius: 8, fontSize: 12, color: c.muted,
                    background: 'rgba(20,20,26,0.5)', border: `1px solid ${c.border}`,
                  }}>
                    {selectedRun.status === 'running' ? 'Analysis in progress…' : 'No findings recorded for this run.'}
                  </Box>
                ) : (
                  findings.map(f => <FindingRow key={f.id} finding={f} />)
                )}
              </Box>
            )}
          </Box>
        )}
      </Box>

      <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
    </Flex>
  )
}
