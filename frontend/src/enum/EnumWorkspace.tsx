import { useCallback, useState } from 'react'
import { NotesOverlay } from '../notes/NotesOverlay'
import { css } from 'styled-system/css'
import { Box, Flex } from 'styled-system/jsx'
import { ChevronUp, ChevronDown } from 'lucide-react'
import { NavBar } from '../components/NavBar'
import { SuryaView } from './SuryaView'
import { ParseView } from './ParseView'
import { CodeView } from './CodeView'
import { SolaudityView } from './SolaudityView'
import { ReverseView } from './ReverseView'
import { AiDocView } from './AiDocView'
import SlideButton from '../components/SlideButton'

type EnumView = 'code' | 'parse' | 'tree' | 'aidoc' | 'solaudity' | 'reverse'

const views: Array<{ id: EnumView; label: string }> = [
  { id: 'code', label: 'CodeView' },
  { id: 'tree', label: 'SuryaView' },
  { id: 'parse', label: 'ParseView' },
  { id: 'solaudity', label: 'SolaudityView' },
  { id: 'reverse', label: 'ReverseView' },
  { id: 'aidoc', label: 'AI Doc' },
]

interface EnumWorkspaceProps {
  auditId: string
  onNavigate: (path: string) => void
  onOpenProfile: () => void
}

type JumpTarget = { contractId: string; line: number } | null

export function EnumWorkspace({ auditId, onNavigate, onOpenProfile }: EnumWorkspaceProps) {
  const [activeView, setActiveView] = useState<EnumView>('tree')
  const [subNavOpen, setSubNavOpen] = useState(true)
  const [jumpTo, setJumpTo] = useState<JumpTarget>(null)
  const [notesOpen, setNotesOpen] = useState(false)

  const handleGoToCode = useCallback((contractId: string, line: number) => {
    setJumpTo({ contractId, line })
    setActiveView('code')
  }, [])

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
          { label: 'Enum', isCurrent: true, accentColor: 'rgba(88, 214, 171, 0.28)' },
          { label: 'Static Analysis', onClick: () => onNavigate(`/static-analysis/${auditId}`), accentColor: 'rgba(180, 140, 255, 0.28)' },
          { label: 'Dynamic Analysis', onClick: () => onNavigate(`/dynamic-analysis/${auditId}`), accentColor: 'rgba(245, 200, 60, 0.28)' },
          { label: 'Reports', onClick: () => onNavigate(`/reports/${auditId}`), accentColor: 'rgba(255, 90, 80, 0.28)' },
        ]}
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
          <Flex align="center" gap="1" px={{ base: '4', md: '8' }} h="52px">
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
                    color: isActive ? 'rgba(88, 214, 171, 1)' : 'rgba(185, 185, 193, 0.72)',
                    background: isActive ? 'rgba(88, 214, 171, 0.09)' : 'transparent',
                    border: isActive ? '1px solid rgba(88, 214, 171, 0.28)' : '1px solid transparent',
                    cursor: 'pointer', transition: 'all 0.15s ease', whiteSpace: 'nowrap',
                    _hover: {
                      color: isActive ? 'rgba(88, 214, 171, 1)' : 'rgba(231, 228, 239, 0.88)',
                      background: isActive ? 'rgba(88, 214, 171, 0.09)' : 'rgba(255, 255, 255, 0.04)',
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
        {activeView === 'code' ? (
          <Box width="100%">
            <CodeView auditId={auditId} jumpTo={jumpTo} onJumpHandled={() => setJumpTo(null)} />
          </Box>
        ) : activeView === 'parse' ? (
          <Box width="100%">
            <ParseView auditId={auditId} onGoToCode={handleGoToCode} />
          </Box>
        ) : activeView === 'tree' ? (
          <Box width="100%">
            <SuryaView auditId={auditId} />
          </Box>
        ) : activeView === 'solaudity' ? (
          <Box width="100%">
            <SolaudityView auditId={auditId} />
          </Box>
        ) : activeView === 'reverse' ? (
          <Box width="100%">
            <ReverseView auditId={auditId} />
          </Box>
        ) : activeView === 'aidoc' ? (
          <Box width="100%">
            <AiDocView auditId={auditId} onNavigateView={(view) => setActiveView(view as typeof activeView)} />
          </Box>
        ) : (
          <Box
            className={css({
              width: '100%', borderRadius: '18px',
              border: '1px solid rgba(185, 185, 189, 0.14)',
              bg: 'rgba(24, 24, 29, 0.82)',
              boxShadow: '0 12px 28px rgba(0, 0, 0, 0.3)',
              minH: '320px', p: '6',
              color: 'rgba(185, 185, 193, 0.66)', fontSize: 'sm',
            })}
          >
            <Box className={css({ color: 'rgba(231, 228, 239, 0.91)', fontSize: 'lg', fontWeight: '700', mb: '2' })}>
              {views.find((v) => v.id === activeView)?.label}
            </Box>
            <Box className={css({ lineHeight: '1.65' })}>
              UI scaffold ready — wire this view to its data source when available.
            </Box>
          </Box>
        )}
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
          text="Goto Scope"
          theme="blue"
          onComplete={() => onNavigate(`/scope/${auditId}`)}
        />
        <SlideButton
          text="Goto Static Analysis"
          theme="blue"
          onComplete={() => onNavigate(`/static-analysis/${auditId}`)}
        />
      </Flex>
    </Flex>
  )
}
