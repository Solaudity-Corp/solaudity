import { useCallback, useEffect, useState } from 'react'
import { css } from 'styled-system/css'
import { Box, Flex } from 'styled-system/jsx'
import {
  ChevronDown, ChevronRight, File,
  Zap, Database, Radio, Shield,
  AlertTriangle, Cpu, Play,
} from 'lucide-react'
import { ProcessingOverlay } from '../components/ProcessingOverlay'
import * as scopeApi from '../scope/api'
import * as solApi from './api'
import type {
  ParsedContractRead, ParsedFunctionRead, ParsedStateVariableRead,
  ParsedEventRead, ParsedModifierRead, CallEdgeRead,
} from './api'

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
// Shared badge helpers
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

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { color: string; bg: string; label: string }> = {
    pending:  { color: c.textMuted, bg: 'rgba(255,255,255,0.05)', label: 'pending' },
    parsing:  { color: c.yellow,    bg: 'rgba(255,210,80,0.10)',  label: 'parsing…' },
    parsed:   { color: c.blue,      bg: 'rgba(100,160,255,0.10)', label: 'parsed' },
    analyzed: { color: c.accentStr, bg: 'rgba(88,214,171,0.10)',  label: 'analyzed ✓' },
    error:    { color: c.red,       bg: 'rgba(255,90,90,0.10)',   label: 'error' },
  }
  const s = map[status] ?? map.pending
  return <Badge color={s.color} bg={s.bg}>{s.label}</Badge>
}

function VisBadge({ v }: { v: string | null }) {
  if (!v) return null
  const map: Record<string, string> = {
    public: c.accentStr, external: c.blue, internal: c.yellow, private: c.textMuted,
  }
  return <Badge color={map[v] ?? c.textMuted}>{v}</Badge>
}

function MutBadge({ m }: { m: string | null }) {
  if (!m || m === 'nonpayable') return null
  const map: Record<string, string> = { pure: c.purple, view: c.blue, payable: c.orange }
  return <Badge color={map[m] ?? c.textMuted}>{m}</Badge>
}

function LineRange({ start, end }: { start: number | null; end: number | null }) {
  if (!start) return null
  return (
    <span style={{ fontSize: 10, color: c.textMuted, fontFamily: c.mono }}>
      L:{start}{end && end !== start ? `–${end}` : ''}
    </span>
  )
}

function SectionHeader({
  icon: Icon, label, count, expanded, onToggle, iconColor = c.textMuted,
}: {
  icon: React.ElementType; label: string; count: number
  expanded: boolean; onToggle: () => void; iconColor?: string
}) {
  return (
    <Flex align="center" gap="2" onClick={onToggle}
      className={css({ px: '3', py: '1.5', cursor: 'pointer', userSelect: 'none', borderRadius: '6px', _hover: { bg: 'rgba(255,255,255,0.03)' } })}
    >
      {expanded
        ? <ChevronDown size={12} style={{ color: c.textMuted, flexShrink: 0 }} />
        : <ChevronRight size={12} style={{ color: c.textMuted, flexShrink: 0 }} />}
      <Icon size={13} style={{ color: iconColor, flexShrink: 0 }} />
      <span style={{ fontSize: 12, fontWeight: 600, color: c.textSub }}>{label}</span>
      <span style={{ fontSize: 10, color: c.textMuted, background: 'rgba(255,255,255,0.07)', padding: '0 5px', borderRadius: 10, fontFamily: c.mono }}>
        {count}
      </span>
    </Flex>
  )
}

