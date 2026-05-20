import { useState } from 'react'
import { css } from 'styled-system/css'
import { Box, Flex } from 'styled-system/jsx'
import { ChevronUp, ChevronDown } from 'lucide-react'
import { NavBar } from '../components/NavBar'
import SlideButton from '../components/SlideButton'
import { SlitherView } from './SlitherView'
import { MythrilView } from './MythrilView'
import { Analyzer4View } from './Analyzer4View'
import { AderynView } from './AderynView'
import { CertoraView } from './CertoraView'
import { SMTCheckerView } from './SMTCheckerView'
import KEVMView from './KEVMView'
import { AiVulnView } from './AiVulnView'
import { NotesOverlay } from '../notes/NotesOverlay'

type StaticView =
  | 'slither'
  | 'mythril'
  | 'analyzer4'
  | 'aderyn'
  | 'certora'
  | 'smtchecker'
  | 'kevm'
  | 'aivuln'

const views: Array<{ id: StaticView; label: string }> = [
  { id: 'slither', label: 'Slither' },
  { id: 'mythril', label: 'Mythril' },
  { id: 'analyzer4', label: '4naly3er' },
  { id: 'aderyn', label: 'Aderyn' },
  { id: 'certora', label: 'Certora Prover' },
  { id: 'smtchecker', label: 'SMTChecker' },
  { id: 'kevm', label: 'KEVM' },
  { id: 'aivuln', label: 'AI Vuln Scanner' },
]

interface StaticAnalysisWorkspaceProps {
  auditId: string
  onNavigate: (path: string) => void
  onOpenProfile: () => void
}

export function StaticAnalysisWorkspace({ auditId, onNavigate, onOpenProfile }: StaticAnalysisWorkspaceProps) {
  const [activeView, setActiveView] = useState<StaticView>('slither')
  const [subNavOpen, setSubNavOpen] = useState(true)
  const [sideNavPanel, setSideNavPanel] = useState<'tools' | null>(null)
  const [notesOpen, setNotesOpen] = useState(false)

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
          { label: 'Static Analysis', isCurrent: true, accentColor: 'rgba(180, 140, 255, 0.28)' },
          { label: 'Dynamic Analysis', onClick: () => onNavigate(`/dynamic-analysis/${auditId}`), accentColor: 'rgba(245, 200, 60, 0.28)' },
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
            {views.map((view) => {
              const isActive = activeView === view.id
              return (
                <button
                  key={view.id}
                  type="button"
                  onClick={() => setActiveView(view.id)}
                  className={css({
                    px: '4', py: '1.5', borderRadius: '6px', fontSize: 'sm',
                    fontWeight: isActive ? '600' : '400',
                    color: isActive ? 'rgba(180, 140, 255, 1)' : 'rgba(185, 185, 193, 0.72)',
                    background: isActive ? 'rgba(180, 140, 255, 0.09)' : 'transparent',
                    border: isActive ? '1px solid rgba(180, 140, 255, 0.28)' : '1px solid transparent',
                    cursor: 'pointer', transition: 'all 0.15s ease', whiteSpace: 'nowrap', flexShrink: 0,
                    _hover: {
                      color: isActive ? 'rgba(180, 140, 255, 1)' : 'rgba(231, 228, 239, 0.88)',
                      background: isActive ? 'rgba(180, 140, 255, 0.09)' : 'rgba(255, 255, 255, 0.04)',
                    },
                  })}
                >
                  {view.label}
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
          {activeView === 'slither' ? (
            <SlitherView auditId={auditId} />
          ) : activeView === 'mythril' ? (
            <MythrilView auditId={auditId} onOpenTools={() => setSideNavPanel('tools')} />
          ) : activeView === 'analyzer4' ? (
            <Analyzer4View auditId={auditId} />
          ) : activeView === 'aderyn' ? (
            <AderynView auditId={auditId} />
          ) : activeView === 'certora' ? (
            <CertoraView auditId={auditId} />
          ) : activeView === 'smtchecker' ? (
            <SMTCheckerView auditId={auditId} />
          ) : activeView === 'kevm' ? (
            <KEVMView auditId={auditId} onOpenTools={() => setSideNavPanel('tools')} />
          ) : (
            <AiVulnView auditId={auditId} />
          )}
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
          text="Goto Enum"
          theme="violet"
          onComplete={() => onNavigate(`/enum/${auditId}`)}
        />
        <SlideButton
          text="Goto Dynamic Analysis"
          theme="yellow"
          onComplete={() => onNavigate(`/dynamic-analysis/${auditId}`)}
        />
      </Flex>
    </Flex>
  )
}
