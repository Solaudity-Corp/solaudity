import { useCallback, useEffect, useRef, useState } from 'react'
import Editor, { useMonaco } from '@monaco-editor/react'
import type * as Monaco from 'monaco-editor'
import { css } from 'styled-system/css'
import { Box, Flex } from 'styled-system/jsx'
import { useSidebarResize } from '../components/useSidebarResize'
import {
  Cpu, Code2, FileCode, List, RefreshCw,
  ChevronDown, ChevronRight, ChevronLeft, AlertCircle, GitBranch,
} from 'lucide-react'
import { ProcessingOverlay } from '../components/ProcessingOverlay'
import * as scopeApi from '../scope/api'
import * as heimdall from './heimdallApi'

// ---------------------------------------------------------------------------
// Colours — consistent with SuryaView / ParseView
// ---------------------------------------------------------------------------
const c = {
  bg: '#101014',
  border: 'rgba(185, 185, 189, 0.14)',
  borderSoft: 'rgba(185, 185, 189, 0.22)',
  accent: '#58D6AB',
  accentFaint: 'rgba(88, 214, 171, 0.08)',
  accentDim: 'rgba(88, 214, 171, 0.55)',
  text: 'rgba(231, 228, 239, 0.96)',
  textSub: 'rgba(231, 228, 239, 0.72)',
  textMuted: 'rgba(185, 185, 189, 0.55)',
  mono: "'Roboto Mono', ui-monospace, monospace",
  card: 'rgba(30, 30, 38, 0.95)',
  orange: 'rgba(255, 150, 80, 0.85)',
  blue: 'rgba(100, 160, 255, 0.85)',
  purple: 'rgba(180, 140, 255, 0.85)',
}

