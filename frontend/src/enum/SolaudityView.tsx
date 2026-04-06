import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  Handle,
  Position,
  MarkerType,
  BackgroundVariant,
  type Node,
  type Edge,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import Dagre from '@dagrejs/dagre'
import { Box, Flex } from 'styled-system/jsx'
import { css } from 'styled-system/css'
import {
  ChevronRight, ChevronDown, File, Folder, FolderOpen,
  Loader, AlertTriangle, GitBranch, Play,
} from 'lucide-react'
import { listContracts, getContractContent } from './codeApi'
import type { ScopeContractRead } from './codeApi'
import {
  listParsedContractsForFile,
  listParsedContracts,
  listFunctions,
  getCallGraph,
  triggerParse,
} from './api'
import type { ParsedFunctionRead, ParsedContractRead, CallEdgeRead, CallType } from './api'

// ─── Theme ────────────────────────────────────────────────────────────────────
const c = {
  bg: '#101014',
  panel: '#14141a',
  sidebar: '#0f0f13',
  border: 'rgba(185,185,189,0.12)',
  text: 'rgba(231,228,239,0.91)',
  muted: 'rgba(185,185,193,0.55)',
  accent: '#58d6ab',
  active: 'rgba(255,255,255,0.07)',
  mono: '"JetBrains Mono","Roboto Mono",monospace',
}

// ─── File tree ────────────────────────────────────────────────────────────────
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

function TreeItem({ node, depth, selectedId, onSelect }: {
  node: TreeNode; depth: number; selectedId: string | null
  onSelect: (sc: ScopeContractRead) => void
}) {
  const [open, setOpen] = useState(true)
  const isSelected = node.contract?.id === selectedId

  if (node.type === 'file') {
    return (
      <Flex
        align="center" gap="1"
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
      <Flex
        align="center" gap="1"
        onClick={() => setOpen((o) => !o)}
        style={{
          paddingLeft: `${6 + depth * 14}px`, paddingTop: 4, paddingBottom: 4, paddingRight: 8,
          cursor: 'pointer', fontSize: 12, fontFamily: c.mono, userSelect: 'none', fontWeight: 600,
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

// ─── Syntax highlighter ───────────────────────────────────────────────────────
const KW = new Set([
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
  'wei','gwei','ether','seconds','minutes','hours','days',
])
const TY = new Set([
  'address','bool','string','bytes',
  'int','int8','int16','int32','int64','int128','int256',
  'uint','uint8','uint16','uint32','uint64','uint128','uint256',
  'bytes1','bytes2','bytes4','bytes8','bytes16','bytes32',
  'fixed','ufixed',
])
const TC = {
  comment: '#6a737d', keyword: '#ff7b72', type: '#79c0ff',
  typeId: '#ffa657', string: '#a5d6ff', number: '#79c0ff',
  plain: '#e6edf3', dim: '#8b949e',
}

function tokenizeLine(line: string): Array<{ color: string; text: string }> {
  const out: Array<{ color: string; text: string }> = []
  const re = /\/\/.*$|\/\*[\s\S]*?\*\/|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|0[xX][0-9a-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[a-zA-Z_$][\w$]*|[^\s]/g
  let last = 0; let m: RegExpExecArray | null
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) out.push({ color: TC.plain, text: line.slice(last, m.index) })
    const t = m[0]; let color = TC.plain
    if (t.startsWith('//') || t.startsWith('/*')) color = TC.comment
    else if (t.startsWith('"') || t.startsWith("'")) color = TC.string
    else if (/^(0[xX]|\d)/.test(t)) color = TC.number
    else if (/^[a-zA-Z_$]/.test(t)) {
      if (KW.has(t)) color = TC.keyword
      else if (TY.has(t)) color = TC.type
      else if (/^[A-Z]/.test(t)) color = TC.typeId
    } else if (/^[;,.]$/.test(t)) color = TC.dim
    out.push({ color, text: t })
    last = m.index + t.length
  }
  if (last < line.length) out.push({ color: TC.plain, text: line.slice(last) })
  return out
}

// ─── Node data types ──────────────────────────────────────────────────────────
interface CallSite {
  edgeId: string
  sourceLine: number | null
  callType: CallType
  isPositioned: boolean
  calleeNodeId: string
  calleeName: string
}

export interface FunctionNodeData extends Record<string, unknown> {
  fn: ParsedFunctionRead
  contractName: string
  code: string
  callSites: CallSite[]
  isExternal: boolean
  nodeWidth: number
  // injected at runtime by FocusController
  onFocusNode: (nodeId: string) => void
}

interface StubNodeData extends Record<string, unknown> {
  displayName: string
}

type FunctionNodeType = Node<FunctionNodeData, 'functionNode'>
type StubNodeType    = Node<StubNodeData,    'stubNode'>

// ─── Layout constants ─────────────────────────────────────────────────────────
const NODE_MIN_W    = 400
const HEADER_H      = 49
const CODE_PAD_TOP  = 8
const CODE_LINE_H   = 16
const CODE_CHAR_W   = 6.65   // px per monospace char at font-size 11
const CODE_H_PAD    = 28 + 14 // left-padding 14 + right breathing room 14
const STUB_H        = 72

function fnNodeWidth(code: string): number {
  const maxChars = Math.max(...code.split('\n').map((l) => l.length), 0)
  return Math.max(NODE_MIN_W, Math.ceil(maxChars * CODE_CHAR_W) + CODE_H_PAD)
}

function fnNodeHeight(code: string): number {
  return HEADER_H + CODE_PAD_TOP + code.split('\n').length * CODE_LINE_H + 16
}

// ─── Edge / badge colors ──────────────────────────────────────────────────────
const EDGE_COLOR: Record<CallType, string> = {
  internal: '#58d6ab', external: '#f0883e',
  delegatecall: '#f85149', staticcall: '#79c0ff', library_call: '#a371f7',
}
const edgeColor = (ct: CallType) => EDGE_COLOR[ct] ?? '#636e7b'

const VIS_C: Record<string, string> = { public: '#58d6ab', external: '#58d6ab', internal: '#f0883e', private: '#f85149' }
const MUT_C: Record<string, string> = { view: '#79c0ff', pure: '#a371f7', payable: '#f2cc60' }

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      fontSize: 9, padding: '1px 6px', borderRadius: 3, flexShrink: 0,
      background: `${color}22`, color, border: `1px solid ${color}44`, fontWeight: 700, letterSpacing: '0.04em',
    }}>
      {label}
    </span>
  )
}

