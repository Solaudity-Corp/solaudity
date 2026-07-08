import { useMemo, useState } from 'react'
import { css } from 'styled-system/css'
import { Flex } from 'styled-system/jsx'
import { AuditsWorkspace } from './audits/AuditsWorkspace'
import { type MenuSection, NavBar } from './components/NavBar'
import { DashboardWorkspace } from './dashboard/DashboardWorkspace'
import { AllReportsView } from './reports/AllReportsView'
export type MenuPath = '/menu/dashboard' | '/menu/audits' | '/menu/reports'

interface MenuProps {
  path: MenuPath
  onNavigate: (path: MenuPath) => void
  onOpenProfile: () => void
}

function sectionFromPath(path: MenuPath): MenuSection {
  if (path === '/menu/audits') return 'audits'
  if (path === '/menu/reports') return 'reports'
  return 'dashboard'
}

export default function Menu({ path, onNavigate, onOpenProfile }: MenuProps) {
  const activeSection = useMemo(() => sectionFromPath(path), [path])
  const [search, setSearch] = useState('')

  const navigateBySection = (section: MenuSection) => {
    onNavigate(`/menu/${section}` as MenuPath)
  }

  return (
    <Flex
      minH="100vh"
      direction="column"
      className={css({
        background: '#101014',
      })}
    >
      <NavBar
        activeSection={activeSection}
        searchValue={search}
        onSearchChange={setSearch}
        onNavigate={navigateBySection}
        onOpenProfile={onOpenProfile}
      />
      {activeSection === 'dashboard' && <DashboardWorkspace onNavigate={navigateBySection} />}
      {activeSection === 'audits' && <AuditsWorkspace searchQuery={search} />}
      {activeSection === 'reports' && (
        <AllReportsView searchQuery={search} onNavigate={(p) => onNavigate(p as MenuPath)} />
      )}
    </Flex>
  )
}