// ---------------------------------------------------------------------------
// Solidity Monarch tokenizer (same as CodeView)
// ---------------------------------------------------------------------------
const SOLIDITY_LANG: Monaco.languages.IMonarchLanguage = {
  defaultToken: '',
  tokenPostfix: '.sol',
  keywords: [
    'pragma', 'solidity', 'contract', 'library', 'interface', 'abstract',
    'function', 'modifier', 'event', 'error', 'struct', 'enum', 'mapping',
    'constructor', 'fallback', 'receive',
    'if', 'else', 'for', 'while', 'do', 'break', 'continue', 'return', 'returns',
    'new', 'delete', 'type', 'emit', 'revert', 'require', 'assert',
    'is', 'using', 'import', 'from', 'as',
    'memory', 'storage', 'calldata',
    'public', 'private', 'internal', 'external',
    'pure', 'view', 'payable', 'nonpayable',
    'virtual', 'override', 'immutable', 'constant',
    'indexed', 'anonymous', 'unchecked', 'assembly',
    'try', 'catch', 'throw',
    'true', 'false',
    'wei', 'gwei', 'ether', 'seconds', 'minutes', 'hours', 'days', 'weeks',
  ],
  typeKeywords: [
    'address', 'bool', 'string', 'bytes',
    'int', 'int8', 'int16', 'int32', 'int64', 'int128', 'int256',
    'uint', 'uint8', 'uint16', 'uint32', 'uint64', 'uint128', 'uint256',
    'bytes1', 'bytes2', 'bytes3', 'bytes4', 'bytes8', 'bytes16', 'bytes32',
    'fixed', 'ufixed',
  ],
  operators: [
    '=', '>', '<', '!', '~', '?', ':',
    '==', '<=', '>=', '!=', '&&', '||', '++', '--',
    '+', '-', '*', '/', '&', '|', '^', '%', '<<', '>>',
    '+=', '-=', '*=', '/=', '&=', '|=', '^=',
  ],
  symbols: /[=><!~?:&|+\-*/^%]+/,
  escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,
  tokenizer: {
    root: [
      [/[a-z_$][\w$]*/, { cases: { '@typeKeywords': 'keyword.type', '@keywords': 'keyword', '@default': 'identifier' } }],
      [/[A-Z][\w$]*/, 'type.identifier'],
      { include: '@whitespace' },
      [/[{}()[\]]/, '@brackets'],
      [/[<>](?!@symbols)/, '@brackets'],
      [/@symbols/, { cases: { '@operators': 'operator', '@default': '' } }],
      [/\d*\.\d+([eE][-+]?\d+)?/, 'number.float'],
      [/0[xX][0-9a-fA-F]+/, 'number.hex'],
      [/\d+/, 'number'],
      [/[;,.]/, 'delimiter'],
      [/"([^"\\]|\\.)*$/, 'string.invalid'],
      [/"/, { token: 'string.quote', bracket: '@open', next: '@string' }],
      [/'[^\\']'/, 'string'],
      [/(')(@escapes)(')/, ['string', 'string.escape', 'string']],
      [/'/, 'string.invalid'],
    ],
    whitespace: [
      [/[ \t\r\n]+/, 'white'],
      [/\/\*/, 'comment', '@comment'],
      [/\/\/[^\n]*/, 'comment'],
    ],
    comment: [
      [/[^*]+/, 'comment'],
      [/\*\//, 'comment', '@pop'],
      [/\*/, 'comment'],
    ],
    string: [
      [/[^\\"]+/, 'string'],
      [/@escapes/, 'string.escape'],
      [/\\./, 'string.escape.invalid'],
      [/"/, { token: 'string.quote', bracket: '@close', next: '@pop' }],
    ],
  },
}

const THEME_RULES: Monaco.editor.ITokenThemeRule[] = [
  { token: 'comment',         foreground: '6a737d', fontStyle: 'italic' },
  { token: 'keyword',         foreground: 'ff7b72', fontStyle: 'bold' },
  { token: 'keyword.type',    foreground: '79c0ff' },
  { token: 'type.identifier', foreground: 'ffa657' },
  { token: 'identifier',      foreground: 'e6edf3' },
  { token: 'number',          foreground: '79c0ff' },
  { token: 'number.float',    foreground: '79c0ff' },
  { token: 'number.hex',      foreground: '79c0ff' },
  { token: 'string',          foreground: 'a5d6ff' },
  { token: 'string.quote',    foreground: 'a5d6ff' },
  { token: 'string.escape',   foreground: 'f2cc60' },
  { token: 'operator',        foreground: 'ff7b72' },
  { token: 'delimiter',       foreground: '8b949e' },
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
// CFG legend — edge colour semantics from heimdall --color-edges
// ---------------------------------------------------------------------------
const CFG_LEGEND = [
  { color: '#58d6ab', label: 'Jump (conditional true / taken)' },
  { color: '#f85149', label: 'Fallthrough (conditional false / not taken)' },
  { color: '#79c0ff', label: 'Unconditional jump' },
  { color: '#ffa657', label: 'Return / halt' },
]

function CfgLegend() {
  return (
    <Flex gap="3" style={{ flexWrap: 'wrap', padding: '6px 14px', borderBottom: `1px solid ${c.border}`, flexShrink: 0 }}>
      {CFG_LEGEND.map(({ color, label }) => (
        <Flex key={label} align="center" gap="1" style={{ userSelect: 'none' }}>
          <div style={{ width: 20, height: 3, borderRadius: 2, background: color, flexShrink: 0 }} />
          <span style={{ fontSize: 10, color: c.textMuted, fontFamily: c.mono }}>{label}</span>
        </Flex>
      ))}
    </Flex>
  )
}

// ---------------------------------------------------------------------------
// CfgDotGraph — interactive SVG with pan, zoom, and zoom controls
// ---------------------------------------------------------------------------
function CfgDotGraph({ dot, loading }: { dot: string | null; loading: boolean }) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const cursorRef  = useRef<HTMLDivElement>(null)
  const dragging   = useRef(false)
  const lastMouse  = useRef({ x: 0, y: 0 })

  const [renderErr, setRenderErr] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan,  setPan]  = useState({ x: 0, y: 0 })

  // Render SVG on dot change
  useEffect(() => {
    if (!dot || !contentRef.current) return
    let cancelled = false
    getViz().then(viz => {
      if (cancelled || !contentRef.current) return
      setRenderErr(null)
      setZoom(1); setPan({ x: 0, y: 0 })
      try {
        const svg = viz.renderSVGElement(dot)
        svg.style.display = 'block'
        svg.style.width   = 'auto'
        svg.style.height  = 'auto'
        // Tint SVG background so graph stands out on dark canvas
        svg.style.background = 'transparent'
        // Make sure all SVG text respects our font
        svg.querySelectorAll('text').forEach((t: SVGTextElement) => {
          t.style.fontFamily = c.mono
          t.style.fontSize   = '11px'
        })
        contentRef.current.innerHTML = ''
        contentRef.current.appendChild(svg)
      } catch (e) { setRenderErr(String(e)) }
    }).catch(e => { if (!cancelled) setRenderErr(String(e)) })
    return () => { cancelled = true }
  }, [dot])

  // Wheel → zoom at cursor
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
        const nz = Math.min(12, Math.max(0.05, z * factor))
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

  // Mouse drag
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
    const onUp = () => { dragging.current = false; overlay.style.cursor = 'grab' }
    overlay.addEventListener('mousedown',  onDown)
    overlay.addEventListener('mousemove',  onMove)
    overlay.addEventListener('mouseup',    onUp)
    overlay.addEventListener('mouseleave', onUp)
    return () => {
      overlay.removeEventListener('mousedown',  onDown)
      overlay.removeEventListener('mousemove',  onMove)
      overlay.removeEventListener('mouseup',    onUp)
      overlay.removeEventListener('mouseleave', onUp)
    }
  }, [dot])

  if (loading)   return <CenteredMsg icon={<Spinner />} text="Generating control flow graph…" />
  if (!dot)      return <CenteredMsg icon={<GitBranch size={32} style={{ opacity: 0.22 }} />} text="Press Generate CFG to visualise the contract's execution paths" />
  if (renderErr) return (
    <Box style={{ height: '100%', overflow: 'auto', padding: '20px 24px' }}>
      <span style={{ fontSize: 12, color: c.orange, fontFamily: c.mono, display: 'block', marginBottom: 12 }}>
        Render error: {renderErr}
      </span>
      <pre style={{ fontSize: 11, color: c.textMuted, fontFamily: c.mono, whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>
        {dot}
      </pre>
    </Box>
  )

  return (
    <Box
      ref={wrapperRef}
      style={{
        position: 'relative', width: '100%', height: '100%',
        overflow: 'hidden', background: c.bg,
        // Subtle dot-grid for a "canvas" feel
        backgroundImage: 'radial-gradient(circle, rgba(185,185,189,0.07) 1px, transparent 1px)',
        backgroundSize: '22px 22px',
      }}
    >
      {/* SVG content */}
      <div
        ref={contentRef}
        style={{
          position: 'absolute', top: 0, left: 0,
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
          pointerEvents: 'none',
          userSelect: 'none',
          filter: 'invert(0)',  // keep dark-mode colours as-is
        }}
      />

      {/* Drag overlay */}
      <div ref={cursorRef} style={{ position: 'absolute', inset: 0, zIndex: 5, cursor: 'grab' }} />

      {/* Zoom controls */}
      <Flex
        gap="1"
        style={{ position: 'absolute', top: 10, right: 12, zIndex: 10 }}
      >
        {([
          { label: '+', title: 'Zoom in',  fn: () => setZoom(z => Math.min(12, z * 1.25)) },
          { label: '−', title: 'Zoom out', fn: () => setZoom(z => Math.max(0.05, z / 1.25)) },
          { label: '↺', title: 'Reset',    fn: () => { setZoom(1); setPan({ x: 0, y: 0 }) } },
        ] as const).map(btn => (
          <button
            key={btn.label}
            title={btn.title}
            onClick={btn.fn}
            style={{
              width: 26, height: 26, borderRadius: 6,
              fontSize: 13, fontWeight: 700,
              background: 'rgba(16,16,20,0.88)',
              border: `1px solid ${c.borderSoft}`,
              color: c.textSub, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              backdropFilter: 'blur(4px)',
            }}
          >
            {btn.label}
          </button>
        ))}
        <span style={{
          fontSize: 10, color: c.textMuted, fontFamily: c.mono,
          alignSelf: 'center', marginLeft: 4,
          background: 'rgba(16,16,20,0.7)', padding: '2px 5px',
          borderRadius: 4, backdropFilter: 'blur(4px)',
        }}>
          {Math.round(zoom * 100)}%
        </span>
      </Flex>

      {/* Hint */}
      <Box style={{
        position: 'absolute', bottom: 10, left: '50%',
        transform: 'translateX(-50%)',
        fontSize: 10, color: c.textMuted, fontFamily: c.mono,
        background: 'rgba(16,16,20,0.7)', padding: '3px 10px',
        borderRadius: 6, zIndex: 10, backdropFilter: 'blur(4px)',
        pointerEvents: 'none', whiteSpace: 'nowrap',
      }}>
        scroll to zoom · drag to pan
      </Box>
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------
type TabId = 'decompile' | 'cfg' | 'disassemble'

const TABS: Array<{ id: TabId; label: string; icon: React.ReactNode; description: string }> = [
  { id: 'decompile',   label: 'Decompile',   icon: <Code2 size={12} />,      description: 'Reverse EVM bytecode into pseudo-Solidity + ABI' },
  { id: 'cfg',         label: 'CFG',         icon: <GitBranch size={12} />,  description: 'Control flow graph — visualise execution paths' },
  { id: 'disassemble', label: 'Disassemble', icon: <List size={12} />,       description: 'Disassemble bytecode into EVM opcodes' },
]

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
function Spinner() {
  return (
    <div style={{
      width: 26, height: 26, borderRadius: '50%',
      border: `2px solid ${c.border}`,
      borderTop: `2px solid ${c.accent}`,
      animation: 'rv-spin 0.8s linear infinite',
      flexShrink: 0,
    }}>
      <style>{`@keyframes rv-spin { to { transform: rotate(360deg) } }`}</style>
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

function SectionDivider({ label }: { label: string }) {
  return (
    <Flex align="center" gap="2" style={{ flexShrink: 0, padding: '10px 0 6px' }}>
      <span style={{
        fontSize: 9, fontWeight: 700, color: c.accentDim, fontFamily: c.mono,
        letterSpacing: '0.16em', textTransform: 'uppercase', whiteSpace: 'nowrap',
      }}>
        {label}
      </span>
      <div style={{ flex: 1, height: 1, background: c.border }} />
    </Flex>
  )
}

// ---------------------------------------------------------------------------
// Bytecode display — collapsible, formatted in groups of 2 chars
// ---------------------------------------------------------------------------
function BytecodePanel({ bytecode }: { bytecode: string }) {
  const [expanded, setExpanded] = useState(false)

  const trimmed = bytecode.startsWith('0x') ? bytecode.slice(2) : bytecode
  const preview = trimmed.slice(0, 128)
  const displayed = expanded ? trimmed : preview
  const groups = displayed.match(/.{1,2}/g) ?? []

  return (
    <Box style={{
      borderRadius: 8,
      border: `1px solid ${c.border}`,
      background: 'rgba(14, 14, 18, 0.9)',
      padding: '10px 14px',
      position: 'relative',
    }}>
      <Flex align="center" gap="2" style={{ marginBottom: 8 }}>
        <span style={{ fontSize: 9, color: c.textMuted, fontFamily: c.mono, letterSpacing: '0.08em' }}>
          0x
        </span>
        <span style={{ fontSize: 10, color: c.textMuted, fontFamily: c.mono, marginLeft: 'auto' }}>
          {trimmed.length / 2} bytes
        </span>
      </Flex>
      <Box style={{
        fontFamily: c.mono,
        fontSize: 11,
        lineHeight: 1.8,
        color: 'rgba(100, 200, 255, 0.75)',
        wordBreak: 'break-all',
        letterSpacing: '0.04em',
      }}>
        {groups.map((byte, i) => (
          <span
            key={i}
            style={{
              display: 'inline-block',
              marginRight: 3,
              padding: '1px 2px',
              borderRadius: 2,
              background: i % 2 === 0 ? 'rgba(88, 214, 171, 0.04)' : 'transparent',
            }}
          >
            {byte}
          </span>
        ))}
        {!expanded && trimmed.length > 128 && (
          <span style={{ color: c.textMuted }}> …</span>
        )}
      </Box>
      {trimmed.length > 128 && (
        <button
          onClick={() => setExpanded(e => !e)}
          style={{
            marginTop: 8, display: 'flex', alignItems: 'center', gap: 4,
            background: 'none', border: 'none', padding: 0,
            cursor: 'pointer', color: c.accentDim, fontSize: 10, fontFamily: c.mono,
          }}
        >
          {expanded
            ? <><ChevronRight size={10} /> show less</>
            : <><ChevronDown size={10} /> show all ({trimmed.length / 2} bytes)</>
          }
        </button>
      )}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// ABI JSON display
// ---------------------------------------------------------------------------
function AbiPanel({ abi }: { abi: object[] }) {
  const [expanded, setExpanded] = useState(false)
  const preview = abi.slice(0, 3)
  const shown = expanded ? abi : preview

  return (
    <Box style={{ borderRadius: 8, border: `1px solid ${c.border}`, background: 'rgba(14, 14, 18, 0.9)', overflow: 'hidden' }}>
      <Box style={{ overflow: 'auto', maxHeight: expanded ? 400 : 160, transition: 'max-height 0.2s ease' }}>
        <pre style={{
          margin: 0, padding: '12px 14px',
          fontFamily: c.mono, fontSize: 11, lineHeight: 1.65,
          color: 'rgba(165, 214, 255, 0.85)',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          {JSON.stringify(shown, null, 2)}
          {!expanded && abi.length > 3 && (
            `\n  // … and ${abi.length - 3} more entries`
          )}
        </pre>
      </Box>
      {abi.length > 3 && (
        <button
          onClick={() => setExpanded(e => !e)}
          style={{
            width: '100%', padding: '6px 14px',
            borderTop: `1px solid ${c.border}`,
            background: 'rgba(20, 20, 26, 0.8)', border: 'none',
            display: 'flex', alignItems: 'center', gap: 4,
            cursor: 'pointer', color: c.accentDim, fontSize: 10, fontFamily: c.mono,
          }}
        >
          {expanded
            ? <><ChevronRight size={10} /> show less</>
            : <><ChevronDown size={10} /> show all {abi.length} entries</>
          }
        </button>
      )}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Decompile tab
// ---------------------------------------------------------------------------
interface DecompileTabProps {
  address: scopeApi.ScopeAddress | null
  onDecompile: () => Promise<void>
  loading: boolean
  error: string | null
  result: heimdall.DecompileResult | null
}

function DecompileTab({ address, onDecompile, loading, error, result }: DecompileTabProps) {
  const monaco = useMonaco()

  // Register Solidity language + theme; always re-apply tokenizer for hot-reload correctness
  useEffect(() => {
    if (!monaco) return
    if (!monaco.languages.getLanguages().find((l) => l.id === 'solidity')) {
      monaco.languages.register({ id: 'solidity', extensions: ['.sol'], mimetypes: ['text/x-solidity'] })
    }
    monaco.languages.setMonarchTokensProvider('solidity', SOLIDITY_LANG)
    monaco.editor.defineTheme('solaudity-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: THEME_RULES,
      colors: {
        'editor.background': '#0a0a0e',
        'editor.foreground': '#e6edf3',
        'editorLineNumber.foreground': '#3d444d',
        'editorLineNumber.activeForeground': '#636e7b',
        'editor.selectionBackground': '#264f78',
        'editor.lineHighlightBackground': '#111118',
        'editorCursor.foreground': '#58d6ab',
        'scrollbarSlider.background': '#30363d',
        'scrollbarSlider.hoverBackground': '#484f58',
        'editorWidget.background': '#161b22',
        'editorWidget.border': '#30363d',
        'editorGutter.background': '#0a0a0e',
        'minimap.background': '#0a0a0e',
      },
    })
    monaco.editor.setTheme('solaudity-dark')
  }, [monaco])

  // No address selected
  if (!address) {
    return (
      <CenteredMsg
        icon={<Cpu size={36} style={{ opacity: 0.2 }} />}
        text="Select an on-chain address from the left panel to begin reverse engineering"
      />
    )
  }

  // No bytecode
  if (!address.bytecode) {
    return (
      <CenteredMsg
        icon={<AlertCircle size={36} style={{ opacity: 0.2, color: c.orange }} />}
        text="No bytecode found for this address. Make sure it is a verified contract."
      />
    )
  }

  // Decompile action bar
  const solLineCount = result?.pseudo_code
    ? result.pseudo_code.split('\n').length
    : 0

  return (
    <Flex direction="column" style={{ height: '100%', gap: 0, overflow: 'hidden' }}>

      {/* ── Action bar ── */}
      <Flex align="center" gap="3" style={{
        padding: '8px 14px',
        borderBottom: `1px solid ${c.border}`,
        flexShrink: 0,
        background: 'rgba(18, 18, 22, 0.8)',
      }}>
        <button
          onClick={onDecompile}
          disabled={loading}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: loading ? 'rgba(88,214,171,0.06)' : 'rgba(88,214,171,0.12)',
            border: `1px solid rgba(88,214,171,${loading ? '0.2' : '0.4'})`,
            borderRadius: 7, padding: '5px 14px',
            fontSize: 11, fontWeight: 700,
            color: loading ? c.accentDim : c.accent,
            cursor: loading ? 'not-allowed' : 'pointer',
            fontFamily: c.mono, transition: 'all 0.15s ease',
            boxShadow: loading ? 'none' : '0 0 12px rgba(88,214,171,0.1)',
          }}
        >
          <RefreshCw size={11} style={{ animation: loading ? 'rv-spin 0.8s linear infinite' : undefined }} />
          {loading ? 'Decompiling…' : result ? 'Re-decompile' : 'Decompile'}
        </button>

        {result && !loading && (
          <>
            <span style={{ fontSize: 10, color: c.textMuted, fontFamily: c.mono }}>
              {solLineCount} lines of pseudo-Solidity
            </span>
            {result.abi && (
              <span style={{ fontSize: 10, color: c.textMuted, fontFamily: c.mono }}>
                · {result.abi.length} ABI entries
              </span>
            )}
          </>
        )}

        {error && (
          <span style={{ fontSize: 11, color: c.orange, fontFamily: c.mono, marginLeft: 4 }}>
            {error}
          </span>
        )}

        <span style={{ marginLeft: 'auto', fontSize: 10, color: c.textMuted, fontFamily: c.mono }}>
          powered by heimdall
        </span>
      </Flex>

      {/* ── Scrollable results ── */}
      <Box style={{ flex: 1, overflow: 'auto', padding: '0 14px 20px' }}>

        {/* ── Bytecode section ── */}
        <SectionDivider label="Bytecode" />
        <BytecodePanel bytecode={address.bytecode} />

        {/* ── Decompiled Solidity section ── */}
        <SectionDivider label="Decompiled Solidity" />
        {!result && !loading && (
          <Box style={{
            borderRadius: 8, border: `1px dashed ${c.border}`,
            padding: '32px 16px', textAlign: 'center',
          }}>
            <span style={{ fontSize: 12, color: c.textMuted, fontFamily: c.mono, fontStyle: 'italic' }}>
              Click Decompile to generate pseudo-Solidity code
            </span>
          </Box>
        )}
        {result && !loading && (
          <Box style={{
            borderRadius: 8, border: `1px solid ${c.border}`,
            overflow: 'hidden',
            background: '#0a0a0e',
          }}>
            {result.pseudo_code ? (
              <Editor
                height={Math.min(Math.max(solLineCount * 19, 200), 600)}
                language="solidity"
                value={result.pseudo_code}
                theme="solaudity-dark"
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  fontFamily: "'Roboto Mono', 'JetBrains Mono', monospace",
                  fontSize: 12,
                  lineHeight: 19,
                  padding: { top: 12, bottom: 12 },
                  renderLineHighlight: 'none',
                  overviewRulerBorder: false,
                  hideCursorInOverviewRuler: true,
                  scrollbar: {
                    verticalScrollbarSize: 6,
                    horizontalScrollbarSize: 6,
                  },
                }}
              />
            ) : (
              <Box style={{ padding: '20px 16px', textAlign: 'center' }}>
                <span style={{ fontSize: 12, color: c.textMuted, fontFamily: c.mono, fontStyle: 'italic' }}>
                  No pseudo-Solidity output — bytecode may be too minimal or obfuscated
                </span>
              </Box>
            )}
          </Box>
        )}

        {/* ── ABI section ── */}
        {result?.abi && result.abi.length > 0 && (
          <>
            <SectionDivider label="Reconstructed ABI" />
            <AbiPanel abi={result.abi} />
          </>
        )}
        {result && !result.abi && !loading && (
          <>
            <SectionDivider label="Reconstructed ABI" />
            <Box style={{
              borderRadius: 8, border: `1px dashed ${c.border}`,
              padding: '14px 16px', textAlign: 'center',
            }}>
              <span style={{ fontSize: 11, color: c.textMuted, fontFamily: c.mono, fontStyle: 'italic' }}>
                ABI could not be reconstructed for this bytecode
              </span>
            </Box>
          </>
        )}
      </Box>
    </Flex>
  )
}

// ---------------------------------------------------------------------------
// CFG tab
// ---------------------------------------------------------------------------
interface CfgTabProps {
  address: scopeApi.ScopeAddress | null
}

function CfgTab({ address }: CfgTabProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [dot, setDot]         = useState<string | null>(null)
  const [nodeCount, setNodeCount] = useState<number | null>(null)

  const run = useCallback(async () => {
    if (!address) return
    setLoading(true); setError(null)
    try {
      const res = await heimdall.getCfg(address.id)
      setDot(res.cfg_dot)
      // Count nodes from DOT source for the info line
      if (res.cfg_dot) {
        const matches = res.cfg_dot.match(/\[label=/g)
        setNodeCount(matches ? matches.length : null)
      }
    } catch (e) {
      setError((e as Error).message)
    }
    setLoading(false)
  }, [address])

  if (!address) {
    return <CenteredMsg icon={<GitBranch size={36} style={{ opacity: 0.2 }} />} text="Select an address to generate its control flow graph" />
  }

  if (!address.bytecode) {
    return <CenteredMsg icon={<AlertCircle size={36} style={{ opacity: 0.2, color: c.orange }} />} text="No bytecode found for this address" />
  }

  return (
    <Flex direction="column" style={{ height: '100%', gap: 0, overflow: 'hidden' }}>

      {/* Action bar */}
      <Flex align="center" gap="3" style={{
        padding: '8px 14px',
        borderBottom: `1px solid ${c.border}`,
        flexShrink: 0,
        background: 'rgba(18,18,22,0.8)',
      }}>
        <button
          onClick={run}
          disabled={loading}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: loading ? 'rgba(88,214,171,0.06)' : 'rgba(88,214,171,0.12)',
            border: `1px solid rgba(88,214,171,${loading ? '0.2' : '0.4'})`,
            borderRadius: 7, padding: '5px 14px',
            fontSize: 11, fontWeight: 700,
            color: loading ? c.accentDim : c.accent,
            cursor: loading ? 'not-allowed' : 'pointer',
            fontFamily: c.mono, transition: 'all 0.15s ease',
            boxShadow: loading ? 'none' : '0 0 12px rgba(88,214,171,0.1)',
          }}
        >
          <RefreshCw size={11} style={{ animation: loading ? 'rv-spin 0.8s linear infinite' : undefined }} />
          {loading ? 'Generating…' : dot ? 'Regenerate CFG' : 'Generate CFG'}
        </button>

        {dot && !loading && nodeCount !== null && (
          <span style={{ fontSize: 10, color: c.textMuted, fontFamily: c.mono }}>
            {nodeCount} basic blocks
          </span>
        )}

        {error && (
          <span style={{ fontSize: 11, color: c.orange, fontFamily: c.mono, marginLeft: 4 }}>
            {error}
          </span>
        )}

        <span style={{ marginLeft: 'auto', fontSize: 10, color: c.textMuted, fontFamily: c.mono }}>
          powered by heimdall · --color-edges
        </span>
      </Flex>

      {/* Legend */}
      <CfgLegend />

      {/* Graph canvas */}
      <Box style={{ flex: 1, overflow: 'hidden' }}>
        <CfgDotGraph dot={dot} loading={loading} />
      </Box>
    </Flex>
  )
}

// ---------------------------------------------------------------------------
// Disassemble tab
// ---------------------------------------------------------------------------
interface DisassembleTabProps {
  address: scopeApi.ScopeAddress | null
}

function DisassembleTab({ address }: DisassembleTabProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [opcodes, setOpcodes] = useState<string | null>(null)

  const run = useCallback(async () => {
    if (!address) return
    setLoading(true); setError(null)
    try {
      const res = await heimdall.disassemble(address.id)
      setOpcodes(res.opcodes)
    } catch (e) {
      setError((e as Error).message)
    }
    setLoading(false)
  }, [address])

  if (!address) {
    return <CenteredMsg icon={<List size={36} style={{ opacity: 0.2 }} />} text="Select an address to disassemble" />
  }

  if (!address.bytecode) {
    return <CenteredMsg icon={<AlertCircle size={36} style={{ opacity: 0.2, color: c.orange }} />} text="No bytecode found for this address" />
  }

  return (
    <Flex direction="column" style={{ height: '100%', gap: 0, overflow: 'hidden' }}>
      <Flex align="center" gap="3" style={{ padding: '8px 14px', borderBottom: `1px solid ${c.border}`, flexShrink: 0, background: 'rgba(18,18,22,0.8)' }}>
        <button
          onClick={run}
          disabled={loading}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: loading ? 'rgba(88,214,171,0.06)' : 'rgba(88,214,171,0.12)',
            border: `1px solid rgba(88,214,171,${loading ? '0.2' : '0.4'})`,
            borderRadius: 7, padding: '5px 14px', fontSize: 11, fontWeight: 700,
            color: loading ? c.accentDim : c.accent,
            cursor: loading ? 'not-allowed' : 'pointer', fontFamily: c.mono,
          }}
        >
          <RefreshCw size={11} style={{ animation: loading ? 'rv-spin 0.8s linear infinite' : undefined }} />
          {loading ? 'Running…' : 'Disassemble'}
        </button>
        {error && <span style={{ fontSize: 11, color: c.orange, fontFamily: c.mono }}>{error}</span>}
        <span style={{ marginLeft: 'auto', fontSize: 10, color: c.textMuted, fontFamily: c.mono }}>powered by heimdall</span>
      </Flex>

      <Box style={{ flex: 1, overflow: 'auto' }}>
        {loading && (
          <Flex align="center" justify="center" style={{ height: '100%' }}>
            <Spinner />
          </Flex>
        )}
        {!loading && !opcodes && (
          <CenteredMsg icon={<FileCode size={32} style={{ opacity: 0.2 }} />} text="Press Disassemble to view EVM opcodes" />
        )}
        {!loading && opcodes && (
          <pre style={{
            margin: 0, padding: '14px 18px',
            fontFamily: c.mono, fontSize: 11.5, lineHeight: 1.7,
            color: 'rgba(231, 228, 239, 0.85)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>
            {opcodes}
          </pre>
        )}
      </Box>
    </Flex>
  )
}

// ---------------------------------------------------------------------------
// Left panel — on-chain address list
// ---------------------------------------------------------------------------
interface AddressPanelProps {
  addresses: scopeApi.ScopeAddress[]
  selectedId: string | null
  onSelect: (a: scopeApi.ScopeAddress) => void
}

function truncateAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function AddressPanel({ addresses, selectedId, onSelect }: AddressPanelProps) {
  const withBytecode    = addresses.filter(a => a.bytecode)
  const withoutBytecode = addresses.filter(a => !a.bytecode)

  const renderItem = (a: scopeApi.ScopeAddress, dim: boolean) => {
    const isSelected = a.id === selectedId
    return (
      <Box
        key={a.id}
        onClick={() => !dim && onSelect(a)}
        style={{
          padding: '7px 10px',
          borderRadius: 6,
          cursor: dim ? 'not-allowed' : 'pointer',
          background: isSelected ? 'rgba(88,214,171,0.08)' : 'transparent',
          border: isSelected ? `1px solid rgba(88,214,171,0.22)` : '1px solid transparent',
          opacity: dim ? 0.38 : 1,
          transition: 'background 0.12s, border 0.12s',
          userSelect: 'none',
        }}
        className={!dim ? css({ _hover: { background: 'rgba(255,255,255,0.04)' } }) : undefined}
      >
        <Flex align="center" gap="2">
          <Cpu size={12} style={{ color: isSelected ? c.accent : c.textMuted, flexShrink: 0 }} />
          <Box style={{ flex: 1, overflow: 'hidden' }}>
            <Box style={{
              fontSize: 11, fontWeight: isSelected ? 600 : 400,
              color: isSelected ? c.accent : c.text,
              fontFamily: c.mono,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {a.label || truncateAddr(a.address)}
            </Box>
            <Box style={{ fontSize: 10, color: c.textMuted, fontFamily: c.mono }}>
              {truncateAddr(a.address)}
            </Box>
          </Box>
          {a.bytecode && (
            <Box style={{
              fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 4,
              background: 'rgba(88,214,171,0.08)', color: c.accentDim,
              fontFamily: c.mono, flexShrink: 0,
            }}>
              bytecode
            </Box>
          )}
        </Flex>
      </Box>
    )
  }

  if (addresses.length === 0) {
    return (
      <Box style={{ padding: '16px 8px', textAlign: 'center' }}>
        <span style={{ fontSize: 11, color: c.textMuted, fontFamily: c.mono, fontStyle: 'italic' }}>
          No on-chain addresses in scope
        </span>
      </Box>
    )
  }

  return (
    <Box style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 2 }}>
      {/* Header */}
      <Flex align="center" style={{ paddingBottom: 6, borderBottom: `1px solid ${c.border}`, flexShrink: 0, marginBottom: 4 }}>
        <span style={{ fontSize: 10, color: c.textMuted, fontFamily: c.mono }}>
          {withBytecode.length} / {addresses.length} with bytecode
        </span>
      </Flex>

      {/* Scrollable list */}
      <Box style={{ flex: 1, overflow: 'auto' }}>
        {withBytecode.map(a => renderItem(a, false))}
        {withoutBytecode.length > 0 && (
          <>
            <Box style={{ height: 1, background: c.border, margin: '8px 0' }} />
            <Box style={{ fontSize: 9, color: c.textMuted, fontFamily: c.mono, padding: '2px 10px 4px', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              No bytecode
            </Box>
            {withoutBytecode.map(a => renderItem(a, true))}
          </>
        )}
      </Box>
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Main ReverseView
// ---------------------------------------------------------------------------
export function ReverseView({ auditId }: { auditId: string }) {
  const [addresses, setAddresses]         = useState<scopeApi.ScopeAddress[]>([])
  const [loadingList, setLoadingList]     = useState(true)
  const [selected, setSelected]           = useState<scopeApi.ScopeAddress | null>(null)
  const [activeTab, setActiveTab]         = useState<TabId>('decompile')

  // Decompile state
  const [decompiling, setDecompiling]         = useState(false)
  const [decompileResult, setDecompileResult] = useState<heimdall.DecompileResult | null>(null)
  const [decompileError, setDecompileError]   = useState<string | null>(null)
  const { effectiveWidth, sidebarOpen, setSidebarOpen, isResizing, handleResizerMouseDown } = useSidebarResize({ defaultWidth: 240 })

  // Load on-chain addresses
  useEffect(() => {
    let active = true
    scopeApi.listAddresses(auditId)
      .then(res => { if (active) setAddresses(res.items) })
      .catch(() => { if (active) setAddresses([]) })
      .finally(() => { if (active) setLoadingList(false) })
    return () => { active = false }
  }, [auditId])

  const handleSelectAddress = useCallback((a: scopeApi.ScopeAddress) => {
    setSelected(a)
    setDecompileError(null)
    // If already decompiled, show the stored result immediately
    if (a.decompiled_sol) {
      setDecompileResult({ pseudo_code: a.decompiled_sol, abi: a.abi_json ?? null })
    } else {
      setDecompileResult(null)
    }
  }, [])

  const handleDecompile = useCallback(async () => {
    if (!selected) return
    setDecompiling(true)
    setDecompileError(null)
    // Enforce minimum overlay display time for the animation
    const minDelay = new Promise(r => setTimeout(r, 1800))
    try {
      const [result] = await Promise.all([heimdall.decompile(selected.id), minDelay])
      setDecompileResult(result)
      // Persist decompiled content into the in-memory address list and selected
      // so coming back to this address shows the result without re-running heimdall
      const patch = { decompiled_sol: result.pseudo_code, abi_json: result.abi }
      setAddresses(prev => prev.map(a => a.id === selected.id ? { ...a, ...patch } : a))
      setSelected(prev => prev ? { ...prev, ...patch } : prev)
    } catch (e) {
      setDecompileError((e as Error).message)
    }
    setDecompiling(false)
  }, [selected])

  return (
    <Box style={{ minHeight: '100%' }}>
      {/* Processing overlay — shown during decompilation */}
      {decompiling && <ProcessingOverlay />}

      {/* Header */}
      <Flex align="center" gap="3" mb="4" px="2">
        <span style={{ fontSize: 14, fontWeight: 700, color: c.text }}>Reverse Engineering</span>
        <span style={{ fontSize: 10, color: c.textMuted, fontFamily: c.mono }}>
          EVM bytecode analysis
        </span>
        <span style={{ fontSize: 10, color: c.textMuted, fontFamily: c.mono, marginLeft: 'auto' }}>
          powered by heimdall
        </span>
      </Flex>

      {loadingList && (
        <Box className={css({ py: '8', textAlign: 'center', color: c.textMuted, fontSize: 'sm', fontFamily: c.mono })}>
          Loading addresses…
        </Box>
      )}

      {!loadingList && addresses.length === 0 && (
        <Box className={css({
          py: '10', textAlign: 'center', borderRadius: '14px',
          border: `1px dashed ${c.border}`, color: c.textMuted, fontSize: 'sm',
        })}>
          No on-chain addresses in scope. Add contract addresses in the Scope section.
        </Box>
      )}

      {!loadingList && addresses.length > 0 && (
        <Flex gap="0" style={{
          height: 'calc(100vh - 280px)', minHeight: 500,
          cursor: isResizing ? 'col-resize' : undefined,
          userSelect: isResizing ? 'none' : undefined,
        }}>

          {/* ── Left panel ── */}
          <Box style={{
            width: sidebarOpen ? effectiveWidth : 32,
            borderRight: `1px solid ${c.borderSoft}`,
            flexShrink: 0,
            overflow: 'hidden',
            transition: isResizing ? 'none' : 'width 0.2s ease',
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
          }}>
            {/* Collapse header */}
            <Flex align="center" justify={sidebarOpen ? 'space-between' : 'center'} style={{
              padding: sidebarOpen ? '6px 8px 4px' : '6px 0 4px',
              borderBottom: `1px solid ${c.borderSoft}`,
              flexShrink: 0,
            }}>
              {sidebarOpen && (
                <span style={{ fontSize: 10, fontFamily: c.mono, color: c.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  Addresses
                </span>
              )}
              <button
                onClick={() => setSidebarOpen(o => !o)}
                title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 20, height: 20, borderRadius: 4, border: 'none',
                  background: 'transparent', cursor: 'pointer', color: c.textMuted, flexShrink: 0,
                }}
              >
                {sidebarOpen ? <ChevronLeft size={13} /> : <ChevronRight size={13} />}
              </button>
            </Flex>

            {sidebarOpen && (
              <Box style={{ flex: 1, overflowY: 'auto', paddingRight: 10, paddingTop: 4 }}>
                <AddressPanel
                  addresses={addresses}
                  selectedId={selected?.id ?? null}
                  onSelect={handleSelectAddress}
                />
              </Box>
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
          </Box>

          {/* ── Right panel ── */}
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
              {activeTab === 'decompile' && (
                <DecompileTab
                  address={selected}
                  onDecompile={handleDecompile}
                  loading={decompiling}
                  error={decompileError}
                  result={decompileResult}
                />
              )}
              {activeTab === 'cfg' && (
                <CfgTab key={selected?.id ?? 'none'} address={selected} />
              )}
              {activeTab === 'disassemble' && (
                <DisassembleTab key={selected?.id ?? 'none'} address={selected} />
              )}
            </Box>
          </Box>
        </Flex>
      )}
    </Box>
  )
}
