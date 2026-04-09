import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Editor, { useMonaco } from '@monaco-editor/react'
import type * as Monaco from 'monaco-editor'
import { css } from 'styled-system/css'
import { Box, Flex } from 'styled-system/jsx'
import { ChevronRight, ChevronDown, ChevronLeft, Check, Loader, File, Folder, FolderOpen } from 'lucide-react'
import { listContracts, getContractContent, saveContractContent } from './codeApi'
import type { ScopeContractRead } from './codeApi'

// ---------------------------------------------------------------------------
// Theme colours
// ---------------------------------------------------------------------------
const c = {
  bg: '#101014',
  panel: '#14141a',
  sidebar: '#0f0f13',
  border: 'rgba(185,185,189,0.12)',
  text: 'rgba(231,228,239,0.91)',
  muted: 'rgba(185,185,193,0.55)',
  accent: '#58d6ab',
  active: 'rgba(255,255,255,0.07)',
  mono: '"Roboto Mono", "JetBrains Mono", monospace',
}

// ---------------------------------------------------------------------------
// Solidity Monarch tokenizer
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
// File tree
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
      <Flex
        align="center"
        gap="1"
        onClick={() => node.contract && onSelect(node.contract)}
        style={{
          paddingLeft: `${8 + depth * 14}px`,
          paddingTop: 4,
          paddingBottom: 4,
          paddingRight: 8,
          cursor: 'pointer',
          borderRadius: 4,
          background: isSelected ? c.active : 'transparent',
          fontSize: 12,
          fontFamily: c.mono,
          userSelect: 'none',
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
      <Flex
        align="center"
        gap="1"
        onClick={() => setOpen((o) => !o)}
        style={{
          paddingLeft: `${6 + depth * 14}px`,
          paddingTop: 4,
          paddingBottom: 4,
          paddingRight: 8,
          cursor: 'pointer',
          fontSize: 12,
          fontFamily: c.mono,
          userSelect: 'none',
          fontWeight: 600,
        }}
        className={css({ _hover: { background: 'rgba(255,255,255,0.04)' } })}
      >
        {open
          ? <ChevronDown size={10} style={{ flexShrink: 0, color: c.muted }} />
          : <ChevronRight size={10} style={{ flexShrink: 0, color: c.muted }} />}
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
// CodeView
// ---------------------------------------------------------------------------
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'
const AUTOSAVE_DELAY = 800

export type JumpTarget = { contractId: string; line: number } | null

interface CodeViewProps {
  auditId: string
  jumpTo?: JumpTarget
  onJumpHandled?: () => void
}

export function CodeView({ auditId, jumpTo, onJumpHandled }: CodeViewProps) {
  const monaco = useMonaco()
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const isSettingValue = useRef(false)
  const pendingJumpLine = useRef<number | null>(null)
  const flashTimers = useRef<ReturnType<typeof setTimeout>[]>([])
  const decorationIds = useRef<string[]>([])

  const [contracts, setContracts] = useState<ScopeContractRead[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loadingContent, setLoadingContent] = useState(false)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [sidebarOpen, setSidebarOpen] = useState(true)

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedContent = useRef('')

  // ---------------------------------------------------------------------------
  // Flash a line 3× in green
  // ---------------------------------------------------------------------------
  const flashLine = useCallback((line: number) => {
    const editor = editorRef.current
    if (!editor || !monaco) return

    // Clear any existing timers/decorations
    flashTimers.current.forEach(clearTimeout)
    flashTimers.current = []
    if (decorationIds.current.length > 0) {
      decorationIds.current = editor.deltaDecorations(decorationIds.current, [])
    }

    const addDeco = () => {
      decorationIds.current = editor.deltaDecorations([], [{
        range: new monaco.Range(line, 1, line, 1),
        options: { isWholeLine: true, className: 'cv-line-flash' },
      }])
    }
    const clearDeco = () => {
      decorationIds.current = editor.deltaDecorations(decorationIds.current, [])
    }

    // 3 flashes: on→off at 0, 280, 560ms; off at 220, 500, 780ms
    addDeco()
    const t1 = setTimeout(clearDeco, 220)
    const t2 = setTimeout(addDeco, 320)
    const t3 = setTimeout(clearDeco, 540)
    const t4 = setTimeout(addDeco, 640)
    const t5 = setTimeout(clearDeco, 900)
    flashTimers.current = [t1, t2, t3, t4, t5]
  }, [monaco])

  const applyJump = useCallback((line: number) => {
    const editor = editorRef.current
    if (!editor) return
    editor.revealLineInCenter(line)
    editor.setPosition({ lineNumber: line, column: 1 })
    // Small delay so the scroll settles before flashing
    setTimeout(() => flashLine(line), 80)
  }, [flashLine])

  // Monaco language + theme registration
  useEffect(() => {
    if (!monaco) return
    if (!monaco.languages.getLanguages().find((l) => l.id === 'solidity')) {
      monaco.languages.register({ id: 'solidity', extensions: ['.sol'], mimetypes: ['text/x-solidity'] })
    }
    // Always re-apply the tokenizer so hot-reloads and build updates take effect
    monaco.languages.setMonarchTokensProvider('solidity', SOLIDITY_LANG)
    monaco.editor.defineTheme('solaudity-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: THEME_RULES,
      colors: {
        'editor.background': '#0d0d11',
        'editor.foreground': '#e6edf3',
        'editorLineNumber.foreground': '#3d444d',
        'editorLineNumber.activeForeground': '#636e7b',
        'editor.selectionBackground': '#264f78',
        'editor.lineHighlightBackground': '#161b22',
        'editorCursor.foreground': '#58d6ab',
        'scrollbarSlider.background': '#30363d',
        'scrollbarSlider.hoverBackground': '#484f58',
        'editorWidget.background': '#161b22',
        'editorWidget.border': '#30363d',
        'editorGutter.background': '#0d0d11',
        'minimap.background': '#0d0d11',
      },
    })
    monaco.editor.setTheme('solaudity-dark')
  }, [monaco])

  // Load contracts list
  useEffect(() => {
    let active = true
    setLoadingList(true)
    listContracts(auditId)
      .then((cs) => { if (active) setContracts(cs) })
      .catch(() => { if (active) setContracts([]) })
      .finally(() => { if (active) setLoadingList(false) })
    return () => { active = false }
  }, [auditId])

  // Handle incoming jumpTo from parent (ParseView → EnumWorkspace → here)
  useEffect(() => {
    if (!jumpTo) return
    pendingJumpLine.current = jumpTo.line
    if (jumpTo.contractId !== selectedId) {
      setSelectedId(jumpTo.contractId)
    } else {
      // Same file already loaded — jump right away
      applyJump(jumpTo.line)
      pendingJumpLine.current = null
    }
    onJumpHandled?.()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpTo])

  // Load file content — use editor API directly to avoid cursor jump
  useEffect(() => {
    if (!selectedId) return
    let active = true
    setLoadingContent(true)
    setSaveStatus('idle')
    getContractContent(selectedId)
      .then((text) => {
        if (!active) return
        lastSavedContent.current = text
        if (editorRef.current) {
          isSettingValue.current = true
          editorRef.current.setValue(text)
          isSettingValue.current = false
          editorRef.current.setScrollTop(0)
          editorRef.current.setPosition({ lineNumber: 1, column: 1 })
        }
      })
      .catch(() => {
        if (!active) return
        const err = '// Failed to load file'
        if (editorRef.current) {
          isSettingValue.current = true
          editorRef.current.setValue(err)
          isSettingValue.current = false
        }
      })
      .finally(() => {
        if (!active) return
        setLoadingContent(false)
        // Apply pending jump after content is loaded
        if (pendingJumpLine.current !== null) {
          const line = pendingJumpLine.current
          pendingJumpLine.current = null
          // Wait a tick for the editor to render
          setTimeout(() => applyJump(line), 60)
        }
      })
    return () => { active = false }
  }, [selectedId, applyJump])

  // Autosave (debounced)
  const scheduleAutosave = useCallback((value: string, contractId: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    setSaveStatus('saving')
    saveTimer.current = setTimeout(async () => {
      try {
        await saveContractContent(contractId, value)
        lastSavedContent.current = value
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus((s) => s === 'saved' ? 'idle' : s), 1800)
      } catch {
        setSaveStatus('error')
      }
    }, AUTOSAVE_DELAY)
  }, [])

  const handleMount = useCallback((editor: Monaco.editor.IStandaloneCodeEditor) => {
    editorRef.current = editor
  }, [])

  const handleEditorChange = useCallback((value: string | undefined) => {
    if (isSettingValue.current) return
    const v = value ?? ''
    if (selectedId && v !== lastSavedContent.current) {
      scheduleAutosave(v, selectedId)
    }
  }, [selectedId, scheduleAutosave])

  const handleSelect = useCallback((sc: ScopeContractRead) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    setSaveStatus('idle')
    setSelectedId(sc.id)
  }, [])

  const tree = useMemo(() => buildTree(contracts), [contracts])
  const selectedContract = contracts.find((sc) => sc.id === selectedId)

  function SaveIndicator() {
    if (saveStatus === 'saving') return (
      <Flex align="center" gap="1" style={{ color: c.muted, fontSize: 11, fontFamily: c.mono }}>
        <Loader size={10} style={{ animation: 'spin 1s linear infinite' }} />
        <span>Saving…</span>
      </Flex>
    )
    if (saveStatus === 'saved') return (
      <Flex align="center" gap="1" style={{ color: c.accent, fontSize: 11, fontFamily: c.mono }}>
        <Check size={10} />
        <span>Saved</span>
      </Flex>
    )
    if (saveStatus === 'error') return (
      <span style={{ color: '#f85149', fontSize: 11, fontFamily: c.mono }}>Save failed</span>
    )
    return null
  }

  return (
    <Flex
      style={{
        width: '100%',
        height: 'calc(100vh - 180px)',
        minHeight: 480,
        border: `1px solid ${c.border}`,
        borderRadius: 14,
        overflow: 'hidden',
        background: c.bg,
      }}
    >
      {/* Sidebar */}
      <Flex
        direction="column"
        style={{
          width: sidebarOpen ? 220 : 32,
          flexShrink: 0,
          borderRight: `1px solid ${c.border}`,
          background: c.sidebar,
          transition: 'width 0.2s ease',
          overflow: 'hidden',
        }}
      >
        <Flex
          align="center"
          justify={sidebarOpen ? 'space-between' : 'center'}
          style={{
            padding: sidebarOpen ? '10px 8px 6px' : '10px 0 6px',
            borderBottom: `1px solid ${c.border}`,
            flexShrink: 0,
          }}
        >
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
              background: 'transparent', cursor: 'pointer', color: c.muted,
              flexShrink: 0,
            }}
          >
            {sidebarOpen ? <ChevronLeft size={13} /> : <ChevronRight size={13} />}
          </button>
        </Flex>
        {sidebarOpen && (
          <Box style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
            {loadingList ? (
              <Box style={{ padding: '12px', color: c.muted, fontSize: 12 }}>Loading…</Box>
            ) : tree.length === 0 ? (
              <Box style={{ padding: '12px', color: c.muted, fontSize: 12 }}>No contracts found</Box>
            ) : (
              tree.map((node) => (
                <TreeItem
                  key={node.path}
                  node={node}
                  depth={0}
                  selectedId={selectedId}
                  onSelect={handleSelect}
                />
              ))
            )}
          </Box>
        )}
      </Flex>

      {/* Editor panel */}
      <Flex direction="column" style={{ flex: 1, minWidth: 0, background: '#0d0d11' }}>
        {/* Tab bar */}
        <Flex
          align="center"
          justify="space-between"
          style={{
            height: 36,
            borderBottom: `1px solid ${c.border}`,
            paddingLeft: 12,
            paddingRight: 16,
            flexShrink: 0,
            background: c.panel,
          }}
        >
          <Flex align="center" gap="2">
            {selectedContract ? (
              <>
                <File size={12} style={{ color: c.muted, flexShrink: 0 }} />
                <span style={{ fontSize: 12, fontFamily: c.mono, color: c.text }}>
                  {selectedContract.file_name}
                </span>
                {selectedContract.compiler_version && (
                  <span style={{ fontSize: 10, fontFamily: c.mono, color: c.muted, marginLeft: 4 }}>
                    {selectedContract.compiler_version}
                  </span>
                )}
              </>
            ) : (
              <span style={{ fontSize: 12, color: c.muted }}>No file selected</span>
            )}
          </Flex>
          <SaveIndicator />
        </Flex>

        {/* Editor */}
        <Box style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {!selectedId && (
            <Flex align="center" justify="center" style={{
              position: 'absolute', inset: 0, zIndex: 2,
              background: '#0d0d11', color: c.muted, fontSize: 13, fontFamily: c.mono,
            }}>
              Select a file from the sidebar
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
            theme="solaudity-dark"
            defaultValue=""
            onMount={handleMount}
            onChange={handleEditorChange}
            options={{
              fontSize: 13,
              fontFamily: '"JetBrains Mono", "Roboto Mono", "Fira Code", monospace',
              fontLigatures: true,
              lineHeight: 1.7,
              minimap: { enabled: true, scale: 1, renderCharacters: false },
              scrollBeyondLastLine: false,
              wordWrap: 'off',
              tabSize: 4,
              insertSpaces: true,
              autoIndent: 'advanced',
              formatOnPaste: false,
              renderLineHighlight: 'line',
              renderWhitespace: 'none',
              bracketPairColorization: { enabled: true },
              guides: { bracketPairs: true, indentation: true },
              smoothScrolling: true,
              cursorSmoothCaretAnimation: 'on',
              cursorBlinking: 'smooth',
              padding: { top: 12, bottom: 12 },
              scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8, useShadows: false },
            }}
          />
        </Box>
      </Flex>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
        .cv-line-flash { background: rgba(88, 214, 171, 0.22) !important; }
      `}</style>
    </Flex>
  )
}
