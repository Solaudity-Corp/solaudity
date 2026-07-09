import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Play, Loader, ShieldCheck, ShieldX, ShieldAlert, Search, FlaskConical,
  Terminal as TerminalIcon, CheckCircle2, XCircle, AlertTriangle, HelpCircle,
  ChevronRight, ChevronDown, Sparkles, FileCheck2, Info, RefreshCw,
} from 'lucide-react'
import {
  buildAgentWsUrl, createRun, getRun, listRuns, promoteFinding,
  type AgentEvent, type AgentFinding, type AgentRun,
} from './agentApi'

const t = {
  bg: '#0c0c10',
  panel: 'rgba(16,16,22,0.97)',
  panel2: 'rgba(22,22,30,0.97)',
  border: 'rgba(185,185,189,0.12)',
  borderMid: 'rgba(185,185,189,0.2)',
  accent: 'rgba(168,130,255,1)',
  accentFaint: 'rgba(168,130,255,0.1)',
  accentBorder: 'rgba(168,130,255,0.32)',
  text: 'rgba(231,228,239,0.92)',
  textSub: 'rgba(231,228,239,0.66)',
  muted: 'rgba(185,185,193,0.5)',
  green: '#58d6ab',
  red: '#ff5a5a',
  yellow: '#f5c83c',
  blue: '#5895ff',
  mono: "'Roboto Mono', ui-monospace, monospace",
}

const SEV_COLOR: Record<string, string> = {
  High: t.red, Medium: t.yellow, Low: t.blue, Informational: t.muted,
}

const STATUS_META: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  verified: { label: 'VERIFIED EXPLOITABLE', color: t.green, bg: 'rgba(88,214,171,0.12)', icon: <ShieldCheck size={13} /> },
  refuted: { label: 'REFUTED', color: t.red, bg: 'rgba(255,90,90,0.1)', icon: <ShieldX size={13} /> },
  unverified: { label: 'UNVERIFIED', color: t.muted, bg: 'rgba(185,185,193,0.1)', icon: <ShieldAlert size={13} /> },
  needs_review: { label: 'NEEDS REVIEW', color: t.yellow, bg: 'rgba(245,200,60,0.1)', icon: <HelpCircle size={13} /> },
}

interface Props {
  auditId: string
}

