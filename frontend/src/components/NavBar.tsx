import { css } from 'styled-system/css'
import { Box, Flex, Stack } from 'styled-system/jsx'
import { Settings2 } from 'lucide-react'
import { NavLink } from './ui'
import { SvgLogo } from './SvgLogo'

export type MenuSection = 'audits' | 'reports' | 'activity'

interface NavBarProps {
  activeSection: MenuSection
  searchValue: string
  onSearchChange: (value: string) => void
  onNavigate: (section: MenuSection) => void
}

const links: Array<{ label: string; section: MenuSection }> = [
  { label: 'Audits', section: 'audits' },
  { label: 'Reports', section: 'reports' },
  { label: 'Activity', section: 'activity' },
]

export function NavBar({ activeSection, searchValue, onSearchChange, onNavigate }: NavBarProps) {
  const controlRadius = '8px'

  return (
    <Box
      as="header"
      className={css({
        borderBottom: '1px solid rgba(185, 185, 189, 0.18)',
        bg: 'rgba(27, 27, 31, 0.9)',
        backdropFilter: 'blur(8px)',
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
              border: '1px solid rgba(185, 185, 189, 0.35)',
              background: 'rgba(36, 36, 40, 0.95)',
              display: 'grid',
              placeItems: 'center',
              cursor: 'pointer',
              _hover: { background: 'rgba(52, 52, 58, 0.95)' },
            })}
          >
            <Stack gap="1" align="center">
              <Box className={css({ w: '4', h: '0.5', bg: '#e7e4ef', borderRadius: 'full' })} />
              <Box className={css({ w: '4', h: '0.5', bg: '#e7e4ef', borderRadius: 'full' })} />
              <Box className={css({ w: '4', h: '0.5', bg: '#e7e4ef', borderRadius: 'full' })} />
            </Stack>
          </button>

          <Box>
            <SvgLogo
              width={120}
              height={34}
              backgroundColor="#24252a"
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
              border: '1px solid rgba(176, 176, 184, 0.45)',
              background: 'rgba(20, 20, 24, 0.94)',
              color: '#e7e4ef',
              outline: 'none',
              _placeholder: { color: 'rgba(167, 167, 174, 0.55)' },
              _focusVisible: {
                borderColor: '#e7e4ef',
                boxShadow: '0 0 0 1px rgba(231, 228, 239, 0.42)',
              },
            })}
          />

          <button
            type="button"
            aria-label="Settings"
            className={css({
              width: '2.5rem',
              height: '2.5rem',
              borderRadius: controlRadius,
              border: '1px solid rgba(176, 176, 184, 0.45)',
              background: 'rgba(36, 36, 40, 0.92)',
              color: '#d9d7e2',
              display: 'grid',
              placeItems: 'center',
              cursor: 'pointer',
              _hover: { background: 'rgba(52, 52, 58, 0.95)' },
            })}
          >
            <Settings2 size={16} strokeWidth={2} />
          </button>
        </Flex>
      </Flex>
    </Box>
  )
}
