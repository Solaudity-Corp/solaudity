import { useCallback, useEffect, useRef, useState } from 'react'
import { css } from 'styled-system/css'
import { Box, Flex } from 'styled-system/jsx'
import {
  Play, Loader, ChevronDown, ChevronRight, Shield,
  AlertTriangle, Clock, File, Folder, FolderOpen, Cpu, Check,
} from 'lucide-react'
import { useSidebarResize } from '../components/useSidebarResize'
import * as api from './aiVulnApi'
import type { VulnScan, VulnTypeInfo } from './aiVulnApi'
import * as scopeApi from '../scope/api'

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------
const c = {
  bg: '#101014',
  panel: 'rgba(24, 24, 29, 0.82)',
  border: 'rgba(185, 185, 189, 0.14)',
  accent: '#b48cff',
  accentFaint: 'rgba(180, 140, 255, 0.08)',
  accentBorder: 'rgba(180, 140, 255, 0.22)',
  text: 'rgba(231, 228, 239, 0.91)',
  textSub: 'rgba(231, 228, 239, 0.72)',
  muted: 'rgba(185, 185, 193, 0.55)',
  mono: "'Roboto Mono', ui-monospace, monospace",
  critical: 'rgba(255, 70, 70, 0.9)',   criticalBg: 'rgba(255, 70, 70, 0.08)',   criticalBorder: 'rgba(255, 70, 70, 0.22)',
  high: 'rgba(255, 100, 70, 0.9)',      highBg: 'rgba(255, 100, 70, 0.08)',      highBorder: 'rgba(255, 100, 70, 0.22)',
  medium: 'rgba(255, 170, 60, 0.9)',    mediumBg: 'rgba(255, 170, 60, 0.07)',    mediumBorder: 'rgba(255, 170, 60, 0.22)',
  low: 'rgba(100, 210, 140, 0.9)',      lowBg: 'rgba(100, 210, 140, 0.07)',      lowBorder: 'rgba(100, 210, 140, 0.2)',
  none: 'rgba(100, 200, 140, 0.85)',    noneBg: 'rgba(100, 200, 140, 0.07)',     noneBorder: 'rgba(100, 200, 140, 0.2)',
}

// ---------------------------------------------------------------------------
// File tree
// ---------------------------------------------------------------------------
interface TreeNode {
  type: 'dir' | 'file'; name: string; path: string
  children?: TreeNode[]; contract?: scopeApi.ScopeContract
}

