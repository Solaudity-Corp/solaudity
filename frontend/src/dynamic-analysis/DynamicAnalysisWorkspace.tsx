import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { css } from 'styled-system/css'
import { Box, Flex } from 'styled-system/jsx'
import {
  Bug, Waves, Zap, Hammer, BookOpen,
  RefreshCw, Trash2, Circle, Square,
  ChevronDown, X, ExternalLink,
} from 'lucide-react'
import { NavBar } from '../components/NavBar'
import SlideButton from '../components/SlideButton'
import { NotesOverlay } from '../notes/NotesOverlay'
import { TerminalPanel } from './TerminalPanel'
import type { TerminalHandle } from './TerminalPanel'
import * as scopeApi from '../scope/api'
import { API_BASE_URL, getAccessToken } from '../auth'

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------
const t = {
  bg: '#0c0c10',
  sidebar: 'rgba(14,14,20,0.99)',
  panel: 'rgba(16,16,22,0.97)',
  border: 'rgba(185,185,189,0.1)',
  borderMid: 'rgba(185,185,189,0.16)',
  accent: 'rgba(245,200,60,1)',
  accentFaint: 'rgba(245,200,60,0.08)',
  accentBorder: 'rgba(245,200,60,0.22)',
  text: 'rgba(231,228,239,0.91)',
  textSub: 'rgba(231,228,239,0.72)',
  muted: 'rgba(185,185,193,0.5)',
  mono: "'Roboto Mono', ui-monospace, monospace",
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------
type SectionId = 'echidna' | 'medusa' | 'anvil' | 'foundry'

interface CmdButton {
  label: string
  cmd: (path: string) => string
  disabled?: (path: string) => boolean
}

interface Section {
  id: SectionId
  title: string
  subtitle: string
  icon: React.ReactNode
  color: string
  buttons: CmdButton[]
}

const SECTIONS: Section[] = [
  {
    id: 'echidna',
    title: 'Echidna',
    subtitle: 'Property-based fuzzer',
    icon: <Bug size={13} />,
    color: 'rgba(245,200,60,0.9)',
    buttons: [
      {
        label: 'Run Echidna',
        cmd: () => '',
        disabled: (p) => !p,
      },
    ],
  },
  {
    id: 'medusa',
    title: 'Medusa',
    subtitle: 'Corpus fuzzer',
    icon: <Waves size={13} />,
    color: 'rgba(86,214,214,0.9)',
    buttons: [
      { label: 'Run Medusa', cmd: () => 'medusa fuzz --config medusa.json' },
    ],
  },
  {
    id: 'anvil',
    title: 'Anvil',
    subtitle: 'Local blockchain',
    icon: <Zap size={13} />,
    color: 'rgba(88,149,255,0.9)',
    buttons: [],
  },
  {
    id: 'foundry',
    title: 'Foundry',
    subtitle: 'Build & test',
    icon: <Hammer size={13} />,
    color: 'rgba(180,140,255,0.9)',
    buttons: [
      { label: 'forge build', cmd: () => 'forge build' },
      { label: 'forge test -vvv', cmd: () => 'forge test -vvv' },
    ],
  },
]

// ---------------------------------------------------------------------------
// Cheat sheet data
// ---------------------------------------------------------------------------
const CHEAT_SECTIONS = [
  {
    title: 'Echidna',
    color: 'rgba(245,200,60,0.9)',
    items: [
      { label: 'Property mode', code: 'echidna <file.sol> --test-mode property --config echidna.yaml' },
      { label: 'Assertion mode', code: 'echidna <file.sol> --test-mode assertion --config echidna.yaml' },
      { label: 'Overflow detection', code: 'echidna <file.sol> --test-mode overflow --config echidna.yaml' },
      { label: 'Exploration (coverage)', code: 'echidna <file.sol> --test-mode exploration --timeout 120 --config echidna.yaml' },
      { label: 'Property naming convention', code: '// Functions named echidna_*() or property_*() returning bool' },
    ],
    docs: [
      { label: 'Echidna GitHub', url: 'https://github.com/crytic/echidna' },
      { label: 'Building Secure Contracts', url: 'https://github.com/crytic/building-secure-contracts/tree/master/program-analysis/echidna' },
    ],
  },
  {
    title: 'Medusa',
    color: 'rgba(86,214,214,0.9)',
    items: [
      { label: 'Start fuzzing', code: 'medusa fuzz --config medusa.json' },
      { label: 'Init config', code: 'medusa init' },
      { label: 'Custom corpus dir', code: 'medusa fuzz --config medusa.json --corpus-dir ./corpus' },
      { label: 'Assertion testing', code: '// Use assert() calls — Medusa detects assertion violations' },
      { label: 'View coverage', code: '// Coverage report written to crytic-export/coverage after run' },
    ],
    docs: [
      { label: 'Medusa GitHub', url: 'https://github.com/crytic/medusa' },
      { label: 'Medusa Documentation', url: 'https://github.com/crytic/medusa/tree/master/docs' },
    ],
  },
  {
    title: 'Foundry',
    color: 'rgba(180,140,255,0.9)',
    items: [
      { label: 'Build project', code: 'forge build' },
      { label: 'Run all tests', code: 'forge test -vvv' },
      { label: 'Match specific test', code: 'forge test --match-test testMyFunction -vvv' },
      { label: 'Increase fuzz runs', code: 'forge test --match-test testFuzz -vvv --fuzz-runs 10000' },
      { label: 'Coverage report', code: 'forge coverage' },
      { label: 'Call contract (Anvil)', code: 'cast call <addr> "balanceOf(address)" <user> --rpc-url http://localhost:8545' },
      { label: 'Deploy contract (Anvil)', code: 'forge create src/Contract.sol:Contract --rpc-url http://localhost:8545 --private-key <key>' },
    ],
    docs: [
      { label: 'Foundry Book', url: 'https://book.getfoundry.sh' },
      { label: 'forge test reference', url: 'https://book.getfoundry.sh/reference/forge/forge-test' },
    ],
  },
  {
    title: 'Anvil',
    color: 'rgba(88,149,255,0.9)',
    items: [
      { label: 'View live logs', code: 'tail -f /tmp/anvil.log' },
      { label: 'Default accounts & keys', code: '// Anvil prints 10 funded accounts with private keys on start' },
      { label: 'Send ETH', code: 'cast send <addr> --value 1ether --private-key <key> --rpc-url http://localhost:8545' },
      { label: 'Get balance', code: 'cast balance <addr> --rpc-url http://localhost:8545' },
      { label: 'Mine blocks', code: 'cast rpc anvil_mine 10 --rpc-url http://localhost:8545' },
    ],
    docs: [
      { label: 'Anvil reference', url: 'https://book.getfoundry.sh/reference/anvil/' },
      { label: 'cast reference', url: 'https://book.getfoundry.sh/reference/cast/' },
    ],
  },
]

// ---------------------------------------------------------------------------
// Status dot
// ---------------------------------------------------------------------------
function StatusDot({ status }: { status: 'connecting' | 'connected' | 'disconnected' }) {
  const color =
    status === 'connected' ? 'rgba(88,214,171,0.9)'
    : status === 'connecting' ? 'rgba(245,200,60,0.9)'
    : 'rgba(255,90,90,0.7)'
  const label =
    status === 'connected' ? 'Connected'
    : status === 'connecting' ? 'Connecting…'
    : 'Disconnected'
  return (
    <Flex align="center" gap="1.5">
      <Circle
        size={7}
        fill={color}
        stroke="none"
        style={{ animation: status === 'connecting' ? 'pulse 1.2s ease-in-out infinite' : 'none' }}
      />
      <span style={{ fontSize: 11, fontFamily: t.mono, color: t.muted }}>{label}</span>
    </Flex>
  )
}

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------
function SectionHeader({ section }: { section: Section }) {
  return (
    <Flex align="center" gap="1.5" style={{ marginBottom: 7 }}>
      <span style={{ color: section.color }}>{section.icon}</span>
      <span style={{ fontSize: 10.5, fontWeight: 700, color: t.text, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
        {section.title}
      </span>
      <span style={{ fontSize: 9.5, color: t.muted, fontFamily: t.mono }}>{section.subtitle}</span>
    </Flex>
  )
}

// ---------------------------------------------------------------------------
// Cheat sheet modal
// ---------------------------------------------------------------------------
function CheatSheet({ onClose }: { onClose: () => void }) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 300,
        background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%', maxWidth: 700, maxHeight: '85vh',
          background: t.sidebar, borderRadius: 12,
          border: `1px solid ${t.borderMid}`,
          overflow: 'hidden', display: 'flex', flexDirection: 'column',
          boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <Flex align="center" justify="space-between" style={{
          padding: '14px 20px', borderBottom: `1px solid ${t.border}`, flexShrink: 0,
        }}>
          <Flex align="center" gap="2">
            <BookOpen size={15} style={{ color: t.accent }} />
            <span style={{ fontFamily: t.mono, fontSize: 12, fontWeight: 700, color: t.text, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Fuzzing Cheat Sheet
            </span>
          </Flex>
          <button
            type="button"
            onClick={onClose}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 26, height: 26, borderRadius: 6, border: `1px solid ${t.border}`,
              background: 'transparent', color: t.muted, cursor: 'pointer',
            }}
          >
            <X size={13} />
          </button>
        </Flex>

        {/* Body */}
        <div style={{ overflowY: 'auto', padding: '18px 20px', flex: 1 }}>
          {CHEAT_SECTIONS.map((sec, si) => (
            <div key={sec.title} style={{ marginBottom: si < CHEAT_SECTIONS.length - 1 ? 28 : 0 }}>
              {/* Section title */}
              <Flex align="center" gap="2" style={{ marginBottom: 10 }}>
                <span style={{ width: 3, height: 14, background: sec.color, borderRadius: 2, display: 'block', flexShrink: 0 }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: t.text, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                  {sec.title}
                </span>
              </Flex>

              {/* Commands */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 10 }}>
                {sec.items.map(item => (
                  <div key={item.label}>
                    <span style={{ fontSize: 9.5, fontFamily: t.mono, color: t.muted, display: 'block', marginBottom: 3 }}>
                      {item.label}
                    </span>
                    <code style={{
                      display: 'block', padding: '5px 10px', borderRadius: 5,
                      background: 'rgba(0,0,0,0.35)', border: `1px solid ${t.border}`,
                      fontFamily: t.mono, fontSize: 10.5, color: 'rgba(180,240,180,0.85)',
                      wordBreak: 'break-all', lineHeight: 1.55,
                    }}>
                      {item.code}
                    </code>
                  </div>
                ))}
              </div>

              {/* Docs links */}
              <Flex gap="2" wrap="wrap">
                {sec.docs.map(doc => (
                  <a
                    key={doc.url}
                    href={doc.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={css({ _hover: { color: `${t.text} !important`, borderColor: `${t.borderMid} !important` } })}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      padding: '3px 8px', borderRadius: 5,
                      border: `1px solid ${t.border}`,
                      background: 'rgba(255,255,255,0.02)',
                      color: t.muted, fontSize: 10, fontFamily: t.mono,
                      textDecoration: 'none', transition: 'all 0.12s',
                    }}
                  >
                    <ExternalLink size={9} />
                    {doc.label}
                  </a>
                ))}
              </Flex>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Reusable sidebar button
// ---------------------------------------------------------------------------
const hoverDefault = css({ _hover: { background: 'rgba(255,255,255,0.07) !important' } })
const hoverDanger  = css({ _hover: { background: 'rgba(255,90,90,0.1) !important', borderColor: 'rgba(255,90,90,0.3) !important' } })

function SidebarBtn({
  label, color, icon, disabled, onClick,
  variant = 'default',
}: {
  label: string
  color: string
  icon?: React.ReactNode
  disabled?: boolean
  onClick: () => void
  variant?: 'default' | 'danger'
}) {
  const variantStyle =
    variant === 'danger'
      ? { bg: 'rgba(255,90,90,0.05)', border: '1px solid rgba(255,90,90,0.2)', color: 'rgba(255,120,120,0.8)' }
      : { bg: disabled ? 'transparent' : 'rgba(255,255,255,0.03)', border: `1px solid ${disabled ? 'rgba(185,185,189,0.07)' : 'rgba(185,185,189,0.1)'}`, color: disabled ? 'rgba(185,185,193,0.5)' : 'rgba(231,228,239,0.72)' }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={variant === 'danger' ? hoverDanger : hoverDefault}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        width: '100%', padding: '5px 9px', borderRadius: 6, textAlign: 'left',
        background: variantStyle.bg,
        border: variantStyle.border,
        color: variantStyle.color,
        fontSize: 11, fontFamily: "'Roboto Mono', ui-monospace, monospace",
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'all 0.12s',
      }}
    >
      {icon ?? <span style={{ color, fontSize: 9 }}>▶</span>}
      {label}
    </button>
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

export function DynamicAnalysisWorkspace({ auditId, onNavigate, onOpenProfile }: Props) {
  const [contracts, setContracts] = useState<scopeApi.ScopeContract[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [sessionKey, setSessionKey] = useState(1)
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting')
  const [notesOpen, setNotesOpen] = useState(false)
  const [sideNavPanel, setSideNavPanel] = useState<'tools' | null>(null)
  const [echidnaMode, setEchidnaMode] = useState('property')
  const [echidnaTimeout, setEchidnaTimeout] = useState(60)
  const [anvilRunning, setAnvilRunning] = useState(false)
  const [cheatSheetOpen, setCheatSheetOpen] = useState(false)

  const termRef = useRef<TerminalHandle>(null)

  useEffect(() => {
    scopeApi.listContracts(auditId, true)
      .then(res => {
        setContracts(res.items)
        if (res.items[0]) setSelectedId(res.items[0].id)
      })
      .catch(() => {})
  }, [auditId])

  const wsUrl = useMemo(() => {
    const base = (API_BASE_URL ?? 'http://localhost:8001').replace(/^http/, 'ws')
    const token = encodeURIComponent(getAccessToken() ?? '')
    return `${base}/terminal/ws/${auditId}?token=${token}&_k=${sessionKey}`
  }, [auditId, sessionKey])

  const handleStatusChange = useCallback((s: 'connecting' | 'connected' | 'disconnected') => {
    setStatus(s)
    if (s === 'disconnected') setAnvilRunning(false)
  }, [])

  const handleReconnect = useCallback(() => {
    termRef.current?.clear()
    setSessionKey(k => k + 1)
  }, [])

  const selectedContract = contracts.find(c => c.id === selectedId)
  const contractPath = selectedContract
    ? selectedContract.file_path.replace(/^\//, '')
    : ''

  const sendCmd = useCallback((cmd: string) => {
    if (!cmd) return
    termRef.current?.sendCmd(cmd)
    setTimeout(() => termRef.current?.focus(), 50)
  }, [])

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
          { label: 'Scope', onClick: () => onNavigate(`/scope/${auditId}`), accentColor: 'rgba(88, 149, 255, 0.28)' },
          { label: 'Enum', onClick: () => onNavigate(`/enum/${auditId}`), accentColor: 'rgba(88, 214, 171, 0.28)' },
          { label: 'Static Analysis', onClick: () => onNavigate(`/static-analysis/${auditId}`), accentColor: 'rgba(180, 140, 255, 0.28)' },
          { label: 'Dynamic Analysis', isCurrent: true, accentColor: 'rgba(245, 200, 60, 0.28)' },
        ]}
        openSideNavPanel={sideNavPanel}
        onSideNavPanelConsumed={() => setSideNavPanel(null)}
        onOpenNotes={() => setNotesOpen(true)}
      />
      {notesOpen && <NotesOverlay auditId={auditId} onClose={() => setNotesOpen(false)} />}
      {cheatSheetOpen && <CheatSheet onClose={() => setCheatSheetOpen(false)} />}

      <Flex flex="1" style={{ minHeight: 0, overflow: 'hidden' }}>

        {/* ── Left sidebar ──────────────────────────────────────── */}
        <Box style={{
          width: 240, minWidth: 240, flexShrink: 0,
          background: t.sidebar,
          borderRight: `1px solid ${t.border}`,
          overflowY: 'auto',
          display: 'flex', flexDirection: 'column',
        }}>
          {/* Contract selector */}
          <Box style={{ padding: '14px 14px 10px', borderBottom: `1px solid ${t.border}` }}>
            <span style={{ fontSize: 9.5, fontFamily: t.mono, color: t.muted, textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: 6 }}>
              Target Contract
            </span>
            <div style={{ position: 'relative' }}>
              <select
                value={selectedId}
                onChange={e => setSelectedId(e.target.value)}
                className={css({ outline: 'none', _focus: { borderColor: 'rgba(245,200,60,0.5) !important' } })}
                style={{
                  width: '100%', appearance: 'none', WebkitAppearance: 'none',
                  padding: '5px 26px 5px 9px', borderRadius: 6,
                  background: 'rgba(10,10,14,0.95)',
                  border: `1px solid ${t.border}`,
                  color: t.text, fontSize: 11, fontFamily: t.mono,
                  cursor: 'pointer',
                }}
              >
                {contracts.length === 0
                  ? <option value="">No contracts in scope</option>
                  : contracts.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.file_path.split('/').pop() ?? c.file_path}
                      </option>
                    ))
                }
              </select>
              <ChevronDown size={11} style={{
                position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                color: t.muted, pointerEvents: 'none',
              }} />
            </div>
            {contractPath && (
              <span style={{ fontSize: 9, fontFamily: t.mono, color: t.muted, display: 'block', marginTop: 4, wordBreak: 'break-all' }}>
                {contractPath}
              </span>
            )}
          </Box>

          {/* Tool sections */}
          <Box style={{ padding: '10px 10px', flex: 1 }}>
            {SECTIONS.map(section => (
              <Box
                key={section.id}
                style={{ marginBottom: 16, paddingBottom: 16, borderBottom: `1px solid ${t.border}` }}
              >
                <SectionHeader section={section} />

                {/* Echidna mode/timeout controls */}
                {section.id === 'echidna' && (
                  <Flex direction="column" gap="1" style={{ marginBottom: 7 }}>
                    <Flex align="center" justify="space-between">
                      <span style={{ fontSize: 10, fontFamily: t.mono, color: t.muted }}>Mode</span>
                      <div style={{ position: 'relative' }}>
                        <select
                          value={echidnaMode}
                          onChange={e => setEchidnaMode(e.target.value)}
                          className={css({ outline: 'none' })}
                          style={{
                            appearance: 'none', WebkitAppearance: 'none',
                            padding: '2px 18px 2px 7px', borderRadius: 5,
                            background: 'rgba(10,10,14,0.95)',
                            border: `1px solid ${t.border}`,
                            color: t.text, fontSize: 10, fontFamily: t.mono, cursor: 'pointer',
                          }}
                        >
                          {['property', 'assertion', 'overflow', 'exploration'].map(m => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                        <ChevronDown size={9} style={{ position: 'absolute', right: 5, top: '50%', transform: 'translateY(-50%)', color: t.muted, pointerEvents: 'none' }} />
                      </div>
                    </Flex>
                    <Flex align="center" justify="space-between">
                      <span style={{ fontSize: 10, fontFamily: t.mono, color: t.muted }}>Timeout (s)</span>
                      <input
                        type="number"
                        value={echidnaTimeout}
                        min={10} max={600}
                        onChange={e => setEchidnaTimeout(Number(e.target.value))}
                        className={css({ outline: 'none', _focus: { borderColor: 'rgba(245,200,60,0.5) !important' } })}
                        style={{
                          width: 54, padding: '2px 6px', borderRadius: 5,
                          background: 'rgba(10,10,14,0.95)', border: `1px solid ${t.border}`,
                          color: t.text, fontSize: 10, fontFamily: t.mono,
                        }}
                      />
                    </Flex>
                  </Flex>
                )}

                {/* Anvil: toggle start/stop */}
                {section.id === 'anvil' && (
                  <Flex direction="column" gap="1.5">
                    {anvilRunning ? (
                      <>
                        <Flex align="center" gap="5px" style={{
                          padding: '3px 9px', borderRadius: 5,
                          background: 'rgba(88,149,255,0.06)',
                          border: '1px solid rgba(88,149,255,0.18)',
                          fontSize: 9.5, fontFamily: t.mono, color: 'rgba(88,149,255,0.65)',
                        }}>
                          <Circle size={6} fill="rgba(88,149,255,0.65)" stroke="none" style={{ animation: 'pulse 2s ease-in-out infinite', flexShrink: 0 }} />
                          Running in background
                        </Flex>
                        <SidebarBtn
                          label="Stop Anvil"
                          color="rgba(255,90,90,0.9)"
                          icon={<Square size={9} fill="currentColor" />}
                          variant="danger"
                          onClick={() => {
                            setAnvilRunning(false)
                            sendCmd('pkill anvil 2>/dev/null; echo "Anvil stopped"')
                          }}
                        />
                        <SidebarBtn
                          label="tail anvil logs"
                          color="rgba(88,149,255,0.9)"
                          onClick={() => sendCmd('tail -f /tmp/anvil.log')}
                        />
                      </>
                    ) : (
                      <SidebarBtn
                        label="Start Anvil"
                        color="rgba(88,149,255,0.9)"
                        onClick={() => {
                          setAnvilRunning(true)
                          sendCmd('anvil > /tmp/anvil.log 2>&1 & echo "⚡ Anvil started (PID $!). Use \'tail anvil logs\' to view output."')
                        }}
                      />
                    )}
                  </Flex>
                )}

                {/* Standard buttons (echidna, medusa, foundry) */}
                {section.id !== 'anvil' && (
                  <Flex direction="column" gap="1.5">
                    {section.buttons.map(btn => {
                      const cmd = section.id === 'echidna'
                        ? `echidna ${contractPath} --test-mode ${echidnaMode} --timeout ${echidnaTimeout} --config echidna.yaml`
                        : btn.cmd(contractPath)
                      const isDisabled = btn.disabled ? btn.disabled(contractPath) : false
                      return (
                        <SidebarBtn
                          key={btn.label}
                          label={btn.label}
                          color={section.color}
                          disabled={isDisabled}
                          onClick={() => { if (cmd) sendCmd(cmd) }}
                        />
                      )
                    })}
                  </Flex>
                )}
              </Box>
            ))}

            {/* Cheat Sheet */}
            <Box>
              <Flex align="center" gap="1.5" style={{ marginBottom: 7 }}>
                <BookOpen size={13} style={{ color: 'rgba(255,165,80,0.9)' }} />
                <span style={{ fontSize: 10.5, fontWeight: 700, color: t.text, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                  Cheat Sheet
                </span>
                <span style={{ fontSize: 9.5, color: t.muted, fontFamily: t.mono }}>Commands & docs</span>
              </Flex>
              <button
                type="button"
                onClick={() => setCheatSheetOpen(true)}
                className={css({
                  _hover: {
                    background: 'rgba(255,165,80,0.08) !important',
                    borderColor: 'rgba(255,165,80,0.22) !important',
                    color: 'rgba(255,200,120,0.9) !important',
                  },
                })}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  width: '100%', padding: '5px 9px', borderRadius: 6, textAlign: 'left',
                  background: 'rgba(255,165,80,0.04)',
                  border: '1px solid rgba(255,165,80,0.14)',
                  color: 'rgba(255,165,80,0.72)',
                  fontSize: 11, fontFamily: t.mono, cursor: 'pointer',
                  transition: 'all 0.12s',
                }}
              >
                <BookOpen size={10} /> Open Cheat Sheet
              </button>
            </Box>
          </Box>
        </Box>

        {/* ── Terminal area ─────────────────────────────────────── */}
        <Flex direction="column" flex="1" style={{ minWidth: 0, overflow: 'hidden' }}>
          {/* Toolbar */}
          <Flex
            align="center"
            justify="space-between"
            style={{
              padding: '0 14px', height: 42, flexShrink: 0,
              background: t.panel,
              borderBottom: `1px solid ${t.border}`,
            }}
          >
            <Flex align="center" gap="3">
              <StatusDot status={status} />
              {anvilRunning && (
                <Flex align="center" gap="5px" style={{ fontSize: 10, fontFamily: t.mono, color: 'rgba(88,149,255,0.65)' }}>
                  <Circle size={5} fill="rgba(88,149,255,0.65)" stroke="none" style={{ animation: 'pulse 2s ease-in-out infinite' }} />
                  anvil
                </Flex>
              )}
            </Flex>
            <Flex align="center" gap="2">
              <button
                type="button"
                onClick={() => termRef.current?.clear()}
                title="Clear terminal"
                className={css({ _hover: { color: `${t.text} !important`, background: 'rgba(255,255,255,0.06) !important' } })}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '3px 8px', borderRadius: 5, border: `1px solid ${t.border}`,
                  background: 'transparent', color: t.muted, fontSize: 10.5,
                  fontFamily: t.mono, cursor: 'pointer', transition: 'all 0.12s',
                }}
              >
                <Trash2 size={11} /> Clear
              </button>
              <button
                type="button"
                onClick={handleReconnect}
                title="New session"
                className={css({ _hover: { color: `${t.accent} !important`, borderColor: `${t.accentBorder} !important`, background: `${t.accentFaint} !important` } })}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '3px 8px', borderRadius: 5, border: `1px solid ${t.border}`,
                  background: 'transparent', color: t.muted, fontSize: 10.5,
                  fontFamily: t.mono, cursor: 'pointer', transition: 'all 0.12s',
                }}
              >
                <RefreshCw size={11} /> Reconnect
              </button>
            </Flex>
          </Flex>

          {/* xterm */}
          <Box flex="1" style={{ minHeight: 0, background: '#0c0c10', overflow: 'hidden' }}>
            <TerminalPanel
              ref={termRef}
              wsUrl={wsUrl}
              onStatusChange={handleStatusChange}
            />
          </Box>
        </Flex>
      </Flex>

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
          text="Goto Static Analysis"
          theme="yellow"
          onComplete={() => onNavigate(`/static-analysis/${auditId}`)}
        />
        <SlideButton
          text="Goto Reports"
          theme="yellow"
          onComplete={() => {}}
        />
      </Flex>

      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>
    </Flex>
  )
}