// ─── FunctionNode ─────────────────────────────────────────────────────────────
function FunctionNode({ data }: NodeProps<FunctionNodeType>) {
  const { fn, contractName, code, callSites, isExternal, nodeWidth, onFocusNode } = data
  const [hoveredLine, setHoveredLine] = useState<number | null>(null)
  const codeLines = code.split('\n')
  const lineStart = fn.source_line_start ?? 1

  // Map: relative line offset → array of callees (multiple calls can share a line)
  type LineSite = { calleeNodeId: string; calleeName: string; callType: CallType }
  const callSiteByOffset = useMemo(() => {
    const m = new Map<number, LineSite[]>()
    for (const cs of callSites) {
      if (cs.isPositioned && cs.sourceLine != null) {
        const offset = cs.sourceLine - lineStart
        const arr = m.get(offset) ?? []
        // Avoid duplicate callee names on the same line
        if (!arr.some(s => s.calleeName === cs.calleeName)) {
          arr.push({ calleeNodeId: cs.calleeNodeId, calleeName: cs.calleeName, callType: cs.callType })
        }
        m.set(offset, arr)
      }
    }
    return m
  }, [callSites, lineStart])

  const fnLabel = fn.is_constructor ? 'constructor' : fn.is_fallback ? 'fallback' : fn.is_receive ? 'receive' : fn.name
  const borderColor = isExternal ? 'rgba(121,192,255,0.28)' : 'rgba(185,185,189,0.22)'
  const headerBg    = isExternal ? '#181e2a' : '#1c1c24'

  return (
    <div style={{
      width: nodeWidth, fontFamily: c.mono,
      background: '#131318',
      border: `1.5px solid ${borderColor}`,
      borderRadius: 8, overflow: 'visible',
      boxShadow: '0 6px 24px rgba(0,0,0,0.6)',
    }}>
      {/* Incoming handle — top center, sits outside the border */}
      <Handle id="in" type="target" position={Position.Top}
        style={{ background: 'rgba(185,185,189,0.4)', border: 'none', width: 8, height: 8, top: -5 }}
      />

      {/* Header */}
      <div style={{
        background: headerBg,
        borderBottom: '1px solid rgba(185,185,189,0.14)',
        borderRadius: '7px 7px 0 0',
        padding: '7px 14px 9px', overflow: 'hidden',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5,
          fontSize: 9, color: isExternal ? 'rgba(121,192,255,0.5)' : 'rgba(185,185,193,0.38)',
          letterSpacing: '0.07em', textTransform: 'uppercase',
        }}>
          <span>{contractName}</span>
          {isExternal && (
            <span style={{
              fontSize: 8, padding: '1px 5px', borderRadius: 3,
              background: 'rgba(121,192,255,0.1)', border: '1px solid rgba(121,192,255,0.25)',
              color: 'rgba(121,192,255,0.7)', letterSpacing: '0.05em', textTransform: 'uppercase',
            }}>
              imported
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: '#e6edf3', fontWeight: 700, marginRight: 2 }}>{fnLabel}</span>
          {fn.visibility && <Badge label={fn.visibility} color={VIS_C[fn.visibility] ?? '#636e7b'} />}
          {fn.mutability && fn.mutability !== 'nonpayable' && <Badge label={fn.mutability} color={MUT_C[fn.mutability] ?? '#636e7b'} />}
          {fn.has_reentrancy && <Badge label="reentrancy" color="#f85149" />}
          {fn.is_entry_point && <Badge label="entry" color="#f2cc60" />}
        </div>
      </div>

      {/* Code body — call site lines are highlighted + clickable */}
      <div style={{
        paddingTop: CODE_PAD_TOP, paddingBottom: 8,
        fontSize: 11, lineHeight: `${CODE_LINE_H}px`,
        borderRadius: '0 0 6px 6px',
      }}>
        {codeLines.map((line, i) => {
          const lineSites  = callSiteByOffset.get(i)
          const isCallLine = lineSites != null && lineSites.length > 0
          const isHov      = hoveredLine === i

          // Build a name→site lookup for O(1) token matching
          const siteByName = isCallLine
            ? new Map(lineSites!.map(s => [s.calleeName, s]))
            : null

          const tokens = tokenizeLine(line)
          const tokenSpans = tokens.map((tok, j) => {
            const site = siteByName?.get(tok.text)
            if (site) {
              const col = edgeColor(site.callType)
              return (
                <span
                  key={j}
                  onClick={(e) => { e.stopPropagation(); onFocusNode(site.calleeNodeId) }}
                  style={{
                    color: col, fontWeight: 700, cursor: 'pointer',
                    textDecoration: isHov ? `underline ${col}` : 'none',
                    textUnderlineOffset: '2px',
                    transition: 'text-decoration 0.1s',
                  }}
                >
                  {tok.text}
                </span>
              )
            }
            return <span key={j} style={{ color: tok.color }}>{tok.text}</span>
          })

          return (
            <div
              key={i}
              onMouseEnter={() => isCallLine && setHoveredLine(i)}
              onMouseLeave={() => isCallLine && setHoveredLine(null)}
              onClick={(e) => {
                if (isCallLine && lineSites != null && lineSites.length > 0) {
                  e.stopPropagation()
                  onFocusNode(lineSites[0].calleeNodeId)
                }
              }}
              style={{
                padding: '0 14px', whiteSpace: 'pre',
                cursor: isCallLine ? 'pointer' : 'text',
                background: isHov
                  ? 'rgba(88,214,171,0.08)'
                  : isCallLine ? 'rgba(88,214,171,0.03)' : 'transparent',
                borderLeft: isCallLine
                  ? `2px solid rgba(88,214,171,${isHov ? '0.75' : '0.3'})`
                  : '2px solid transparent',
                transition: 'background 0.1s ease, border-color 0.1s ease',
              }}
            >
              {tokenSpans}
            </div>
          )
        })}
      </div>

      {/* Source handles — right side, offset outside the border */}
      {callSites.map((site) => {
        if (!site.isPositioned || site.sourceLine == null) return null
        const offset = site.sourceLine - lineStart
        const top = HEADER_H + CODE_PAD_TOP + offset * CODE_LINE_H + CODE_LINE_H / 2
        const col = edgeColor(site.callType)
        return (
          <Handle key={site.edgeId} id={site.edgeId} type="source" position={Position.Right}
            style={{
              top, right: -6,
              background: col, border: '2px solid #131318',
              width: 10, height: 10, borderRadius: '50%',
              boxShadow: `0 0 0 1.5px ${col}55`,
            }}
          />
        )
      })}

      {/* Fallback source handle — bottom center for edges without a source line */}
      <Handle id="out" type="source" position={Position.Bottom}
        style={{ background: 'rgba(185,185,189,0.35)', border: 'none', width: 8, height: 8, bottom: -5 }}
      />
    </div>
  )
}

