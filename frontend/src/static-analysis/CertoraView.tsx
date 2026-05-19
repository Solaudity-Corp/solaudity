import { useCallback, useEffect, useRef, useState } from 'react'
import { css } from 'styled-system/css'
import { Box, Flex } from 'styled-system/jsx'
import { Play, Loader, Trash2, ChevronDown, ChevronRight, ChevronLeft, File, Folder, FolderOpen, Upload, X } from 'lucide-react'
import { useSidebarResize } from '../components/useSidebarResize'
import * as api from './certoraApi'
import type { CertoraRuleStatus, CertoraRun, CertoraRule, CertoraSpec } from './certoraApi'
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
  pass: 'rgba(88, 214, 171, 0.9)',
  passBg: 'rgba(88, 214, 171, 0.07)',
  passBorder: 'rgba(88, 214, 171, 0.22)',
  fail: 'rgba(255, 90, 90, 0.9)',
  failBg: 'rgba(255, 90, 90, 0.08)',
  failBorder: 'rgba(255, 90, 90, 0.22)',
  timeout: 'rgba(255, 150, 80, 0.9)',
  timeoutBg: 'rgba(255, 150, 80, 0.08)',
  timeoutBorder: 'rgba(255, 150, 80, 0.22)',
  unknown: 'rgba(100, 160, 255, 0.9)',
  unknownBg: 'rgba(100, 160, 255, 0.06)',
  unknownBorder: 'rgba(100, 160, 255, 0.18)',
}

