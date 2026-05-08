import { useCallback, useEffect, useRef, useState } from 'react'
import { css } from 'styled-system/css'
import { Box, Flex, Stack } from 'styled-system/jsx'
import { ChevronRight, Settings2 } from 'lucide-react'
import { Menu, NavLink } from '@/components/ui'
import { darkMenuContentClass, darkMenuItemClass, disconnectMenuItemClass } from '@/components/ui/menu.styles'
import { logoutUser } from '../auth'
import { SvgLogo } from './SvgLogo'
import { SideNav } from './SideNav'
import type { SubPanel } from './SideNav'

export type MenuSection = 'dashboard' | 'audits' | 'reports' | 'activity'

export interface JourneyItem {
  label: string
  onClick?: () => void
  isCurrent?: boolean
  disabled?: boolean
  accentColor?: string
}

interface NavBarProps {
  activeSection: MenuSection
  searchValue: string
  onSearchChange: (value: string) => void
  onNavigate: (section: MenuSection) => void
  onOpenProfile?: () => void
  showSearch?: boolean
  journeyItems?: JourneyItem[]
  openSideNavPanel?: SubPanel | null
  onSideNavPanelConsumed?: () => void
}

const links: Array<{ label: string; section: MenuSection }> = [
  { label: 'Audits', section: 'audits' },
  { label: 'Reports', section: 'reports' },
  { label: 'Activity', section: 'activity' },
]

// ── Color helpers ──────────────────────────────────────────────────────────────

function lerpColor(from: string, to: string, t: number): string {
  const parse = (c: string): [number, number, number, number] => {
    const m = c.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/)
    if (!m) return [185, 185, 189, 0.18]
    return [+m[1], +m[2], +m[3], m[4] !== undefined ? +m[4] : 1]
  }
  const [r1, g1, b1, a1] = parse(from)
  const [r2, g2, b2, a2] = parse(to)
  return `rgba(${Math.round(r1 + (r2 - r1) * t)}, ${Math.round(g1 + (g2 - g1) * t)}, ${Math.round(b1 + (b2 - b1) * t)}, ${+(a1 + (a2 - a1) * t).toFixed(3)})`
}

function withAlpha(color: string, alpha: number): string {
  const m = color.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/)
  if (!m) return color
  return `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${alpha.toFixed(3)})`
}

const FALLBACK_ACCENT = 'rgba(185, 185, 189, 0.20)'

// ── Component ─────────────────────────────────────────────────────────────────

