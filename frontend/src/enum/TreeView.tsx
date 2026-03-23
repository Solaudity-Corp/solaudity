import { useCallback, useEffect, useRef, useState } from 'react'
import { css } from 'styled-system/css'
import { Box, Flex } from 'styled-system/jsx'
import { ChevronDown, ChevronRight, File, Cpu, Zap, GitBranch, Play } from 'lucide-react'
import { ProcessingOverlay } from '../components/ProcessingOverlay'
import * as scopeApi from '../scope/api'
import * as solApi from './api'
import type { ParsedContractRead, ParsedFunctionRead, CallEdgeRead } from './api'

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------
const c = {
  bg: '#101014',
  surface: 'rgba(24, 24, 29, 0.9)',
  card: 'rgba(30, 30, 38, 0.95)',
  border: 'rgba(185, 185, 189, 0.14)',
  borderSoft: 'rgba(185, 185, 189, 0.22)',
  accent: 'rgba(88, 214, 171, 0.9)',
  accentStr: '#58D6AB',
  accentFaint: 'rgba(88, 214, 171, 0.08)',
  text: 'rgba(231, 228, 239, 0.96)',
  textSub: 'rgba(231, 228, 239, 0.72)',
  textMuted: 'rgba(185, 185, 189, 0.55)',
  purple: 'rgba(180, 140, 255, 0.85)',
  blue: 'rgba(100, 160, 255, 0.85)',
  yellow: 'rgba(255, 210, 80, 0.85)',
  orange: 'rgba(255, 150, 80, 0.85)',
  red: 'rgba(255, 90, 90, 0.85)',
  mono: "'Roboto Mono', ui-monospace, monospace",
}

// ---------------------------------------------------------------------------
// Node graph types
// ---------------------------------------------------------------------------
type NodeData = {
  id: string
  label: string
  visibility: string | null
  mutability: string | null
  is_entry_point: boolean | null
  is_constructor: boolean
  x: number
  y: number
  width: number
  height: number
  column: number
}

type EdgeData = {
  id: string
  from: string
  to: string
  is_cross_contract: boolean
}

// Node colour by function type
function nodeColor(node: NodeData): { fill: string; stroke: string; text: string } {
  if (node.is_entry_point)        return { fill: 'rgba(88,214,171,0.15)',  stroke: '#58D6AB',               text: '#58D6AB' }
  if (node.is_constructor)        return { fill: 'rgba(180,140,255,0.15)', stroke: 'rgba(180,140,255,0.8)', text: 'rgba(180,140,255,0.9)' }
  if (node.mutability === 'pure')  return { fill: 'rgba(180,140,255,0.10)', stroke: 'rgba(180,140,255,0.5)', text: 'rgba(180,140,255,0.85)' }
  if (node.mutability === 'view')  return { fill: 'rgba(100,160,255,0.10)', stroke: 'rgba(100,160,255,0.5)', text: 'rgba(100,160,255,0.85)' }
  if (node.mutability === 'payable') return { fill: 'rgba(255,150,80,0.12)', stroke: 'rgba(255,150,80,0.6)', text: 'rgba(255,150,80,0.9)' }
  if (node.visibility === 'internal' || node.visibility === 'private')
    return { fill: 'rgba(185,185,189,0.07)', stroke: 'rgba(185,185,189,0.28)', text: 'rgba(185,185,189,0.65)' }
  return { fill: 'rgba(30,30,38,0.95)', stroke: 'rgba(185,185,189,0.35)', text: 'rgba(231,228,239,0.85)' }
}