// ─── StubNode ─────────────────────────────────────────────────────────────────
function StubNode({ data }: NodeProps<StubNodeType>) {
  const { displayName } = data
  return (
    <div style={{
      width: NODE_MIN_W, fontFamily: c.mono,
      background: '#17100f',
      border: '1.5px solid rgba(248,81,73,0.28)',
      borderRadius: 8, overflow: 'visible',
      boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
    }}>
      <Handle id="in" type="target" position={Position.Top}
        style={{ background: 'rgba(248,81,73,0.45)', border: 'none', width: 8, height: 8, top: -4 }}
      />
      <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <AlertTriangle size={16} style={{ color: '#f85149', flexShrink: 0 }} />
        <div>
          <div style={{ fontSize: 9, color: 'rgba(248,81,73,0.45)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 3 }}>
            function not found
          </div>
          <div style={{ fontSize: 12, color: 'rgba(248,81,73,0.85)', fontWeight: 600, wordBreak: 'break-all' }}>
            {displayName}
          </div>
        </div>
      </div>
    </div>
  )
}

// Must be at module level
const nodeTypes = { functionNode: FunctionNode, stubNode: StubNode }

// ─── Dagre layout ─────────────────────────────────────────────────────────────
function applyDagreLayout(nodes: Node[], edges: Edge[]): Node[] {
  const g = new Dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'TB', nodesep: 80, ranksep: 130, marginx: 60, marginy: 60 })

  nodes.forEach((n) => {
    const w = n.type === 'stubNode' ? NODE_MIN_W : (n.data as FunctionNodeData).nodeWidth
    const h = n.type === 'stubNode' ? STUB_H : fnNodeHeight((n.data as FunctionNodeData).code)
    g.setNode(n.id, { width: w, height: h })
  })
  edges.forEach((e) => g.setEdge(e.source, e.target))
  Dagre.layout(g)

  return nodes.map((n) => {
    const w = n.type === 'stubNode' ? NODE_MIN_W : (n.data as FunctionNodeData).nodeWidth
    const h = n.type === 'stubNode' ? STUB_H : fnNodeHeight((n.data as FunctionNodeData).code)
    const pos = g.node(n.id)
    return { ...n, position: { x: pos.x - w / 2, y: pos.y - h / 2 } }
  })
}

