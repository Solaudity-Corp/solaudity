import { useCallback, useEffect, useRef, useState } from 'react'
import { css } from 'styled-system/css'
import { Box, Flex, Stack } from 'styled-system/jsx'
import { ChevronRight, Settings2 } from 'lucide-react'
import { Menu, NavLink } from '@/components/ui'
import { darkMenuContentClass, disconnectMenuItemClass } from '@/components/ui/menu.styles'
import { logoutUser } from '../auth'
import { SvgLogo } from './SvgLogo'
import { SideNav } from './SideNav'

export type MenuSection = 'dashboard' | 'audits' | 'reports' | 'activity'

export interface JourneyItem {
  label: string
  onClick?: () => void
  isCurrent?: boolean
  disabled?: boolean
}

interface NavBarProps {
  activeSection: MenuSection
  searchValue: string
  onSearchChange: (value: string) => void
  onNavigate: (section: MenuSection) => void
  onOpenProfile?: () => void
  showSearch?: boolean
  journeyItems?: JourneyItem[]
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
  journeyItems = [],
}: NavBarProps) {
  const controlRadius = '8px'
  const JOURNEY_ANIM_DURATION_MS = 520
  const [sideNavOpen, setSideNavOpen] = useState(false)
  const [journeyAnimatingFromIndex, setJourneyAnimatingFromIndex] = useState<number | null>(null)
  const [journeyAnimatingToIndex, setJourneyAnimatingToIndex] = useState<number | null>(null)
  const [journeyAnimatingProgress, setJourneyAnimatingProgress] = useState(0)
  const journeyAnimFrameRef = useRef<number | null>(null)
  const journeyIsAnimatingRef = useRef(false)
  const isJourneyAnimating = journeyAnimatingToIndex !== null

  const triggerJourneyJump = useCallback((item: JourneyItem, targetIndex: number, currentIndex: number) => {
    const onJump = item.onClick
    if (!onJump || item.disabled || journeyIsAnimatingRef.current) {
      return
    }

    journeyIsAnimatingRef.current = true
    setJourneyAnimatingFromIndex(currentIndex >= 0 ? currentIndex : null)
    setJourneyAnimatingToIndex(targetIndex)
    setJourneyAnimatingProgress(0)

    const startTime = performance.now()
    const duration = JOURNEY_ANIM_DURATION_MS

    const animate = (now: number) => {
      const t = Math.min((now - startTime) / duration, 1)
      const eased = t < 0.5
        ? 4 * t * t * t
        : 1 - Math.pow(-2 * t + 2, 3) / 2
      setJourneyAnimatingProgress(eased)

      if (t < 1) {
        journeyAnimFrameRef.current = requestAnimationFrame(animate)
        return
      }

      journeyAnimFrameRef.current = null
      journeyIsAnimatingRef.current = false
      setJourneyAnimatingFromIndex(null)
      setJourneyAnimatingToIndex(null)
      setJourneyAnimatingProgress(0)
      onJump()
    }

    journeyAnimFrameRef.current = requestAnimationFrame(animate)
  }, [JOURNEY_ANIM_DURATION_MS])

  useEffect(() => {
    return () => {
      if (journeyAnimFrameRef.current !== null) {
        cancelAnimationFrame(journeyAnimFrameRef.current)
        journeyAnimFrameRef.current = null
      }
      journeyIsAnimatingRef.current = false
    }
  }, [])

  const currentJourneyIndex = journeyItems.findIndex((step) => !!step.isCurrent)

  return (
    <>
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
            {/* Hamburger — opens SideNav */}
            <button
              type="button"
              aria-label="Open menu"
              onClick={() => setSideNavOpen(true)}
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

            <Box
              onClick={() => onNavigate('dashboard')}
              className={css({ cursor: 'pointer' })}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onNavigate('dashboard')
                }
              }}
              aria-label="Go to main page"
            >
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

          {journeyItems.length > 0 && (
            <Flex
              flex="1"
              justify="center"
              px={{ base: '2', md: '4' }}
              ml={{ base: '2', md: '6' }}
              mr={{ base: '2', md: '4' }}
              minW="0"
            >
              <Flex
                align="center"
                gap="1.5"
                className={css({
                  w: 'full',
                  h: '10',
                  px: '3',
                  borderRadius: '10px',
                  borderLeft: '1px solid rgba(185, 185, 193, 0.22)',
                  border: '1px solid rgba(176, 176, 184, 0.28)',
                  background: 'rgba(16, 16, 20, 0.92)',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.18)',
                  overflow: 'hidden',
                })}
              >
                {journeyItems.map((item, idx) => {
                  const isAnimatingCurrent = journeyAnimatingFromIndex === idx
                  const isAnimatingTarget = journeyAnimatingToIndex === idx
                  const isClickable = !!item.onClick && !item.disabled && !isJourneyAnimating
                  const isForward = journeyAnimatingFromIndex !== null && journeyAnimatingToIndex !== null
                    ? journeyAnimatingToIndex > journeyAnimatingFromIndex
                    : true
                  const sourceTransformOrigin = isForward ? 'right center' : 'left center'
                  const targetTransformOrigin = isForward ? 'left center' : 'right center'
                  const currentBadgeFill = isAnimatingCurrent ? 1 - journeyAnimatingProgress : 1
                  const targetBadgeFill = isAnimatingTarget ? journeyAnimatingProgress : 0
                  const badgeFill = item.isCurrent ? currentBadgeFill : targetBadgeFill
                  const badgeTransformOrigin = item.isCurrent ? sourceTransformOrigin : targetTransformOrigin
                  return (
                    <Flex key={`${item.label}-${idx}`} align="center" gap="1" minW="0" flex="1">
                      <Box minW="0" flex="1">
                        <Box
                          className={css({
                            position: 'relative',
                            w: 'full',
                            borderRadius: 'md',
                            overflow: 'hidden',
                          })}
                        >
                          <Box
                            aria-hidden
                            className={css({
                              position: 'absolute',
                              inset: 0,
                              zIndex: 0,
                              borderRadius: 'md',
                              bg: 'rgba(88, 214, 171, 0.22)',
                              transformOrigin: badgeTransformOrigin,
                              pointerEvents: 'none',
                              transition: isAnimatingCurrent || isAnimatingTarget ? undefined : 'opacity 0.2s ease',
                            })}
                            style={{
                              transform: `scaleX(${badgeFill})`,
                              opacity: badgeFill,
                            }}
                          />

                          {item.isCurrent ? (
                            <Box
                              className={css({
                                position: 'relative',
                                zIndex: 1,
                                display: 'block',
                                w: 'full',
                                fontSize: 'sm',
                                lineHeight: '1',
                                textAlign: 'center',
                                fontWeight: '600',
                                color: 'rgba(185, 185, 193, 0.78)',
                                px: '2',
                                py: '1',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              })}
                            >
                              {item.label}
                            </Box>
                          ) : (
                            <button
                              type="button"
                              onClick={() => triggerJourneyJump(item, idx, currentJourneyIndex)}
                              disabled={!isClickable}
                              className={css({
                                position: 'relative',
                                zIndex: 1,
                                w: 'full',
                                fontSize: 'sm',
                                lineHeight: '1',
                                textAlign: 'center',
                                fontWeight: '400',
                                color: isClickable
                                  ? 'rgba(185, 185, 193, 0.78)'
                                  : 'rgba(185, 185, 193, 0.45)',
                                bg: 'transparent',
                                border: 'none',
                                cursor: isClickable ? 'pointer' : 'not-allowed',
                                px: '2',
                                py: '1',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                transition: 'color 0.18s ease, transform 0.18s ease',
                                _hover: isClickable
                                  ? { color: 'rgba(231, 228, 239, 0.92)' }
                                  : undefined,
                                _active: isClickable ? { transform: 'scale(0.985)' } : undefined,
                              })}
                            >
                              {item.label}
                            </button>
                          )}
                        </Box>
                      </Box>

                      {idx < journeyItems.length - 1 && (
                        <ChevronRight size={12} className={css({ color: 'rgba(167, 167, 174, 0.7)', flexShrink: 0 })} />
                      )}
                    </Flex>
                  )
                })}
              </Flex>
            </Flex>
          )}

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
                  <Menu.Item value="logout" className={disconnectMenuItemClass} onClick={() => logoutUser()}>
                    Disconnect
                  </Menu.Item>
                </Menu.Content>
              </Menu.Positioner>
            </Menu.Root>
          </Flex>
        </Flex>
      </Box>

      <SideNav open={sideNavOpen} onClose={() => setSideNavOpen(false)} onOpenProfile={onOpenProfile} />
    </>
  )
}
