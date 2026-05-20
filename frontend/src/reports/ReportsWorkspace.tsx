import { useCallback, useEffect, useRef, useState } from 'react'
import { css } from 'styled-system/css'
import { Box, Flex } from 'styled-system/jsx'
import { Trash2, ChevronDown, ChevronUp, Plus, Check, Loader } from 'lucide-react'
import { NavBar } from '../components/NavBar'
import SlideButton from '../components/SlideButton'
import { NotesOverlay } from '../notes/NotesOverlay'
import * as api from './api'
import type { Finding } from './api'

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------
const t = {
  bg: '#0e0e12',
  card: 'rgba(18,18,24,0.97)',
  cardHover: 'rgba(22,22,30,0.97)',
  border: 'rgba(185,185,189,0.1)',
  borderMid: 'rgba(185,185,189,0.16)',
  accent: 'rgba(255,90,80,1)',
  accentFaint: 'rgba(255,90,80,0.08)',
  accentBorder: 'rgba(255,90,80,0.22)',
  text: 'rgba(231,228,239,0.91)',
  textSub: 'rgba(231,228,239,0.65)',
  muted: 'rgba(185,185,193,0.5)',
  mono: "'Roboto Mono', ui-monospace, monospace",
  input: 'rgba(10,10,14,0.95)',
}

// ---------------------------------------------------------------------------
// Severity config
// ---------------------------------------------------------------------------
const SEVERITIES = ['Critical', 'High', 'Medium', 'Low', 'Informational', 'Gas']
const STATUSES = ['Open', 'Acknowledged', 'Fixed', "Won't Fix"]

const severityColor: Record<string, string> = {
  Critical:      'rgba(255,59,59,0.9)',
  High:          'rgba(255,112,67,0.9)',
  Medium:        'rgba(255,183,77,0.9)',
  Low:           'rgba(255,230,100,0.9)',
  Informational: 'rgba(129,212,250,0.9)',
  Gas:           'rgba(165,214,167,0.9)',
}

const severityBg: Record<string, string> = {
  Critical:      'rgba(255,59,59,0.12)',
  High:          'rgba(255,112,67,0.12)',
  Medium:        'rgba(255,183,77,0.12)',
  Low:           'rgba(255,230,100,0.1)',
  Informational: 'rgba(129,212,250,0.1)',
  Gas:           'rgba(165,214,167,0.1)',
}

// ---------------------------------------------------------------------------
// Field components
// ---------------------------------------------------------------------------
function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 9.5, fontFamily: t.mono, color: t.muted, textTransform: 'uppercase', letterSpacing: '0.07em', display: 'block', marginBottom: 5 }}>
      {children}
    </span>
  )
}

const inputBase: React.CSSProperties = {
  width: '100%', padding: '7px 10px', borderRadius: 6,
  background: t.input, border: `1px solid ${t.border}`,
  color: t.text, fontSize: 12.5, fontFamily: t.mono,
  outline: 'none', resize: 'vertical',
  transition: 'border-color 0.12s',
}

// ---------------------------------------------------------------------------
// Save indicator
// ---------------------------------------------------------------------------
type SaveState = 'idle' | 'saving' | 'saved'

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === 'idle') return null
  return (
    <Flex align="center" gap="1" style={{ fontSize: 10, fontFamily: t.mono, color: t.muted }}>
      {state === 'saving'
        ? <><Loader size={10} style={{ animation: 'spin 1s linear infinite' }} /> Saving…</>
        : <><Check size={10} style={{ color: 'rgba(88,214,171,0.8)' }} /> Saved</>
      }
    </Flex>
  )
}

// ---------------------------------------------------------------------------
// Finding card
// ---------------------------------------------------------------------------
interface FindingCardProps {
  finding: Finding
  index: number
  onUpdate: (id: string, patch: Partial<Finding>) => void
  onDelete: (id: string) => void
  saveState: SaveState
}