export function AgentView({ auditId }: Props) {
  const [run, setRun] = useState<AgentRun | null>(null)
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [findings, setFindings] = useState<AgentFinding[]>([])
  const [running, setRunning] = useState(false)
  const [conn, setConn] = useState<'idle' | 'connecting' | 'connected' | 'closed'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [promoting, setPromoting] = useState<Set<string>>(new Set())
  const [maxProve, setMaxProve] = useState(6)

  const wsRef = useRef<WebSocket | null>(null)
  const feedRef = useRef<HTMLDivElement>(null)
  const gotTerminalRef = useRef(false)

  // Reload the latest run + its persisted findings from the server.
  const refresh = useCallback(async () => {
    const runs = await listRuns(auditId)
    if (runs.length === 0) return null
    const latest = runs[0]
    setRun(latest)
    try {
      const detail = await getRun(latest.id)
      setFindings(detail.findings)
    } catch { /* */ }
    return latest
  }, [auditId])

  // Auto-scroll the activity feed.
  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: 'smooth' })
  }, [events])

  useEffect(() => () => { wsRef.current?.close() }, [])

  const upsertFinding = useCallback((f: AgentFinding) => {
    setFindings((prev) => {
      const idx = prev.findIndex((x) => x.id === f.id)
      if (idx >= 0) { const next = [...prev]; next[idx] = f; return next }
      return [...prev, f]
    })
  }, [])

  const handleEvent = useCallback((ev: AgentEvent) => {
    // Cap the feed so a very long run cannot grow memory without bound.
    setEvents((prev) => (prev.length > 600 ? [...prev.slice(-600), ev] : [...prev, ev]))
    if (ev.type === 'finding' && ev.finding) upsertFinding(ev.finding)
    if (ev.type === 'done') {
      gotTerminalRef.current = true
      setRunning(false); setConn('closed')
      if (ev.summary?.model) setRun((r) => (r ? { ...r, model: ev.summary!.model! } : r))
    }
    if (ev.type === 'error') { gotTerminalRef.current = true; setError(ev.message ?? 'Agent error'); setRunning(false) }
    if (ev.type === 'closed') { gotTerminalRef.current = true; setConn('closed') }
  }, [upsertFinding])

  const connect = useCallback((runId: string) => {
    wsRef.current?.close()
    gotTerminalRef.current = false
    setConn('connecting')
    const ws = new WebSocket(buildAgentWsUrl(runId))
    wsRef.current = ws
    ws.onopen = () => setConn('connected')
    ws.onmessage = (e) => {
      if (typeof e.data !== 'string') return
      try { handleEvent(JSON.parse(e.data) as AgentEvent) } catch { /* */ }
    }
    ws.onclose = () => {
      setConn('closed'); setRunning(false)
      // Closed without a terminal event → the stream dropped but the run may
      // still be completing server-side. Surface a resync affordance.
      if (!gotTerminalRef.current) {
        setError('Connection to the live run dropped. The run may still be completing on the server — click Refresh to load the latest results.')
      }
    }
    ws.onerror = () => { setConn('closed') }
  }, [handleEvent])

  // On mount: load the latest run's findings, and resume streaming if it is live.
  const connectRef = useRef(connect)
  connectRef.current = connect
  const bootedRef = useRef(false)
  useEffect(() => {
    if (bootedRef.current) return
    bootedRef.current = true
    let alive = true
    ;(async () => {
      try {
        const runs = await listRuns(auditId)
        if (!alive || runs.length === 0) return
        const latest = runs[0]
        setRun(latest)
        try { const d = await getRun(latest.id); if (alive) setFindings(d.findings) } catch { /* */ }
        if (alive && (latest.status === 'running' || latest.status === 'pending')) {
          setRunning(true)
          connectRef.current(latest.id)
        }
      } catch { /* */ }
    })()
    return () => { alive = false }
  }, [auditId])

  const start = useCallback(async () => {
    setError(null); setEvents([]); setFindings([])
    setRunning(true)
    try {
      const r = await createRun(auditId, { max_prove: maxProve })
      setRun(r)
      connect(r.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setRunning(false)
    }
  }, [auditId, maxProve, connect])

  const doPromote = useCallback(async (f: AgentFinding) => {
    setPromoting((p) => new Set(p).add(f.id))
    try {
      const res = await promoteFinding(f.id)
      upsertFinding({ ...f, promoted_report_finding_id: res.report_finding_id })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPromoting((p) => { const n = new Set(p); n.delete(f.id); return n })
    }
  }, [upsertFinding])

  const summary = useMemo(() => {
    const s = { verified: 0, refuted: 0, unverified: 0, needs_review: 0 }
    for (const f of findings) s[f.status] = (s[f.status] ?? 0) + 1
    return s
  }, [findings])

  const sortedFindings = useMemo(() => {
    const rank: Record<string, number> = { verified: 0, needs_review: 1, unverified: 2, refuted: 3 }
    const sev: Record<string, number> = { High: 0, Medium: 1, Low: 2, Informational: 3 }
    return [...findings].sort((a, b) =>
      (rank[a.status] - rank[b.status]) || (sev[a.severity] - sev[b.severity]))
  }, [findings])

  return (
    <Frame>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 20px', borderBottom: `1px solid ${t.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 9, background: t.accentFaint, border: `1px solid ${t.accentBorder}` }}>
          <Sparkles size={17} color={t.accent} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: t.text, letterSpacing: '-0.01em' }}>Verified Exploit Agent</div>
          <div style={{ fontSize: 11.5, color: t.textSub }}>
            Triages every tool finding, hunts logic bugs, and <b style={{ color: t.accent }}>proves exploits with real Foundry PoCs</b>.
          </div>
        </div>

        <label style={{ fontSize: 11, color: t.muted, display: 'flex', alignItems: 'center', gap: 6 }}>
          max PoCs
          <select value={maxProve} onChange={(e) => setMaxProve(Number(e.target.value))} disabled={running}
            style={{ background: t.panel2, color: t.text, border: `1px solid ${t.border}`, borderRadius: 6, padding: '3px 6px', fontFamily: t.mono, fontSize: 11 }}>
            {[3, 6, 10, 15].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>

        <button onClick={() => { void refresh() }} disabled={running} title="Reload latest results"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 8,
            background: t.panel2, color: t.textSub, border: `1px solid ${t.border}`,
            cursor: running ? 'default' : 'pointer',
          }}>
          <RefreshCw size={14} />
        </button>

        <button onClick={start} disabled={running}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderRadius: 8,
            background: running ? 'rgba(168,130,255,0.15)' : t.accent, color: running ? t.accent : '#12101a',
            border: 'none', fontWeight: 600, fontSize: 12.5, cursor: running ? 'default' : 'pointer',
            fontFamily: t.mono,
          }}>
          {running ? <Loader size={14} className="spin" /> : <Play size={14} />}
          {running ? 'Running…' : 'Run Agent'}
        </button>
      </div>

      {/* Summary + status bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 20px', borderBottom: `1px solid ${t.border}`, flexWrap: 'wrap' }}>
        <StatChip icon={<ShieldCheck size={12} />} color={t.green} label="verified" n={summary.verified} />
        <StatChip icon={<HelpCircle size={12} />} color={t.yellow} label="needs review" n={summary.needs_review} />
        <StatChip icon={<ShieldAlert size={12} />} color={t.muted} label="unverified" n={summary.unverified} />
        <StatChip icon={<ShieldX size={12} />} color={t.red} label="refuted" n={summary.refuted} />
        <div style={{ flex: 1 }} />
        {run?.model && <span style={{ fontSize: 10.5, color: t.muted, fontFamily: t.mono }}>{run.model}</span>}
        <ConnDot conn={conn} running={running} />
      </div>

      {error && (
        <div style={{ margin: '10px 20px 0', padding: '8px 12px', borderRadius: 8, background: 'rgba(255,90,90,0.1)', border: '1px solid rgba(255,90,90,0.28)', color: t.red, fontSize: 12 }}>
          {error}
        </div>
      )}

      {/* Split: activity feed | findings */}
      <div style={{ display: 'flex', gap: 0, flex: 1, minHeight: 0 }}>
        {/* Activity feed */}
        <div style={{ flex: '1.05', display: 'flex', flexDirection: 'column', borderRight: `1px solid ${t.border}`, minWidth: 0 }}>
          <PanelLabel icon={<TerminalIcon size={12} />} text="Live activity" />
          <div ref={feedRef} style={{ flex: 1, overflowY: 'auto', padding: '8px 14px 20px', fontFamily: t.mono }}>
            {events.length === 0 && !running && (
              <EmptyState text="Click Run Agent to start. The agent will gather findings, triage them, hunt for new bugs, and try to prove each exploit with Foundry — streaming here live." />
            )}
            {events.map((ev, i) => <FeedRow key={i} ev={ev} />)}
          </div>
        </div>

        {/* Findings */}
        <div style={{ flex: '1', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <PanelLabel icon={<FileCheck2 size={12} />} text={`Findings (${findings.length})`} />
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 14px 20px' }}>
            {findings.length === 0 && <EmptyState text="Verified, refuted, and to-review findings will appear here as the agent resolves them." />}
            {sortedFindings.map((f) => (
              <FindingCard
                key={f.id} f={f}
                open={expanded === f.id}
                onToggle={() => setExpanded(expanded === f.id ? null : f.id)}
                onPromote={() => doPromote(f)}
                promoting={promoting.has(f.id)}
              />
            ))}
          </div>
        </div>
      </div>

      <style>{`@keyframes spin{to{transform:rotate(360deg)}} .spin{animation:spin 1s linear infinite}`}</style>
    </Frame>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, overflow: 'hidden', margin: '0 16px 12px' }}>
      {children}
    </div>
  )
}