// ─── FocusController — must live inside ReactFlow provider ───────────────────
// Injects onFocusNode into every node's data so the callback has access to
// useReactFlow().fitView, which only works inside the provider.
function FocusController({ setNodes }: { setNodes: (updater: (nds: Node[]) => Node[]) => void }) {
  const { fitView } = useReactFlow()

  useEffect(() => {
    const onFocusNode = (nodeId: string) => {
      fitView({ nodes: [{ id: nodeId }], duration: 650, padding: 0.35 })
    }
    setNodes((nds) =>
      nds.map((n) =>
        n.type === 'functionNode'
          ? { ...n, data: { ...n.data, onFocusNode } }
          : n,
      ),
    )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])   // run once on mount — fitView ref is stable

  return null
}

// ─── GraphCanvas ──────────────────────────────────────────────────────────────
function GraphCanvas({ initNodes, initEdges }: { initNodes: Node[]; initEdges: Edge[] }) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initNodes)
  const [edges, , onEdgesChange] = useEdgesState(initEdges)

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <ReactFlow
        nodes={nodes} edges={edges}
        onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView fitViewOptions={{ padding: 0.1 }}
        minZoom={0.05} maxZoom={2}
        style={{ background: c.bg }}
        proOptions={{ hideAttribution: true }}
        nodesDraggable
      >
        <FocusController setNodes={setNodes} />
        <Background variant={BackgroundVariant.Dots} color="rgba(185,185,189,0.07)" gap={24} size={1} />
        <Controls showInteractive={false} />
        <MiniMap nodeColor="#1e1e28" maskColor="rgba(16,16,20,0.85)" />
      </ReactFlow>
    </div>
  )
}

// ─── Data loading ─────────────────────────────────────────────────────────────
type ViewStatus = 'idle' | 'loading' | 'no_parse' | 'parsing' | 'ready' | 'error'
interface GraphData { nodes: Node[]; edges: Edge[] }