function FindingCard({ finding, index, onUpdate, onDelete, saveState }: FindingCardProps) {
  const [expanded, setExpanded] = useState(true)
  const color = severityColor[finding.severity] ?? t.muted
  const bg = severityBg[finding.severity] ?? t.accentFaint

  const field = (key: keyof Finding, value: string) => onUpdate(finding.id, { [key]: value })

  const focusCls = css({ _focus: { borderColor: 'rgba(255,90,80,0.4) !important' } })
  const hoverDeleteCls = css({ _hover: { color: 'rgba(255,90,90,0.9) !important', borderColor: 'rgba(255,90,90,0.3) !important' } })

  return (
    <Box style={{
      borderRadius: 10,
      border: `1px solid ${t.border}`,
      background: t.card,
      overflow: 'hidden',
    }}>
      {/* Card header */}
      <Flex
        align="center"
        gap="2"
        style={{
          padding: '10px 14px',
          borderBottom: expanded ? `1px solid ${t.border}` : 'none',
          background: 'rgba(0,0,0,0.15)',
          cursor: 'pointer',
        }}
        onClick={() => setExpanded(v => !v)}
      >
        {/* Index */}
        <span style={{ fontSize: 10, fontFamily: t.mono, color: t.muted, flexShrink: 0, minWidth: 18 }}>
          #{index + 1}
        </span>

        {/* Severity badge */}
        <span style={{
          fontSize: 9.5, fontFamily: t.mono, fontWeight: 700, letterSpacing: '0.06em',
          padding: '2px 7px', borderRadius: 4,
          background: bg, color, border: `1px solid ${color.replace('0.9', '0.3')}`,
          flexShrink: 0,
        }}>
          {finding.severity.toUpperCase()}
        </span>

        {/* Title (inline edit — stop propagation so click doesn't toggle) */}
        <input
          value={finding.title}
          placeholder="Finding title…"
          onChange={e => field('title', e.target.value)}
          onClick={e => e.stopPropagation()}
          className={focusCls}
          style={{
            flex: 1, background: 'transparent', border: 'none', outline: 'none',
            color: t.text, fontSize: 13, fontWeight: 600,
            fontFamily: "'Roboto Mono', ui-monospace, monospace",
          }}
        />

        {/* Save + delete + chevron */}
        <Flex align="center" gap="2" style={{ flexShrink: 0 }} onClick={e => e.stopPropagation()}>
          <SaveIndicator state={saveState} />
          <button
            type="button"
            onClick={() => onDelete(finding.id)}
            className={hoverDeleteCls}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 26, height: 26, borderRadius: 5,
              border: `1px solid ${t.border}`,
              background: 'transparent', color: t.muted, cursor: 'pointer',
            }}
          >
            <Trash2 size={11} />
          </button>
        </Flex>
        <span style={{ color: t.muted, flexShrink: 0 }}>
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </span>
      </Flex>

      {/* Card body */}
      {expanded && (
        <Box style={{ padding: '14px 16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 20px', marginBottom: 12 }}>
            {/* Severity */}
            <div>
              <FieldLabel>Severity</FieldLabel>
              <div style={{ position: 'relative' }}>
                <select
                  value={finding.severity}
                  onChange={e => field('severity', e.target.value)}
                  className={focusCls}
                  style={{ ...inputBase, appearance: 'none', WebkitAppearance: 'none', paddingRight: 28, cursor: 'pointer' }}
                >
                  {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <ChevronDown size={11} style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', color: t.muted, pointerEvents: 'none' }} />
              </div>
            </div>

            {/* Status */}
            <div>
              <FieldLabel>Status</FieldLabel>
              <div style={{ position: 'relative' }}>
                <select
                  value={finding.status}
                  onChange={e => field('status', e.target.value)}
                  className={focusCls}
                  style={{ ...inputBase, appearance: 'none', WebkitAppearance: 'none', paddingRight: 28, cursor: 'pointer' }}
                >
                  {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <ChevronDown size={11} style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', color: t.muted, pointerEvents: 'none' }} />
              </div>
            </div>
          </div>

          {/* Scope */}
          <div style={{ marginBottom: 12 }}>
            <FieldLabel>Scope</FieldLabel>
            <input
              value={finding.scope}
              placeholder="Affected contract / function…"
              onChange={e => field('scope', e.target.value)}
              className={focusCls}
              style={{ ...inputBase, resize: undefined }}
            />
          </div>

          {/* Description */}
          <div style={{ marginBottom: 12 }}>
            <FieldLabel>Description</FieldLabel>
            <textarea
              value={finding.description}
              placeholder="Describe the vulnerability in detail…"
              rows={4}
              onChange={e => field('description', e.target.value)}
              className={focusCls}
              style={{ ...inputBase }}
            />
          </div>

          {/* Proof of Concept */}
          <div style={{ marginBottom: 12 }}>
            <FieldLabel>Proof of Concept</FieldLabel>
            <textarea
              value={finding.proof_of_concept}
              placeholder="// Paste test code or reproduction steps…"
              rows={5}
              onChange={e => field('proof_of_concept', e.target.value)}
              className={focusCls}
              style={{
                ...inputBase,
                fontFamily: t.mono,
                fontSize: 12,
                background: 'rgba(0,0,0,0.4)',
                color: 'rgba(180,240,180,0.85)',
              }}
            />
          </div>

          {/* Recommendation */}
          <div>
            <FieldLabel>Recommendation</FieldLabel>
            <textarea
              value={finding.recommendation}
              placeholder="Explain how to fix or mitigate the issue…"
              rows={3}
              onChange={e => field('recommendation', e.target.value)}
              className={focusCls}
              style={{ ...inputBase }}
            />
          </div>
        </Box>
      )}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Main workspace
// ---------------------------------------------------------------------------
interface Props {
  auditId: string
  onNavigate: (path: string) => void
  onOpenProfile: () => void
}

export function ReportsWorkspace({ auditId, onNavigate, onOpenProfile }: Props) {
  const [findings, setFindings] = useState<Finding[]>([])
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({})
  const [notesOpen, setNotesOpen] = useState(false)
  const [sideNavPanel] = useState<'tools' | null>(null)
  const debounceRefs = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  useEffect(() => {
    api.listFindings(auditId).then(setFindings).catch(() => {})
  }, [auditId])

  const setSave = (id: string, state: SaveState) =>
    setSaveStates(prev => ({ ...prev, [id]: state }))

  const handleUpdate = useCallback((id: string, patch: Partial<Finding>) => {
    setFindings(prev => prev.map(f => f.id === id ? { ...f, ...patch } : f))
    setSave(id, 'saving')

    clearTimeout(debounceRefs.current[id])
    debounceRefs.current[id] = setTimeout(async () => {
      try {
        await api.updateFinding(id, patch)
        setSave(id, 'saved')
        setTimeout(() => setSave(id, 'idle'), 2000)
      } catch {
        setSave(id, 'idle')
      }
    }, 700)
  }, [])

  const handleDelete = useCallback(async (id: string) => {
    setFindings(prev => prev.filter(f => f.id !== id))
    clearTimeout(debounceRefs.current[id])
    try { await api.deleteFinding(id) } catch { /* best-effort */ }
  }, [])

  const handleAdd = useCallback(async () => {
    const newOrder = findings.length
    const newFinding: Finding = {
      id: crypto.randomUUID(),
      audit_id: auditId,
      order: newOrder,
      title: '',
      severity: 'High',
      description: '',
      scope: '',
      proof_of_concept: '',
      recommendation: '',
      status: 'Open',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    setFindings(prev => [...prev, newFinding])
    try {
      await api.createFinding(auditId, {
        id: newFinding.id,
        order: newFinding.order,
        title: newFinding.title,
        severity: newFinding.severity,
        description: newFinding.description,
        scope: newFinding.scope,
        proof_of_concept: newFinding.proof_of_concept,
        recommendation: newFinding.recommendation,
        status: newFinding.status,
      })
    } catch {
      setFindings(prev => prev.filter(f => f.id !== newFinding.id))
    }
  }, [auditId, findings.length])

  // Summary counts
  const counts = findings.reduce<Record<string, number>>((acc, f) => {
    acc[f.severity] = (acc[f.severity] ?? 0) + 1
    return acc
  }, {})

  return (
    <Flex direction="column" style={{ height: '100vh', background: t.bg, overflow: 'hidden' }}>
      <NavBar
        activeSection="audits"
        searchValue=""
        onSearchChange={() => {}}
        onNavigate={(section) => onNavigate(`/menu/${section}`)}
        onOpenProfile={onOpenProfile}
        showSearch={false}
        journeyItems={[
          { label: 'Scope', onClick: () => onNavigate(`/scope/${auditId}`), accentColor: 'rgba(88,149,255,0.28)' },
          { label: 'Enum', onClick: () => onNavigate(`/enum/${auditId}`), accentColor: 'rgba(88,214,171,0.28)' },
          { label: 'Static Analysis', onClick: () => onNavigate(`/static-analysis/${auditId}`), accentColor: 'rgba(180,140,255,0.28)' },
          { label: 'Dynamic Analysis', onClick: () => onNavigate(`/dynamic-analysis/${auditId}`), accentColor: 'rgba(245,200,60,0.28)' },
          { label: 'Reports', isCurrent: true, accentColor: 'rgba(255,90,80,0.28)' },
        ]}
        openSideNavPanel={sideNavPanel}
        onSideNavPanelConsumed={() => {}}
        onOpenNotes={() => setNotesOpen(true)}
      />
      {notesOpen && <NotesOverlay auditId={auditId} onClose={() => setNotesOpen(false)} />}

      {/* Content */}
      <Box flex="1" style={{ overflowY: 'auto', minHeight: 0 }}>
        <Box style={{ maxWidth: 860, margin: '0 auto', padding: '28px 24px 40px' }}>

          {/* Header */}
          <Flex align="flex-start" justify="space-between" style={{ marginBottom: 24 }}>
            <div>
              <h1 style={{ fontSize: 20, fontWeight: 700, color: t.text, margin: 0, letterSpacing: '-0.01em' }}>
                Audit Report
              </h1>
              <p style={{ fontSize: 12, fontFamily: t.mono, color: t.muted, margin: '4px 0 0' }}>
                {findings.length} finding{findings.length !== 1 ? 's' : ''}
              </p>
            </div>

            {/* Severity summary badges */}
            {findings.length > 0 && (
              <Flex gap="2" wrap="wrap" style={{ justifyContent: 'flex-end' }}>
                {SEVERITIES.filter(s => counts[s]).map(s => (
                  <span key={s} style={{
                    fontSize: 10, fontFamily: t.mono, fontWeight: 700,
                    padding: '3px 8px', borderRadius: 5,
                    background: severityBg[s], color: severityColor[s],
                    border: `1px solid ${severityColor[s].replace('0.9', '0.25')}`,
                  }}>
                    {counts[s]} {s}
                  </span>
                ))}
              </Flex>
            )}
          </Flex>

          {/* Empty state */}
          {findings.length === 0 && (
            <Flex
              direction="column"
              align="center"
              justify="center"
              style={{
                padding: '64px 0', borderRadius: 12,
                border: `1px dashed ${t.border}`,
                background: 'rgba(255,255,255,0.01)',
              }}
            >
              <span style={{ fontSize: 13, color: t.muted, fontFamily: t.mono, marginBottom: 6 }}>
                No findings yet
              </span>
              <span style={{ fontSize: 11, color: 'rgba(185,185,193,0.35)', fontFamily: t.mono }}>
                Click + below to add your first finding
              </span>
            </Flex>
          )}

          {/* Finding cards */}
          <Flex direction="column" gap="3">
            {findings.map((f, i) => (
              <FindingCard
                key={f.id}
                finding={f}
                index={i}
                onUpdate={handleUpdate}
                onDelete={handleDelete}
                saveState={saveStates[f.id] ?? 'idle'}
              />
            ))}
          </Flex>

          {/* Add finding button */}
          <button
            type="button"
            onClick={handleAdd}
            className={css({
              _hover: {
                background: 'rgba(255,90,80,0.08) !important',
                borderColor: 'rgba(255,90,80,0.3) !important',
                color: 'rgba(255,130,120,0.9) !important',
              },
            })}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              width: '100%', marginTop: findings.length > 0 ? 12 : 16,
              padding: '11px', borderRadius: 8,
              border: `1px dashed ${t.border}`,
              background: 'transparent', color: t.muted,
              fontSize: 12, fontFamily: t.mono, cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            <Plus size={14} />
            Add Finding
          </button>
        </Box>
      </Box>

      {/* Bottom nav */}
      <Flex
        align="center"
        justify="space-between"
        style={{
          padding: '16px 32px', flexShrink: 0,
          borderTop: `1px solid ${t.borderMid}`,
          background: 'rgba(12,12,16,0.95)',
        }}
      >
        <SlideButton
          reversed
          text="Goto Dynamic Analysis"
          theme="yellow"
          onComplete={() => onNavigate(`/dynamic-analysis/${auditId}`)}
        />
        <SlideButton
          text="Finish Audit"
          theme="yellow"
          onComplete={() => onNavigate('/menu/audits')}
        />
      </Flex>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg) } }
        textarea { line-height: 1.55; }
      `}</style>
    </Flex>
  )
}