function PanelLabel({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 14px', borderBottom: `1px solid ${t.border}`, color: t.textSub, fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
      {icon}{text}
    </div>
  )
}

function StatChip({ icon, color, label, n }: { icon: React.ReactNode; color: string; label: string; n: number }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 20, background: 'rgba(255,255,255,0.03)', border: `1px solid ${t.border}`, color, fontSize: 11.5, fontFamily: t.mono }}>
      {icon}<b style={{ color: t.text }}>{n}</b><span style={{ color: t.muted }}>{label}</span>
    </span>
  )
}

function ConnDot({ conn, running }: { conn: string; running: boolean }) {
  const map: Record<string, [string, string]> = {
    idle: [t.muted, 'idle'], connecting: [t.yellow, 'connecting'],
    connected: [t.green, running ? 'streaming' : 'connected'], closed: [t.muted, 'done'],
  }
  const [c, label] = map[conn] ?? [t.muted, conn]
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: t.muted, fontFamily: t.mono }}>
      <span style={{ width: 7, height: 7, borderRadius: 99, background: c, boxShadow: `0 0 8px ${c}` }} />{label}
    </span>
  )
}

function EmptyState({ text }: { text: string }) {
  return <div style={{ color: t.muted, fontSize: 12, lineHeight: 1.6, padding: '18px 4px', maxWidth: 460 }}>{text}</div>
}

