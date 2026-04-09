import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Editor, { useMonaco } from '@monaco-editor/react'
import type * as Monaco from 'monaco-editor'
import { css } from 'styled-system/css'
import { Box, Flex } from 'styled-system/jsx'
import {
  ChevronRight, ChevronDown, ChevronLeft,
  File, Folder, FolderOpen,
  Loader, Sparkles, FileText, Copy, Check,
  Cpu, ArrowRight,
} from 'lucide-react'
import { listContracts, getContractContent, generateDoc, listDocsForContract, listDocsForAddress } from './codeApi'
import type { ScopeContractRead, AiDocRecord } from './codeApi'
import { listAddresses } from '../scope/api'
import type { ScopeAddress } from '../scope/api'

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------
const c = {
  bg: '#101014',
  panel: '#14141a',
  sidebar: '#0f0f13',
  border: 'rgba(185,185,189,0.12)',
  text: 'rgba(231,228,239,0.91)',
  muted: 'rgba(185,185,193,0.55)',
  accent: '#58d6ab',
  accentDim: 'rgba(88,214,171,0.12)',
  accentBorder: 'rgba(88,214,171,0.28)',
  active: 'rgba(255,255,255,0.07)',
  mono: '"JetBrains Mono","Roboto Mono",monospace',
}

// ---------------------------------------------------------------------------
// Solidity Monarch tokenizer (same as CodeView)
// ---------------------------------------------------------------------------
const SOLIDITY_LANG: Monaco.languages.IMonarchLanguage = {
  defaultToken: '',
  tokenPostfix: '.sol',
  keywords: [
    'pragma','solidity','contract','library','interface','abstract',
    'function','modifier','event','error','struct','enum','mapping',
    'constructor','fallback','receive',
    'if','else','for','while','do','break','continue','return','returns',
    'new','delete','type','emit','revert','require','assert',
    'is','using','import','from','as',
    'memory','storage','calldata',
    'public','private','internal','external',
    'pure','view','payable','nonpayable',
    'virtual','override','immutable','constant',
    'indexed','anonymous','unchecked','assembly',
    'try','catch','throw','true','false',
    'wei','gwei','ether','seconds','minutes','hours','days','weeks',
  ],
  typeKeywords: [
    'address','bool','string','bytes',
    'int','int8','int16','int32','int64','int128','int256',
    'uint','uint8','uint16','uint32','uint64','uint128','uint256',
    'bytes1','bytes2','bytes3','bytes4','bytes8','bytes16','bytes32',
    'fixed','ufixed',
  ],
  operators: ['=','>','<','!','~','?',':','==','<=','>=','!=','&&','||','++','--','+','-','*','/','&','|','^','%','<<','>>','+=','-=','*=','/=','&=','|=','^='],
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
  { token: 'comment', foreground: '6a737d', fontStyle: 'italic' },
  { token: 'keyword', foreground: 'ff7b72', fontStyle: 'bold' },
  { token: 'keyword.type', foreground: '79c0ff' },
  { token: 'type.identifier', foreground: 'ffa657' },
  { token: 'identifier', foreground: 'e6edf3' },
  { token: 'number', foreground: '79c0ff' },
  { token: 'number.float', foreground: '79c0ff' },
  { token: 'number.hex', foreground: '79c0ff' },
  { token: 'string', foreground: 'a5d6ff' },
  { token: 'string.quote', foreground: 'a5d6ff' },
  { token: 'string.escape', foreground: 'f2cc60' },
  { token: 'operator', foreground: 'ff7b72' },
  { token: 'delimiter', foreground: '8b949e' },
]

// ---------------------------------------------------------------------------
// File tree (same pattern as CodeView)
// ---------------------------------------------------------------------------
interface TreeNode {
  type: 'dir' | 'file'
  name: string
  path: string
  children?: TreeNode[]
  contract?: ScopeContractRead
}

