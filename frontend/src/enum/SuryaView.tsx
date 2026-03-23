import { useCallback, useEffect, useRef, useState } from 'react'
import { css } from 'styled-system/css'
import { Box, Flex } from 'styled-system/jsx'
import {
  File,
  GitBranch, Share2, List, Search, Link2,
  Layers, FileCode, FileText, RefreshCw,
} from 'lucide-react'
import * as scopeApi from '../scope/api'
import * as surya from './suryaApi'

// ---------------------------------------------------------------------------
// Colours — same palette as ParseView / TreeView
// ---------------------------------------------------------------------------
const c = {
  bg: '#101014',
  border: 'rgba(185, 185, 189, 0.14)',
  borderSoft: 'rgba(185, 185, 189, 0.22)',
  accent: '#58D6AB',
  accentFaint: 'rgba(88, 214, 171, 0.08)',
  text: 'rgba(231, 228, 239, 0.96)',
  textSub: 'rgba(231, 228, 239, 0.72)',
  textMuted: 'rgba(185, 185, 189, 0.55)',
  mono: "'Roboto Mono', ui-monospace, monospace",
  card: 'rgba(30, 30, 38, 0.95)',
  purple: 'rgba(180, 140, 255, 0.85)',
  blue: 'rgba(100, 160, 255, 0.85)',
  orange: 'rgba(255, 150, 80, 0.85)',
}

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------
type TabId = 'graph' | 'inheritance' | 'ftrace' | 'describe' | 'dependencies' | 'flatten' | 'parse' | 'mdreport'

const TABS: Array<{ id: TabId; label: string; icon: React.ReactNode; description: string; needsFile: boolean }> = [
  { id: 'graph',        label: 'Graph',        icon: <GitBranch size={12} />,  description: 'Function call graph (DOT)',           needsFile: false },
  { id: 'inheritance',  label: 'Inheritance',  icon: <Share2 size={12} />,     description: 'Contract inheritance tree (DOT)',     needsFile: false },
  { id: 'ftrace',       label: 'Ftrace',       icon: <List size={12} />,       description: 'Function call trace',                needsFile: false },
  { id: 'describe',     label: 'Describe',     icon: <Search size={12} />,     description: 'Contract & function summary',        needsFile: false },
  { id: 'dependencies', label: 'Dependencies', icon: <Link2 size={12} />,      description: 'C3-linearised inheritance chain',    needsFile: false },
  { id: 'flatten',      label: 'Flatten',      icon: <Layers size={12} />,     description: 'Inline all imports into one file',   needsFile: true  },
  { id: 'parse',        label: 'Parse',        icon: <FileCode size={12} />,   description: 'Solidity AST parse tree',            needsFile: true  },
  { id: 'mdreport',     label: 'MD Report',    icon: <FileText size={12} />,   description: 'Markdown documentation report',      needsFile: false },
]

// ---------------------------------------------------------------------------
// Viz.js singleton — load Graphviz WASM once
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _vizPromise: Promise<any> | null = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getViz(): Promise<any> {
  if (!_vizPromise) {
    _vizPromise = import('@viz-js/viz').then(m => m.instance())
  }
  return _vizPromise
}