function FeedRow({ ev }: { ev: AgentEvent }) {
  if (ev.type === 'phase') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '14px 0 6px', color: t.accent, fontSize: 12, fontWeight: 600 }}>
        <span style={{ width: 6, height: 6, borderRadius: 99, background: t.accent }} />
        {phaseIcon(ev.phase)} {ev.message}
      </div>
    )
  }
  if (ev.type === 'log') return <Line color={t.textSub}>· {ev.message}</Line>
  if (ev.type === 'issue') {
    const i = ev.issue ?? {}
    const sev = (i.severity ?? '') as string
    const fp = i.verdict === 'false_positive'
    return (
      <Line color={t.textSub}>
        <span style={{ color: SEV_COLOR[sev] ?? t.muted }}>◆</span>{' '}
        <span style={{ color: fp ? t.muted : t.text, textDecoration: fp ? 'line-through' : 'none' }}>{i.title}</span>{' '}
        <span style={{ color: t.muted, fontSize: 10.5 }}>[{sev}{i.exploitability ? ` · exploit:${i.exploitability}` : ''}{ev.stage === 'hunt' ? ' · novel' : ''}]</span>
      </Line>
    )
  }
  if (ev.type === 'prove') {
    const c = ev.stage === 'verified' ? t.green : (ev.stage === 'refuted' ? t.red : (ev.stage === 'unverified' ? t.muted : t.accent))
    return <Line color={c}>  ⚑ <b>{(ev.stage ?? '').toUpperCase()}</b> — {ev.message}</Line>
  }
  if (ev.type === 'forge') {
    const c = ev.passed ? t.green : t.red
    return (
      <div style={{ margin: '4px 0 8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: c, fontSize: 11, marginBottom: 3 }}>
          {ev.passed ? <CheckCircle2 size={12} /> : <XCircle size={12} />} forge test — {ev.passed ? 'passed' : `failed (${ev.error_kind})`}
        </div>
        <pre style={{ margin: 0, padding: '8px 10px', background: '#08080c', border: `1px solid ${t.border}`, borderRadius: 7, color: t.textSub, fontSize: 10.5, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 180, overflow: 'auto' }}>
          {(ev.output ?? '').split('\n').slice(-16).join('\n')}
        </pre>
      </div>
    )
  }
  if (ev.type === 'done') {
    return <div style={{ margin: '12px 0 4px', color: t.green, fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 7 }}><CheckCircle2 size={14} /> Run complete.</div>
  }
  if (ev.type === 'error') {
    return <div style={{ margin: '10px 0', color: t.red, fontSize: 12, display: 'flex', alignItems: 'center', gap: 7 }}><AlertTriangle size={14} /> {ev.message}</div>
  }
  return null
}

function Line({ children, color }: { children: React.ReactNode; color: string }) {
  return <div style={{ color, fontSize: 11.5, lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{children}</div>
}

function phaseIcon(phase?: string) {
  if (phase === 'gather') return <Info size={13} />
  if (phase === 'triage') return <Search size={13} />
  if (phase === 'hunt') return <Sparkles size={13} />
  if (phase === 'prove') return <FlaskConical size={13} />
  return null
}

function FindingCard({ f, open, onToggle, onPromote, promoting }: {
  f: AgentFinding; open: boolean; onToggle: () => void; onPromote: () => void; promoting: boolean
}) {
  const meta = STATUS_META[f.status] ?? STATUS_META.needs_review
  const promoted = !!f.promoted_report_finding_id
  return (
    <div style={{ marginBottom: 8, border: `1px solid ${f.status === 'verified' ? 'rgba(88,214,171,0.3)' : t.border}`, borderRadius: 9, background: t.panel2, overflow: 'hidden' }}>
      <button onClick={onToggle} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 9, padding: '10px 12px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
        {open ? <ChevronDown size={14} color={t.muted} /> : <ChevronRight size={14} color={t.muted} />}
        <span style={{ width: 8, height: 8, borderRadius: 99, background: SEV_COLOR[f.severity] ?? t.muted, flexShrink: 0 }} />
        <span style={{ flex: 1, color: t.text, fontSize: 12.5, fontWeight: 500, minWidth: 0 }}>{f.title}</span>
        {f.is_novel && <span style={{ fontSize: 9.5, color: t.accent, border: `1px solid ${t.accentBorder}`, borderRadius: 5, padding: '1px 5px' }}>NOVEL</span>}
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.03em', color: meta.color, background: meta.bg, border: `1px solid ${meta.color}44`, borderRadius: 5, padding: '2px 6px', flexShrink: 0, fontFamily: t.mono }}>
          {meta.icon}{meta.label}
        </span>
      </button>

      {open && (
        <div style={{ padding: '4px 14px 14px 34px', fontSize: 12, color: t.textSub, lineHeight: 1.6 }}>
          <MetaRow k="Severity / Category" v={`${f.severity}${f.category ? ' · ' + f.category : ''}`} />
          {(f.target_contract || f.target_function) && <MetaRow k="Target" v={[f.target_contract, f.target_function].filter(Boolean).join('.')} />}
          {f.root_cause && <MetaRow k="Root cause" v={f.root_cause} />}
          {f.description && <div style={{ margin: '8px 0', whiteSpace: 'pre-wrap' }}>{f.description}</div>}
          {f.recommendation && <MetaRow k="Recommendation" v={f.recommendation} />}
          {f.correlated_sources && f.correlated_sources.length > 0 && (
            <MetaRow k="Correlates" v={f.correlated_sources.join(', ')} />
          )}

          {f.poc_code && (
            <details style={{ marginTop: 10 }}>
              <summary style={{ cursor: 'pointer', color: t.accent, fontSize: 11.5, fontFamily: t.mono }}>
                {f.exploit_proven ? '✅ Proof-of-Concept (forge test passed)' : 'PoC attempt'}
              </summary>
              <pre style={{ marginTop: 6, padding: '10px 12px', background: '#08080c', border: `1px solid ${t.border}`, borderRadius: 7, color: t.text, fontSize: 10.5, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 320, overflow: 'auto', fontFamily: t.mono }}>
                {f.poc_code}
              </pre>
              {f.poc_output && (
                <pre style={{ marginTop: 6, padding: '8px 10px', background: '#08080c', border: `1px solid ${t.border}`, borderRadius: 7, color: t.textSub, fontSize: 10, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 160, overflow: 'auto', fontFamily: t.mono }}>
                  {f.poc_output.split('\n').slice(-20).join('\n')}
                </pre>
              )}
            </details>
          )}

          <div style={{ marginTop: 12 }}>
            <button onClick={onPromote} disabled={promoting || promoted}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 7,
                background: promoted ? 'rgba(88,214,171,0.12)' : t.accentFaint,
                color: promoted ? t.green : t.accent, border: `1px solid ${promoted ? 'rgba(88,214,171,0.3)' : t.accentBorder}`,
                fontSize: 11.5, fontWeight: 600, cursor: promoted ? 'default' : 'pointer', fontFamily: t.mono,
              }}>
              <FileCheck2 size={13} />{promoted ? 'Added to report' : (promoting ? 'Adding…' : 'Promote to report')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function MetaRow({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ margin: '4px 0' }}>
      <span style={{ color: t.muted, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{k}: </span>
      <span style={{ color: t.text }}>{v}</span>
    </div>
  )
}