function buildFileTree(contracts: scopeApi.ScopeContract[]): TreeNode[] {
  const root: TreeNode = { type: 'dir', name: '', path: '', children: [] }
  for (const sc of contracts) {
    const parts = sc.file_path.replace(/^\//, '').split('/')
    let node = root
    for (let i = 0; i < parts.length - 1; i++) {
      const name = parts[i]
      let child = node.children!.find(n => n.type === 'dir' && n.name === name)
      if (!child) { child = { type: 'dir', name, path: parts.slice(0, i + 1).join('/'), children: [] }; node.children!.push(child) }
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
      <Flex align="center" gap="1" onClick={() => node.contract && onSelect(node.contract)}
        style={{ paddingLeft: `${8 + depth * 14}px`, paddingTop: 4, paddingBottom: 4, paddingRight: 6, cursor: 'pointer', borderRadius: 4, background: isSelected ? 'rgba(180,140,255,0.10)' : 'transparent', fontSize: 11, fontFamily: c.mono, userSelect: 'none' }}
        className={css({ _hover: { background: 'rgba(255,255,255,0.05)' } })}>
        <div style={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0, border: `1.5px solid ${isSelected ? c.accent : 'rgba(185,185,189,0.3)'}`, background: isSelected ? 'rgba(180,140,255,0.2)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.12s' }}>
          {isSelected && <div style={{ width: 4, height: 4, borderRadius: '50%', background: c.accent }} />}
        </div>
        <File size={11} style={{ color: '#f5a623', flexShrink: 0 }} strokeWidth={1.5} />
        <span style={{ color: isSelected ? c.accent : c.textSub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
      </Flex>
    )
  }
  return (
    <Box>
      <Flex align="center" gap="1" onClick={() => setOpen(o => !o)}
        style={{ paddingLeft: `${6 + depth * 14}px`, paddingTop: 4, paddingBottom: 4, paddingRight: 6, cursor: 'pointer', fontSize: 11, fontFamily: c.mono, userSelect: 'none', fontWeight: 600 }}
        className={css({ _hover: { background: 'rgba(255,255,255,0.04)' } })}>
        {open ? <ChevronDown size={10} style={{ flexShrink: 0, color: c.muted }} /> : <ChevronRight size={10} style={{ flexShrink: 0, color: c.muted }} />}
        <Box style={{ color: '#f5a623', display: 'flex', flexShrink: 0 }}>
          {open ? <FolderOpen size={13} /> : <Folder size={13} />}
        </Box>
        <span style={{ color: c.textSub }}>{node.name}</span>
      </Flex>
      {open && node.children?.map(child => <FileTreeItem key={child.path} node={child} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} />)}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Markdown renderer
// ---------------------------------------------------------------------------
function InlineText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  return (
    <>{parts.map((p, i) => {
      if (p.startsWith('**') && p.endsWith('**')) return <strong key={i} style={{ color: c.text, fontWeight: 700 }}>{p.slice(2, -2)}</strong>
      if (p.startsWith('`') && p.endsWith('`')) return <code key={i} style={{ background: 'rgba(180,140,255,0.10)', color: c.accent, borderRadius: 3, padding: '0 4px', fontSize: '0.93em', fontFamily: c.mono }}>{p.slice(1, -1)}</code>
      return <span key={i}>{p}</span>
    })}</>
  )
}

function ScanRenderer({ content }: { content: string }) {
  const lines = content.split('\n')
  const result: React.ReactNode[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.trimStart().startsWith('```')) {
      const lang = line.trim().slice(3).trim()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) { codeLines.push(lines[i]); i++ }
      result.push(<Box key={`cb-${i}`} style={{ background: '#0d0d11', border: '1px solid rgba(185,185,189,0.12)', borderRadius: 6, padding: '10px 14px', margin: '8px 0', overflowX: 'auto' }}>
        {lang && <div style={{ fontSize: 9.5, color: c.muted, fontFamily: c.mono, marginBottom: 6, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{lang}</div>}
        <pre style={{ margin: 0, fontSize: 11.5, fontFamily: c.mono, color: 'rgba(220,215,240,0.85)', lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{codeLines.join('\n')}</pre>
      </Box>); i++; continue
    }
    if (line.startsWith('#### ')) { result.push(<Box key={i} style={{ color: c.accent, fontSize: 12, fontWeight: 700, margin: '12px 0 4px' }}><InlineText text={line.slice(5)} /></Box>); i++; continue }
    if (line.startsWith('### ')) { result.push(<Box key={i} style={{ color: c.text, fontSize: 12.5, fontWeight: 700, margin: '16px 0 6px', borderLeft: `2px solid ${c.accent}`, paddingLeft: 8 }}><InlineText text={line.slice(4)} /></Box>); i++; continue }
    if (line.startsWith('## ')) { result.push(<Box key={i} style={{ color: c.accent, fontSize: 13.5, fontWeight: 700, margin: '20px 0 8px', paddingBottom: 5, borderBottom: `1px solid ${c.accentBorder}` }}><InlineText text={line.slice(3)} /></Box>); i++; continue }
    if (line.startsWith('# ')) { result.push(<Box key={i} style={{ color: c.accent, fontSize: 15, fontWeight: 700, margin: '0 0 12px', paddingBottom: 7, borderBottom: `1px solid ${c.accentBorder}` }}><InlineText text={line.slice(2)} /></Box>); i++; continue }
    if (line.match(/\*\*Overall Risk\*\*:\s*(CRITICAL|HIGH|MEDIUM|LOW|NONE)/i)) {
      const risk = (line.match(/(CRITICAL|HIGH|MEDIUM|LOW|NONE)/i)?.[0] ?? 'NONE').toUpperCase()
      const col = riskColors(risk)
      result.push(<Flex key={i} align="center" gap="2" style={{ margin: '6px 0' }}>
        <span style={{ fontSize: 12, color: c.muted, fontFamily: c.mono }}>Overall Risk</span>
        <span style={{ fontSize: 10.5, fontWeight: 700, fontFamily: c.mono, letterSpacing: '0.06em', color: col.fg, background: col.bg, border: `1px solid ${col.border}`, borderRadius: 4, padding: '2px 8px' }}>{risk}</span>
      </Flex>); i++; continue
    }
    if (line.match(/^(\s*[-*]|\s*\d+\.) /)) {
      const indent = (line.match(/^(\s*)/)?.[1].length ?? 0)
      const text = line.replace(/^(\s*[-*]|\s*\d+\.) /, '')
      result.push(<Flex key={i} align="flex-start" style={{ gap: 6, paddingLeft: 4 + indent * 6, marginBottom: 2 }}>
        <span style={{ color: c.accent, flexShrink: 0, marginTop: 3, fontSize: 9 }}>▸</span>
        <span style={{ fontSize: 12, color: c.textSub, lineHeight: 1.65, fontFamily: c.mono }}><InlineText text={text} /></span>
      </Flex>); i++; continue
    }
    if (line.match(/^---+$/)) { result.push(<Box key={i} style={{ borderTop: '1px solid rgba(185,185,189,0.1)', margin: '12px 0' }} />); i++; continue }
    if (line.trim() === '') { result.push(<Box key={i} style={{ height: 5 }} />); i++; continue }
    result.push(<Box key={i} style={{ fontSize: 12, color: c.textSub, lineHeight: 1.7, fontFamily: c.mono, marginBottom: 1 }}><InlineText text={line} /></Box>); i++
  }
  return <Box>{result}</Box>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function riskColors(risk: string) {
  const map: Record<string, { fg: string; bg: string; border: string }> = {
    CRITICAL: { fg: c.critical, bg: c.criticalBg, border: c.criticalBorder },
    HIGH:     { fg: c.high,     bg: c.highBg,     border: c.highBorder },
    MEDIUM:   { fg: c.medium,   bg: c.mediumBg,   border: c.mediumBorder },
    LOW:      { fg: c.low,      bg: c.lowBg,      border: c.lowBorder },
    NONE:     { fg: c.none,     bg: c.noneBg,     border: c.noneBorder },
  }
  return map[risk] ?? map.NONE
}

function extractRisk(content: string): string {
  return (content.match(/Overall Risk.*?(CRITICAL|HIGH|MEDIUM|LOW|NONE)/i)?.[1] ?? 'NONE').toUpperCase()
}

function RiskPill({ risk }: { risk: string }) {
  const col = riskColors(risk)
  return (
    <span style={{ fontSize: 9.5, fontWeight: 700, fontFamily: c.mono, letterSpacing: '0.06em', color: col.fg, background: col.bg, border: `1px solid ${col.border}`, borderRadius: 4, padding: '1px 6px', flexShrink: 0 }}>{risk}</span>
  )
}

function formatDate(iso: string) {
  try { return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return iso }
}

// ---------------------------------------------------------------------------
// Multi-select vuln picker
// ---------------------------------------------------------------------------
function VulnPicker({ types, selected, onChange, disabled }: {
  types: VulnTypeInfo[]; selected: Set<string>; onChange: (s: Set<string>) => void; disabled: boolean
}) {
  const toggle = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id); else next.add(id)
    onChange(next)
  }
  return (
    <Flex direction="column" gap="0" style={{ padding: '6px 0' }}>
      {types.map(v => {
        const on = selected.has(v.id)
        return (
          <Flex key={v.id} align="center" gap="2"
            onClick={() => !disabled && toggle(v.id)}
            style={{ padding: '5px 12px', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, borderRadius: 4, background: on ? 'rgba(180,140,255,0.07)' : 'transparent', transition: 'background 0.12s' }}
            className={css({ _hover: { background: 'rgba(255,255,255,0.04)' } })}>
            <div style={{ width: 14, height: 14, borderRadius: 3, border: `1.5px solid ${on ? c.accent : 'rgba(185,185,189,0.3)'}`, background: on ? 'rgba(180,140,255,0.18)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.12s' }}>
              {on && <Check size={9} color={c.accent} strokeWidth={3} />}
            </div>
            <span style={{ fontSize: 11, fontFamily: c.mono, color: on ? c.text : c.muted, lineHeight: 1.4 }}>{v.title}</span>
          </Flex>
        )
      })}
    </Flex>
  )
}

// ---------------------------------------------------------------------------
// Section divider
// ---------------------------------------------------------------------------
function SectionDivider({ title, risk, model, date }: {
  title: string; risk: string; model: string; date: string
}) {
  return (
    <Box style={{ marginBottom: 4, marginTop: 8 }}>
      <Flex align="center" gap="3" style={{ padding: '10px 0 8px' }}>
        <Box style={{ flex: 1, height: 1, background: 'rgba(180,140,255,0.15)' }} />
        <Flex align="center" gap="2" style={{
          padding: '5px 14px', borderRadius: 20,
          background: 'rgba(180,140,255,0.06)', border: `1px solid rgba(180,140,255,0.18)`,
          flexShrink: 0,
        }}>
          <Shield size={11} color={c.accent} strokeWidth={2} />
          <span style={{ fontSize: 11, fontWeight: 700, color: c.accent, fontFamily: c.mono }}>{title}</span>
          <RiskPill risk={risk} />
        </Flex>
        <Box style={{ flex: 1, height: 1, background: 'rgba(180,140,255,0.15)' }} />
      </Flex>
      <Flex align="center" gap="2" style={{ paddingLeft: 2, paddingBottom: 10 }}>
        <span style={{ fontSize: 10, color: 'rgba(185,185,193,0.35)', fontFamily: c.mono }}>{model}</span>
        <span style={{ fontSize: 10, color: 'rgba(185,185,193,0.25)', fontFamily: c.mono }}>·</span>
        <span style={{ fontSize: 10, color: 'rgba(185,185,193,0.35)', fontFamily: c.mono }}>{date}</span>
      </Flex>
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------
export function AiVulnView({ auditId }: { auditId: string }) {
  const [vulnTypes, setVulnTypes] = useState<VulnTypeInfo[]>([])
  const [selectedVulns, setSelectedVulns] = useState<Set<string>>(new Set())
  const [contracts, setContracts] = useState<scopeApi.ScopeContract[]>([])
  const [selectedContract, setSelectedContract] = useState<scopeApi.ScopeContract | null>(null)

  // scanning state
  const [scanning, setScanning] = useState(false)
  const [scanProgress, setScanProgress] = useState<{ done: number; total: number; current: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  // results: keyed by vuln_type — current batch
  const [scanResults, setScanResults] = useState<VulnScan[]>([])

  // history panel
  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState<VulnScan[]>([])

  // section nav tabs
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const { effectiveWidth, sidebarOpen, setSidebarOpen, isResizing, handleResizerMouseDown } =
    useSidebarResize({ defaultWidth: 220 })

  useEffect(() => {
    api.listVulnTypes().then(items => setVulnTypes(items)).catch(() => {})
    scopeApi.listContracts(auditId).then(r => setContracts(r.items)).catch(() => {})
  }, [auditId])

  const loadHistory = useCallback((contractId: string) => {
    api.listVulnScansForContract(contractId).then(setHistory).catch(() => {})
  }, [])

  const handleContractSelect = useCallback((sc: scopeApi.ScopeContract) => {
    setSelectedContract(sc)
    setScanResults([])
    setHistory([])
    setError(null)
    loadHistory(sc.id)
  }, [loadHistory])

  const handleScan = async () => {
    if (!selectedContract || selectedVulns.size === 0 || scanning) return
    setError(null)
    setScanning(true)
    setScanResults([])
    const ordered = vulnTypes.filter(v => selectedVulns.has(v.id))
    setScanProgress({ done: 0, total: ordered.length, current: ordered[0]?.title ?? '' })

    const results: VulnScan[] = []
    for (let i = 0; i < ordered.length; i++) {
      const v = ordered[i]
      setScanProgress({ done: i, total: ordered.length, current: v.title })
      try {
        const scan = await api.runVulnScan(auditId, selectedContract.id, v.id)
        results.push(scan)
        setScanResults([...results])
      } catch (e: unknown) {
        setError(`${v.id}: ${e instanceof Error ? e.message : 'Scan failed'}`)
        break
      }
    }
    setScanProgress(null)
    setScanning(false)
    setHistory(prev => {
      const ids = new Set(results.map(r => r.id))
      return [...results, ...prev.filter(h => !ids.has(h.id))]
    })
  }

  const scrollToSection = (vulnId: string) => {
    sectionRefs.current[vulnId]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const tree = buildFileTree(contracts)

  return (
    <Flex style={{ height: 'calc(100vh - 220px)', minHeight: 520, overflow: 'hidden', borderRadius: 10, border: `1px solid ${c.border}` }}>

      {/* Sidebar */}
      {sidebarOpen && (
        <>
          <Box style={{ width: effectiveWidth, minWidth: 140, maxWidth: 420, flexShrink: 0, background: c.panel, borderRight: `1px solid ${c.border}`, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

            {/* Header */}
            <Flex align="center" justify="space-between" style={{ padding: '10px 12px 8px', borderBottom: `1px solid ${c.border}`, flexShrink: 0 }}>
              <Flex align="center" gap="1.5">
                <Shield size={11} color={c.accent} strokeWidth={2} />
                <span style={{ fontSize: 10.5, fontWeight: 600, color: c.muted, fontFamily: c.mono, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Contracts</span>
              </Flex>
              <button type="button" onClick={() => setSidebarOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: c.muted, padding: 2, display: 'flex' }}>
                <ChevronDown size={12} strokeWidth={2} style={{ transform: 'rotate(90deg)' }} />
              </button>
            </Flex>

            {/* File tree */}
            <Box style={{ flex: 1, overflowY: 'auto', padding: '6px 4px', borderBottom: `1px solid ${c.border}` }}>
              {tree.length === 0
                ? <span style={{ fontSize: 11, color: c.muted, fontFamily: c.mono, padding: '8px 12px', display: 'block' }}>No contracts in scope</span>
                : tree.map(node => <FileTreeItem key={node.path} node={node} depth={0} selectedId={selectedContract?.id ?? ''} onSelect={handleContractSelect} />)
              }
            </Box>

            {/* Vuln picker */}
            <Box style={{ flexShrink: 0, borderBottom: `1px solid ${c.border}` }}>
              <Flex align="center" justify="space-between" style={{ padding: '8px 12px 4px' }}>
                <span style={{ fontSize: 10.5, fontWeight: 600, color: c.muted, fontFamily: c.mono, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                  Checks
                </span>
                {selectedVulns.size > 0 && (
                  <span style={{ fontSize: 10, fontFamily: c.mono, color: c.accent, background: c.accentFaint, border: `1px solid ${c.accentBorder}`, borderRadius: 10, padding: '1px 7px' }}>
                    {selectedVulns.size} selected
                  </span>
                )}
              </Flex>
              <Box style={{ maxHeight: 220, overflowY: 'auto' }}>
                <VulnPicker types={vulnTypes} selected={selectedVulns} onChange={setSelectedVulns} disabled={scanning} />
              </Box>
            </Box>

            {/* Scan button */}
            <Box style={{ padding: '10px 12px', flexShrink: 0 }}>
              <button
                type="button"
                disabled={!selectedContract || selectedVulns.size === 0 || scanning}
                onClick={handleScan}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                  padding: '8px 0', borderRadius: 7, fontSize: 12, fontWeight: 600, fontFamily: c.mono,
                  cursor: (!selectedContract || selectedVulns.size === 0 || scanning) ? 'not-allowed' : 'pointer',
                  color: c.accent, background: c.accentFaint, border: `1px solid ${c.accentBorder}`,
                  opacity: (!selectedContract || selectedVulns.size === 0) ? 0.4 : 1, transition: 'all 0.15s',
                }}>
                {scanning ? <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Play size={13} />}
                {scanning
                  ? (scanProgress ? `${scanProgress.done + 1} / ${scanProgress.total}` : 'Scanning…')
                  : `Scan ${selectedVulns.size > 0 ? `(${selectedVulns.size})` : ''}`}
              </button>
            </Box>
          </Box>

          {/* Resizer */}
          <Box onMouseDown={handleResizerMouseDown} style={{ width: 4, flexShrink: 0, cursor: 'col-resize', background: isResizing ? 'rgba(180,140,255,0.3)' : 'transparent', transition: 'background 0.15s' }} className={css({ _hover: { background: 'rgba(180,140,255,0.2)' } })} />
        </>
      )}

      {/* Main panel */}
      <Flex direction="column" style={{ flex: 1, overflow: 'hidden', background: c.bg }}>

        {/* Top bar */}
        <Flex align="center" gap="2" style={{ padding: '8px 14px', borderBottom: `1px solid ${c.border}`, flexShrink: 0, background: c.panel, minHeight: 44 }}>
          {!sidebarOpen && (
            <button type="button" onClick={() => setSidebarOpen(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: c.muted, padding: '2px 4px', display: 'flex' }}>
              <ChevronDown size={13} strokeWidth={2} style={{ transform: 'rotate(-90deg)' }} />
            </button>
          )}

          {/* Section nav tabs — shown when results are ready */}
          {scanResults.length > 0 && (
            <Flex align="center" gap="1" style={{ overflowX: 'auto', flex: 1 }}>
              {scanResults.map(s => {
                const risk = extractRisk(s.content)
                const col = riskColors(risk)
                const label = vulnTypes.find(v => v.id === s.vuln_type)?.title?.split('—')[0]?.trim() ?? s.vuln_type
                return (
                  <button key={s.vuln_type} type="button" onClick={() => scrollToSection(s.vuln_type)}
                    style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 5, border: `1px solid rgba(180,140,255,0.16)`, background: 'rgba(180,140,255,0.05)', cursor: 'pointer', flexShrink: 0, fontFamily: c.mono, fontSize: 10.5, color: c.muted, transition: 'all 0.12s' }}
                    className={css({ _hover: { background: 'rgba(180,140,255,0.12)', color: c.text } })}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: col.fg, flexShrink: 0 }} />
                    {label}
                  </button>
                )
              })}
            </Flex>
          )}

          {!scanResults.length && (
            <Box style={{ flex: 1 }}>
              {selectedContract && (
                <span style={{ fontSize: 11, fontFamily: c.mono, color: c.accent, background: c.accentFaint, border: `1px solid ${c.accentBorder}`, borderRadius: 5, padding: '3px 8px' }}>
                  {selectedContract.file_name}
                </span>
              )}
            </Box>
          )}

          {/* History */}
          {history.length > 0 && (
            <button type="button" onClick={() => setHistoryOpen(o => !o)}
              style={{ display: 'flex', alignItems: 'center', gap: 5, background: historyOpen ? c.accentFaint : 'rgba(255,255,255,0.03)', border: `1px solid ${historyOpen ? c.accentBorder : c.border}`, borderRadius: 6, padding: '4px 9px', fontSize: 10.5, fontFamily: c.mono, color: historyOpen ? c.accent : c.muted, cursor: 'pointer', flexShrink: 0 }}>
              <Clock size={11} strokeWidth={2} />
              History ({history.length})
            </button>
          )}
        </Flex>

        {/* History panel */}
        {historyOpen && history.length > 0 && (
          <Box style={{ borderBottom: `1px solid ${c.border}`, background: c.panel, padding: '8px 14px', flexShrink: 0, maxHeight: 160, overflowY: 'auto' }}>
            <span style={{ fontSize: 10, color: c.muted, fontFamily: c.mono, letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
              Past scans · {selectedContract?.file_name}
            </span>
            <Flex direction="column" gap="1">
              {history.map(scan => (
                <Flex key={scan.id} align="center" gap="2"
                  onClick={() => { setScanResults(prev => { const without = prev.filter(s => s.vuln_type !== scan.vuln_type); return [...without, scan].sort((a, b) => vulnTypes.findIndex(v => v.id === a.vuln_type) - vulnTypes.findIndex(v => v.id === b.vuln_type)) }); setHistoryOpen(false) }}
                  style={{ padding: '4px 8px', borderRadius: 5, cursor: 'pointer' }}
                  className={css({ _hover: { background: 'rgba(255,255,255,0.04)' } })}>
                  <RiskPill risk={extractRisk(scan.content)} />
                  <span style={{ fontSize: 11, color: c.muted, fontFamily: c.mono, flex: 1 }}>{vulnTypes.find(v => v.id === scan.vuln_type)?.title ?? scan.vuln_type}</span>
                  <span style={{ fontSize: 10, color: 'rgba(185,185,193,0.35)', fontFamily: c.mono }}>{formatDate(scan.created_at)}</span>
                </Flex>
              ))}
            </Flex>
          </Box>
        )}

        {/* Content */}
        <Box style={{ flex: 1, overflowY: 'auto', padding: 20 }}>

          {/* Error */}
          {error && (
            <Flex align="flex-start" gap="2" style={{ padding: '10px 14px', borderRadius: 7, marginBottom: 16, background: 'rgba(248,81,73,0.07)', border: '1px solid rgba(248,81,73,0.22)' }}>
              <AlertTriangle size={14} color="#f85149" strokeWidth={2} style={{ flexShrink: 0, marginTop: 1 }} />
              <span style={{ fontSize: 12, color: '#f85149', fontFamily: c.mono, lineHeight: 1.55 }}>{error}</span>
            </Flex>
          )}

          {/* Progress indicator */}
          {scanning && scanProgress && (
            <Box style={{ marginBottom: 16 }}>
              <Flex align="center" gap="3" style={{ padding: '10px 14px', borderRadius: 7, background: c.accentFaint, border: `1px solid ${c.accentBorder}` }}>
                <Cpu size={15} color={c.accent} style={{ animation: 'spin 2s linear infinite', flexShrink: 0 }} />
                <Flex direction="column" gap="0.5" style={{ flex: 1 }}>
                  <span style={{ fontSize: 12, color: c.text, fontFamily: c.mono, fontWeight: 600 }}>
                    Scanning {scanProgress.done + 1} of {scanProgress.total}
                  </span>
                  <span style={{ fontSize: 11, color: c.muted, fontFamily: c.mono }}>{scanProgress.current}</span>
                </Flex>
              </Flex>
              {/* Progress bar */}
              <Box style={{ height: 3, background: 'rgba(185,185,189,0.1)', borderRadius: 2, marginTop: 6 }}>
                <Box style={{ height: '100%', background: c.accent, borderRadius: 2, width: `${(scanProgress.done / scanProgress.total) * 100}%`, transition: 'width 0.3s ease' }} />
              </Box>
            </Box>
          )}

          {/* Results — one section per vuln */}
          {scanResults.map(scan => {
            const vinfo = vulnTypes.find(v => v.id === scan.vuln_type)
            const risk = extractRisk(scan.content)
            return (
              <Box key={scan.vuln_type} ref={(el) => { sectionRefs.current[scan.vuln_type] = el }} style={{ marginBottom: 32 }}>
                <SectionDivider
                  title={vinfo?.title ?? scan.vuln_type}
                  risk={risk}
                  model={scan.model}
                  date={formatDate(scan.created_at)}
                />
                <ScanRenderer content={scan.content} />
              </Box>
            )
          })}

          {/* Empty state */}
          {!scanning && scanResults.length === 0 && !error && (
            <Flex align="center" justify="center" direction="column" gap="3" style={{ paddingTop: 60 }}>
              <Box style={{ width: 52, height: 52, borderRadius: 13, background: c.accentFaint, border: `1px solid ${c.accentBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Shield size={24} color={c.accent} strokeWidth={1.5} />
              </Box>
              <Flex direction="column" align="center" gap="1">
                <span style={{ fontSize: 14, fontWeight: 600, color: c.text }}>AI Vuln Scanner</span>
                <span style={{ fontSize: 12, color: c.muted, fontFamily: c.mono, textAlign: 'center', maxWidth: 400, lineHeight: 1.6 }}>
                  {!selectedContract
                    ? 'Select a contract from the sidebar, tick the checks to run, then click Scan.'
                    : selectedVulns.size === 0
                      ? `Contract selected: ${selectedContract.file_name}. Now tick the vulnerability checks you want to run.`
                      : `${selectedVulns.size} check${selectedVulns.size > 1 ? 's' : ''} selected. Click Scan to begin.`}
                </span>
              </Flex>
            </Flex>
          )}
        </Box>
      </Flex>

      <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
    </Flex>
  )
}