// ---------------------------------------------------------------------------
// DotGraph — renders a DOT string as SVG with zoom + pan
// ---------------------------------------------------------------------------
function DotGraph({ dot, loading }: { dot: string | null; loading: boolean }) {
  const wrapperRef  = useRef<HTMLDivElement>(null)
  const contentRef  = useRef<HTMLDivElement>(null)
  const dragging    = useRef(false)           // ref — no re-render on change
  const lastMouse   = useRef({ x: 0, y: 0 })
  const cursorRef   = useRef<HTMLDivElement>(null)

  const [renderErr, setRenderErr] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan,  setPan]  = useState({ x: 0, y: 0 })

  // Render SVG whenever dot changes, reset view
  useEffect(() => {
    if (!dot || !contentRef.current) return
    setRenderErr(null)
    setZoom(1); setPan({ x: 0, y: 0 })
    let cancelled = false
    getViz().then(viz => {
      if (cancelled || !contentRef.current) return
      try {
        const svg = viz.renderSVGElement(dot)
        svg.style.display = 'block'
        svg.style.width   = 'auto'
        svg.style.height  = 'auto'
        contentRef.current.innerHTML = ''
        contentRef.current.appendChild(svg)
      } catch (e) { setRenderErr(String(e)) }
    }).catch(e => { if (!cancelled) setRenderErr(String(e)) })
    return () => { cancelled = true }
  }, [dot])

  // Wheel → zoom at cursor (non-passive so we can preventDefault)
  useEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect   = el.getBoundingClientRect()
      const mx     = e.clientX - rect.left
      const my     = e.clientY - rect.top
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
      setZoom(z => {
        const nz = Math.min(10, Math.max(0.1, z * factor))
        setPan(p => ({
          x: mx - (mx - p.x) * (nz / z),
          y: my - (my - p.y) * (nz / z),
        }))
        return nz
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Native mouse events on the overlay so we bypass React batching entirely
  useEffect(() => {
    const overlay = cursorRef.current
    if (!overlay) return

    const onDown = (e: MouseEvent) => {
      e.preventDefault()
      dragging.current = true
      lastMouse.current = { x: e.clientX, y: e.clientY }
      overlay.style.cursor = 'grabbing'
    }
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return
      const dx = e.clientX - lastMouse.current.x
      const dy = e.clientY - lastMouse.current.y
      lastMouse.current = { x: e.clientX, y: e.clientY }
      setPan(p => ({ x: p.x + dx, y: p.y + dy }))
    }
    const onUp = () => {
      dragging.current = false
      overlay.style.cursor = 'grab'
    }

    overlay.addEventListener('mousedown', onDown)
    overlay.addEventListener('mousemove', onMove)
    overlay.addEventListener('mouseup',   onUp)
    overlay.addEventListener('mouseleave', onUp)
    return () => {
      overlay.removeEventListener('mousedown', onDown)
      overlay.removeEventListener('mousemove', onMove)
      overlay.removeEventListener('mouseup',   onUp)
      overlay.removeEventListener('mouseleave', onUp)
    }
  }, [dot]) // re-attach after SVG renders

  if (loading)   return <CenteredMsg icon={<Spinner />} text="Running surya…" />
  if (!dot)      return <CenteredMsg icon={<GitBranch size={32} style={{ opacity: 0.25 }} />} text="Press Run to generate the graph" />
  if (renderErr) return <CenteredMsg icon={<GitBranch size={32} style={{ opacity: 0.25 }} />} text={`Render error: ${renderErr}`} />

  return (
    <Box ref={wrapperRef} style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: c.bg }}>

      {/* SVG — pointer-events:none so the overlay owns all interactions */}
      <div
        ref={contentRef}
        style={{
          position: 'absolute', top: 0, left: 0,
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      />

      {/* Interaction overlay — sits above SVG, below zoom buttons */}
      <div
        ref={cursorRef}
        style={{ position: 'absolute', inset: 0, zIndex: 5, cursor: 'grab' }}
      />

      {/* Zoom controls */}
      <Flex gap="1" style={{ position: 'absolute', top: 10, right: 12, zIndex: 10 }}>
        {([
          { label: '+', title: 'Zoom in',  fn: () => setZoom(z => Math.min(10, z * 1.25)) },
          { label: '−', title: 'Zoom out', fn: () => setZoom(z => Math.max(0.1, z / 1.25)) },
          { label: '↺', title: 'Reset',    fn: () => { setZoom(1); setPan({ x: 0, y: 0 }) } },
        ] as const).map(btn => (
          <button key={btn.label} title={btn.title} onClick={btn.fn} style={{
            width: 26, height: 26, borderRadius: 6, fontSize: 13, fontWeight: 700,
            background: 'rgba(20,20,26,0.92)', border: `1px solid ${c.borderSoft}`,
            color: c.textSub, cursor: 'pointer', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
          }}>
            {btn.label}
          </button>
        ))}
        <span style={{ fontSize: 10, color: c.textMuted, fontFamily: c.mono, alignSelf: 'center', marginLeft: 4 }}>
          {Math.round(zoom * 100)}%
        </span>
      </Flex>
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Text output panel — for ftrace, describe, dependencies, flatten, parse
// ---------------------------------------------------------------------------
function TextOutput({ text, loading, placeholder }: { text: string | null; loading: boolean; placeholder: string }) {
  if (loading) return <CenteredMsg icon={<Spinner />} text="Running surya…" />
  if (!text)   return <CenteredMsg icon={<FileCode size={32} style={{ opacity: 0.25, color: c.textMuted }} />} text={placeholder} />
  return (
    <Box style={{ height: '100%', overflow: 'auto' }}>
      <pre style={{
        margin: 0, padding: 16,
        fontFamily: c.mono, fontSize: 12, lineHeight: 1.65,
        color: c.text, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}>
        {text}
      </pre>
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Markdown renderer — converts surya mdreport output to styled HTML
// ---------------------------------------------------------------------------
function renderMd(md: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const inlineStyles = (s: string) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, `<code style="background:rgba(255,255,255,0.07);padding:1px 5px;border-radius:4px;font-family:monospace;font-size:0.9em">$1</code>`)

  const lines = md.split('\n')
  const out: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Headings
    if (/^### /.test(line)) { out.push(`<h3 style="margin:20px 0 6px;font-size:13px;font-weight:700;color:rgba(231,228,239,0.9);letter-spacing:0.02em">${inlineStyles(line.slice(4))}</h3>`); i++; continue }
    if (/^## /.test(line))  { out.push(`<h2 style="margin:28px 0 8px;font-size:15px;font-weight:700;color:${c.accent};border-bottom:1px solid rgba(88,214,171,0.2);padding-bottom:6px">${inlineStyles(line.slice(3))}</h2>`); i++; continue }
    if (/^# /.test(line))   { out.push(`<h1 style="margin:0 0 20px;font-size:18px;font-weight:700;color:${c.accent}">${inlineStyles(line.slice(2))}</h1>`); i++; continue }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) { out.push(`<hr style="border:none;border-top:1px solid rgba(185,185,189,0.18);margin:16px 0"/>`); i++; continue }

    // Table — collect all rows
    if (/^\s*\|/.test(line)) {
      const rows: string[][] = []
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        const cells = lines[i].split('|').slice(1, -1).map(s => s.trim())
        rows.push(cells)
        i++
      }
      // Skip separator row (---|---|---)
      const header = rows[0] ?? []
      const body   = rows.slice(1).filter(r => !r.every(c => /^[-:]+$/.test(c)))
      const thStyle = `padding:6px 12px;text-align:left;font-size:11px;font-weight:600;color:${c.accent};border-bottom:1px solid rgba(88,214,171,0.25);white-space:nowrap`
      const tdStyle = `padding:5px 12px;font-size:11px;color:rgba(231,228,239,0.85);border-bottom:1px solid rgba(185,185,189,0.08)`
      const ths = header.map(h => `<th style="${thStyle}">${inlineStyles(h)}</th>`).join('')
      const trs = body.map((r, ri) =>
        `<tr style="background:${ri % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)'}">` +
        r.map(cell => `<td style="${tdStyle}">${inlineStyles(cell)}</td>`).join('') +
        '</tr>'
      ).join('')
      out.push(
        `<div style="overflow-x:auto;margin:12px 0">` +
        `<table style="border-collapse:collapse;width:100%;font-family:${c.mono}">` +
        `<thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table></div>`
      )
      continue
    }

    // Blank line
    if (line.trim() === '') { out.push('<div style="height:8px"/>'); i++; continue }

    // Paragraph
    out.push(`<p style="margin:4px 0;font-size:12px;line-height:1.65;color:rgba(231,228,239,0.82)">${inlineStyles(line)}</p>`)
    i++
  }

  return out.join('\n')
}

function MdOutput({ md, loading }: { md: string | null; loading: boolean }) {
  if (loading) return <CenteredMsg icon={<Spinner />} text="Running surya…" />
  if (!md) return <CenteredMsg icon={<FileText size={32} style={{ opacity: 0.25, color: c.textMuted }} />} text="Press Run to generate the report" />
  return (
    <Box style={{ height: '100%', overflow: 'auto' }}>
      <div
        style={{ padding: '20px 24px', fontFamily: c.mono, maxWidth: 900 }}
        // surya mdreport is trusted internal output — not user-supplied HTML
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: renderMd(md) }}
      />
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Shared small components
// ---------------------------------------------------------------------------
function Spinner() {
  return (
    <div style={{
      width: 28, height: 28, borderRadius: '50%',
      border: `2px solid ${c.border}`,
      borderTop: `2px solid ${c.accent}`,
      animation: 'spin 0.8s linear infinite',
    }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

function CenteredMsg({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <Flex align="center" justify="center" style={{ height: '100%', flexDirection: 'column', gap: 12 }}>
      <div style={{ color: c.textMuted }}>{icon}</div>
      <span style={{ fontSize: 12, color: c.textMuted, fontFamily: c.mono, fontStyle: 'italic', textAlign: 'center', maxWidth: 320 }}>
        {text}
      </span>
    </Flex>
  )
}

function RunButton({ onClick, loading, disabled }: { onClick: () => void; loading: boolean; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={loading || disabled}
      style={{
        display: 'flex', alignItems: 'center', gap: 5,
        background: 'rgba(88,214,171,0.1)', border: `1px solid rgba(88,214,171,0.3)`,
        borderRadius: 7, padding: '4px 12px', fontSize: 11, fontWeight: 600,
        color: c.accent, cursor: (loading || disabled) ? 'not-allowed' : 'pointer',
        fontFamily: c.mono, opacity: (loading || disabled) ? 0.5 : 1,
      }}
    >
      <RefreshCw size={11} style={{ animation: loading ? 'spin 0.8s linear infinite' : undefined }} />
      {loading ? 'Running…' : 'Run'}
    </button>
  )
}

function OptionToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', userSelect: 'none' }}>
      <input
        type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        style={{ accentColor: c.accent }}
      />
      <span style={{ fontSize: 11, color: c.textMuted, fontFamily: c.mono }}>{label}</span>
    </label>
  )
}

function SelectInput({ value, onChange, options, placeholder }: {
  value: string; onChange: (v: string) => void
  options: string[]; placeholder: string
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        background: 'rgba(30,30,38,0.95)', border: `1px solid ${c.borderSoft}`,
        borderRadius: 6, padding: '3px 8px', fontSize: 11, color: c.text,
        fontFamily: c.mono, cursor: 'pointer', outline: 'none',
      }}
    >
      <option value="" disabled>{placeholder}</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

// ---------------------------------------------------------------------------
// Left panel: file list with checkboxes
// ---------------------------------------------------------------------------
function LeftPanel({
  scopeContracts,
  includedScIds,
  onToggleInclude,
  onSelectAll,
  onSelectNone,
}: {
  scopeContracts: scopeApi.ScopeContract[]
  includedScIds: Set<string>
  onToggleInclude: (id: string) => void
  onSelectAll: () => void
  onSelectNone: () => void
}) {
  const allSelected  = scopeContracts.length > 0 && scopeContracts.every(sc => includedScIds.has(sc.id))
  const noneSelected = scopeContracts.every(sc => !includedScIds.has(sc.id))

  return (
    <Box style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 6 }}>
      {/* Select all / none row */}
      <Flex align="center" gap="1" style={{ paddingBottom: 6, borderBottom: `1px solid ${c.border}`, flexShrink: 0 }}>
        <span style={{ fontSize: 10, color: c.textMuted, fontFamily: c.mono, flex: 1 }}>
          {includedScIds.size}/{scopeContracts.length} selected
        </span>
        <button
          onClick={onSelectAll}
          disabled={allSelected}
          title="Select all"
          style={{
            fontSize: 11, padding: '2px 8px', borderRadius: 5, cursor: allSelected ? 'default' : 'pointer',
            background: allSelected ? 'rgba(88,214,171,0.12)' : 'rgba(88,214,171,0.06)',
            border: `1px solid ${allSelected ? 'rgba(88,214,171,0.3)' : 'rgba(88,214,171,0.15)'}`,
            color: c.accent, fontFamily: c.mono, opacity: allSelected ? 0.5 : 1,
          }}
        >
          ✓ All
        </button>
        <button
          onClick={onSelectNone}
          disabled={noneSelected}
          title="Deselect all"
          style={{
            fontSize: 11, padding: '2px 8px', borderRadius: 5, cursor: noneSelected ? 'default' : 'pointer',
            background: 'transparent', border: `1px solid ${c.border}`,
            color: c.textMuted, fontFamily: c.mono, opacity: noneSelected ? 0.4 : 1,
          }}
        >
          ✕ None
        </button>
      </Flex>

      {/* File list */}
      <Box style={{ flex: 1, overflowY: 'auto' }}>
        {scopeContracts.map(sc => {
          const fileName   = sc.file_path.split('/').pop() ?? sc.file_path
          const isIncluded = includedScIds.has(sc.id)

          return (
            <Flex
              key={sc.id}
              align="center"
              gap="1"
              onClick={() => onToggleInclude(sc.id)}
              style={{ borderRadius: 6, padding: '4px 4px', cursor: 'pointer', marginBottom: 2 }}
              className={css({ _hover: { bg: 'rgba(255,255,255,0.04)' } })}
            >
              {/* Checkbox */}
              <div style={{
                width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                border: `1.5px solid ${isIncluded ? c.accent : 'rgba(185,185,189,0.3)'}`,
                background: isIncluded ? 'rgba(88,214,171,0.15)' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.12s',
              }}>
                {isIncluded && <span style={{ fontSize: 9, color: c.accent, lineHeight: 1 }}>✓</span>}
              </div>

              <File size={11} style={{ color: '#f5a623', flexShrink: 0 }} />
              <span style={{
                fontSize: 11, color: isIncluded ? c.textSub : c.textMuted,
                fontFamily: c.mono, overflow: 'hidden', textOverflow: 'ellipsis',
                whiteSpace: 'nowrap', flex: 1,
                opacity: isIncluded ? 1 : 0.45,
              }}>
                {fileName}
              </span>
            </Flex>
          )
        })}
      </Box>
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Per-tab control bars + content
// ---------------------------------------------------------------------------

function GraphTab({ auditId, includedScIds }: { auditId: string; includedScIds: string[] }) {
  const [dot, setDot] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [simple, setSimple] = useState(false)
  const [modifiers, setModifiers] = useState(false)
  const [libraries, setLibraries] = useState(true)

  const run = useCallback(async () => {
    setLoading(true); setErr(null)
    try { setDot(await surya.getGraph(auditId, { simple, modifiers, libraries }, includedScIds)) }
    catch (e) { setErr(String((e as Error).message)) }
    setLoading(false)
  }, [auditId, simple, modifiers, libraries, includedScIds])

  return (
    <Flex direction="column" style={{ height: '100%', gap: 0 }}>
      <Flex align="center" gap="3" style={{ padding: '8px 12px', borderBottom: `1px solid ${c.border}`, flexShrink: 0, flexWrap: 'wrap' }}>
        <OptionToggle label="Simple (contract-level)" checked={simple} onChange={setSimple} />
        <OptionToggle label="Show modifiers" checked={modifiers} onChange={setModifiers} />
        <OptionToggle label="Show libraries" checked={libraries} onChange={setLibraries} />
        <RunButton onClick={run} loading={loading} />
        {err && <span style={{ fontSize: 11, color: c.orange, fontFamily: c.mono }}>{err}</span>}
      </Flex>
      <Box style={{ flex: 1, overflow: 'hidden' }}>
        <DotGraph dot={dot} loading={loading} />
      </Box>
    </Flex>
  )
}

function InheritanceTab({ auditId, includedScIds }: { auditId: string; includedScIds: string[] }) {
  const [dot, setDot] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const run = useCallback(async () => {
    setLoading(true); setErr(null)
    try { setDot(await surya.getInheritance(auditId, includedScIds)) }
    catch (e) { setErr(String((e as Error).message)) }
    setLoading(false)
  }, [auditId, includedScIds])

  return (
    <Flex direction="column" style={{ height: '100%', gap: 0 }}>
      <Flex align="center" gap="3" style={{ padding: '8px 12px', borderBottom: `1px solid ${c.border}`, flexShrink: 0 }}>
        <RunButton onClick={run} loading={loading} />
        {err && <span style={{ fontSize: 11, color: c.orange, fontFamily: c.mono }}>{err}</span>}
      </Flex>
      <Box style={{ flex: 1, overflow: 'hidden' }}>
        <DotGraph dot={dot} loading={loading} />
      </Box>
    </Flex>
  )
}

// Parse function names out of `surya describe` text output
function parseFunctionNames(describeText: string): string[] {
  const matches = [...describeText.matchAll(/^\s*-\s+\[(?:Pub|Ext|Int|Prv|Mod)\]\s+(\w+)/gm)]
  return [...new Set(matches.map(m => m[1]))]
}

function FileSelect({
  scopeContracts, includedScIds, value, onChange, placeholder,
}: {
  scopeContracts: scopeApi.ScopeContract[]
  includedScIds: string[]
  value: string
  onChange: (id: string) => void
  placeholder: string
}) {
  const options = scopeContracts
    .filter(sc => includedScIds.includes(sc.id))
    .map(sc => ({ id: sc.id, label: sc.file_path.split('/').pop() ?? sc.file_path }))

  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        background: 'rgba(30,30,38,0.95)', border: `1px solid ${c.borderSoft}`,
        borderRadius: 6, padding: '3px 8px', fontSize: 11, color: value ? c.text : c.textMuted,
        fontFamily: c.mono, cursor: 'pointer', outline: 'none',
      }}
    >
      <option value="">{placeholder}</option>
      {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
    </select>
  )
}

function FtraceTab({ auditId, scopeContracts, includedScIds }: {
  auditId: string
  scopeContracts: scopeApi.ScopeContract[]
  includedScIds: string[]
}) {
  const [fileId, setFileId]     = useState('')
  const [fn, setFn]             = useState('')
  const [functions, setFunctions] = useState<string[]>([])
  const [vis, setVis]           = useState<'all' | 'internal' | 'external'>('all')
  const [output, setOutput]     = useState<string | null>(null)
  const [loading, setLoading]   = useState(false)
  const [fnLoading, setFnLoading] = useState(false)
  const [err, setErr]           = useState<string | null>(null)

  // When a file is picked, fetch its functions via describe
  useEffect(() => {
    if (!fileId) { setFunctions([]); setFn(''); return }
    setFnLoading(true); setFn(''); setFunctions([])
    surya.getDescribe(auditId, [fileId])
      .then(text => setFunctions(parseFunctionNames(text)))
      .catch(() => setFunctions([]))
      .finally(() => setFnLoading(false))
  }, [auditId, fileId])

  const run = useCallback(async () => {
    if (!fileId || !fn) return
    setLoading(true); setErr(null)
    try { setOutput(await surya.getFtrace(auditId, fileId, fn, vis)) }
    catch (e) { setErr(String((e as Error).message)) }
    setLoading(false)
  }, [auditId, fileId, fn, vis])

  return (
    <Flex direction="column" style={{ height: '100%', gap: 0 }}>
      <Flex align="center" gap="2" style={{ padding: '8px 12px', borderBottom: `1px solid ${c.border}`, flexShrink: 0, flexWrap: 'wrap' }}>
        <FileSelect
          scopeContracts={scopeContracts} includedScIds={includedScIds}
          value={fileId} onChange={setFileId} placeholder="Contract file"
        />
        {/* Function dropdown — populated after describe */}
        <select
          value={fn}
          onChange={e => setFn(e.target.value)}
          disabled={!fileId || fnLoading}
          style={{
            background: 'rgba(30,30,38,0.95)', border: `1px solid ${c.borderSoft}`,
            borderRadius: 6, padding: '3px 8px', fontSize: 11, color: fn ? c.text : c.textMuted,
            fontFamily: c.mono, cursor: (!fileId || fnLoading) ? 'not-allowed' : 'pointer',
            outline: 'none', opacity: (!fileId || fnLoading) ? 0.5 : 1,
          }}
        >
          <option value="">{fnLoading ? 'Loading…' : 'Function'}</option>
          {functions.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <SelectInput value={vis} onChange={v => setVis(v as 'all' | 'internal' | 'external')} options={['all', 'internal', 'external']} placeholder="visibility" />
        <RunButton onClick={run} loading={loading} disabled={!fileId || !fn} />
        {err && <span style={{ fontSize: 11, color: c.orange, fontFamily: c.mono }}>{err}</span>}
      </Flex>
      <Box style={{ flex: 1, overflow: 'hidden' }}>
        <TextOutput text={output} loading={loading} placeholder="Select a contract file, pick a function, then press Run" />
      </Box>
    </Flex>
  )
}

function DescribeTab({ auditId, includedScIds }: { auditId: string; includedScIds: string[] }) {
  const [output, setOutput] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const run = useCallback(async () => {
    setLoading(true); setErr(null)
    try { setOutput(await surya.getDescribe(auditId, includedScIds)) }
    catch (e) { setErr(String((e as Error).message)) }
    setLoading(false)
  }, [auditId, includedScIds])

  return (
    <Flex direction="column" style={{ height: '100%', gap: 0 }}>
      <Flex align="center" gap="3" style={{ padding: '8px 12px', borderBottom: `1px solid ${c.border}`, flexShrink: 0 }}>
        <RunButton onClick={run} loading={loading} />
        {err && <span style={{ fontSize: 11, color: c.orange, fontFamily: c.mono }}>{err}</span>}
      </Flex>
      <Box style={{ flex: 1, overflow: 'hidden' }}>
        <TextOutput text={output} loading={loading} placeholder="Press Run to describe all contracts" />
      </Box>
    </Flex>
  )
}

function DependenciesTab({ auditId, scopeContracts, includedScIds }: {
  auditId: string
  scopeContracts: scopeApi.ScopeContract[]
  includedScIds: string[]
}) {
  const [fileId, setFileId]   = useState('')
  const [output, setOutput]   = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr]         = useState<string | null>(null)

  const run = useCallback(async () => {
    if (!fileId) return
    setLoading(true); setErr(null)
    try { setOutput(await surya.getDependencies(auditId, fileId)) }
    catch (e) { setErr(String((e as Error).message)) }
    setLoading(false)
  }, [auditId, fileId])

  return (
    <Flex direction="column" style={{ height: '100%', gap: 0 }}>
      <Flex align="center" gap="2" style={{ padding: '8px 12px', borderBottom: `1px solid ${c.border}`, flexShrink: 0, flexWrap: 'wrap' }}>
        <FileSelect
          scopeContracts={scopeContracts} includedScIds={includedScIds}
          value={fileId} onChange={setFileId} placeholder="Contract file"
        />
        <RunButton onClick={run} loading={loading} disabled={!fileId} />
        {err && <span style={{ fontSize: 11, color: c.orange, fontFamily: c.mono }}>{err}</span>}
      </Flex>
      <Box style={{ flex: 1, overflow: 'hidden' }}>
        <TextOutput text={output} loading={loading} placeholder="Select a contract file and press Run" />
      </Box>
    </Flex>
  )
}

function FlattenTab({ auditId, scopeContracts, includedScIds }: {
  auditId: string
  scopeContracts: scopeApi.ScopeContract[]
  includedScIds: string[]
}) {
  const [output, setOutput] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const singleScId = includedScIds.length === 1 ? includedScIds[0] : null
  const selectedSc = singleScId ? (scopeContracts.find(sc => sc.id === singleScId) ?? null) : null
  const fileName   = selectedSc ? (selectedSc.file_path.split('/').pop() ?? selectedSc.file_path) : null

  const run = useCallback(async () => {
    if (!singleScId) return
    setLoading(true); setErr(null)
    try { setOutput(await surya.getFlatten(auditId, singleScId)) }
    catch (e) { setErr(String((e as Error).message)) }
    setLoading(false)
  }, [auditId, singleScId])

  const hint = includedScIds.length === 0
    ? '← Select exactly one file in the left panel'
    : includedScIds.length > 1
      ? `← Select only one file (${includedScIds.length} selected)`
      : null

  return (
    <Flex direction="column" style={{ height: '100%', gap: 0 }}>
      <Flex align="center" gap="2" style={{ padding: '8px 12px', borderBottom: `1px solid ${c.border}`, flexShrink: 0, flexWrap: 'wrap' }}>
        {fileName
          ? <span style={{ fontSize: 11, fontFamily: c.mono, color: c.accent }}>{fileName}</span>
          : <span style={{ fontSize: 11, fontFamily: c.mono, color: c.textMuted }}>{hint}</span>}
        <RunButton onClick={run} loading={loading} disabled={!singleScId} />
        {err && <span style={{ fontSize: 11, color: c.orange, fontFamily: c.mono }}>{err}</span>}
      </Flex>
      <Box style={{ flex: 1, overflow: 'hidden' }}>
        <TextOutput text={output} loading={loading} placeholder="Select exactly one file in the left panel and press Run" />
      </Box>
    </Flex>
  )
}

function ParseTab({ auditId, scopeContracts, includedScIds }: {
  auditId: string
  scopeContracts: scopeApi.ScopeContract[]
  includedScIds: string[]
}) {
  const [output, setOutput] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [asJson, setAsJson] = useState(false)

  const singleScId = includedScIds.length === 1 ? includedScIds[0] : null
  const selectedSc = singleScId ? (scopeContracts.find(sc => sc.id === singleScId) ?? null) : null
  const fileName   = selectedSc ? (selectedSc.file_path.split('/').pop() ?? selectedSc.file_path) : null

  const run = useCallback(async () => {
    if (!singleScId) return
    setLoading(true); setErr(null)
    try { setOutput(await surya.getParse(auditId, singleScId, asJson)) }
    catch (e) { setErr(String((e as Error).message)) }
    setLoading(false)
  }, [auditId, singleScId, asJson])

  const hint = includedScIds.length === 0
    ? '← Select exactly one file in the left panel'
    : includedScIds.length > 1
      ? `← Select only one file (${includedScIds.length} selected)`
      : null

  return (
    <Flex direction="column" style={{ height: '100%', gap: 0 }}>
      <Flex align="center" gap="2" style={{ padding: '8px 12px', borderBottom: `1px solid ${c.border}`, flexShrink: 0, flexWrap: 'wrap' }}>
        {fileName
          ? <span style={{ fontSize: 11, fontFamily: c.mono, color: c.accent }}>{fileName}</span>
          : <span style={{ fontSize: 11, fontFamily: c.mono, color: c.textMuted }}>{hint}</span>}
        <OptionToggle label="JSON output" checked={asJson} onChange={setAsJson} />
        <RunButton onClick={run} loading={loading} disabled={!singleScId} />
        {err && <span style={{ fontSize: 11, color: c.orange, fontFamily: c.mono }}>{err}</span>}
      </Flex>
      <Box style={{ flex: 1, overflow: 'hidden' }}>
        <TextOutput text={output} loading={loading} placeholder="Select exactly one file in the left panel and press Run" />
      </Box>
    </Flex>
  )
}

function MdReportTab({ auditId, includedScIds }: { auditId: string; includedScIds: string[] }) {
  const [md, setMd] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const run = useCallback(async () => {
    setLoading(true); setErr(null)
    try { setMd(await surya.getMdReport(auditId, includedScIds)) }
    catch (e) { setErr(String((e as Error).message)) }
    setLoading(false)
  }, [auditId, includedScIds])

  return (
    <Flex direction="column" style={{ height: '100%', gap: 0 }}>
      <Flex align="center" gap="3" style={{ padding: '8px 12px', borderBottom: `1px solid ${c.border}`, flexShrink: 0 }}>
        <RunButton onClick={run} loading={loading} />
        {md && (
          <button
            onClick={() => {
              const blob = new Blob([md], { type: 'text/markdown' })
              const a = document.createElement('a')
              a.href = URL.createObjectURL(blob)
              a.download = 'surya-report.md'
              a.click()
            }}
            style={{
              fontSize: 11, color: c.textMuted, fontFamily: c.mono, cursor: 'pointer',
              background: 'none', border: `1px solid ${c.border}`, borderRadius: 6,
              padding: '3px 10px',
            }}
          >
            Download .md
          </button>
        )}
        {err && <span style={{ fontSize: 11, color: c.orange, fontFamily: c.mono }}>{err}</span>}
      </Flex>
      <Box style={{ flex: 1, overflow: 'hidden' }}>
        <MdOutput md={md} loading={loading} />
      </Box>
    </Flex>
  )
}

// ---------------------------------------------------------------------------
// Main SuryaView
// ---------------------------------------------------------------------------
export function SuryaView({ auditId }: { auditId: string }) {
  const [scopeContracts, setScopeContracts] = useState<scopeApi.ScopeContract[]>([])
  const [loading, setLoading]               = useState(true)
  const [activeTab, setActiveTab]           = useState<TabId>('graph')
  const [includedScIds, setIncludedScIds]   = useState<Set<string>>(new Set())

  useEffect(() => {
    scopeApi.listContracts(auditId, true).then(res => {
      setScopeContracts(res.items)
      setIncludedScIds(new Set(res.items.map(sc => sc.id))) // all included by default
    }).catch(() => { /* ignore */ }).finally(() => setLoading(false))
  }, [auditId])

  const includedScIdsArr = Array.from(includedScIds)

  const handleToggleInclude = (id: string) => setIncludedScIds(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  const handleSelectAll     = () => setIncludedScIds(new Set(scopeContracts.map(sc => sc.id)))
  const handleSelectNone    = () => setIncludedScIds(new Set())

  return (
    <Box style={{ minHeight: '100%' }}>
      {/* Header */}
      <Flex align="center" gap="3" mb="4" px="2">
        <span style={{ fontSize: 14, fontWeight: 700, color: c.text }}>Surya Analysis</span>
        <span style={{ fontSize: 10, color: c.textMuted, fontFamily: c.mono }}>
          {includedScIds.size}/{scopeContracts.length} files selected
        </span>
        <span style={{ fontSize: 10, color: c.textMuted, fontFamily: c.mono, marginLeft: 'auto' }}>
          powered by surya
        </span>
      </Flex>

      {loading && (
        <Box className={css({ py: '8', textAlign: 'center', color: c.textMuted, fontSize: 'sm', fontFamily: c.mono })}>
          Loading contracts…
        </Box>
      )}

      {!loading && scopeContracts.length === 0 && (
        <Box className={css({ py: '10', textAlign: 'center', borderRadius: '14px', border: `1px dashed ${c.border}`, color: c.textMuted, fontSize: 'sm' })}>
          No contracts in scope yet. Go to the Scope section first.
        </Box>
      )}

      {!loading && scopeContracts.length > 0 && (
        <Flex gap="0" style={{ height: 'calc(100vh - 280px)', minHeight: 500 }}>

          {/* Left panel */}
          <Box style={{ width: '22%', borderRight: `1px solid ${c.borderSoft}`, paddingRight: 10, flexShrink: 0 }}>
            <LeftPanel
              scopeContracts={scopeContracts}
              includedScIds={includedScIds}
              onToggleInclude={handleToggleInclude}
              onSelectAll={handleSelectAll}
              onSelectNone={handleSelectNone}
            />
          </Box>

          {/* Right panel */}
          <Box style={{ flex: 1, paddingLeft: 16, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

            {/* Tab bar */}
            <Flex gap="1" style={{ flexShrink: 0, borderBottom: `1px solid ${c.border}`, flexWrap: 'wrap' }}>
              {TABS.map(tab => {
                const isActive = activeTab === tab.id
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    title={tab.description}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 5,
                      padding: '6px 10px', fontSize: 11, fontWeight: isActive ? 600 : 400,
                      color: isActive ? c.accent : c.textMuted,
                      background: isActive ? c.accentFaint : 'transparent',
                      border: 'none',
                      borderBottom: isActive ? `2px solid ${c.accent}` : '2px solid transparent',
                      cursor: 'pointer', fontFamily: c.mono, transition: 'color 0.12s',
                    }}
                    className={css({ _hover: { color: 'rgba(231,228,239,0.9)' } })}
                  >
                    {tab.icon}{tab.label}
                  </button>
                )
              })}
            </Flex>

            {/* Tab content */}
            <Box style={{ flex: 1, overflow: 'hidden', paddingTop: 4 }}>
              {activeTab === 'graph'        && <GraphTab        auditId={auditId} includedScIds={includedScIdsArr} />}
              {activeTab === 'inheritance'  && <InheritanceTab  auditId={auditId} includedScIds={includedScIdsArr} />}
              {activeTab === 'ftrace'       && <FtraceTab       auditId={auditId} scopeContracts={scopeContracts} includedScIds={includedScIdsArr} />}
              {activeTab === 'describe'     && <DescribeTab     auditId={auditId} includedScIds={includedScIdsArr} />}
              {activeTab === 'dependencies' && <DependenciesTab auditId={auditId} scopeContracts={scopeContracts} includedScIds={includedScIdsArr} />}
              {activeTab === 'flatten'      && <FlattenTab      auditId={auditId} scopeContracts={scopeContracts} includedScIds={includedScIdsArr} />}
              {activeTab === 'parse'        && <ParseTab        auditId={auditId} scopeContracts={scopeContracts} includedScIds={includedScIdsArr} />}
              {activeTab === 'mdreport'     && <MdReportTab     auditId={auditId} includedScIds={includedScIdsArr} />}
            </Box>
          </Box>
        </Flex>
      )}
    </Box>
  )
}
