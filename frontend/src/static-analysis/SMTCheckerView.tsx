import { useCallback, useEffect, useState } from 'react'
import { css } from 'styled-system/css'
import { Box, Flex } from 'styled-system/jsx'
import { Play, Loader, Trash2, ChevronDown, ChevronRight, ChevronLeft, File, Folder, FolderOpen } from 'lucide-react'
import { useSidebarResize } from '../components/useSidebarResize'
import * as api from './smtcheckerApi'
import type { SMTCheckerEngine, SMTCheckerRun, SMTCheckerFinding } from './smtcheckerApi'
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
}

const TARGET_COLORS: Record<string, { color: string; bg: string; border: string }> = {
  overflow:      { color: c.err,  bg: c.errBg,  border: c.errBorder },
  underflow:     { color: c.err,  bg: c.errBg,  border: c.errBorder },
  divByZero:     { color: c.err,  bg: c.errBg,  border: c.errBorder },
  assertion:     { color: c.err,  bg: c.errBg,  border: c.errBorder },
  popEmptyArray: { color: c.warn, bg: c.warnBg, border: c.warnBorder },
  outOfBounds:   { color: c.warn, bg: c.warnBg, border: c.warnBorder },
  balance:       { color: c.warn, bg: c.warnBg, border: c.warnBorder },
  constantCond:  { color: c.info, bg: c.infoBg, border: c.infoBorder },
}

const DEFAULT_TARGET_STYLE = { color: c.warn, bg: c.warnBg, border: c.warnBorder }