// ---------------------------------------------------------------------------
// BFS layout — assign columns by call depth from entry points
// ---------------------------------------------------------------------------
function buildLayout(
  functions: ParsedFunctionRead[],
  edges: CallEdgeRead[],
): { nodes: NodeData[]; edges: EdgeData[] } {
  const NODE_W = 160
  const NODE_H = 36
  const COL_GAP = 220
  const ROW_GAP = 52

  // Build adjacency
  const outgoing = new Map<string, string[]>()
  const incoming = new Map<string, Set<string>>()
  for (const fn of functions) {
    outgoing.set(fn.id, [])
    incoming.set(fn.id, new Set())
  }
  const validEdges: EdgeData[] = []
  for (const e of edges) {
    if (!e.callee_function_id) continue
    if (!outgoing.has(e.caller_function_id) || !outgoing.has(e.callee_function_id)) continue
    outgoing.get(e.caller_function_id)!.push(e.callee_function_id)
    incoming.get(e.callee_function_id)!.add(e.caller_function_id)
    validEdges.push({ id: e.id, from: e.caller_function_id, to: e.callee_function_id, is_cross_contract: e.is_cross_contract })
  }

  // BFS from entry points
  const col = new Map<string, number>()
  const queue: string[] = []
  for (const fn of functions) {
    if (fn.is_entry_point || fn.is_constructor) {
      col.set(fn.id, 0)
      queue.push(fn.id)
    }
  }
  // BFS
  let qi = 0
  while (qi < queue.length) {
    const id = queue[qi++]
    const c0 = col.get(id)!
    for (const nxt of outgoing.get(id) ?? []) {
      if (!col.has(nxt) || col.get(nxt)! < c0 + 1) {
        col.set(nxt, c0 + 1)
        queue.push(nxt)
      }
    }
  }
  // Remaining nodes that aren't reachable from entry points
  for (const fn of functions) {
    if (!col.has(fn.id)) col.set(fn.id, 0)
  }

  // Group by column
  const byCol = new Map<number, string[]>()
  for (const [id, c0] of col.entries()) {
    const arr = byCol.get(c0) ?? []
    arr.push(id)
    byCol.set(c0, arr)
  }

  const fnMap = new Map<string, ParsedFunctionRead>()
  for (const fn of functions) fnMap.set(fn.id, fn)

  const nodes: NodeData[] = []
  for (const [colIdx, ids] of byCol.entries()) {
    ids.forEach((id, rowIdx) => {
      const fn = fnMap.get(id)!
      const label = fn.is_constructor ? 'constructor'
        : fn.is_fallback ? 'fallback'
        : fn.is_receive ? 'receive'
        : fn.name
      nodes.push({
        id,
        label,
        visibility: fn.visibility ?? null,
        mutability: fn.mutability ?? null,
        is_entry_point: fn.is_entry_point ?? null,
        is_constructor: fn.is_constructor,
        x: colIdx * COL_GAP,
        y: rowIdx * ROW_GAP,
        width: NODE_W,
        height: NODE_H,
        column: colIdx,
      })
    })
  }

  return { nodes, edges: validEdges }
}

// ---------------------------------------------------------------------------
// Cubic bezier path between two nodes
// ---------------------------------------------------------------------------
function edgePath(from: NodeData, to: NodeData): string {
  const x1 = from.x + from.width
  const y1 = from.y + from.height / 2
  const x2 = to.x
  const y2 = to.y + to.height / 2
  const cx = (x1 + x2) / 2
  return `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`
}

