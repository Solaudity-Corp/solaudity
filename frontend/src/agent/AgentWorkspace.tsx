import { useState } from 'react'
import { Flex } from 'styled-system/jsx'
import { NavBar } from '../components/NavBar'
import SlideButton from '../components/SlideButton'
import { NotesOverlay } from '../notes/NotesOverlay'
import { AgentView } from './AgentView'

const bg = '#0c0c10'
const borderMid = 'rgba(185,185,189,0.16)'

interface Props {
  auditId: string
  onNavigate: (path: string) => void
  onOpenProfile: () => void
}

export function AgentWorkspace({ auditId, onNavigate, onOpenProfile }: Props) {
  const [notesOpen, setNotesOpen] = useState(false)

  return (
    <Flex direction="column" style={{ height: '100vh', background: bg, overflow: 'hidden' }}>
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
          { label: 'Dynamic Analysis', onClick: () => onNavigate(`/dynamic-analysis/${auditId}`), accentColor: 'rgba(245, 200, 60, 0.28)' },
          { label: 'Reports', onClick: () => onNavigate(`/reports/${auditId}`), accentColor: 'rgba(255, 90, 80, 0.28)' },
          { label: 'Agent', isCurrent: true, accentColor: 'rgba(168, 130, 255, 0.28)' },
        ]}
        onOpenNotes={() => setNotesOpen(true)}
      />

      {notesOpen && <NotesOverlay auditId={auditId} onClose={() => setNotesOpen(false)} />}

      <Flex flex="1" style={{ minHeight: 0, overflow: 'hidden', paddingTop: 12 }}>
        <AgentView auditId={auditId} />
      </Flex>

      <Flex
        align="center"
        justify="space-between"
        style={{
          padding: '16px 32px', flexShrink: 0,
          borderTop: `1px solid ${borderMid}`,
          background: 'rgba(12,12,16,0.95)',
        }}
      >
        <SlideButton
          reversed
          text="Goto Reports"
          theme="violet"
          onComplete={() => onNavigate(`/reports/${auditId}`)}
        />
        <SlideButton
          text="Finish Audit"
          theme="violet"
          onComplete={() => onNavigate('/menu/audits')}
        />
      </Flex>
    </Flex>
  )
}