// ---------------------------------------------------------------------------
// File tree (shared pattern)
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
// Target badge
// ---------------------------------------------------------------------------
function TargetBadge({ target, severity }: { target: string | null; severity: string }) {
  const style = target ? (TARGET_COLORS[target] ?? DEFAULT_TARGET_STYLE)
    : severity === 'error' ? { color: c.err, bg: c.errBg, border: c.errBorder }
    : severity === 'info'  ? { color: c.info, bg: c.infoBg, border: c.infoBorder }
    : { color: c.warn, bg: c.warnBg, border: c.warnBorder }

  const label = target ?? severity.toUpperCase()

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
function FindingRow({ finding }: { finding: SMTCheckerFinding }) {
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
        <TargetBadge target={finding.target} severity={finding.severity} />
        <span style={{
          fontSize: 11, color: c.textSub, flex: 1,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {finding.message}
        </span>
        {finding.filename && (
          <span style={{ fontSize: 10, fontFamily: c.mono, color: c.muted, flexShrink: 0 }}>
            {finding.filename.split('/').pop()}{finding.line != null ? `:${finding.line}` : ''}
          </span>
        )}
      </Flex>
      {open && (
        <Box style={{ padding: '8px 12px 10px', borderTop: `1px solid ${c.border}` }}>
          {finding.formatted_message ? (
            <Box style={{
              fontSize: 11, fontFamily: c.mono, color: c.textSub,
              lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>
              {finding.formatted_message}
            </Box>
          ) : (
            finding.filename && (
              <span style={{
                fontSize: 10, fontFamily: c.mono, color: c.info,
                background: c.infoBg, border: `1px solid ${c.infoBorder}`,
                borderRadius: 4, padding: '2px 6px', display: 'inline-block',
              }}>
                {finding.filename}
                {finding.line != null ? `:${finding.line}` : ''}
                {finding.col != null ? `:${finding.col}` : ''}
              </span>
            )
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
  run: SMTCheckerRun; isSelected: boolean; onSelect: () => void; onDelete: () => void
}) {
  const when = new Date(run.created_at).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  const total = run.count_warnings + run.count_errors
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
        <Flex gap="1" align="center">
          {run.status === 'running' && <Loader size={10} style={{ color: c.accent, animation: 'spin 1s linear infinite' }} />}
          {run.status === 'done' && (
            <Flex gap="1">
              {run.count_errors   > 0 && <span style={{ fontSize: 9, fontFamily: c.mono, color: c.err  }}>{run.count_errors}E</span>}
              {run.count_warnings > 0 && <span style={{ fontSize: 9, fontFamily: c.mono, color: c.warn }}>{run.count_warnings}W</span>}
              {total === 0 && <span style={{ fontSize: 9, fontFamily: c.mono, color: 'rgba(88,214,171,0.8)' }}>✓</span>}
            </Flex>
          )}
          {run.status === 'error' && <span style={{ fontSize: 9, color: c.err, fontFamily: c.mono }}>ERR</span>}
          <span style={{ fontSize: 9, fontFamily: c.mono, color: c.muted, marginLeft: 2 }}>[{run.engine}]</span>
        </Flex>
        <button
          onClick={e => { e.stopPropagation(); onDelete() }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: c.muted, display: 'flex', padding: 2 }}
          className={css({ _hover: { color: 'rgba(255,90,90,0.8)' } })}
        >
          <Trash2 size={10} />
        </button>
      </Flex>
      <span style={{ fontSize: 9, fontFamily: c.mono, color: c.muted }}>{when}</span>
    </Flex>
  )
}

// ---------------------------------------------------------------------------
// Engine selector
// ---------------------------------------------------------------------------
function EngineSelect({ value, onChange, disabled }: {
  value: SMTCheckerEngine; onChange: (v: SMTCheckerEngine) => void; disabled: boolean
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value as SMTCheckerEngine)}
      disabled={disabled}
      style={{
        fontSize: 10, fontFamily: c.mono, padding: '2px 6px',
        borderRadius: 4, border: `1px solid rgba(185,185,189,0.18)`,
        background: 'rgba(20,20,26,0.8)', color: c.muted, cursor: disabled ? 'not-allowed' : 'pointer',
        outline: 'none',
      }}
    >
      <option value="chc">CHC (z3)</option>
      <option value="bmc">BMC (built-in)</option>
      <option value="all">All engines</option>
    </select>
  )
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------
interface SMTCheckerViewProps {
  auditId: string
}

export function SMTCheckerView({ auditId }: SMTCheckerViewProps) {
  const [contracts, setContracts] = useState<scopeApi.ScopeContract[]>([])
  const [selectedContractId, setSelectedContractId] = useState<string>('')
  const [loadingContracts, setLoadingContracts] = useState(true)
  const { effectiveWidth, sidebarOpen, setSidebarOpen, isResizing, handleResizerMouseDown } = useSidebarResize({ defaultWidth: 220 })

  const [engine, setEngine] = useState<SMTCheckerEngine>('chc')
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const [runs, setRuns] = useState<SMTCheckerRun[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [loadingRun, setLoadingRun] = useState(false)
  const [runDetail, setRunDetail] = useState<{ run: SMTCheckerRun; findings: SMTCheckerFinding[] } | null>(null)
  const [filterTarget, setFilterTarget] = useState<string>('all')

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
      const detail = await api.triggerRun(auditId, selectedContractId, engine)
      setRuns(prev => [detail, ...prev])
      setSelectedRunId(detail.id)
    } catch (e) {
      setRunError((e as Error).message)
    } finally {
      setRunning(false)
    }
  }, [auditId, selectedContractId, engine, running])

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
  const targets = Array.from(new Set(findings.map(f => f.target).filter(Boolean))) as string[]
  const filtered = filterTarget === 'all' ? findings : findings.filter(f => f.target === filterTarget)

  return (
    <Box style={{ width: '100%' }}>
      <Flex align="center" gap="3" style={{ marginBottom: 16 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: c.text }}>SMTChecker</span>
        <span style={{ fontSize: 10, color: c.muted, fontFamily: c.mono }}>
          Solidity built-in formal verifier
        </span>
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
          <Flex align="center" justify={sidebarOpen ? 'space-between' : 'center'} style={{
            padding: sidebarOpen ? '8px 8px 5px' : '8px 0 5px',
            borderBottom: `1px solid ${c.border}`, flexShrink: 0,
          }}>
            {sidebarOpen && (
              <span style={{ fontSize: 10, color: c.muted, fontFamily: c.mono, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                Files
              </span>
            )}
            <button
              onClick={() => setSidebarOpen(o => !o)}
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
              <Box style={{ flex: 1, overflowY: 'auto', padding: '4px 0', minHeight: 0 }}>
                {loadingContracts ? (
                  <Box style={{ padding: '10px', fontSize: 11, color: c.muted, fontFamily: c.mono }}>Loading…</Box>
                ) : contracts.length === 0 ? (
                  <Box style={{ padding: '10px', fontSize: 11, color: c.muted }}>No contracts in scope</Box>
                ) : (
                  buildFileTree(contracts).map(node => (
                    <FileTreeItem
                      key={node.path} node={node} depth={0}
                      selectedId={selectedContractId}
                      onSelect={sc => setSelectedContractId(sc.id)}
                    />
                  ))
                )}
              </Box>

              {/* Run history + controls */}
              <Flex direction="column" style={{
                flexShrink: 0, maxHeight: '42%',
                borderTop: `1px solid ${c.border}`, padding: '6px 8px 8px',
              }}>
                <Flex align="center" justify="space-between" style={{ marginBottom: 5, flexShrink: 0 }}>
                  <span style={{ fontSize: 10, color: c.muted, fontFamily: c.mono, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                    Run history
                  </span>
                  <button
                    onClick={handleRun}
                    disabled={running || !selectedContractId}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      padding: '2px 8px', borderRadius: 5, fontSize: 10, fontWeight: 600, fontFamily: c.mono,
                      cursor: running || !selectedContractId ? 'not-allowed' : 'pointer',
                      color: running || !selectedContractId ? 'rgba(180,140,255,0.35)' : c.accent,
                      background: running || !selectedContractId ? 'rgba(180,140,255,0.04)' : c.accentFaint,
                      border: `1px solid ${running || !selectedContractId ? 'rgba(180,140,255,0.12)' : 'rgba(180,140,255,0.3)'}`,
                    }}
                  >
                    {running
                      ? <><Loader size={9} style={{ animation: 'spin 1s linear infinite' }} /> …</>
                      : <><Play size={9} /> Run</>}
                  </button>
                </Flex>

                <Box style={{ marginBottom: 6 }}>
                  <EngineSelect value={engine} onChange={setEngine} disabled={running} />
                </Box>

                {runError && (
                  <Box style={{ fontSize: 10, color: c.err, fontFamily: c.mono, marginBottom: 4 }}>{runError}</Box>
                )}

                {runs.length === 0 ? (
                  <span style={{ fontSize: 11, color: c.muted, fontFamily: c.mono }}>No runs yet</span>
                ) : (
                  <Flex direction="column" gap="1" style={{ overflowY: 'auto' }}>
                    {runs.map(run => (
                      <RunEntry
                        key={run.id} run={run}
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

          {sidebarOpen && (
            <Box
              onMouseDown={handleResizerMouseDown}
              style={{
                position: 'absolute', top: 0, right: -3, width: 6, bottom: 0,
                cursor: 'col-resize', zIndex: 20,
                background: isResizing ? 'rgba(180,140,255,0.45)' : 'transparent',
              }}
              className={css({ _hover: { background: 'rgba(180,140,255,0.35) !important' } })}
            />
          )}
        </Flex>

        {/* Right panel */}
        <Flex direction="column" style={{ flex: 1, paddingLeft: sidebarOpen ? 16 : 12, overflow: 'hidden' }}>

          {loadingRun && (
            <Flex align="center" justify="center" style={{ height: '100%', color: c.muted, gap: 8 }}>
              <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} />
              <span style={{ fontSize: 13, fontFamily: c.mono }}>Running SMT solver…</span>
            </Flex>
          )}

          {!loadingRun && !runDetail && (
            <Flex align="center" justify="center" direction="column" gap="2" style={{ height: '100%' }}>
              <span style={{ fontSize: 13, color: c.muted, fontFamily: c.mono }}>Select a file and press Run</span>
              <span style={{ fontSize: 11, color: c.muted, fontFamily: c.mono }}>
                Checks overflow, underflow, division by zero, assertion violations and more
              </span>
            </Flex>
          )}

          {!loadingRun && runDetail && (
            <>
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
                <span style={{ fontSize: 10, fontFamily: c.mono, color: c.muted }}>
                  engine: {runDetail.run.engine}
                </span>
                {runDetail.run.error_message && (
                  <span style={{ fontSize: 11, color: c.err, fontFamily: c.mono }}>{runDetail.run.error_message}</span>
                )}

                {findings.length > 0 && (
                  <Flex gap="1" wrap="wrap" style={{ marginLeft: 'auto' }}>
                    {(['all', ...targets] as const).map(t => {
                      const count = t === 'all' ? findings.length : findings.filter(f => f.target === t).length
                      if (t !== 'all' && count === 0) return null
                      const isActive = filterTarget === t
                      const style = t === 'all' ? null : (TARGET_COLORS[t] ?? DEFAULT_TARGET_STYLE)
                      return (
                        <button key={t} onClick={() => setFilterTarget(t)} style={{
                          fontSize: 9, fontFamily: c.mono, fontWeight: isActive ? 700 : 400,
                          padding: '2px 7px', borderRadius: 4, cursor: 'pointer', border: '1px solid',
                          color: isActive ? (style?.color ?? c.accent) : c.muted,
                          background: isActive ? (style?.bg ?? c.accentFaint) : 'transparent',
                          borderColor: isActive ? (style?.border ?? 'rgba(180,140,255,0.3)') : c.border,
                        }}>
                          {t === 'all' ? `All (${count})` : `${t} (${count})`}
                        </button>
                      )
                    })}
                  </Flex>
                )}
              </Flex>

              <Box style={{ flex: 1, overflowY: 'auto' }}>
                {filtered.length === 0 && (
                  <Flex align="center" justify="center" style={{ minHeight: 120 }}>
                    <span style={{ fontSize: 12, color: c.muted, fontFamily: c.mono }}>
                      {findings.length === 0 ? '✓ No findings' : 'No findings for this filter'}
                    </span>
                  </Flex>
                )}
                {filtered.map(f => <FindingRow key={f.id} finding={f} />)}
              </Box>
            </>
          )}
        </Flex>
      </Flex>

      <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
    </Box>
  )
}