// ---------------------------------------------------------------------------
// SVG call graph canvas
// ---------------------------------------------------------------------------
function CallGraphCanvas({
  functions, edges, contractName,
}: {
  functions: ParsedFunctionRead[]
  edges: CallEdgeRead[]
  contractName: string
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)
  const [pan, setPan] = useState({ x: 20, y: 20 })
  const [dragging, setDragging] = useState(false)
  const dragStart = useRef<{ mx: number; my: number; px: number; py: number } | null>(null)

  const { nodes, edges: layoutEdges } = buildLayout(functions, edges)

  const nodeMap = new Map(nodes.map(n => [n.id, n]))

  const onMouseDown = (e: React.MouseEvent) => {
    if ((e.target as SVGElement).closest('.node-group')) return
    setDragging(true)
    dragStart.current = { mx: e.clientX, my: e.clientY, px: pan.x, py: pan.y }
  }
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragging || !dragStart.current) return
    setPan({
      x: dragStart.current.px + (e.clientX - dragStart.current.mx),
      y: dragStart.current.py + (e.clientY - dragStart.current.my),
    })
  }
  const onMouseUp = () => { setDragging(false); dragStart.current = null }

  if (functions.length === 0) {
    return (
      <Flex align="center" justify="center" style={{ height: '100%', flexDirection: 'column', gap: 12 }}>
        <GitBranch size={32} style={{ color: c.textMuted, opacity: 0.4 }} />
        <span style={{ fontSize: 13, color: c.textMuted, fontStyle: 'italic' }}>
          No functions found in {contractName}
        </span>
      </Flex>
    )
  }

  return (
    <Box style={{ height: '100%', overflow: 'hidden', position: 'relative', cursor: dragging ? 'grabbing' : 'grab' }}>
      {/* Legend */}
      <Flex gap="2" style={{ position: 'absolute', top: 10, right: 12, zIndex: 10, flexWrap: 'wrap' }}>
        {[
          { color: '#58D6AB',               label: 'entry' },
          { color: 'rgba(180,140,255,0.9)', label: 'constructor/pure' },
          { color: 'rgba(100,160,255,0.85)',label: 'view' },
          { color: 'rgba(255,150,80,0.9)',  label: 'payable' },
          { color: 'rgba(185,185,189,0.6)', label: 'internal/private' },
        ].map(({ color, label }) => (
          <Flex key={label} align="center" gap="1">
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
            <span style={{ fontSize: 9, color: c.textMuted, fontFamily: c.mono }}>{label}</span>
          </Flex>
        ))}
      </Flex>

      <svg
        ref={svgRef}
        style={{ width: '100%', height: '100%' }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      >
        <defs>
          <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L0,6 L8,3 z" fill="rgba(185,185,189,0.35)" />
          </marker>
          <marker id="arrow-highlight" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L0,6 L8,3 z" fill={c.accentStr} />
          </marker>
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        <g transform={`translate(${pan.x}, ${pan.y})`}>
          {/* Edges */}
          {layoutEdges.map(edge => {
            const from = nodeMap.get(edge.from)
            const to = nodeMap.get(edge.to)
            if (!from || !to) return null
            const isHovered = hoveredNode === edge.from || hoveredNode === edge.to
            return (
              <path
                key={edge.id}
                d={edgePath(from, to)}
                fill="none"
                stroke={isHovered ? c.accentStr : 'rgba(185,185,189,0.22)'}
                strokeWidth={isHovered ? 1.5 : 1}
                strokeDasharray={edge.is_cross_contract ? '4 3' : undefined}
                markerEnd={isHovered ? 'url(#arrow-highlight)' : 'url(#arrow)'}
                style={{ transition: 'stroke 0.15s ease, stroke-width 0.15s ease' }}
              />
            )
          })}

          {/* Nodes */}
          {nodes.map(node => {
            const col = nodeColor(node)
            const isHovered = hoveredNode === node.id
            const isConnected = layoutEdges.some(
              e => (e.from === node.id || e.to === node.id) && (hoveredNode === e.from || hoveredNode === e.to)
            )
            return (
              <g
                key={node.id}
                className="node-group"
                transform={`translate(${node.x}, ${node.y})`}
                onMouseEnter={() => setHoveredNode(node.id)}
                onMouseLeave={() => setHoveredNode(null)}
                style={{ cursor: 'default' }}
              >
                {/* Drop shadow */}
                {(isHovered || isConnected) && (
                  <rect
                    x={-2} y={-2}
                    width={node.width + 4} height={node.height + 4}
                    rx={10} ry={10}
                    fill={col.stroke}
                    opacity={0.12}
                    filter="url(#glow)"
                  />
                )}
                {/* Node pill */}
                <rect
                  x={0} y={0}
                  width={node.width} height={node.height}
                  rx={8} ry={8}
                  fill={isHovered ? col.fill.replace(/[\d.]+\)$/, '0.28)') : col.fill}
                  stroke={isHovered || isConnected ? col.stroke : col.stroke.replace(/[\d.]+\)$/, '0.45)')}
                  strokeWidth={isHovered ? 1.5 : 1}
                  style={{ transition: 'fill 0.15s ease, stroke 0.15s ease' }}
                />
                {/* Entry point dot */}
                {node.is_entry_point && (
                  <circle cx={12} cy={node.height / 2} r={3} fill={c.accentStr} opacity={0.9} />
                )}
                {/* Label */}
                <text
                  x={node.is_entry_point ? 22 : 12}
                  y={node.height / 2 + 1}
                  dominantBaseline="middle"
                  fontSize={11}
                  fontFamily={c.mono}
                  fill={isHovered ? col.text.replace(/[\d.]+\)$/, '1)') : col.text}
                  style={{ pointerEvents: 'none', transition: 'fill 0.15s ease' }}
                >
                  {node.label.length > 17 ? node.label.slice(0, 15) + '…' : node.label}
                </text>
                {/* Visibility badge */}
                {node.visibility && (
                  <text
                    x={node.width - 6}
                    y={node.height / 2 + 1}
                    dominantBaseline="middle"
                    textAnchor="end"
                    fontSize={9}
                    fontFamily={c.mono}
                    fill={c.textMuted}
                    opacity={0.7}
                    style={{ pointerEvents: 'none' }}
                  >
                    {node.visibility === 'external' ? 'ext'
                      : node.visibility === 'internal' ? 'int'
                      : node.visibility === 'private' ? 'prv'
                      : 'pub'}
                  </text>
                )}
              </g>
            )
          })}
        </g>
      </svg>

      {/* Node count */}
      <div style={{
        position: 'absolute', bottom: 10, right: 12,
        fontSize: 10, color: c.textMuted, fontFamily: c.mono,
      }}>
        {nodes.length} nodes · {layoutEdges.length} edges
      </div>
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Left panel badges
// ---------------------------------------------------------------------------
function Badge({ children, color = c.textMuted, bg = 'rgba(255,255,255,0.06)' }: {
  children: React.ReactNode; color?: string; bg?: string
}) {
  return (
    <span style={{
      display: 'inline-block', padding: '1px 6px', borderRadius: 6,
      fontSize: 10, fontWeight: 600, background: bg, color,
      fontFamily: c.mono, whiteSpace: 'nowrap', lineHeight: '16px',
    }}>
      {children}
    </span>
  )
}