const RULE_ORDER: CertoraRuleStatus[] = ['FAIL', 'SANITY_FAIL', 'TIMEOUT', 'UNKNOWN', 'PASS']

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
// Rule status badge
// ---------------------------------------------------------------------------
function RuleBadge({ status }: { status: CertoraRuleStatus }) {
  const styles: Record<CertoraRuleStatus, { color: string; bg: string; border: string; label: string }> = {
    PASS:        { color: c.pass,    bg: c.passBg,    border: c.passBorder,    label: 'PASS' },
    FAIL:        { color: c.fail,    bg: c.failBg,    border: c.failBorder,    label: 'FAIL' },
    TIMEOUT:     { color: c.timeout, bg: c.timeoutBg, border: c.timeoutBorder, label: 'TIMEOUT' },
    UNKNOWN:     { color: c.unknown, bg: c.unknownBg, border: c.unknownBorder, label: 'UNKNOWN' },
    SANITY_FAIL: { color: c.fail,    bg: c.failBg,    border: c.failBorder,    label: 'SANITY' },
  }
  const s = styles[status]
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
// Rule row
// ---------------------------------------------------------------------------
function RuleRow({ rule }: { rule: CertoraRule }) {
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
        <RuleBadge status={rule.status} />
        <span style={{ fontSize: 11, color: c.textSub, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: c.mono }}>
          {rule.name}
        </span>
        {rule.duration_ms != null && (
          <span style={{ fontSize: 10, fontFamily: c.mono, color: c.muted, flexShrink: 0 }}>
            {(rule.duration_ms / 1000).toFixed(1)}s
          </span>
        )}
      </Flex>
      {open && rule.message && (
        <Box style={{ padding: '8px 12px 10px', borderTop: `1px solid ${c.border}` }}>
          <Box style={{ fontSize: 11, fontFamily: c.mono, color: c.textSub, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {rule.message}
          </Box>
        </Box>
      )}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Spec pill
// ---------------------------------------------------------------------------
function SpecPill({ spec, isSelected, onSelect, onDelete }: {
  spec: CertoraSpec; isSelected: boolean; onSelect: () => void; onDelete: () => void
}) {
  return (
    <Flex align="center" gap="1" onClick={onSelect} style={{
      padding: '3px 8px 3px 6px', borderRadius: 5, cursor: 'pointer', userSelect: 'none',
      background: isSelected ? 'rgba(180,140,255,0.10)' : 'rgba(255,255,255,0.03)',
      border: `1px solid ${isSelected ? 'rgba(180,140,255,0.28)' : 'rgba(185,185,189,0.12)'}`,
      flexShrink: 0,
    }}>
      <File size={9} style={{ color: c.accent, flexShrink: 0 }} />
      <span style={{
        fontSize: 10, fontFamily: c.mono,
        color: isSelected ? c.accent : c.muted,
        maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {spec.filename}
      </span>
      <button
        onClick={e => { e.stopPropagation(); onDelete() }}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: c.muted, display: 'flex', padding: 1, marginLeft: 2 }}
        className={css({ _hover: { color: 'rgba(255,90,90,0.8)' } })}
      >
        <X size={9} />
      </button>
    </Flex>
  )
}

// ---------------------------------------------------------------------------
// Run history entry
// ---------------------------------------------------------------------------
function RunEntry({ run, spec, isSelected, onSelect, onDelete }: {
  run: CertoraRun; spec?: CertoraSpec; isSelected: boolean; onSelect: () => void; onDelete: () => void
}) {
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
        <Flex gap="1" align="center">
          {run.status === 'running' && <Loader size={10} style={{ color: c.accent, animation: 'spin 1s linear infinite' }} />}
          {run.status === 'done' && (
            <Flex gap="1">
              {run.count_fail > 0    && <span style={{ fontSize: 9, fontFamily: c.mono, color: c.fail }}>{run.count_fail}F</span>}
              {run.count_timeout > 0 && <span style={{ fontSize: 9, fontFamily: c.mono, color: c.timeout }}>{run.count_timeout}T</span>}
              {run.count_pass > 0    && <span style={{ fontSize: 9, fontFamily: c.mono, color: c.pass }}>{run.count_pass}P</span>}
              {(run.count_pass + run.count_fail + run.count_timeout + run.count_unknown) === 0 && (
                <span style={{ fontSize: 9, fontFamily: c.mono, color: c.muted }}>—</span>
              )}
            </Flex>
          )}
          {run.status === 'error' && <span style={{ fontSize: 9, color: c.fail, fontFamily: c.mono }}>ERR</span>}
        </Flex>
        <button
          onClick={e => { e.stopPropagation(); onDelete() }}
          title="Delete run"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: c.muted, display: 'flex', padding: 2 }}
          className={css({ _hover: { color: 'rgba(255,90,90,0.8)' } })}
        >
          <Trash2 size={10} />
        </button>
      </Flex>
      {spec && (
        <span style={{ fontSize: 9, fontFamily: c.mono, color: c.accent, opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {spec.filename}
        </span>
      )}
      <span style={{ fontSize: 9, fontFamily: c.mono, color: c.muted }}>{when}</span>
    </Flex>
  )
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
interface CertoraViewProps {
  auditId: string
}

export function CertoraView({ auditId }: CertoraViewProps) {
  const [contracts, setContracts] = useState<scopeApi.ScopeContract[]>([])
  const [selectedContractId, setSelectedContractId] = useState<string>('')
  const [loadingContracts, setLoadingContracts] = useState(true)
  const { effectiveWidth, sidebarOpen, setSidebarOpen, isResizing, handleResizerMouseDown } = useSidebarResize({ defaultWidth: 240 })

  const [specs, setSpecs] = useState<CertoraSpec[]>([])
  const [selectedSpecId, setSelectedSpecId] = useState<string | null>(null)
  const [uploadingSpec, setUploadingSpec] = useState(false)
  const [specError, setSpecError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const [runs, setRuns] = useState<CertoraRun[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [loadingRun, setLoadingRun] = useState(false)
  const [runDetail, setRunDetail] = useState<{ run: CertoraRun; rules: CertoraRule[] } | null>(null)
  const [filterStatus, setFilterStatus] = useState<CertoraRuleStatus | 'all'>('all')

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
    setSpecs([])
    setSelectedSpecId(null)
    setRuns([])
    setSelectedRunId(null)
    setRunDetail(null)

    Promise.all([
      api.listSpecs(auditId, selectedContractId),
      api.listRunsForContract(auditId, selectedContractId),
    ]).then(([s, r]) => {
      if (!active) return
      setSpecs(s)
      setSelectedSpecId(s[0]?.id ?? null)
      setRuns(r)
      setSelectedRunId(r[0]?.id ?? null)
    }).catch(() => {})

    return () => { active = false }
  }, [auditId, selectedContractId])

  useEffect(() => {
    if (!selectedRunId) { setRunDetail(null); return }
    let active = true
    setLoadingRun(true)
    api.getRun(selectedRunId)
      .then(d => { if (active) setRunDetail({ run: d, rules: d.rules }) })
      .catch(() => {})
      .finally(() => { if (active) setLoadingRun(false) })
    return () => { active = false }
  }, [selectedRunId])

  const handleUploadSpec = useCallback(async (file: File) => {
    if (!selectedContractId || uploadingSpec) return
    setUploadingSpec(true)
    setSpecError(null)
    try {
      const spec = await api.uploadSpec(auditId, selectedContractId, file)
      setSpecs(prev => [spec, ...prev])
      setSelectedSpecId(spec.id)
    } catch (e) {
      setSpecError((e as Error).message)
    } finally {
      setUploadingSpec(false)
    }
  }, [auditId, selectedContractId, uploadingSpec])

  const handleDeleteSpec = useCallback(async (specId: string) => {
    try {
      await api.deleteSpec(specId)
      setSpecs(prev => prev.filter(s => s.id !== specId))
      if (selectedSpecId === specId) {
        const next = specs.find(s => s.id !== specId)
        setSelectedSpecId(next?.id ?? null)
      }
    } catch { /* ignore */ }
  }, [selectedSpecId, specs])

  const handleRun = useCallback(async () => {
    if (!selectedContractId || !selectedSpecId || running) return
    setRunning(true)
    setRunError(null)
    try {
      const detail = await api.triggerRun(auditId, selectedContractId, selectedSpecId)
      setRuns(prev => [detail, ...prev])
      setSelectedRunId(detail.id)
    } catch (e) {
      setRunError((e as Error).message)
    } finally {
      setRunning(false)
    }
  }, [auditId, selectedContractId, selectedSpecId, running])

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

  const rules = runDetail?.rules ?? []
  const filtered = filterStatus === 'all' ? rules : rules.filter(r => r.status === filterStatus)
  const sorted = [...filtered].sort((a, b) => RULE_ORDER.indexOf(a.status) - RULE_ORDER.indexOf(b.status))

  const specById = (id: string) => specs.find(s => s.id === id)

  return (
    <Box style={{ width: '100%' }}>
      <Flex align="center" gap="3" style={{ marginBottom: 16 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: c.text }}>Certora Prover</span>
        <a
          href="https://github.com/Certora/CertoraProver"
          target="_blank" rel="noopener noreferrer"
          style={{ fontSize: 10, color: c.muted, fontFamily: c.mono, textDecoration: 'none' }}
          className={css({ _hover: { color: 'rgba(180,140,255,0.8)', textDecoration: 'underline' } })}
        >
          by Certora
        </a>
        <span style={{ fontSize: 10, color: c.muted, fontFamily: c.mono }}>Formal Verification</span>
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

              {/* CVL Spec section */}
              <Flex direction="column" style={{
                flexShrink: 0,
                borderTop: `1px solid ${c.border}`, padding: '6px 8px 8px',
              }}>
                <Flex align="center" justify="space-between" style={{ marginBottom: 6 }}>
                  <span style={{ fontSize: 10, color: c.muted, fontFamily: c.mono, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                    CVL Specs
                  </span>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingSpec || !selectedContractId}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 3,
                      padding: '2px 7px', borderRadius: 5, fontSize: 10, fontWeight: 600, fontFamily: c.mono,
                      cursor: uploadingSpec || !selectedContractId ? 'not-allowed' : 'pointer',
                      color: uploadingSpec || !selectedContractId ? 'rgba(180,140,255,0.35)' : c.accent,
                      background: uploadingSpec || !selectedContractId ? 'rgba(180,140,255,0.04)' : c.accentFaint,
                      border: `1px solid ${uploadingSpec || !selectedContractId ? 'rgba(180,140,255,0.12)' : 'rgba(180,140,255,0.3)'}`,
                    }}
                  >
                    {uploadingSpec
                      ? <><Loader size={9} style={{ animation: 'spin 1s linear infinite' }} /> …</>
                      : <><Upload size={9} /> Upload</>}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".spec"
                    style={{ display: 'none' }}
                    onChange={e => {
                      const f = e.target.files?.[0]
                      if (f) handleUploadSpec(f)
                      e.target.value = ''
                    }}
                  />
                </Flex>

                {specError && (
                  <Box style={{ fontSize: 10, color: c.fail, fontFamily: c.mono, marginBottom: 4 }}>{specError}</Box>
                )}

                {specs.length === 0 ? (
                  <span style={{ fontSize: 10, color: c.muted, fontFamily: c.mono }}>No specs uploaded</span>
                ) : (
                  <Flex gap="1" wrap="wrap">
                    {specs.map(s => (
                      <SpecPill
                        key={s.id} spec={s}
                        isSelected={s.id === selectedSpecId}
                        onSelect={() => setSelectedSpecId(s.id)}
                        onDelete={() => handleDeleteSpec(s.id)}
                      />
                    ))}
                  </Flex>
                )}
              </Flex>

              {/* Run history */}
              <Flex direction="column" style={{
                flexShrink: 0, maxHeight: '32%',
                borderTop: `1px solid ${c.border}`, padding: '6px 8px 8px',
              }}>
                <Flex align="center" justify="space-between" style={{ marginBottom: 5 }}>
                  <span style={{ fontSize: 10, color: c.muted, fontFamily: c.mono, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                    Run history
                  </span>
                  <button
                    onClick={handleRun}
                    disabled={running || !selectedContractId || !selectedSpecId}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      padding: '2px 8px', borderRadius: 5, fontSize: 10, fontWeight: 600, fontFamily: c.mono,
                      cursor: running || !selectedContractId || !selectedSpecId ? 'not-allowed' : 'pointer',
                      color: running || !selectedContractId || !selectedSpecId ? 'rgba(88,214,171,0.3)' : c.pass,
                      background: running || !selectedContractId || !selectedSpecId ? 'rgba(88,214,171,0.03)' : c.passBg,
                      border: `1px solid ${running || !selectedContractId || !selectedSpecId ? 'rgba(88,214,171,0.1)' : c.passBorder}`,
                    }}
                  >
                    {running
                      ? <><Loader size={9} style={{ animation: 'spin 1s linear infinite' }} /> …</>
                      : <><Play size={9} /> Prove</>}
                  </button>
                </Flex>

                {runError && (
                  <Box style={{ fontSize: 10, color: c.fail, fontFamily: c.mono, marginBottom: 4 }}>{runError}</Box>
                )}

                {runs.length === 0 ? (
                  <span style={{ fontSize: 11, color: c.muted, fontFamily: c.mono }}>No runs yet</span>
                ) : (
                  <Flex direction="column" gap="1" style={{ overflowY: 'auto' }}>
                    {runs.map(run => (
                      <RunEntry
                        key={run.id} run={run}
                        spec={specs.find(s => s.id === run.spec_id)}
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
              <span style={{ fontSize: 13, fontFamily: c.mono }}>Loading results…</span>
            </Flex>
          )}

          {!loadingRun && !runDetail && (
            <Flex align="center" justify="center" direction="column" gap="2" style={{ height: '100%' }}>
              <span style={{ fontSize: 13, color: c.muted, fontFamily: c.mono }}>
                {specs.length === 0 ? 'Upload a .spec file, then press Prove' : 'Select a spec and press Prove'}
              </span>
              <span style={{ fontSize: 11, color: c.muted, fontFamily: c.mono }}>
                Formally verifies rules defined in your CVL specification
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
                    : `${rules.length} rule${rules.length !== 1 ? 's' : ''}`}
                </span>
                {runDetail.run.duration_ms != null && (
                  <span style={{ fontSize: 10, fontFamily: c.mono, color: c.muted }}>
                    {(runDetail.run.duration_ms / 1000).toFixed(1)}s
                  </span>
                )}
                {runDetail.run.error_message && (
                  <span style={{ fontSize: 11, color: c.fail, fontFamily: c.mono }}>{runDetail.run.error_message}</span>
                )}
                {specById(runDetail.run.spec_id) && (
                  <span style={{ fontSize: 10, fontFamily: c.mono, color: c.accent, opacity: 0.75 }}>
                    {specById(runDetail.run.spec_id)!.filename}
                  </span>
                )}

                {rules.length > 0 && (
                  <Flex gap="1" wrap="wrap" style={{ marginLeft: 'auto' }}>
                    {(['all', 'FAIL', 'SANITY_FAIL', 'TIMEOUT', 'UNKNOWN', 'PASS'] as const).map(t => {
                      const count = t === 'all' ? rules.length : rules.filter(r => r.status === t).length
                      if (t !== 'all' && count === 0) return null
                      const isActive = filterStatus === t
                      const colMap: Record<string, string> = {
                        PASS: c.pass, FAIL: c.fail, SANITY_FAIL: c.fail, TIMEOUT: c.timeout, UNKNOWN: c.unknown,
                      }
                      const col = t === 'all' ? c.accent : colMap[t]
                      return (
                        <button key={t} onClick={() => setFilterStatus(t)} style={{
                          fontSize: 9, fontFamily: c.mono, fontWeight: isActive ? 700 : 400,
                          padding: '2px 7px', borderRadius: 4, cursor: 'pointer', border: '1px solid',
                          color: isActive ? col : c.muted,
                          background: isActive ? col.replace('0.9)', '0.08)').replace('0.8)', '0.08)') : 'transparent',
                          borderColor: isActive ? col.replace('0.9)', '0.3)').replace('0.8)', '0.3)') : c.border,
                        }}>
                          {t === 'all' ? `All (${count})` : `${t === 'SANITY_FAIL' ? 'SANITY' : t} (${count})`}
                        </button>
                      )
                    })}
                  </Flex>
                )}
              </Flex>

              <Box style={{ flex: 1, overflowY: 'auto' }}>
                {sorted.length === 0 && (
                  <Flex align="center" justify="center" style={{ minHeight: 120 }}>
                    <span style={{ fontSize: 12, color: c.muted, fontFamily: c.mono }}>
                      {rules.length === 0 ? '— No rules in output' : 'No rules for this filter'}
                    </span>
                  </Flex>
                )}
                {sorted.map(r => <RuleRow key={r.id} rule={r} />)}
              </Box>
            </>
          )}
        </Flex>
      </Flex>

      <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
    </Box>
  )
}