function buildTree(contracts: ScopeContractRead[]): TreeNode[] {
  const root: TreeNode = { type: 'dir', name: '', path: '', children: [] }
  for (const sc of contracts) {
    const parts = sc.file_path.replace(/^\//, '').split('/')
    let node = root
    for (let i = 0; i < parts.length - 1; i++) {
      const name = parts[i]
      let child = node.children!.find((n) => n.type === 'dir' && n.name === name)
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

interface TreeItemProps {
  node: TreeNode
  depth: number
  selectedId: string | null
  onSelect: (sc: ScopeContractRead) => void
}

function TreeItem({ node, depth, selectedId, onSelect }: TreeItemProps) {
  const [open, setOpen] = useState(true)
  const isSelected = node.contract?.id === selectedId

  if (node.type === 'file') {
    return (
      <Flex align="center" gap="1"
        onClick={() => node.contract && onSelect(node.contract)}
        style={{
          paddingLeft: `${8 + depth * 14}px`, paddingTop: 4, paddingBottom: 4, paddingRight: 8,
          cursor: 'pointer', borderRadius: 4,
          background: isSelected ? c.active : 'transparent',
          fontSize: 12, fontFamily: c.mono, userSelect: 'none',
        }}
        className={css({ _hover: { background: 'rgba(255,255,255,0.05)' } })}
      >
        <File size={13} style={{ color: c.muted, flexShrink: 0 }} />
        <span style={{
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginLeft: 2,
          color: isSelected ? c.accent : 'rgba(185,185,193,0.8)',
          fontWeight: isSelected ? 500 : 400,
        }}>
          {node.name}
        </span>
      </Flex>
    )
  }

  return (
    <Box>
      <Flex align="center" gap="1" onClick={() => setOpen((o) => !o)}
        style={{
          paddingLeft: `${6 + depth * 14}px`, paddingTop: 4, paddingBottom: 4, paddingRight: 8,
          cursor: 'pointer', fontSize: 12, fontFamily: c.mono, userSelect: 'none', fontWeight: 600,
        }}
        className={css({ _hover: { background: 'rgba(255,255,255,0.04)' } })}
      >
        {open ? <ChevronDown size={10} style={{ flexShrink: 0, color: c.muted }} /> : <ChevronRight size={10} style={{ flexShrink: 0, color: c.muted }} />}
        <Box style={{ color: '#f5a623', display: 'flex', flexShrink: 0 }}>
          {open ? <FolderOpen size={14} /> : <Folder size={14} />}
        </Box>
        <span style={{ color: c.text }}>{node.name}</span>
      </Flex>
      {open && node.children?.map((child) => (
        <TreeItem key={child.path} node={child} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} />
      ))}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Inline renderer — splits a string on backticks and styles code spans
// ---------------------------------------------------------------------------
function InlineText({ text, color = 'rgba(231,228,239,0.78)' }: { text: string; color?: string }) {
  const parts = text.split(/(`[^`]+`)/)
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('`') && part.endsWith('`')) {
          return (
            <code key={i} style={{
              fontFamily: c.mono,
              fontSize: '0.88em',
              padding: '1px 5px',
              borderRadius: 4,
              background: 'rgba(88,214,171,0.10)',
              border: '1px solid rgba(88,214,171,0.22)',
              color: '#58d6ab',
              letterSpacing: 0,
            }}>
              {part.slice(1, -1)}
            </code>
          )
        }
        return <span key={i} style={{ color }}>{part}</span>
      })}
    </>
  )
}

// ---------------------------------------------------------------------------
// Markdown renderer — parses the AI doc sections into readable HTML
// ---------------------------------------------------------------------------
function DocRenderer({ content }: { content: string }) {
  const lines = content.split('\n')

  return (
    <Box style={{ fontFamily: c.mono, fontSize: 12.5, lineHeight: 1.75, color: c.text }}>
      {lines.map((line, i) => {
        if (line.startsWith('# ')) {
          return (
            <Box key={i} style={{
              color: c.accent, fontSize: 14, fontWeight: 700,
              margin: '20px 0 8px',
              paddingBottom: 6,
              borderBottom: `1px solid ${c.accentBorder}`,
              letterSpacing: '0.01em',
            }}>
              <InlineText text={line.slice(2)} color={c.accent} />
            </Box>
          )
        }
        if (line.startsWith('## ')) {
          return (
            <Box key={i} style={{ color: c.text, fontSize: 13, fontWeight: 600, margin: '14px 0 4px' }}>
              <InlineText text={line.slice(3)} color={c.text} />
            </Box>
          )
        }
        if (line.startsWith('- ')) {
          return (
            <Flex key={i} align="flex-start" style={{ gap: 6, paddingLeft: 4, marginBottom: 2 }}>
              <span style={{ color: c.accent, flexShrink: 0, marginTop: 2, fontSize: 10 }}>▸</span>
              <span><InlineText text={line.slice(2)} /></span>
            </Flex>
          )
        }
        if (line === '') {
          return <Box key={i} style={{ height: 6 }} />
        }
        return (
          <Box key={i} style={{ color: 'rgba(231,228,239,0.72)', marginBottom: 1 }}>
            <InlineText text={line} />
          </Box>
        )
      })}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// AiDocView
// ---------------------------------------------------------------------------
interface AiDocViewProps {
  auditId: string
  onNavigateView: (view: string) => void
}

export function AiDocView({ auditId, onNavigateView }: AiDocViewProps) {
  const monaco = useMonaco()
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const selDecorations = useRef<string[]>([])

  const [contracts, setContracts] = useState<ScopeContractRead[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loadingContent, setLoadingContent] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)

  // Addresses
  const [addresses, setAddresses] = useState<ScopeAddress[]>([])
  const [selectedAddress, setSelectedAddress] = useState<ScopeAddress | null>(null)
  const [showReversePrompt, setShowReversePrompt] = useState(false)

  // Selection state
  const [selectedText, setSelectedText] = useState<string>('')
  const [fileText, setFileText] = useState<string>('')

  // Doc history
  const [docHistory, setDocHistory] = useState<AiDocRecord[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [activeDocId, setActiveDocId] = useState<string | null>(null)

  // Doc generation
  const [generating, setGenerating] = useState(false)
  const [generatedDoc, setGeneratedDoc] = useState<string | null>(null)
  const [genError, setGenError] = useState<string | null>(null)
  const [genMeta, setGenMeta] = useState<{ provider: string; model: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const tree = useMemo(() => buildTree(contracts), [contracts])
  const selectedContract = contracts.find((sc) => sc.id === selectedId)

  // Monaco setup
  useEffect(() => {
    if (!monaco) return
    if (!monaco.languages.getLanguages().find((l) => l.id === 'solidity')) {
      monaco.languages.register({ id: 'solidity', extensions: ['.sol'], mimetypes: ['text/x-solidity'] })
    }
    monaco.languages.setMonarchTokensProvider('solidity', SOLIDITY_LANG)
    monaco.editor.defineTheme('aidoc-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: THEME_RULES,
      colors: {
        'editor.background': '#0d0d11',
        'editor.foreground': '#e6edf3',
        'editorLineNumber.foreground': '#3d444d',
        'editorLineNumber.activeForeground': '#636e7b',
        // Bright teal selection
        'editor.selectionBackground': 'rgba(88,214,171,0.22)',
        'editor.inactiveSelectionBackground': 'rgba(88,214,171,0.10)',
        'editor.selectionHighlightBackground': 'rgba(88,214,171,0.08)',
        'editor.lineHighlightBackground': '#161b22',
        'editorCursor.foreground': '#58d6ab',
        'scrollbarSlider.background': '#30363d',
        'scrollbarSlider.hoverBackground': '#484f58',
        'editorGutter.background': '#0d0d11',
      },
    })
    monaco.editor.setTheme('aidoc-dark')
  }, [monaco])

  // Load contracts
  useEffect(() => {
    let active = true
    setLoadingList(true)
    listContracts(auditId)
      .then((cs) => { if (active) setContracts(cs) })
      .catch(() => { if (active) setContracts([]) })
      .finally(() => { if (active) setLoadingList(false) })
    return () => { active = false }
  }, [auditId])

  // Load addresses
  useEffect(() => {
    let active = true
    listAddresses(auditId)
      .then((res) => { if (active) setAddresses(res.items) })
      .catch(() => { if (active) setAddresses([]) })
    return () => { active = false }
  }, [auditId])

  // Fetch existing docs when a contract or address is selected
  useEffect(() => {
    if (!selectedId && !selectedAddress) return
    let active = true
    setLoadingHistory(true)
    setDocHistory([])
    setActiveDocId(null)
    setGeneratedDoc(null)
    setGenMeta(null)
    setGenError(null)
    const fetch = selectedAddress
      ? listDocsForAddress(selectedAddress.id)
      : listDocsForContract(selectedId!)
    fetch
      .then((res) => {
        if (!active) return
        setDocHistory(res.items)
        if (res.items.length > 0) {
          const latest = res.items[0]
          setActiveDocId(latest.id)
          setGeneratedDoc(latest.content)
          setGenMeta({ provider: latest.provider, model: latest.model })
        }
      })
      .catch(() => { /* no docs yet — silent */ })
      .finally(() => { if (active) setLoadingHistory(false) })
    return () => { active = false }
  }, [selectedId, selectedAddress])

  // Load file content
  useEffect(() => {
    if (!selectedId) return
    let active = true
    setLoadingContent(true)
    setSelectedText('')
    getContractContent(selectedId)
      .then((text) => {
        if (!active) return
        setFileText(text)
        if (editorRef.current) {
          editorRef.current.setValue(text)
          editorRef.current.setScrollTop(0)
          editorRef.current.setPosition({ lineNumber: 1, column: 1 })
        }
      })
      .catch(() => {
        if (!active) return
        const err = '// Failed to load file'
        setFileText(err)
        if (editorRef.current) editorRef.current.setValue(err)
      })
      .finally(() => { if (active) setLoadingContent(false) })
    return () => { active = false }
  }, [selectedId])

  const handleMount = useCallback((editor: Monaco.editor.IStandaloneCodeEditor) => {
    editorRef.current = editor

    editor.onDidChangeCursorSelection((e) => {
      const model = editor.getModel()
      if (!model) return

      const sel = e.selection
      const text = model.getValueInRange(sel)

      // Clear previous decorations
      selDecorations.current = editor.deltaDecorations(selDecorations.current, [])

      if (text.trim().length > 0) {
        setSelectedText(text)
        // Add border decoration around the selection
        selDecorations.current = editor.deltaDecorations([], [
          {
            range: sel,
            options: {
              className: 'aidoc-sel-inline',
              linesDecorationsClassName: 'aidoc-sel-margin',
              overviewRuler: { color: '#58d6ab', position: 1 },
            },
          },
        ])
      } else {
        setSelectedText('')
      }
    })
  }, [])

  const handleSelect = useCallback((sc: ScopeContractRead) => {
    setSelectedId(sc.id)
    setSelectedAddress(null)
    setShowReversePrompt(false)
  }, [])

  const handleSelectAddress = useCallback((addr: ScopeAddress) => {
    setSelectedAddress(addr)
    setSelectedId(null)
    setSelectedText('')
    setFileText('')
    if (addr.decompiled_sol) {
      setShowReversePrompt(false)
      if (editorRef.current) {
        editorRef.current.setValue(addr.decompiled_sol)
        editorRef.current.setScrollTop(0)
        editorRef.current.setPosition({ lineNumber: 1, column: 1 })
      }
      setFileText(addr.decompiled_sol)
    } else {
      setShowReversePrompt(true)
      if (editorRef.current) editorRef.current.setValue('')
    }
  }, [])

  const codeToSend = selectedText.trim() || fileText

  const handleGenerate = useCallback(async () => {
    if (!codeToSend || generating || (!selectedId && !selectedAddress)) return
    setGenerating(true)
    setGenError(null)
    setGeneratedDoc(null)
    setGenMeta(null)
    try {
      const res = await generateDoc({
        audit_id: auditId,
        code_text: codeToSend,
        contract_id: selectedId ?? null,
        address_id: selectedAddress?.id ?? null,
      })
      setGeneratedDoc(res.doc.content)
      setGenMeta({ provider: res.provider, model: res.model })
      setActiveDocId(res.doc.id)
      setDocHistory((prev) => [res.doc, ...prev])
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Generation failed'
      setGenError(msg)
    } finally {
      setGenerating(false)
    }
  }, [auditId, codeToSend, generating, selectedId, selectedAddress])

  const handleCopy = useCallback(() => {
    if (!generatedDoc) return
    navigator.clipboard.writeText(generatedDoc).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [generatedDoc])

  const noSource = !selectedId && !selectedAddress

  const selLabel = selectedText.trim()
    ? `Selection (${selectedText.trim().split('\n').length} lines)`
    : selectedAddress
      ? `Full decompiled — ${selectedAddress.label || selectedAddress.address.slice(0, 10)}`
      : selectedContract
        ? `Full file — ${selectedContract.file_name}`
        : 'No file selected'

  return (
    <Flex style={{
      width: '100%',
      height: 'calc(100vh - 180px)',
      minHeight: 480,
      border: `1px solid ${c.border}`,
      borderRadius: 14,
      overflow: 'hidden',
      background: c.bg,
    }}>

      {/* ── LEFT HALF: sidebar + code ─────────────────────────────────────── */}
      <Flex style={{ width: '50%', borderRight: `1px solid ${c.border}`, minWidth: 0 }}>

        {/* Sidebar */}
        <Flex direction="column" style={{
          width: sidebarOpen ? 220 : 32,
          flexShrink: 0,
          borderRight: `1px solid ${c.border}`,
          background: c.sidebar,
          transition: 'width 0.2s ease',
          overflow: 'hidden',
        }}>
          <Flex align="center" justify={sidebarOpen ? 'space-between' : 'center'} style={{
            padding: sidebarOpen ? '10px 8px 6px' : '10px 0 6px',
            borderBottom: `1px solid ${c.border}`,
            flexShrink: 0,
          }}>
            {sidebarOpen && (
              <span style={{ fontSize: 10, fontFamily: c.mono, color: c.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Files
              </span>
            )}
            <button
              onClick={() => setSidebarOpen((o) => !o)}
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
              {/* Files list */}
              <Box style={{ flex: 1, overflowY: 'auto', padding: '4px 0', minHeight: 0 }}>
                {loadingList
                  ? <Box style={{ padding: '12px', color: c.muted, fontSize: 12 }}>Loading…</Box>
                  : tree.length === 0
                    ? <Box style={{ padding: '12px', color: c.muted, fontSize: 12 }}>No contracts found</Box>
                    : tree.map((node) => (
                      <TreeItem key={node.path} node={node} depth={0} selectedId={selectedId} onSelect={handleSelect} />
                    ))}
              </Box>

              {/* Addresses section */}
              {addresses.length > 0 && (
                <Box style={{ borderTop: `1px solid ${c.border}`, flexShrink: 0 }}>
                  <Box style={{
                    padding: '8px 8px 4px',
                    fontSize: 10, fontFamily: c.mono, color: c.muted,
                    textTransform: 'uppercase', letterSpacing: '0.08em',
                  }}>
                    Addresses
                  </Box>
                  <Box style={{ maxHeight: 180, overflowY: 'auto', padding: '0 4px 6px' }}>
                    {addresses.map((addr) => {
                      const isSelected = selectedAddress?.id === addr.id
                      const hasDecompiled = !!addr.decompiled_sol
                      return (
                        <Flex
                          key={addr.id}
                          align="center"
                          gap="1"
                          onClick={() => handleSelectAddress(addr)}
                          style={{
                            paddingLeft: 8, paddingTop: 4, paddingBottom: 4, paddingRight: 6,
                            cursor: 'pointer', borderRadius: 4,
                            background: isSelected ? c.active : 'transparent',
                            fontSize: 11, fontFamily: c.mono, userSelect: 'none',
                          }}
                          className={css({ _hover: { background: 'rgba(255,255,255,0.05)' } })}
                        >
                          <Cpu size={12} style={{ color: isSelected ? c.accent : c.muted, flexShrink: 0 }} />
                          <Box style={{ flex: 1, minWidth: 0 }}>
                            <Box style={{
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                              color: isSelected ? c.accent : 'rgba(185,185,193,0.8)',
                              fontWeight: isSelected ? 500 : 400,
                            }}>
                              {addr.label || `${addr.address.slice(0, 6)}…${addr.address.slice(-4)}`}
                            </Box>
                          </Box>
                          {hasDecompiled && (
                            <Box style={{
                              fontSize: 9, padding: '1px 4px', borderRadius: 3,
                              background: 'rgba(88,214,171,0.08)',
                              color: 'rgba(88,214,171,0.6)',
                              fontFamily: c.mono, flexShrink: 0,
                            }}>
                              ✓
                            </Box>
                          )}
                        </Flex>
                      )
                    })}
                  </Box>
                </Box>
              )}
            </>
          )}
        </Flex>

        {/* Code panel */}
        <Flex direction="column" style={{ flex: 1, minWidth: 0, background: '#0d0d11' }}>
          {/* Tab bar */}
          <Flex align="center" justify="space-between" style={{
            height: 36, flexShrink: 0,
            borderBottom: `1px solid ${c.border}`,
            paddingLeft: 12, paddingRight: 12,
            background: c.panel,
          }}>
            <Flex align="center" gap="2">
              {selectedAddress ? (
                <>
                  <Cpu size={12} style={{ color: c.muted, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontFamily: c.mono, color: c.text }}>
                    {selectedAddress.label || `${selectedAddress.address.slice(0, 6)}…${selectedAddress.address.slice(-4)}`}
                  </span>
                  {selectedAddress.decompiled_sol && (
                    <span style={{ fontSize: 10, fontFamily: c.mono, color: c.muted }}>decompiled</span>
                  )}
                </>
              ) : (
                <>
                  <File size={12} style={{ color: c.muted, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontFamily: c.mono, color: selectedContract ? c.text : c.muted }}>
                    {selectedContract?.file_name ?? 'Select a file or address'}
                  </span>
                </>
              )}
            </Flex>
            {/* Selection indicator */}
            {selectedText.trim() && (
              <Flex align="center" gap="1" style={{
                fontSize: 10, fontFamily: c.mono,
                color: c.accent,
                background: c.accentDim,
                border: `1px solid ${c.accentBorder}`,
                borderRadius: 4,
                padding: '2px 7px',
              }}>
                <span>{selectedText.trim().split('\n').length}L selected</span>
              </Flex>
            )}
          </Flex>

          {/* Monaco (read-only) */}
          <Box style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
            {!selectedId && !selectedAddress && (
              <Flex align="center" justify="center" direction="column" style={{
                position: 'absolute', inset: 0, zIndex: 2,
                background: '#0d0d11', color: c.muted, fontSize: 13, fontFamily: c.mono, gap: 8,
              }}>
                <FileText size={32} style={{ color: 'rgba(185,185,193,0.10)', marginBottom: 4 }} />
                <span>Select a file or address from the sidebar</span>
                <span style={{ fontSize: 11 }}>Then select code to document a specific snippet</span>
              </Flex>
            )}

            {/* Reverse prompt popup — shown when address has no decompiled_sol */}
            {showReversePrompt && (
              <Flex align="center" justify="center" style={{
                position: 'absolute', inset: 0, zIndex: 3,
                background: 'rgba(13,13,17,0.82)', backdropFilter: 'blur(4px)',
              }}>
                <Flex direction="column" align="center" style={{
                  background: '#1a1a22',
                  border: `1px solid rgba(185,185,189,0.18)`,
                  borderRadius: 12, padding: '28px 32px', gap: 12,
                  maxWidth: 300, textAlign: 'center',
                }}>
                  <Cpu size={28} style={{ color: 'rgba(88,214,171,0.4)', marginBottom: 4 }} />
                  <span style={{ fontSize: 13, fontFamily: c.mono, color: c.text, fontWeight: 600 }}>
                    Not reversed yet
                  </span>
                  <span style={{ fontSize: 11, fontFamily: c.mono, color: c.muted, lineHeight: 1.6 }}>
                    This contract hasn't been decompiled.<br />
                    Go to Reverse View to run heimdall first.
                  </span>
                  <button
                    onClick={() => onNavigateView('reverse')}
                    style={{
                      marginTop: 4,
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '7px 18px', borderRadius: 7,
                      background: c.accentDim,
                      border: `1px solid ${c.accentBorder}`,
                      color: c.accent, cursor: 'pointer',
                      fontSize: 12, fontFamily: c.mono, fontWeight: 600,
                    }}
                  >
                    Go to Reverse View <ArrowRight size={12} />
                  </button>
                </Flex>
              </Flex>
            )}
            {selectedId && loadingContent && (
              <Flex align="center" justify="center" style={{
                position: 'absolute', inset: 0, zIndex: 2,
                background: '#0d0d11', color: c.muted, fontSize: 13, fontFamily: c.mono,
              }}>
                Loading…
              </Flex>
            )}
            <Editor
              height="100%"
              language="solidity"
              theme="aidoc-dark"
              defaultValue=""
              onMount={handleMount}
              options={{
                readOnly: true,
                fontSize: 13,
                fontFamily: '"JetBrains Mono","Roboto Mono","Fira Code",monospace',
                fontLigatures: true,
                lineHeight: 1.7,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                wordWrap: 'off',
                tabSize: 4,
                renderLineHighlight: 'none',
                renderWhitespace: 'none',
                bracketPairColorization: { enabled: true },
                guides: { indentation: true },
                smoothScrolling: true,
                padding: { top: 12, bottom: 12 },
                scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6, useShadows: false },
                // Keep cursor visible so selection is interactive
                cursorStyle: 'line',
              }}
            />
          </Box>

          {/* Generate bar */}
          <Flex align="center" justify="space-between" style={{
            height: 44, flexShrink: 0,
            borderTop: `1px solid ${c.border}`,
            paddingLeft: 12, paddingRight: 12,
            background: c.panel,
          }}>
            <span style={{ fontSize: 11, fontFamily: c.mono, color: c.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
              {selLabel}
            </span>
            <button
              onClick={handleGenerate}
              disabled={generating || noSource}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 14px', borderRadius: 6,
                background: generating || noSource ? 'rgba(88,214,171,0.05)' : c.accentDim,
                border: `1px solid ${generating || noSource ? 'rgba(88,214,171,0.10)' : c.accentBorder}`,
                color: generating || noSource ? 'rgba(88,214,171,0.35)' : c.accent,
                cursor: generating || noSource ? 'not-allowed' : 'pointer',
                fontSize: 12, fontFamily: c.mono, fontWeight: 600,
                transition: 'all 0.15s ease', whiteSpace: 'nowrap',
              }}
            >
              {generating
                ? <Loader size={12} style={{ animation: 'adSpin 1s linear infinite' }} />
                : <Sparkles size={12} />}
              {generating ? 'Generating…' : selectedText.trim() ? 'Generate for Selection' : 'Generate for File'}
            </button>
          </Flex>
        </Flex>
      </Flex>

      {/* ── RIGHT HALF: doc output ────────────────────────────────────────── */}
      <Flex direction="column" style={{ width: '50%', minWidth: 0 }}>
        {/* Header */}
        <Flex align="center" justify="space-between" style={{
          height: 36, flexShrink: 0,
          borderBottom: `1px solid ${c.border}`,
          paddingLeft: 12, paddingRight: 12,
          background: c.panel,
        }}>
          <Flex align="center" gap="2" style={{ minWidth: 0, flex: 1 }}>
            <Sparkles size={12} style={{ color: c.accent, flexShrink: 0 }} />
            <span style={{ fontSize: 12, fontFamily: c.mono, color: c.text, flexShrink: 0 }}>AI Documentation</span>
            {genMeta && (
              <span style={{ fontSize: 10, fontFamily: c.mono, color: c.muted, marginLeft: 2, flexShrink: 0 }}>
                {genMeta.provider} / {genMeta.model}
              </span>
            )}
            {/* History picker */}
            {docHistory.length > 1 && (
              <select
                value={activeDocId ?? ''}
                onChange={(e) => {
                  const doc = docHistory.find((d) => d.id === e.target.value)
                  if (!doc) return
                  setActiveDocId(doc.id)
                  setGeneratedDoc(doc.content)
                  setGenMeta({ provider: doc.provider, model: doc.model })
                }}
                style={{
                  marginLeft: 6, fontSize: 10, fontFamily: c.mono,
                  background: 'rgba(255,255,255,0.05)',
                  border: `1px solid ${c.border}`,
                  borderRadius: 4, color: c.muted,
                  padding: '1px 4px', cursor: 'pointer',
                  maxWidth: 160,
                }}
              >
                {docHistory.map((d, i) => (
                  <option key={d.id} value={d.id} style={{ background: '#14141a' }}>
                    {i === 0 ? 'Latest' : new Date(d.created_at).toLocaleString()}
                  </option>
                ))}
              </select>
            )}
            {loadingHistory && (
              <Loader size={11} style={{ animation: 'adSpin 1s linear infinite', color: c.muted, marginLeft: 6 }} />
            )}
          </Flex>
          {generatedDoc && (
            <button
              onClick={handleCopy}
              title="Copy markdown"
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '3px 10px', borderRadius: 5,
                background: 'transparent',
                border: `1px solid ${c.border}`,
                color: copied ? c.accent : c.muted,
                cursor: 'pointer', fontSize: 11, fontFamily: c.mono,
                transition: 'all 0.15s ease', flexShrink: 0,
              }}
            >
              {copied ? <Check size={11} /> : <Copy size={11} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          )}
        </Flex>

        {/* Doc body */}
        <Box style={{ flex: 1, overflowY: 'auto', position: 'relative' }}>
          {/* Empty state */}
          {!generatedDoc && !generating && !genError && !loadingHistory && (
            <Flex align="center" justify="center" direction="column" style={{
              position: 'absolute', inset: 0,
              color: c.muted, fontSize: 13, fontFamily: c.mono, gap: 10,
            }}>
              <Sparkles size={36} style={{ color: 'rgba(88,214,171,0.10)', marginBottom: 4 }} />
              <span style={{ color: c.text }}>No documentation yet</span>
              <span style={{ fontSize: 11, textAlign: 'center', maxWidth: 280, lineHeight: 1.6 }}>
                Select a file, optionally highlight a function or code block,<br />
                then click <span style={{ color: c.accent }}>Generate</span>
              </span>
            </Flex>
          )}

          {/* Loading — contained inside the doc box, not a full overlay */}
          {generating && (
            <Flex align="center" justify="center" direction="column" style={{
              padding: '60px 24px', gap: 14,
            }}>
              <div style={{
                width: 34, height: 34, borderRadius: '50%',
                border: '2px solid rgba(88,214,171,0.12)',
                borderTop: `2px solid ${c.accent}`,
                animation: 'adSpin 0.85s linear infinite',
              }} />
              <span style={{ fontSize: 12, fontFamily: c.mono, color: c.muted }}>
                Generating documentation…
              </span>
              <span style={{ fontSize: 10, fontFamily: c.mono, color: 'rgba(185,185,193,0.35)' }}>
                This may take a moment
              </span>
            </Flex>
          )}

          {/* Error */}
          {genError && !generating && (
            <Flex align="center" justify="center" direction="column" style={{
              position: 'absolute', inset: 0,
              color: c.muted, fontSize: 13, fontFamily: c.mono, gap: 8,
            }}>
              <span style={{ color: '#f85149', fontSize: 14, fontWeight: 600 }}>Generation failed</span>
              <span style={{ fontSize: 11, color: c.muted, maxWidth: 320, textAlign: 'center' }}>{genError}</span>
            </Flex>
          )}

          {/* Result */}
          {generatedDoc && !generating && (
            <Box style={{ padding: '20px 24px 32px' }}>
              <DocRenderer content={generatedDoc} />
            </Box>
          )}
        </Box>

        {/* Footer */}
        <Flex align="center" style={{
          height: 44, flexShrink: 0,
          borderTop: `1px solid ${c.border}`,
          paddingLeft: 14, paddingRight: 14,
          background: c.panel,
          gap: 6,
        }}>
          <Sparkles size={11} style={{ color: 'rgba(88,214,171,0.4)' }} />
          <span style={{ fontSize: 10, fontFamily: c.mono, color: 'rgba(185,185,193,0.35)' }}>
            AI-generated documentation — always verify against source code
          </span>
        </Flex>
      </Flex>

      <style>{`
        @keyframes adSpin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }

        /* Teal selection border decoration */
        .aidoc-sel-inline {
          border-top: 1px solid rgba(88,214,171,0.65) !important;
          border-bottom: 1px solid rgba(88,214,171,0.65) !important;
        }
        .aidoc-sel-margin {
          border-left: 2px solid rgba(88,214,171,0.9) !important;
          margin-left: 1px;
        }

        /* Scrollbar styling for doc panel */
        .aidoc-doc-scroll::-webkit-scrollbar { width: 6px; }
        .aidoc-doc-scroll::-webkit-scrollbar-track { background: transparent; }
        .aidoc-doc-scroll::-webkit-scrollbar-thumb { background: rgba(185,185,193,0.15); border-radius: 3px; }
        .aidoc-doc-scroll::-webkit-scrollbar-thumb:hover { background: rgba(185,185,193,0.28); }
      `}</style>
    </Flex>
  )
}