function KindBadge({ kind }: { kind: string }) {
  const map: Record<string, { color: string; bg: string }> = {
    contract:  { color: c.accentStr, bg: 'rgba(88,214,171,0.10)' },
    library:   { color: c.purple,    bg: 'rgba(180,140,255,0.10)' },
    interface: { color: c.blue,      bg: 'rgba(100,160,255,0.10)' },
    abstract:  { color: c.yellow,    bg: 'rgba(255,210,80,0.10)' },
  }
  const s = map[kind] ?? { color: c.textMuted, bg: 'rgba(255,255,255,0.06)' }
  return <Badge color={s.color} bg={s.bg}>{kind}</Badge>
}

// ---------------------------------------------------------------------------
// Left panel components
// ---------------------------------------------------------------------------
function LeftContractNode({
  pc, isSelected, onSelect,
}: {
  pc: ParsedContractRead
  isSelected: boolean
  onSelect: () => void
}) {
  return (
    <Box
      onClick={onSelect}
      style={{
        display: 'flex', alignItems: 'center', gap: 5,
        cursor: 'pointer', marginBottom: 2,
        padding: '3px 8px', borderRadius: 5,
        background: isSelected ? 'rgba(88,214,171,0.1)' : 'transparent',
        border: `1px solid ${isSelected ? 'rgba(88,214,171,0.25)' : 'transparent'}`,
      }}
      className={css({ _hover: { background: isSelected ? 'rgba(88,214,171,0.12)' : 'rgba(255,255,255,0.04)' } })}
    >
      <Cpu size={11} style={{ color: c.accentStr, flexShrink: 0 }} />
      <span style={{ fontSize: 12, fontWeight: isSelected ? 700 : 500, color: isSelected ? c.accentStr : c.text, fontFamily: c.mono, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {pc.name}
      </span>
      <KindBadge kind={pc.contract_kind} />
    </Box>
  )
}

function LeftFileRow({
  sc, definitions, expandedFiles, selectedPcId,
  onToggleFile, onSelectContract,
}: {
  sc: scopeApi.ScopeContract
  definitions: ParsedContractRead[]
  expandedFiles: Set<string>
  selectedPcId: string | null
  onToggleFile: (id: string) => void
  onSelectContract: (pcId: string) => void
}) {
  const isOpen = expandedFiles.has(sc.id)
  const fileName = sc.file_path.split('/').pop() ?? sc.file_path

  return (
    <Box style={{ marginBottom: 4 }}>
      <Flex
        align="center" gap="1"
        onClick={() => onToggleFile(sc.id)}
        style={{ cursor: 'pointer', padding: '4px 4px', borderRadius: 6 }}
        className={css({ _hover: { bg: 'rgba(255,255,255,0.03)' } })}
      >
        {isOpen
          ? <ChevronDown size={12} style={{ color: c.textMuted, flexShrink: 0 }} />
          : <ChevronRight size={12} style={{ color: c.textMuted, flexShrink: 0 }} />}
        <File size={12} style={{ color: '#f5a623', flexShrink: 0 }} />
        <span style={{ fontSize: 11, color: c.textSub, fontFamily: c.mono, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {fileName}
        </span>
        {definitions.length > 0 && (
          <span style={{ fontSize: 10, color: c.textMuted, fontFamily: c.mono, flexShrink: 0 }}>
            ({definitions.length})
          </span>
        )}
      </Flex>

      {isOpen && (
        <Box style={{ paddingLeft: 16 }}>
          {definitions.length === 0 && (
            <Box style={{ fontSize: 10, color: c.textMuted, padding: '4px 8px', fontFamily: c.mono }}>
              Not parsed yet
            </Box>
          )}
          {definitions.map(pc => (
            <LeftContractNode
              key={pc.id}
              pc={pc}
              isSelected={selectedPcId === pc.id}
              onSelect={() => onSelectContract(pc.id)}
            />
          ))}
        </Box>
      )}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Main TreeView — visual call graph
// ---------------------------------------------------------------------------
export function TreeView({ auditId }: { auditId: string }) {
  const [scopeContracts, setScopeContracts] = useState<scopeApi.ScopeContract[]>([])
  const [parsedContracts, setParsedContracts] = useState<ParsedContractRead[]>([])
  const [selectedPcId, setSelectedPcId] = useState<string | null>(null)
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [graphData, setGraphData] = useState<{
    functions: ParsedFunctionRead[]
    edges: CallEdgeRead[]
  } | null>(null)
  const [graphLoading, setGraphLoading] = useState(false)

  const defsByFile = new Map<string, ParsedContractRead[]>()
  for (const pc of parsedContracts) {
    const list = defsByFile.get(pc.scope_contract_id) ?? []
    list.push(pc)
    defsByFile.set(pc.scope_contract_id, list)
  }

  const reload = useCallback(async () => {
    try {
      const scopeRes = await scopeApi.listContracts(auditId, true)
      setScopeContracts(scopeRes.items)
    } catch { /* ignore */ }
    try {
      const parsedRes = await solApi.listParsedContracts(auditId)
      setParsedContracts(parsedRes.items)
    } catch { /* ignore */ }
    setLoading(false)
  }, [auditId])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { reload() }, [reload])

  const handleAnalyzeAll = async () => {
    if (scopeContracts.length === 0) return
    setProcessing(true)
    const start = Date.now()

    // Step 1: parse any contracts that haven't been parsed yet
    const unparsed = scopeContracts.filter(sc => {
      const defs = defsByFile.get(sc.id) ?? []
      return defs.length === 0 || defs.every(pc => pc.parse_status === 'pending' || pc.parse_status === 'error')
    })
    for (const sc of unparsed) {
      try { await solApi.triggerParse(auditId, sc.id) } catch (err) { console.error(err) }
    }

    // Step 2: reload to get fresh parsed contracts list
    let freshParsed = parsedContracts
    if (unparsed.length > 0) {
      try {
        const res = await solApi.listParsedContracts(auditId)
        freshParsed = res.items
        setParsedContracts(freshParsed)
      } catch { /* ignore */ }
    }

    // Step 3: analyze all parsed/analyzable contracts
    const toAnalyze = freshParsed.filter(pc => pc.parse_status === 'parsed' || pc.parse_status === 'analyzed')
    for (const pc of toAnalyze) {
      try { await solApi.triggerAnalyze(pc.id) } catch (err) { console.error(err) }
    }

    const remaining = 2000 - (Date.now() - start)
    if (remaining > 0) await new Promise(r => setTimeout(r, remaining))
    setProcessing(false)
    await reload()
  }

  const handleSelectContract = async (pcId: string) => {
    setSelectedPcId(pcId)
    setGraphLoading(true)
    setGraphData(null)
    try {
      const [fns, graphRes] = await Promise.all([
        solApi.listFunctions(pcId),
        solApi.getCallGraph(auditId),
      ])
      const fnIds = new Set(fns.items.map(f => f.id))
      const filteredEdges = graphRes.edges.filter(
        e => fnIds.has(e.caller_function_id) || (e.callee_function_id && fnIds.has(e.callee_function_id))
      )
      setGraphData({ functions: fns.items, edges: filteredEdges })
    } catch {
      setGraphData({ functions: [], edges: [] })
    }
    setGraphLoading(false)
  }

  const handleToggleFile = (id: string) => {
    setExpandedFiles(prev => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id) } else { next.add(id) }
      return next
    })
  }

  const selectedPc = parsedContracts.find(pc => pc.id === selectedPcId) ?? null

  return (
    <Box style={{ minHeight: '100%' }}>
      {processing && <ProcessingOverlay />}

      {/* Header */}
      <Flex align="center" gap="3" mb="4" px="2">
        <span style={{ fontSize: 14, fontWeight: 700, color: c.text }}>Call Graph</span>
        <Badge color={c.blue} bg="rgba(100,160,255,0.10)">{parsedContracts.length} contracts</Badge>
        {selectedPc && (
          <Badge color={c.accentStr} bg="rgba(88,214,171,0.10)">
            <Zap size={9} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 3 }} />
            {selectedPc.name}
          </Badge>
        )}
        <button
          onClick={handleAnalyzeAll}
          disabled={processing}
          style={{
            marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5,
            background: 'rgba(88,214,171,0.1)', border: '1px solid rgba(88,214,171,0.3)',
            borderRadius: 8, padding: '4px 12px', fontSize: 11, fontWeight: 600,
            color: c.accentStr, cursor: processing ? 'not-allowed' : 'pointer', fontFamily: c.mono,
            opacity: processing ? 0.6 : 1,
          }}
        >
          <Play size={11} /> Analyze All
        </button>
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
        <Flex gap="0" style={{ height: 'calc(100vh - 280px)', minHeight: 400 }}>

          {/* Left panel — 30% */}
          <Box style={{
            width: '30%', borderRight: `1px solid ${c.borderSoft}`,
            paddingRight: 10, overflowY: 'auto', flexShrink: 0,
          }}>
            <Box style={{ fontSize: 10, color: c.textMuted, fontFamily: c.mono, marginBottom: 8, padding: '0 4px' }}>
              Click a contract to visualize its call graph
            </Box>
            {scopeContracts.map(sc => (
              <LeftFileRow
                key={sc.id}
                sc={sc}
                definitions={defsByFile.get(sc.id) ?? []}
                expandedFiles={expandedFiles}
                selectedPcId={selectedPcId}
                onToggleFile={handleToggleFile}
                onSelectContract={handleSelectContract}
              />
            ))}
          </Box>

          {/* Right panel — 70% — SVG call graph */}
          <Box style={{ flex: 1, paddingLeft: 16, overflow: 'hidden', position: 'relative' }}>
            {!selectedPc && !graphLoading && (
              <Flex align="center" justify="center" style={{ height: '100%', flexDirection: 'column', gap: 16 }}>
                <GitBranch size={48} style={{ color: c.textMuted, opacity: 0.25 }} />
                <span style={{ fontSize: 13, color: c.textMuted, fontStyle: 'italic' }}>
                  ← Select a contract to visualize its call graph
                </span>
              </Flex>
            )}

            {graphLoading && (
              <Flex align="center" justify="center" style={{ height: '100%', flexDirection: 'column', gap: 12 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: '50%',
                  border: `2px solid ${c.border}`,
                  borderTop: `2px solid ${c.accentStr}`,
                  animation: 'spin 0.8s linear infinite',
                }} />
                <span style={{ fontSize: 12, color: c.textMuted, fontFamily: c.mono }}>Building graph…</span>
                <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
              </Flex>
            )}

            {!graphLoading && selectedPc && graphData && (
              <Box style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                {/* Contract header */}
                <Flex align="center" gap="2" mb="3" pb="2" style={{ borderBottom: `1px solid ${c.border}`, flexShrink: 0 }}>
                  <Cpu size={14} style={{ color: c.accentStr }} />
                  <span style={{ fontSize: 14, fontWeight: 700, color: c.text, fontFamily: c.mono }}>{selectedPc.name}</span>
                  <span style={{ fontSize: 10, color: c.textMuted, fontFamily: c.mono }}>
                    {graphData.functions.length} functions · {graphData.edges.length} call edges
                  </span>
                </Flex>
                <Box style={{ flex: 1, overflow: 'hidden' }}>
                  <CallGraphCanvas
                    functions={graphData.functions}
                    edges={graphData.edges}
                    contractName={selectedPc.name}
                  />
                </Box>
              </Box>
            )}
          </Box>
        </Flex>
      )}
    </Box>
  )
}