async function loadGraphData(
  auditId: string,
  scopeContractId: string,
): Promise<{ status: ViewStatus; graphData?: GraphData }> {
  // ── 1. Parsed contracts for this .sol file ──────────────────────────────────
  const { items: parsed } = await listParsedContractsForFile(auditId, scopeContractId)
  if (parsed.length === 0) return { status: 'no_parse' }

  const anyParsing = parsed.some((pc) => pc.parse_status === 'parsing')
  const ready = parsed.filter((pc) => pc.parse_status === 'parsed' || pc.parse_status === 'analyzed')
  if (ready.length === 0) return { status: anyParsing ? 'parsing' : 'no_parse' }

  // ── 2. Functions in current file ────────────────────────────────────────────
  const currentFns: Array<{ fn: ParsedFunctionRead; contractName: string }> = []
  await Promise.all(ready.map(async (pc) => {
    const { items: fns } = await listFunctions(pc.id)
    fns.forEach((fn) => currentFns.push({ fn, contractName: pc.name }))
  }))
  if (currentFns.length === 0) return { status: 'no_parse' }

  // ── 3. Source for current file ──────────────────────────────────────────────
  const currentSource = await getContractContent(scopeContractId)
  const currentLines  = currentSource.split('\n')

  // ── 4. Full call graph for audit ────────────────────────────────────────────
  let allEdges: CallEdgeRead[] = []
  let allAuditFns: ParsedFunctionRead[] = []
  try {
    const cg = await getCallGraph(auditId)
    allEdges    = cg.edges
    allAuditFns = cg.functions
  } catch { /* not yet analyzed — nodes without edges */ }

  const currentFnIds  = new Set(currentFns.map((f) => f.fn.id))
  const allAuditFnMap = new Map(allAuditFns.map((f) => [f.id, f]))

  // Edges where the caller is in the current file (include cross-file callees)
  const relevantEdges = allEdges.filter(
    (e) => currentFnIds.has(e.caller_function_id) && !!e.callee_function_id,
  )

  // ── 5. Resolve external callees (follow imports) ────────────────────────────
  const externalCalleeIds = new Set(
    relevantEdges.filter((e) => !currentFnIds.has(e.callee_function_id!)).map((e) => e.callee_function_id!),
  )

  // Build a signature → fn map so we can match _disableInitializers() and similar
  // functions that may have a different id in the call graph vs the function list
  const sigToFn = new Map<string, ParsedFunctionRead>()
  for (const fn of allAuditFns) {
    if (fn.selector) sigToFn.set(fn.selector, fn)
    const simpleSig = `${fn.name}(${(fn.params ?? []).map((p) => p.type).join(',')})`
    sigToFn.set(simpleSig, fn)
    sigToFn.set(fn.name, fn) // last-wins fallback by bare name
  }

  const externalFnData = new Map<string, { fn: ParsedFunctionRead; code: string; contractName: string; scopeContractId: string }>()
  const stubIds        = new Set<string>()

  if (externalCalleeIds.size > 0) {
    // Build parsed_contract_id → parsed contract map
    const { items: allParsedContracts } = await listParsedContracts(auditId)
    const pcMap = new Map<string, ParsedContractRead>(allParsedContracts.map((pc) => [pc.id, pc]))

    // Group external functions by their parsed contract (to batch source fetches)
    const extByContract = new Map<string, ParsedFunctionRead[]>()
    for (const calleeId of externalCalleeIds) {
      // Try direct id lookup first; fall back to signature matching
      let fn = allAuditFnMap.get(calleeId)
      if (!fn) {
        // Find the edge that produced this calleeId to get the signature
        const edge = relevantEdges.find((e) => e.callee_function_id === calleeId)
        if (edge?.callee_signature) fn = sigToFn.get(edge.callee_signature)
        if (!fn && edge?.callee_expression) fn = sigToFn.get(edge.callee_expression.replace(/\(.*/, ''))
      }
      if (!fn) { stubIds.add(calleeId); continue }
      const list = extByContract.get(fn.parsed_contract_id) ?? []
      list.push(fn)
      extByContract.set(fn.parsed_contract_id, list)
    }

    // Fetch source per unique scope contract
    await Promise.all([...extByContract.entries()].map(async ([pcId, fns]) => {
      const pc = pcMap.get(pcId)
      if (!pc) { fns.forEach((fn) => stubIds.add(fn.id)); return }
      try {
        const src  = await getContractContent(pc.scope_contract_id)
        const srcs = src.split('\n')
        for (const fn of fns) {
          const code = fn.source_line_start != null && fn.source_line_end != null
            ? srcs.slice(fn.source_line_start - 1, fn.source_line_end).join('\n')
            : `// ${fn.name}`
          externalFnData.set(fn.id, { fn, code, contractName: pc.name, scopeContractId: pc.scope_contract_id })
        }
      } catch {
        fns.forEach((fn) => stubIds.add(fn.id))
      }
    }))
  }

  // ── 6. Call sites per function (for positioned handles + text-scan fallback) ─
  const callSitesByFn = new Map<string, CallSite[]>()
  for (const e of relevantEdges) {
    if (!e.callee_function_id) continue

    const callerFn = currentFns.find((f) => f.fn.id === e.caller_function_id)?.fn

    // Resolve callee display name — prefer resolved fn name, then edge metadata
    const resolvedFn = allAuditFnMap.get(e.callee_function_id)
      ?? externalFnData.get(e.callee_function_id)?.fn
    const calleeName = resolvedFn?.name
      ?? e.callee_expression?.replace(/\(.*/, '').replace(/.*\./, '')
      ?? e.callee_signature?.replace(/\(.*/, '')
      ?? null
    if (!calleeName) continue

    const calleeNodeId = e.callee_function_id
    const sites = callSitesByFn.get(e.caller_function_id) ?? []

    if (e.source_line != null && callerFn?.source_line_start != null && e.source_line > callerFn.source_line_start) {
      // ── Primary path: Slither gave us the exact line ──────────────────────
      const relOffset = e.source_line - callerFn.source_line_start
      sites.push({ edgeId: e.id, sourceLine: e.source_line, callType: e.call_type, isPositioned: relOffset >= 0, calleeNodeId, calleeName })
    } else if (callerFn?.source_line_start != null && callerFn?.source_line_end != null) {
      // ── Fallback: regex-scan the function body for `calleeName(` ──────────
      // Handles bare calls foo(), member calls obj.foo(), and chained calls
      const re = new RegExp(`(?:^|[^\\w$])${calleeName.replace(/[$]/g, '\\$')}\\s*\\(`)
      const bodyLines = currentLines.slice(callerFn.source_line_start - 1, callerFn.source_line_end)
      let foundAny = false
      bodyLines.forEach((ln, idx) => {
        if (!re.test(ln)) return
        const absLine = callerFn.source_line_start! + idx
        if (!sites.some(s => s.sourceLine === absLine && s.calleeName === calleeName)) {
          sites.push({ edgeId: foundAny ? `${e.id}_s${idx}` : e.id, sourceLine: absLine, callType: e.call_type, isPositioned: true, calleeNodeId, calleeName })
          foundAny = true
        }
      })
      if (!foundAny) {
        sites.push({ edgeId: e.id, sourceLine: null, callType: e.call_type, isPositioned: false, calleeNodeId, calleeName })
      }
    }

    callSitesByFn.set(e.caller_function_id, sites)
  }

  // ── 7. React Flow nodes ─────────────────────────────────────────────────────
  const rfNodes: Node[] = []

  const noop = () => {}   // placeholder — FocusController injects the real one

  // Current file functions
  for (const { fn, contractName } of currentFns) {
    const code = fn.source_line_start != null && fn.source_line_end != null
      ? currentLines.slice(fn.source_line_start - 1, fn.source_line_end).join('\n')
      : `// ${fn.name} — source unavailable`
    rfNodes.push({
      id: fn.id, type: 'functionNode' as const, position: { x: 0, y: 0 },
      data: {
        fn, contractName, code,
        callSites: callSitesByFn.get(fn.id) ?? [],
        isExternal: false,
        nodeWidth: fnNodeWidth(code),
        onFocusNode: noop,
      },
    })
  }

  // External / imported functions
  for (const [fnId, { fn, code, contractName }] of externalFnData) {
    rfNodes.push({
      id: fnId, type: 'functionNode' as const, position: { x: 0, y: 0 },
      data: {
        fn, contractName, code,
        callSites: [],
        isExternal: true,
        nodeWidth: fnNodeWidth(code),
        onFocusNode: noop,
      },
    })
  }

  // Stub nodes (function not found)
  const stubNames = new Map<string, string>()
  for (const e of relevantEdges) {
    if (!e.callee_function_id || !stubIds.has(e.callee_function_id)) continue
    if (!stubNames.has(e.callee_function_id))
      stubNames.set(e.callee_function_id, e.callee_signature ?? e.callee_expression ?? 'unknown')
  }
  for (const [stubId, displayName] of stubNames) {
    rfNodes.push({
      id: stubId, type: 'stubNode' as const, position: { x: 0, y: 0 },
      data: { displayName },
    })
  }

  // ── 8. React Flow edges ─────────────────────────────────────────────────────
  const rfEdges: Edge[] = relevantEdges
    .filter((e) => !!e.callee_function_id)
    .flatMap((e) => {
      const callSites = callSitesByFn.get(e.caller_function_id) ?? []
      const sitesForEdge = callSites.filter((s) => s.edgeId === e.id || s.edgeId.startsWith(`${e.id}_s`))
      
      if (sitesForEdge.length === 0) {
        return [{
          id: e.id,
          source: e.caller_function_id,
          target: e.callee_function_id!,
          sourceHandle: 'out',
          targetHandle: 'in',
          type: 'smoothstep',
          animated: true,
          style: { stroke: edgeColor(e.call_type), strokeWidth: 1.5 },
          markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor(e.call_type), width: 14, height: 14 },
        }]
      }

      return sitesForEdge.map((site, idx) => ({
        id: sitesForEdge.length === 1 ? e.id : `${e.id}_${idx}`,
        source: e.caller_function_id,
        target: e.callee_function_id!,
        sourceHandle: site.isPositioned && site.sourceLine != null ? site.edgeId : 'out',
        targetHandle: 'in',
        type: 'smoothstep',
        animated: true,
        style: { stroke: edgeColor(e.call_type), strokeWidth: 1.5 },
        markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor(e.call_type), width: 14, height: 14 },
      }))
    })

  // ── 9. Dagre layout ─────────────────────────────────────────────────────────
  const laidOut = applyDagreLayout(rfNodes, rfEdges)
  return { status: 'ready', graphData: { nodes: laidOut, edges: rfEdges } }
}

// ─── Legend ───────────────────────────────────────────────────────────────────
const LEGEND: Array<{ type: CallType; label: string }> = [
  { type: 'internal', label: 'internal' },
  { type: 'external', label: 'external' },
  { type: 'delegatecall', label: 'delegatecall' },
  { type: 'staticcall', label: 'staticcall' },
  { type: 'library_call', label: 'library' },
]

// ─── SolaudityView ────────────────────────────────────────────────────────────
interface SolaudityViewProps { auditId: string }

export function SolaudityView({ auditId }: SolaudityViewProps) {
  const [contracts, setContracts]   = useState<ScopeContractRead[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [status, setStatus]         = useState<ViewStatus>('idle')
  const [graphData, setGraphData]   = useState<GraphData | null>(null)
  const [errorMsg, setErrorMsg]     = useState('')
  const [parsing, setParsing]       = useState(false)

  useEffect(() => {
    let active = true
    setLoadingList(true)
    listContracts(auditId)
      .then((cs) => { if (active) setContracts(cs) })
      .catch(() => { if (active) setContracts([]) })
      .finally(() => { if (active) setLoadingList(false) })
    return () => { active = false }
  }, [auditId])

  useEffect(() => {
    if (!selectedId) return
    let active = true
    setStatus('loading')
    setGraphData(null)
    loadGraphData(auditId, selectedId)
      .then((r) => {
        if (!active) return
        if (r.status === 'ready' && r.graphData) setGraphData(r.graphData)
        setStatus(r.status)
      })
      .catch((err: unknown) => {
        if (!active) return
        setErrorMsg(err instanceof Error ? err.message : 'Unknown error')
        setStatus('error')
      })
    return () => { active = false }
  }, [auditId, selectedId])

  const handleSelect = useCallback((sc: ScopeContractRead) => setSelectedId(sc.id), [])

  const handleTriggerParse = useCallback(async () => {
    if (!selectedId || parsing) return
    setParsing(true)
    try { await triggerParse(auditId, selectedId); setStatus('parsing') }
    finally { setParsing(false) }
  }, [auditId, selectedId, parsing])

  const tree             = useMemo(() => buildTree(contracts), [contracts])
  const selectedFileName = contracts.find((sc) => sc.id === selectedId)?.file_name

  return (
    <Flex style={{
      width: '100%', height: 'calc(100vh - 180px)', minHeight: 480,
      border: `1px solid ${c.border}`, borderRadius: 14, overflow: 'hidden', background: c.bg,
    }}>
      {/* Sidebar */}
      <Flex direction="column" style={{ width: 220, flexShrink: 0, borderRight: `1px solid ${c.border}`, background: c.sidebar }}>
        <Box style={{
          padding: '10px 8px 6px', fontSize: 10, fontFamily: c.mono, color: c.muted,
          textTransform: 'uppercase', letterSpacing: '0.08em',
          borderBottom: `1px solid ${c.border}`, flexShrink: 0,
        }}>
          Files
        </Box>
        <Box style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
          {loadingList
            ? <Box style={{ padding: '12px', color: c.muted, fontSize: 12 }}>Loading…</Box>
            : tree.length === 0
              ? <Box style={{ padding: '12px', color: c.muted, fontSize: 12 }}>No contracts found</Box>
              : tree.map((node) => (
                <TreeItem key={node.path} node={node} depth={0} selectedId={selectedId} onSelect={handleSelect} />
              ))}
        </Box>
      </Flex>

      {/* Graph panel */}
      <Flex direction="column" style={{ flex: 1, minWidth: 0 }}>
        {/* Header */}
        <Flex align="center" style={{
          height: 36, flexShrink: 0, borderBottom: `1px solid ${c.border}`,
          paddingLeft: 12, paddingRight: 16, background: c.panel, gap: 8,
        }}>
          <GitBranch size={13} style={{ color: c.muted, flexShrink: 0 }} />
          <span style={{ fontSize: 12, fontFamily: c.mono, color: selectedFileName ? c.text : c.muted }}>
            {selectedFileName ?? 'Select a file to view its call graph'}
          </span>
          {status === 'ready' && (
            <Flex align="center" gap="3" style={{ marginLeft: 'auto', flexShrink: 0 }}>
              {LEGEND.map(({ type, label }) => (
                <Flex key={type} align="center" gap="1">
                  <div style={{ width: 14, height: 2, background: edgeColor(type), borderRadius: 1 }} />
                  <span style={{ fontSize: 9, color: c.muted, fontFamily: c.mono }}>{label}</span>
                </Flex>
              ))}
            </Flex>
          )}
        </Flex>

        {/* Canvas / status states */}
        <Box style={{ flex: 1, position: 'relative', minHeight: 0 }}>
          {status === 'idle' && (
            <Flex align="center" justify="center" direction="column"
              style={{ position: 'absolute', inset: 0, color: c.muted, fontSize: 13, fontFamily: c.mono, gap: 10 }}>
              <GitBranch size={36} style={{ color: 'rgba(185,185,193,0.12)', marginBottom: 4 }} />
              <span>Select a file to view its function call graph</span>
            </Flex>
          )}
          {status === 'loading' && (
            <Flex align="center" justify="center"
              style={{ position: 'absolute', inset: 0, color: c.muted, fontSize: 13, fontFamily: c.mono, gap: 10 }}>
              <Loader size={16} style={{ animation: 'svSpin 1s linear infinite', color: c.accent }} />
              <span>Loading graph…</span>
            </Flex>
          )}
          {status === 'no_parse' && (
            <Flex align="center" justify="center" direction="column"
              style={{ position: 'absolute', inset: 0, color: c.muted, fontSize: 13, fontFamily: c.mono, gap: 12 }}>
              <AlertTriangle size={30} style={{ color: '#f2cc60', marginBottom: 2 }} />
              <span style={{ color: c.text }}>This file has not been parsed yet</span>
              <span style={{ fontSize: 11 }}>Parse it first to generate the function call graph</span>
              <button
                onClick={handleTriggerParse} disabled={parsing}
                style={{
                  marginTop: 6, padding: '8px 22px', borderRadius: 6,
                  background: 'rgba(88,214,171,0.1)', border: '1px solid rgba(88,214,171,0.28)',
                  color: c.accent, cursor: parsing ? 'not-allowed' : 'pointer',
                  fontSize: 12, fontFamily: c.mono, fontWeight: 600,
                  display: 'flex', alignItems: 'center', gap: 7, opacity: parsing ? 0.7 : 1,
                }}
              >
                {parsing ? <Loader size={12} style={{ animation: 'svSpin 1s linear infinite' }} /> : <Play size={12} />}
                {parsing ? 'Parsing…' : 'Parse this file'}
              </button>
            </Flex>
          )}
          {status === 'parsing' && (
            <Flex align="center" justify="center" direction="column"
              style={{ position: 'absolute', inset: 0, color: c.muted, fontSize: 13, fontFamily: c.mono, gap: 10 }}>
              <Loader size={28} style={{ animation: 'svSpin 1s linear infinite', color: c.accent, marginBottom: 4 }} />
              <span style={{ color: c.text }}>Parsing in progress…</span>
              <span style={{ fontSize: 11 }}>Reload this view once parsing completes</span>
            </Flex>
          )}
          {status === 'error' && (
            <Flex align="center" justify="center" direction="column"
              style={{ position: 'absolute', inset: 0, color: c.muted, fontSize: 13, fontFamily: c.mono, gap: 10 }}>
              <AlertTriangle size={28} style={{ color: '#f85149', marginBottom: 2 }} />
              <span style={{ color: '#f85149' }}>Failed to load graph</span>
              <span style={{ fontSize: 11 }}>{errorMsg}</span>
            </Flex>
          )}
          {status === 'ready' && graphData && (
            <GraphCanvas key={selectedId!} initNodes={graphData.nodes} initEdges={graphData.edges} />
          )}
        </Box>
      </Flex>

      <style>{`
        @keyframes svSpin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
        .react-flow__attribution { display: none !important; }
        .react-flow__controls {
          background: #14141a !important; border: 1px solid rgba(185,185,189,0.14) !important;
          border-radius: 8px !important; box-shadow: none !important;
        }
        .react-flow__controls-button {
          background: #14141a !important; border-color: rgba(185,185,189,0.12) !important;
          color: rgba(185,185,193,0.6) !important; fill: rgba(185,185,193,0.6) !important;
        }
        .react-flow__controls-button:hover { background: rgba(255,255,255,0.05) !important; }
        .react-flow__minimap { border: 1px solid rgba(185,185,189,0.14) !important; border-radius: 8px !important; }
        .react-flow__node { overflow: visible !important; }

        /* Thin horizontal scrollbar inside code nodes */
        .sv-code-body::-webkit-scrollbar { height: 3px; }
        .sv-code-body::-webkit-scrollbar-track { background: transparent; }
        .sv-code-body::-webkit-scrollbar-thumb { background: rgba(185,185,193,0.18); border-radius: 2px; }
        .sv-code-body::-webkit-scrollbar-thumb:hover { background: rgba(185,185,193,0.35); }
      `}</style>
    </Flex>
  )
}
