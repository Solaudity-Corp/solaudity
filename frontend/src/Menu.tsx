import { useMemo, useState } from 'react'
import { css } from 'styled-system/css'
import { Box, Flex, Stack } from 'styled-system/jsx'
import { Card } from './components/ui'
import { AuditsWorkspace } from './audits/AuditsWorkspace'
import { type MenuSection, NavBar } from './components/NavBar'

export type MenuPath = '/menu/audits' | '/menu/reports' | '/menu/activity'

interface MenuProps {
  path: MenuPath
  onNavigate: (path: MenuPath) => void
}

function sectionFromPath(path: MenuPath): MenuSection {
  if (path === '/menu/reports') return 'reports'
  if (path === '/menu/activity') return 'activity'
  return 'audits'
}

export default function Menu({ path, onNavigate }: MenuProps) {
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
      />
      {activeSection === 'audits' && <AuditsWorkspace searchQuery={search} />}

      {activeSection !== 'audits' && (
        <Flex flex="1" px={{ base: '4', md: '8' }} py={{ base: '5', md: '7' }}>
          <Card.Root
            variant="outline"
            className={css({
              width: '100%',
              borderRadius: '18px',
              borderColor: 'rgba(185, 185, 189, 0.14)',
              bg: 'rgba(24, 24, 29, 0.82)',
              boxShadow: '0 12px 28px rgba(0, 0, 0, 0.3)',
              minH: '320px',
            })}
          >
            <Card.Header>
              <Card.Title className={css({ color: 'rgba(231, 228, 239, 0.91)', fontSize: 'calc(1.25rem + 2px)', fontWeight: '700' })}>
                {activeSection === 'reports' ? 'Reports' : 'Activity'}
              </Card.Title>
              <Card.Description className={css({ color: 'rgba(204, 204, 212, 0.66)', lineHeight: '1.62' })}>
                {activeSection === 'reports'
                  ? 'This section can aggregate finalized audit reports and export options.'
                  : 'This section can display timeline events: opened audits, uploads, and status changes.'}
              </Card.Description>
            </Card.Header>
            <Card.Body>
              <Stack gap="3">
                <Box className={css({ color: 'rgba(223, 223, 231, 0.91)', fontSize: 'sm', lineHeight: '1.62' })}>
                  UI scaffold is ready. You can now wire this section to backend endpoints when available.
                </Box>
                <Box
                  className={css({
                    color: 'rgba(185, 185, 193, 0.65)',
                    fontSize: 'sm',
                    lineHeight: '1.62',
                    border: '1px dashed rgba(185, 185, 189, 0.24)',
                    borderRadius: '12px',
                    px: '4',
                    py: '3',
                  })}
                >
                  Search input in the top bar is already connected to local state and can be reused here.
                </Box>
              </Stack>
            </Card.Body>
          </Card.Root>
        </Flex>
      )}
    </Flex>
  )
}