export function NavBar({
  activeSection,
  searchValue,
  onSearchChange,
  onNavigate,
  onOpenProfile,
  showSearch = true,
  journeyItems = [],
  openSideNavPanel,
  onSideNavPanelConsumed,
}: NavBarProps) {
  const controlRadius = '8px'
  const JOURNEY_ANIM_DURATION_MS = 560
  const [sideNavOpen, setSideNavOpen] = useState(false)
  const isNavOpen = sideNavOpen || !!openSideNavPanel

  const handleNavClose = useCallback(() => {
    setSideNavOpen(false)
    onSideNavPanelConsumed?.()
  }, [onSideNavPanelConsumed])
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
      // easeOutQuart: fast initial sweep, silky landing
      const eased = 1 - Math.pow(1 - t, 4)
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

  // Pre-compute source and target colors for the whole animation pass
  const fromItemColor = journeyAnimatingFromIndex !== null
    ? (journeyItems[journeyAnimatingFromIndex]?.accentColor ?? FALLBACK_ACCENT)
    : FALLBACK_ACCENT
  const toItemColor = journeyAnimatingToIndex !== null
    ? (journeyItems[journeyAnimatingToIndex]?.accentColor ?? FALLBACK_ACCENT)
    : FALLBACK_ACCENT

  return (
    <>
      <Box
        as="header"
        className={css({
          position: 'relative',
          zIndex: 50,
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
                  border: '1px solid rgba(176, 176, 184, 0.28)',
                  background: 'rgba(16, 16, 20, 0.92)',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.18)',
                  overflow: 'hidden',
                })}
              >
                {journeyItems.map((item, idx) => {
                  const isAnimatingCurrent = journeyAnimatingFromIndex === idx
                  const isAnimatingTarget = journeyAnimatingToIndex === idx
                  const isParticipating = isAnimatingCurrent || isAnimatingTarget
                  const isClickable = !!item.onClick && !item.disabled && !isJourneyAnimating
                  const isForward = journeyAnimatingFromIndex !== null && journeyAnimatingToIndex !== null
                    ? journeyAnimatingToIndex > journeyAnimatingFromIndex
                    : true

                  // Transform origin: source shrinks from its far edge, target grows from its near edge
                  const sourceTransformOrigin = isForward ? 'right center' : 'left center'
                  const targetTransformOrigin = isForward ? 'left center' : 'right center'
                  const currentBadgeFill = isAnimatingCurrent ? 1 - journeyAnimatingProgress : 1
                  const targetBadgeFill = isAnimatingTarget ? journeyAnimatingProgress : 0
                  const badgeFill = item.isCurrent ? currentBadgeFill : targetBadgeFill
                  const badgeTransformOrigin = item.isCurrent ? sourceTransformOrigin : targetTransformOrigin

                  // ── Animated color: both fills morph together from source → target color ──
                  const itemAccent = item.accentColor ?? FALLBACK_ACCENT
                  const fillColor = isParticipating
                    ? lerpColor(fromItemColor, toItemColor, journeyAnimatingProgress)
                    : itemAccent

                  // ── Glow: pulses at the midpoint of the transition ──
                  const glowPulse = isParticipating
                    ? Math.sin(journeyAnimatingProgress * Math.PI)
                    : (item.isCurrent ? 0.4 : 0)
                  const glowAlpha = 0.18 + 0.28 * glowPulse
                  const glowShadow = badgeFill > 0.02
                    ? `0 0 ${Math.round(8 + 12 * glowPulse)}px ${Math.round(1 + 3 * glowPulse)}px ${withAlpha(fillColor, glowAlpha)}`
                    : 'none'

                  // ── Leading-edge shimmer: bright streak at the growing edge ──
                  const shimmerAlpha = Math.min(glowAlpha * 3.5, 0.72)
                  const shimmerDir = isParticipating
                    ? (isAnimatingTarget ? (isForward ? '90deg' : '270deg') : (isForward ? '270deg' : '90deg'))
                    : '90deg'
                  const fillBackground = isParticipating && badgeFill > 0.02
                    ? `linear-gradient(${shimmerDir}, ${fillColor} 30%, ${withAlpha(fillColor, shimmerAlpha)} 100%)`
                    : fillColor

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
                          {/* Animated fill */}
                          <Box
                            aria-hidden
                            className={css({
                              position: 'absolute',
                              inset: 0,
                              zIndex: 0,
                              borderRadius: 'md',
                              pointerEvents: 'none',
                            })}
                            style={{
                              transformOrigin: badgeTransformOrigin,
                              transform: `scaleX(${badgeFill})`,
                              opacity: badgeFill > 0.01 ? 1 : 0,
                              background: fillBackground,
                              boxShadow: glowShadow,
                              transition: isParticipating
                                ? 'none'
                                : 'opacity 0.3s ease, background 0.5s ease, box-shadow 0.5s ease',
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
                                px: '2',
                                py: '1',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              })}
                              style={{
                                color: isAnimatingCurrent
                                  ? lerpColor('rgba(231, 228, 239, 0.92)', 'rgba(185, 185, 193, 0.6)', journeyAnimatingProgress)
                                  : 'rgba(231, 228, 239, 0.92)',
                                transition: isAnimatingCurrent ? 'none' : 'color 0.3s ease',
                              }}
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
                                bg: 'transparent',
                                border: 'none',
                                cursor: isClickable ? 'pointer' : 'not-allowed',
                                px: '2',
                                py: '1',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                transition: 'color 0.25s ease, transform 0.18s ease',
                                _active: isClickable ? { transform: 'scale(0.985)' } : undefined,
                              })}
                              style={{
                                color: isAnimatingTarget
                                  ? lerpColor('rgba(185, 185, 193, 0.6)', 'rgba(231, 228, 239, 0.92)', journeyAnimatingProgress)
                                  : isClickable ? 'rgba(185, 185, 193, 0.78)' : 'rgba(185, 185, 193, 0.45)',
                              }}
                            >
                              {item.label}
                            </button>
                          )}
                        </Box>
                      </Box>

                      {idx < journeyItems.length - 1 && (
                        <ChevronRight
                          size={12}
                          style={{
                            flexShrink: 0,
                            color: isParticipating
                              ? withAlpha(fillColor, 0.55)
                              : 'rgba(167, 167, 174, 0.7)',
                            transition: isParticipating ? 'none' : 'color 0.4s ease',
                          }}
                        />
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

      <SideNav open={isNavOpen} onClose={handleNavClose} openToPanel={openSideNavPanel} />
    </>
  )
}
