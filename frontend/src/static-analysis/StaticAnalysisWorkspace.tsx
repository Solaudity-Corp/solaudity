import { useState } from 'react'
import { css } from 'styled-system/css'
import { Box, Flex } from 'styled-system/jsx'
import { ChevronUp, ChevronDown } from 'lucide-react'
import { NavBar } from '../components/NavBar'
import SlideButton from '../components/SlideButton'
import { SlitherView } from './SlitherView'
import { MythrilView } from './MythrilView'
import { SecurifyView } from './SecurifyView'
import { AderynView } from './AderynView'
import { CertoraView } from './CertoraView'
import { SMTCheckerView } from './SMTCheckerView'
import { KEVMView } from './KEVMView'
import { CodeQualityView } from './CodeQualityView'
import { OrchestrationView } from './OrchestrationView'

type StaticView =
  | 'slither'
  | 'mythril'
  | 'securify'
  | 'aderyn'
  | 'certora'
  | 'smtchecker'
  | 'kevm'
  | 'codequality'
  | 'orchestration'

const views: Array<{ id: StaticView; label: string }> = [
  { id: 'slither', label: 'Slither' },
  { id: 'mythril', label: 'Mythril' },
  { id: 'securify', label: 'Securify' },
  { id: 'aderyn', label: 'Aderyn' },
  { id: 'certora', label: 'Certora Prover' },
  { id: 'smtchecker', label: 'SMTChecker' },
  { id: 'kevm', label: 'KEVM' },
  { id: 'codequality', label: 'Qualité de code' },
  { id: 'orchestration', label: 'Orchestration' },
]

interface StaticAnalysisWorkspaceProps {
  auditId: string
  onNavigate: (path: string) => void
  onOpenProfile: () => void
}

export function StaticAnalysisWorkspace({ auditId, onNavigate, onOpenProfile }: StaticAnalysisWorkspaceProps) {
  const [activeView, setActiveView] = useState<StaticView>('slither')
  const [subNavOpen, setSubNavOpen] = useState(true)

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
          { label: 'Scope', onClick: () => onNavigate(`/scope/${auditId}`) },
          { label: 'Enum', onClick: () => onNavigate(`/enum/${auditId}`) },
          { label: 'Static Analysis', isCurrent: true },
        ]}
      />

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
                    color: isActive ? 'rgba(88, 214, 171, 1)' : 'rgba(185, 185, 193, 0.72)',
                    background: isActive ? 'rgba(88, 214, 171, 0.08)' : 'transparent',
                    border: isActive ? '1px solid rgba(88, 214, 171, 0.22)' : '1px solid transparent',
                    cursor: 'pointer', transition: 'all 0.15s ease', whiteSpace: 'nowrap', flexShrink: 0,
                    _hover: {
                      color: isActive ? 'rgba(88, 214, 171, 1)' : 'rgba(231, 228, 239, 0.88)',
                      background: isActive ? 'rgba(88, 214, 171, 0.08)' : 'rgba(255, 255, 255, 0.04)',
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
            <MythrilView auditId={auditId} />
          ) : activeView === 'securify' ? (
            <SecurifyView auditId={auditId} />
          ) : activeView === 'aderyn' ? (
            <AderynView auditId={auditId} />
          ) : activeView === 'certora' ? (
            <CertoraView auditId={auditId} />
          ) : activeView === 'smtchecker' ? (
            <SMTCheckerView auditId={auditId} />
          ) : activeView === 'kevm' ? (
            <KEVMView auditId={auditId} />
          ) : activeView === 'codequality' ? (
            <CodeQualityView auditId={auditId} />
          ) : (
            <OrchestrationView auditId={auditId} />
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
          onComplete={() => onNavigate(`/enum/${auditId}`)}
        />
        <SlideButton
          text="Goto Reports"
          onComplete={() => {}}
        />
      </Flex>
    </Flex>
  )
}