// ---------------------------------------------------------------------------
// Right-panel detail sub-rows
// ---------------------------------------------------------------------------
function FunctionRow({ fn, varMap }: { fn: ParsedFunctionRead; varMap: Map<string, string> }) {
  const [expanded, setExpanded] = useState(false)
  const sig = (() => {
    const ps = (fn.params ?? []).map(p => `${p.type}${p.name ? ' ' + p.name : ''}`).join(', ')
    const rs = (fn.return_params ?? []).map(p => p.type).join(', ')
    const special = fn.is_constructor ? 'constructor' : fn.is_fallback ? 'fallback' : fn.is_receive ? 'receive' : fn.name
    return `${special}(${ps})${rs ? ` → ${rs.includes(',') ? `(${rs})` : rs}` : ''}`
  })()
  const reads = (fn.reads_var_ids ?? []).map(id => varMap.get(id) ?? id.slice(0, 8))
  const writes = (fn.writes_var_ids ?? []).map(id => varMap.get(id) ?? id.slice(0, 8))
  return (
    <Box style={{ borderBottom: `1px solid ${c.border}` }}>
      <Flex align="center" gap="2" onClick={() => setExpanded(e => !e)}
        className={css({ px: '3', py: '1.5', cursor: 'pointer', _hover: { bg: 'rgba(255,255,255,0.02)' } })}
      >
        {expanded ? <ChevronDown size={10} style={{ color: c.textMuted, flexShrink: 0 }} /> : <ChevronRight size={10} style={{ color: c.textMuted, flexShrink: 0 }} />}
        <span style={{ fontSize: 11, color: c.text, fontFamily: c.mono, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {sig}
        </span>
        <Flex gap="1" align="center" style={{ flexShrink: 0 }}>
          <VisBadge v={fn.visibility} />
          <MutBadge m={fn.mutability} />
          {fn.is_constructor && <Badge color={c.purple} bg="rgba(180,140,255,0.10)">constructor</Badge>}
          {fn.has_reentrancy && <span title="Reentrancy"><AlertTriangle size={12} style={{ color: c.red }} /></span>}
          {fn.is_entry_point && <span title="Entry point"><Zap size={12} style={{ color: c.accentStr }} /></span>}
          <LineRange start={fn.source_line_start} end={fn.source_line_end} />
        </Flex>
      </Flex>
      {expanded && (
        <Box style={{ paddingLeft: 24, paddingBottom: 8, paddingRight: 12 }}>
          <Flex gap="3" wrap="wrap" style={{ marginBottom: 4 }}>
            {fn.selector && <span style={{ fontSize: 10, color: c.textMuted, fontFamily: c.mono }}>selector: <span style={{ color: c.blue }}>0x{fn.selector}</span></span>}
            {(fn.modifiers_applied ?? []).length > 0 && <span style={{ fontSize: 10, color: c.textMuted, fontFamily: c.mono }}>mods: <span style={{ color: c.yellow }}>{fn.modifiers_applied!.join(', ')}</span></span>}
          </Flex>
          {reads.length > 0 && <div style={{ fontSize: 10, color: c.textMuted, fontFamily: c.mono, marginBottom: 2 }}>reads: <span style={{ color: c.blue }}>{reads.join(', ')}</span></div>}
          {writes.length > 0 && <div style={{ fontSize: 10, color: c.textMuted, fontFamily: c.mono, marginBottom: 2 }}>writes: <span style={{ color: c.orange }}>{writes.join(', ')}</span></div>}
        </Box>
      )}
    </Box>
  )
}

function StateVarRow({ v }: { v: ParsedStateVariableRead }) {
  return (
    <Flex align="center" gap="2" className={css({ px: '3', py: '1.5', borderBottom: `1px solid ${c.border}` })}>
      <span style={{ fontSize: 11, color: c.text, fontFamily: c.mono, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        <span style={{ color: c.purple }}>{v.type_str}</span>{' '}
        <span style={{ color: c.text }}>{v.name}</span>
        {v.initial_value && <span style={{ color: c.textMuted }}> = {v.initial_value}</span>}
      </span>
      <Flex gap="1" align="center" style={{ flexShrink: 0 }}>
        <VisBadge v={v.visibility} />
        {v.is_constant && <Badge color={c.yellow} bg="rgba(255,210,80,0.10)">constant</Badge>}
        {v.is_immutable && <Badge color={c.orange} bg="rgba(255,150,80,0.10)">immutable</Badge>}
        <LineRange start={v.source_line_start} end={null} />
      </Flex>
    </Flex>
  )
}

function EventRow({ ev }: { ev: ParsedEventRead }) {
  const paramStr = (ev.params ?? []).map(p => `${p.type}${p.indexed ? ' indexed' : ''} ${p.name}`).join(', ')
  return (
    <Flex align="center" gap="2" className={css({ px: '3', py: '1.5', borderBottom: `1px solid ${c.border}` })}>
      <span style={{ fontSize: 11, color: c.text, fontFamily: c.mono, flex: 1 }}>
        <span style={{ color: c.blue }}>{ev.name}</span>({paramStr})
      </span>
      <LineRange start={ev.source_line_start} end={null} />
    </Flex>
  )
}

function ModifierRow({ mod }: { mod: ParsedModifierRead }) {
  const paramStr = (mod.params ?? []).map(p => `${p.type} ${p.name}`).join(', ')
  return (
    <Flex align="center" gap="2" className={css({ px: '3', py: '1.5', borderBottom: `1px solid ${c.border}` })}>
      <span style={{ fontSize: 11, color: c.text, fontFamily: c.mono, flex: 1 }}>
        <span style={{ color: c.yellow }}>{mod.name}</span>({paramStr})
      </span>
      <Flex gap="1" style={{ flexShrink: 0 }}>
        <VisBadge v={mod.visibility} />
        <LineRange start={mod.source_line_start} end={mod.source_line_end} />
      </Flex>
    </Flex>
  )
}

// ---------------------------------------------------------------------------
// Right panel: full contract details
// ---------------------------------------------------------------------------
type ContractDetails = {
  functions: ParsedFunctionRead[]
  variables: ParsedStateVariableRead[]
  events: ParsedEventRead[]
  modifiers: ParsedModifierRead[]
  loading: boolean
}

function ContractDetailsPanel({
  pc, details,
}: {
  pc: ParsedContractRead
  details: ContractDetails | null | undefined
}) {
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(['functions', 'variables', 'events', 'modifiers']))
  const toggleSection = (s: string) => setOpenSections(prev => {
    const next = new Set(prev)
    if (next.has(s)) { next.delete(s) } else { next.add(s) }
    return next
  })

  const varMap = new Map<string, string>()
  ;(details?.variables ?? []).forEach(v => varMap.set(v.id, v.name))

  return (
    <Box>
      {/* Contract header */}
      <Flex align="center" gap="2" mb="3" pb="3" style={{ borderBottom: `1px solid ${c.borderSoft}` }}>
        <Cpu size={16} style={{ color: c.accentStr }} />
        <span style={{ fontSize: 15, fontWeight: 700, color: c.text, fontFamily: c.mono }}>{pc.name}</span>
        <KindBadge kind={pc.contract_kind} />
        <StatusBadge status={pc.parse_status} />
        {(pc.inheritance ?? []).length > 0 && (
          <span style={{ fontSize: 10, color: c.textMuted, fontFamily: c.mono }}>
            inherits: <span style={{ color: c.textSub }}>{(pc.inheritance ?? []).join(', ')}</span>
          </span>
        )}
        <LineRange start={pc.source_line_start} end={pc.source_line_end} />
      </Flex>

      {details?.loading && (
        <Box className={css({ px: '4', py: '3', color: c.textMuted, fontSize: 'xs', fontFamily: c.mono })}>Loading…</Box>
      )}

      {!details?.loading && details && (
        <Box>
          {/* Functions */}
          <SectionHeader icon={Zap} label="Functions" count={details.functions.length}
            expanded={openSections.has('functions')} onToggle={() => toggleSection('functions')} iconColor={c.accentStr} />
          {openSections.has('functions') && details.functions.length > 0 && (
            <Box style={{ marginLeft: 8, marginBottom: 6, borderRadius: 6, overflow: 'hidden', border: `1px solid ${c.border}` }}>
              {details.functions.map(fn => <FunctionRow key={fn.id} fn={fn} varMap={varMap} />)}
            </Box>
          )}
          {openSections.has('functions') && details.functions.length === 0 && (
            <Box className={css({ px: '5', py: '1', color: c.textMuted, fontSize: 'xs' })}>No functions</Box>
          )}

          {/* State Variables */}
          <SectionHeader icon={Database} label="State Variables" count={details.variables.length}
            expanded={openSections.has('variables')} onToggle={() => toggleSection('variables')} iconColor={c.blue} />
          {openSections.has('variables') && details.variables.length > 0 && (
            <Box style={{ marginLeft: 8, marginBottom: 6, borderRadius: 6, overflow: 'hidden', border: `1px solid ${c.border}` }}>
              {details.variables.map(v => <StateVarRow key={v.id} v={v} />)}
            </Box>
          )}

          {/* Events */}
          <SectionHeader icon={Radio} label="Events" count={details.events.length}
            expanded={openSections.has('events')} onToggle={() => toggleSection('events')} iconColor={c.purple} />
          {openSections.has('events') && details.events.length > 0 && (
            <Box style={{ marginLeft: 8, marginBottom: 6, borderRadius: 6, overflow: 'hidden', border: `1px solid ${c.border}` }}>
              {details.events.map(ev => <EventRow key={ev.id} ev={ev} />)}
            </Box>
          )}

          {/* Modifiers */}
          <SectionHeader icon={Shield} label="Modifiers" count={details.modifiers.length}
            expanded={openSections.has('modifiers')} onToggle={() => toggleSection('modifiers')} iconColor={c.yellow} />
          {openSections.has('modifiers') && details.modifiers.length > 0 && (
            <Box style={{ marginLeft: 8, marginBottom: 6, borderRadius: 6, overflow: 'hidden', border: `1px solid ${c.border}` }}>
              {details.modifiers.map(m => <ModifierRow key={m.id} mod={m} />)}
            </Box>
          )}
        </Box>
      )}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Left panel: single parsed contract node (simple clickable button)
// ---------------------------------------------------------------------------
function LeftContractNode({
  pc, isSelected, onSelect,
}: {
  pc: ParsedContractRead
  isSelected: boolean
  onSelect: () => void
}) {
  return (
    <Box style={{ marginBottom: 2 }}>
      <Box
        onClick={onSelect}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          cursor: 'pointer',
          padding: '3px 8px', borderRadius: 5,
          background: isSelected ? 'rgba(88,214,171,0.1)' : 'transparent',
          border: `1px solid ${isSelected ? 'rgba(88,214,171,0.25)' : 'transparent'}`,
        }}
        className={css({ _hover: { background: isSelected ? 'rgba(88,214,171,0.12)' : 'rgba(255,255,255,0.04)' } })}
      >
        <Cpu size={11} style={{ color: c.accentStr, flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: isSelected ? 700 : 500, color: isSelected ? c.accentStr : c.text, fontFamily: c.mono }}>
          {pc.name}
        </span>
        <KindBadge kind={pc.contract_kind} />
        <StatusBadge status={pc.parse_status} />
      </Box>
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Left panel: scope file row
// ---------------------------------------------------------------------------
function LeftFileRow({
  sc, definitions, expandedFiles, selectedPcId,
  reparsing, onToggleFile, onSelectContract, onParse,
}: {
  sc: scopeApi.ScopeContract
  definitions: ParsedContractRead[]
  expandedFiles: Set<string>
  selectedPcId: string | null
  reparsing: boolean
  onToggleFile: (id: string) => void
  onSelectContract: (pcId: string) => void
  onParse: (id: string) => void
}) {
  const isOpen = expandedFiles.has(sc.id)
  const fileName = sc.file_path.split('/').pop() ?? sc.file_path

  return (
    <Box style={{ marginBottom: 4 }}>
      {/* File row */}
      <Flex
        align="center" gap="1"
        className={css({
          px: '1', py: '1', borderRadius: '6px',
          _hover: { bg: 'rgba(255,255,255,0.03)' },
        })}
      >
        <Box onClick={() => onToggleFile(sc.id)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', flex: 1, gap: 5, minWidth: 0 }}>
          {isOpen
            ? <ChevronDown size={12} style={{ color: c.textMuted, flexShrink: 0 }} />
            : <ChevronRight size={12} style={{ color: c.textMuted, flexShrink: 0 }} />}
          <File size={12} style={{ color: '#f5a623', flexShrink: 0 }} />
          <span style={{ fontSize: 11, color: c.textSub, fontFamily: c.mono, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {fileName}
          </span>
          {definitions.length > 0 && (
            <span style={{ fontSize: 10, color: c.textMuted, fontFamily: c.mono, flexShrink: 0 }}>
              ({definitions.length})
            </span>
          )}
        </Box>
        {/* Re-Parse button */}
        <button
          onClick={e => { e.stopPropagation(); if (!reparsing) onParse(sc.id) }}
          style={{
            fontSize: 9, padding: '1px 6px', borderRadius: 4, cursor: reparsing ? 'not-allowed' : 'pointer',
            border: `1px solid ${c.border}`, background: 'transparent',
            color: reparsing ? c.yellow : c.textMuted, fontFamily: c.mono, fontWeight: 600, flexShrink: 0,
          }}
        >
          {reparsing ? '…' : '↺'}
        </button>
      </Flex>

      {/* Definitions under this file */}
      {isOpen && (
        <Box style={{ paddingLeft: 12 }}>
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
// Main ParseView — 30/70 split layout
// ---------------------------------------------------------------------------
export function ParseView({ auditId }: { auditId: string }) {
  const [scopeContracts, setScopeContracts] = useState<scopeApi.ScopeContract[]>([])
  const [parsedContracts, setParsedContracts] = useState<ParsedContractRead[]>([])
  const [callGraph, setCallGraph] = useState<{ edges: CallEdgeRead[]; functions: ParsedFunctionRead[] } | null>(null)
  const [details, setDetails] = useState<Record<string, ContractDetails>>({})
  const [selectedPcId, setSelectedPcId] = useState<string | null>(null)
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set())
  const [processing, setProcessing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [reparsing, setReparsing] = useState<Set<string>>(new Set())

  // Group parsed contracts by scope_contract_id
  const defsByFile = new Map<string, ParsedContractRead[]>()
  for (const pc of parsedContracts) {
    const list = defsByFile.get(pc.scope_contract_id) ?? []
    list.push(pc)
    defsByFile.set(pc.scope_contract_id, list)
  }

  const loadCallGraph = useCallback(async () => {
    try {
      const g = await solApi.getCallGraph(auditId)
      setCallGraph(g)
    } catch { /* ignore */ }
  }, [auditId])

  const reload = useCallback(async () => {
    try {
      const scopeRes = await scopeApi.listContracts(auditId, true)
      setScopeContracts(scopeRes.items)
    } catch (err) { console.error('Failed to load scope contracts:', err) }
    try {
      const parsedRes = await solApi.listParsedContracts(auditId)
      setParsedContracts(parsedRes.items)
    } catch { /* ignore */ }
    setLoading(false)
  }, [auditId])

  useEffect(() => { reload().then(() => loadCallGraph()) }, [reload, loadCallGraph])

  const loadDetails = async (pcId: string) => {
    if (details[pcId]) return
    setDetails(prev => ({ ...prev, [pcId]: { functions: [], variables: [], events: [], modifiers: [], loading: true } }))
    try {
      const [fns, vars, evs, mods] = await Promise.all([
        solApi.listFunctions(pcId),
        solApi.listStateVariables(pcId),
        solApi.listEvents(pcId),
        solApi.listModifiers(pcId),
      ])
      setDetails(prev => ({
        ...prev,
        [pcId]: { functions: fns.items, variables: vars.items, events: evs.items, modifiers: mods.items, loading: false },
      }))
    } catch {
      setDetails(prev => ({ ...prev, [pcId]: { functions: [], variables: [], events: [], modifiers: [], loading: false } }))
    }
  }

  const handleParse = async (scopeContractId: string) => {
    setReparsing(prev => new Set(prev).add(scopeContractId))
    try { await solApi.triggerParse(auditId, scopeContractId) } catch (err) { console.error(err) }
    setReparsing(prev => { const next = new Set(prev); next.delete(scopeContractId); return next })
    await reload()
  }

  const handleAnalyzeAll = async () => {
    if (scopeContracts.length === 0) return
    setProcessing(true)
    // eslint-disable-next-line react-hooks/purity
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

    // eslint-disable-next-line react-hooks/purity
    const remaining = 2000 - (Date.now() - start)
    if (remaining > 0) await new Promise(r => setTimeout(r, remaining))
    setProcessing(false)
    setDetails({})
    await reload()
    await loadCallGraph()
  }

  const handleSelectContract = async (pcId: string) => {
    setSelectedPcId(pcId)
    await loadDetails(pcId)
  }

  const handleToggleFile = (id: string) => {
    setExpandedFiles(prev => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id) } else { next.add(id) }
      return next
    })
  }

  // Filter
  const lowerSearch = search.toLowerCase()
  const filteredContracts = search
    ? scopeContracts.filter(sc => {
        if (sc.file_path.toLowerCase().includes(lowerSearch)) return true
        return (defsByFile.get(sc.id) ?? []).some(pc => pc.name.toLowerCase().includes(lowerSearch))
      })
    : scopeContracts

  const selectedPc = parsedContracts.find(pc => pc.id === selectedPcId) ?? null
  const analyzedCount = parsedContracts.filter(pc => pc.parse_status === 'analyzed').length
  const callEdgeCount = callGraph?.edges.length ?? 0

  return (
    <Box style={{ minHeight: '100%' }}>
      {processing && <ProcessingOverlay />}

      {/* Header */}
      <Flex align="center" gap="3" mb="4" px="2" wrap="wrap">
        <span style={{ fontSize: 14, fontWeight: 700, color: c.text }}>Contract Tree</span>
        <Flex gap="2" align="center">
          <Badge color={c.accentStr} bg="rgba(88,214,171,0.10)">{scopeContracts.length} in scope</Badge>
          <Badge color={c.blue} bg="rgba(100,160,255,0.10)">{parsedContracts.length} contracts</Badge>
          {analyzedCount > 0 && <Badge color={c.accentStr} bg="rgba(88,214,171,0.10)">{analyzedCount} analyzed</Badge>}
          {callEdgeCount > 0 && <Badge color={c.purple} bg="rgba(180,140,255,0.10)">{callEdgeCount} call edges</Badge>}
        </Flex>

        <Flex gap="2" align="center" style={{ marginLeft: 'auto' }}>
          <button
            onClick={handleAnalyzeAll}
            disabled={processing}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              background: 'rgba(88,214,171,0.1)', border: '1px solid rgba(88,214,171,0.3)',
              borderRadius: 8, padding: '4px 12px', fontSize: 11, fontWeight: 600,
              color: c.accentStr, cursor: processing ? 'not-allowed' : 'pointer', fontFamily: c.mono,
              opacity: processing ? 0.6 : 1,
            }}
          >
            <Play size={11} /> Analyze All
          </button>
          <input
            type="text"
            placeholder="Search…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              background: 'rgba(255,255,255,0.05)', border: `1px solid ${c.border}`,
              borderRadius: 8, padding: '4px 10px', fontSize: 12, color: c.text,
              outline: 'none', width: 150, fontFamily: c.mono,
            }}
          />
        </Flex>
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

          {/* Left panel — 30% — contract/call tree */}
          <Box style={{
            width: '30%',
            borderRight: `1px solid ${c.borderSoft}`,
            paddingRight: 10,
            overflowY: 'auto',
            flexShrink: 0,
          }}>
            {filteredContracts.length === 0 && (
              <Box style={{ color: c.textMuted, fontSize: 11, padding: '8px 4px' }}>
                No contracts match "{search}"
              </Box>
            )}
            {filteredContracts.map(sc => (
              <LeftFileRow
                key={sc.id}
                sc={sc}
                definitions={defsByFile.get(sc.id) ?? []}
                expandedFiles={expandedFiles}
                selectedPcId={selectedPcId}
                reparsing={reparsing.has(sc.id)}
                onToggleFile={handleToggleFile}
                onSelectContract={handleSelectContract}
                onParse={handleParse}
              />
            ))}
          </Box>

          {/* Right panel — 70% — parsed details */}
          <Box style={{
            flex: 1,
            paddingLeft: 16,
            overflowY: 'auto',
          }}>
            {!selectedPc && (
              <Flex align="center" justify="center" style={{ height: '100%' }}>
                <span style={{ fontSize: 13, color: c.textMuted, fontStyle: 'italic' }}>
                  ← Select a contract from the tree to view its details
                </span>
              </Flex>
            )}
            {selectedPc && (
              <ContractDetailsPanel
                pc={selectedPc}
                details={details[selectedPcId!]}
              />
            )}
          </Box>
        </Flex>
      )}
    </Box>
  )
}
