import { useState } from 'react'
import { css } from 'styled-system/css'
import { Box, Flex } from 'styled-system/jsx'
import { ChevronUp, ChevronDown, Bug, Zap, Terminal, Construction } from 'lucide-react'
import { NavBar } from '../components/NavBar'
import SlideButton from '../components/SlideButton'
import { NotesOverlay } from '../notes/NotesOverlay'
import { EchidnaView } from './EchidnaView'

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------
const y = {
  accent: 'rgba(245, 200, 60, 1)',
  accentSoft: 'rgba(245, 200, 60, 0.85)',
  accentFaint: 'rgba(245, 200, 60, 0.07)',
  accentBorder: 'rgba(245, 200, 60, 0.22)',
  accentNav: 'rgba(245, 200, 60, 0.28)',
  text: 'rgba(231, 228, 239, 0.91)',
  textSub: 'rgba(231, 228, 239, 0.72)',
  muted: 'rgba(185, 185, 193, 0.55)',
  border: 'rgba(185, 185, 189, 0.14)',
  mono: "'Roboto Mono', ui-monospace, monospace",
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------
type DynView = 'echidna' | 'medusa' | 'forgeshell'

interface ToolDef {
  id: DynView
  label: string
  icon: React.ReactNode
  tagline: string
  description: string
  install: string
  status: 'coming-soon'
}

const TOOLS: ToolDef[] = [
  {
    id: 'echidna',
    label: 'Echidna',
    icon: <Bug size={20} strokeWidth={1.5} />,
    tagline: 'Property-based fuzzer',
    description:
      'Echidna is a Haskell-based smart contract fuzzer by Trail of Bits. It uses property-based testing to find violations in Solidity invariants. Define properties in Solidity and Echidna will automatically generate input sequences that break them.',
    install: 'Pre-built binary — no runtime dependencies required.',
    status: 'coming-soon',
  },
  {
    id: 'medusa',
    label: 'Medusa',
    icon: <Zap size={20} strokeWidth={1.5} />,
    tagline: 'Go-based corpus fuzzer',
    description:
      'Medusa is a Go-based fuzzer from Trail of Bits, designed as a faster, more configurable alternative to Echidna. It supports corpus-guided mutation fuzzing and integrates directly with Foundry-style test suites.',
    install: 'Single Go binary — download and run.',
    status: 'coming-soon',
  },
  {
    id: 'forgeshell',
    label: 'Forge Shell',
    icon: <Terminal size={20} strokeWidth={1.5} />,
    tagline: 'Interactive contract console',
    description:
      'A live terminal panel that lets you run forge, cast, and anvil commands directly against a selected contract. Fork a network, deploy, call functions, and inspect state — all from inside the audit workspace.',
    install: 'Requires Foundry (forge / cast / anvil) installed in the backend container.',
    status: 'coming-soon',
  },
]

// ---------------------------------------------------------------------------
// Placeholder view
// ---------------------------------------------------------------------------
function ToolPlaceholder({ tool }: { tool: ToolDef }) {
  return (
    <Flex
      direction="column"
      align="center"
      justify="center"
      style={{ minHeight: 420, gap: 0 }}
    >
      {/* Icon circle */}
      <Flex
        align="center"
        justify="center"
        style={{
          width: 72, height: 72, borderRadius: 18,
          background: y.accentFaint,
          border: `1px solid ${y.accentBorder}`,
          color: y.accent,
          marginBottom: 20,
        }}
      >
        {tool.icon}
      </Flex>

      {/* Tool name + tag */}
      <Flex align="center" gap="2" style={{ marginBottom: 8 }}>
        <span style={{ fontSize: 20, fontWeight: 700, color: y.text }}>{tool.label}</span>
        <span style={{
          fontSize: 10.5, fontWeight: 600, fontFamily: y.mono,
          color: y.accent, background: y.accentFaint,
          border: `1px solid ${y.accentBorder}`,
          borderRadius: 5, padding: '2px 8px',
          letterSpacing: '0.05em', textTransform: 'uppercase',
        }}>
          {tool.tagline}
        </span>
      </Flex>

      {/* Description */}
      <Box style={{ maxWidth: 520, textAlign: 'center', marginBottom: 28 }}>
        <p style={{ fontSize: 13, color: y.textSub, lineHeight: 1.75, fontFamily: y.mono }}>
          {tool.description}
        </p>
      </Box>

      {/* Install note */}
      <Flex
        align="center"
        gap="2"
        style={{
          padding: '8px 16px', borderRadius: 8,
          background: 'rgba(255,255,255,0.03)',
          border: `1px solid ${y.border}`,
          marginBottom: 32,
        }}
      >
        <span style={{ fontSize: 11, color: y.muted, fontFamily: y.mono }}>{tool.install}</span>
      </Flex>

      {/* Coming soon badge */}
      <Flex align="center" gap="2" style={{
        padding: '10px 20px', borderRadius: 10,
        background: y.accentFaint,
        border: `1px solid ${y.accentBorder}`,
      }}>
        <Construction size={14} color={y.accent} strokeWidth={1.8} />
        <span style={{ fontSize: 12, fontWeight: 600, color: y.accent, fontFamily: y.mono, letterSpacing: '0.04em' }}>
          Implementation coming soon
        </span>
      </Flex>
    </Flex>
  )
}

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------
interface DynamicAnalysisWorkspaceProps {
  auditId: string
  onNavigate: (path: string) => void
  onOpenProfile: () => void
}

export function DynamicAnalysisWorkspace({ auditId, onNavigate, onOpenProfile }: DynamicAnalysisWorkspaceProps) {
  const [activeView, setActiveView] = useState<DynView>('echidna')
  const [subNavOpen, setSubNavOpen] = useState(true)
  const [notesOpen, setNotesOpen] = useState(false)
  const [sideNavPanel, setSideNavPanel] = useState<'tools' | null>(null)

  const activeTool = TOOLS.find(t => t.id === activeView)!

  return (
    <Flex direction="column" minH="100vh" className={css({ background: '#101014' })}>
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
          { label: 'Dynamic Analysis', isCurrent: true, accentColor: y.accentNav },
        ]}
        openSideNavPanel={sideNavPanel}
        onSideNavPanelConsumed={() => setSideNavPanel(null)}
        onOpenNotes={() => setNotesOpen(true)}
      />
      {notesOpen && <NotesOverlay auditId={auditId} onClose={() => setNotesOpen(false)} />}

      {/* Collapsible sub-navbar */}
      <Box
        className={css({
          position: 'relative',
          borderBottom: subNavOpen ? '1px solid rgba(185, 185, 189, 0.12)' : 'none',
          bg: 'rgba(16, 16, 20, 0.85)',
          backdropFilter: 'blur(6px)',
          overflow: 'visible',
        })}
      >
        <Box
          className={css({
            overflow: 'hidden',
            transition: 'max-height 0.22s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.18s ease',
            maxHeight: subNavOpen ? '52px' : '0px',
            opacity: subNavOpen ? 1 : 0,
          })}
        >
          <Flex align="center" gap="1" px={{ base: '4', md: '8' }} h="52px" overflowX="auto">
            {TOOLS.map((tool) => {
              const isActive = activeView === tool.id
              return (
                <button
                  key={tool.id}
                  type="button"
                  onClick={() => setActiveView(tool.id)}
                  className={css({
                    px: '4', py: '1.5', borderRadius: '6px', fontSize: 'sm',
                    fontWeight: isActive ? '600' : '400',
                    color: isActive ? y.accent : 'rgba(185, 185, 193, 0.72)',
                    background: isActive ? y.accentFaint : 'transparent',
                    border: isActive ? `1px solid ${y.accentBorder}` : '1px solid transparent',
                    cursor: 'pointer', transition: 'all 0.15s ease', whiteSpace: 'nowrap', flexShrink: 0,
                    _hover: {
                      color: isActive ? y.accent : 'rgba(231, 228, 239, 0.88)',
                      background: isActive ? y.accentFaint : 'rgba(255, 255, 255, 0.04)',
                    },
                  })}
                >
                  {tool.label}
                </button>
              )
            })}
          </Flex>
        </Box>

        {/* Collapse pill */}
        <Flex justify="center" className={css({ position: 'relative' })}>
          <Box
            onClick={() => setSubNavOpen((o) => !o)}
            role="button" tabIndex={0}
            aria-label={subNavOpen ? 'Collapse view selector' : 'Expand view selector'}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSubNavOpen((o) => !o) }
            }}
            className={css({
              position: 'absolute', top: '0px', display: 'flex', alignItems: 'center',
              justifyContent: 'center', px: '6', minW: '40', h: '5',
              borderRadius: '0 0 8px 8px', bg: 'rgba(28, 28, 34, 0.96)',
              border: '1px solid rgba(185, 185, 189, 0.18)', borderTop: 'none',
              cursor: 'pointer', color: 'rgba(167, 167, 174, 0.72)',
              transition: 'color 0.15s ease, background 0.15s ease', userSelect: 'none', zIndex: 10,
              _hover: { bg: 'rgba(38, 38, 46, 0.98)', color: 'rgba(231, 228, 239, 0.88)' },
            })}
          >
            {subNavOpen ? <ChevronUp size={11} strokeWidth={2.5} /> : <ChevronDown size={11} strokeWidth={2.5} />}
          </Box>
        </Flex>
      </Box>

      {/* Page content */}
      <Flex
        flex="1"
        px={{ base: '4', md: '8' }}
        py={{ base: '5', md: '7' }}
        className={css({
          transition: 'padding-top 0.22s ease',
          paddingTop: subNavOpen ? undefined : 'calc(20px + 1.25rem)',
        })}
      >
        <Box width="100%">
          {activeView === 'echidna'
            ? <EchidnaView auditId={auditId} onOpenTools={() => setSideNavPanel('tools')} />
            : <ToolPlaceholder tool={activeTool} />
          }
        </Box>
      </Flex>

      {/* Bottom navigation */}
      <Flex
        align="center"
        justify="space-between"
        className={css({
          px: '8', py: '6',
          borderTop: '1px solid rgba(185, 185, 189, 0.22)',
          bg: 'rgba(14, 14, 18, 0.9)',
          flexShrink: 0,
        })}
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
    </Flex>
  )
}
