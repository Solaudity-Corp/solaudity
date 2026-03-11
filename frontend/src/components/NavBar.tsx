import { css } from 'styled-system/css'
import { Box, Flex, Stack } from 'styled-system/jsx'
import { Settings2 } from 'lucide-react'
import { Menu, NavLink } from '@/components/ui'
import { darkMenuContentClass, darkMenuItemClass, disconnectMenuItemClass } from '@/components/ui/menu.styles'
import { logoutUser } from '../auth'
import { SvgLogo } from './SvgLogo'

export type MenuSection = 'audits' | 'reports' | 'activity'

interface NavBarProps {
  activeSection: MenuSection
  searchValue: string
  onSearchChange: (value: string) => void
  onNavigate: (section: MenuSection) => void
  onOpenProfile?: () => void
  showSearch?: boolean
}

const links: Array<{ label: string; section: MenuSection }> = [
  { label: 'Audits', section: 'audits' },
  { label: 'Reports', section: 'reports' },
  { label: 'Activity', section: 'activity' },
]

export function NavBar({
  activeSection,
  searchValue,
  onSearchChange,
  onNavigate,
  onOpenProfile,
  showSearch = true,
}: NavBarProps) {
  const controlRadius = '8px'

  return (
    <Box
      as="header"
      className={css({
        borderBottom: '1px solid rgba(185, 185, 189, 0.14)',
        bg: 'rgba(20, 20, 24, 0.95)',
        backdropFilter: 'blur(8px)',
        boxShadow: '0 8px 18px rgba(0, 0, 0, 0.22)',
      })}
    >
      <Flex
        w="100%"
        px={{ base: '4', md: '8' }}
        h="72px"
        align="center"
        justify="space-between"
        gap="4"
      >
        <Flex align="center" gap="3">
          <button
            type="button"
            aria-label="Open menu"
            className={css({
              width: '2.5rem',
              height: '2.5rem',
              borderRadius: controlRadius,
              border: '1px solid rgba(185, 185, 189, 0.24)',
              background: 'rgba(16, 16, 20, 0.92)',
              display: 'grid',
              placeItems: 'center',
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)',
              _hover: { background: 'rgba(30, 30, 36, 0.95)' },
            })}
          >
            <Stack gap="1" align="center">
              <Box className={css({ w: '4', h: '0.5', bg: 'rgba(231, 228, 239, 0.9)', borderRadius: 'full' })} />
              <Box className={css({ w: '4', h: '0.5', bg: 'rgba(231, 228, 239, 0.9)', borderRadius: 'full' })} />
              <Box className={css({ w: '4', h: '0.5', bg: 'rgba(231, 228, 239, 0.9)', borderRadius: 'full' })} />
            </Stack>
          </button>

          <Box>
            <SvgLogo
              width={120}
              height={34}
              backgroundColor="#1d1e24"
              gradientStops={['#858489', '#e7e4ef', '#858489', '#b9b9b9', '#858489']}
              underlineColor="#b9b9b9"
              cornerRadius={3}
            />
          </Box>

          <Flex align="center" gap={{ base: '2', md: '5' }} ml={{ base: '1', md: '3' }}>
            {links.map((item) => (
              <NavLink
                key={item.section}
                active={activeSection === item.section}
                onClick={() => onNavigate(item.section)}
              >
                {item.label}
              </NavLink>
            ))}
          </Flex>
        </Flex>

        <Flex align="center" gap="3" ml="auto">
          {showSearch && (
            <input
              type="text"
              placeholder="Search audits, chain, repo..."
              aria-label="Search audits"
              value={searchValue}
              onChange={(event) => onSearchChange(event.target.value)}
              className={css({
                w: { base: '44', md: '56' },
                h: '10',
                px: '4',
                borderRadius: controlRadius,
                border: '1px solid rgba(176, 176, 184, 0.28)',
                background: 'rgba(16, 16, 20, 0.92)',
                color: 'rgba(231, 228, 239, 0.91)',
                outline: 'none',
                lineHeight: '1.5',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.18)',
                _placeholder: { color: 'rgba(167, 167, 174, 0.64)' },
                _focusVisible: {
                  borderColor: 'rgba(231, 228, 239, 0.42)',
                  boxShadow: '0 0 0 1px rgba(231, 228, 239, 0.22)',
                },
              })}
            />
          )}

          <Menu.Root positioning={{ placement: 'bottom-end', gutter: 8 }}>
            <Menu.Trigger asChild>
              <button
                type="button"
                aria-label="Settings"
                className={css({
                  width: '2.5rem',
                  height: '2.5rem',
                  borderRadius: controlRadius,
                  border: '1px solid rgba(176, 176, 184, 0.28)',
                  background: 'rgba(16, 16, 20, 0.92)',
                  color: 'rgba(217, 215, 226, 0.9)',
                  display: 'grid',
                  placeItems: 'center',
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)',
                  _hover: { background: 'rgba(30, 30, 36, 0.95)' },
                })}
              >
                <Settings2 size={16} strokeWidth={2} />
              </button>
            </Menu.Trigger>
            <Menu.Positioner>
              <Menu.Content className={darkMenuContentClass}>
                <Menu.Item value="profile" className={darkMenuItemClass} onClick={() => onOpenProfile?.()}>
                  Profile
                </Menu.Item>
                <Menu.Item value="logout" className={disconnectMenuItemClass} onClick={() => logoutUser()}>
                  Disconnect
                </Menu.Item>
              </Menu.Content>
            </Menu.Positioner>
          </Menu.Root>
        </Flex>
      </Flex>
    </Box>
  )
}
