import { useEffect, useState } from 'react'
import { css } from 'styled-system/css'
import { Box, Flex, Grid } from 'styled-system/jsx'
import { NavBar } from '../components/NavBar'
import { getAudit } from '../audits/api'
import type { AuditRecord } from '../audits/types'

interface ScopeWorkspaceProps {
    auditId: string
    onNavigate: (path: string) => void
    onOpenProfile: () => void
}

const ui = {
    textPrimary: 'rgba(231, 228, 239, 0.91)',
    textSecondary: 'rgba(231, 228, 239, 0.67)',
    textMuted: 'rgba(231, 228, 239, 0.61)',
    borderFaint: 'rgba(185, 185, 189, 0.14)',
    borderSoft: 'rgba(185, 185, 189, 0.22)',
    surfaceContent: 'rgba(22, 22, 27, 0.88)',
    surfaceCard: 'rgba(28, 28, 33, 0.9)',
}

// Simple date formatter that doesn't need external libraries
function formatDate(dateStr: string | null | undefined): string {
    if (!dateStr) return 'Not set'
    try {
        const d = new Date(dateStr)
        return d.toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
        })
    } catch {
        return dateStr
    }
}

export default function ScopeWorkspace({ auditId, onNavigate, onOpenProfile }: ScopeWorkspaceProps) {
    const [audit, setAudit] = useState<AuditRecord | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        let active = true
        setIsLoading(true)
        setError(null)

        getAudit(auditId)
            .then((data) => {
                if (active) {
                    setAudit(data)
                    setIsLoading(false)
                }
            })
            .catch((err) => {
                if (active) {
                    setError(err instanceof Error ? err.message : 'Failed to load audit')
                    setIsLoading(false)
                }
            })

        return () => {
            active = false
        }
    }, [auditId])

    return (
        <Flex
            minH="100vh"
            direction="column"
            className={css({
                background: '#101014', // Matches the main app dark theme
            })}
        >
            <NavBar
                activeSection="audits"
                searchValue=""
                onSearchChange={() => { }}
                onNavigate={(section) => onNavigate(`/menu/${section}`)}
                onOpenProfile={onOpenProfile}
            />

            <Flex flex="1" px={{ base: '4', md: '8' }} py={{ base: '4', md: '6' }} direction="column" gap="6">
                {/* TOP SECTION: Module Header */}
                <Box
                    className={css({
                        bg: ui.surfaceContent,
                        border: `1px solid ${ui.borderSoft}`,
                        borderRadius: '20px',
                        px: { base: '5', md: '6' },
                        py: { base: '4', md: '5' },
                        boxShadow: '0 10px 24px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.03)',
                        background: 'linear-gradient(145deg, rgba(20, 20, 25, 0.95), rgba(14, 14, 18, 0.94))',
                    })}
                >
                    {isLoading && (
                        <Flex align="center" justify="center" minH="80px" className={css({ color: ui.textSecondary })}>
                            Loading audit details...
                        </Flex>
                    )}

                    {error && (
                        <Flex align="center" justify="center" minH="80px" className={css({ color: '#f87171' })}>
                            {error}
                        </Flex>
                    )}

                    {!isLoading && !error && audit && (
                        <Flex direction="column" gap="4">
                            <Box>
                                <Flex justify="flex-start" align="center" wrap="wrap" gap="3">
                                    <Box className={css({ fontSize: '1.1rem', fontWeight: '800', color: ui.textPrimary, letterSpacing: '-0.01em' })}>
                                        Module: Scope Definition
                                    </Box>
                                    <Box
                                        onClick={() => {
                                            window.history.pushState(null, '', '/menu/audits')
                                            window.dispatchEvent(new PopStateEvent('popstate'))
                                        }}
                                        className={css({
                                            fontSize: '1.1rem',
                                            fontWeight: '800',
                                            color: 'rgba(111, 224, 187, 0.98)',
                                            cursor: 'pointer',
                                            _hover: { textDecoration: 'underline' }
                                        })}
                                    >
                                        Audit: {audit.title}
                                    </Box>
                                </Flex>
                                <Box mt="1.5" className={css({ color: ui.textSecondary, fontSize: '0.8rem', lineHeight: '1.5', maxW: '800px' })}>
                                    Define the scope of the engagement here. Upload contracts, link Github repositories.
                                </Box>
                            </Box>

                            {/* Minimal Audit Info as requested by the user */}
                            <Grid columns={{ base: 1, sm: 2, md: 4 }} gap="4" mt="1" className={css({
                                pt: '3',
                                borderTop: `1px solid ${ui.borderFaint}`
                            })}>
                                <Box>
                                    <Box className={css({ color: ui.textMuted, fontSize: 'xs', textTransform: 'uppercase', letterSpacing: '0.05em' })}>Start Date</Box>
                                    <Box className={css({ color: ui.textPrimary, fontSize: 'sm', fontWeight: '500', mt: '1' })}>{formatDate(audit.start_date)}</Box>
                                </Box>
                                <Box>
                                    <Box className={css({ color: ui.textMuted, fontSize: 'xs', textTransform: 'uppercase', letterSpacing: '0.05em' })}>Chain</Box>
                                    <Box className={css({ color: ui.textPrimary, fontSize: 'sm', fontWeight: '500', mt: '1' })}>{audit.chain || 'Internal/No Chain'}</Box>
                                </Box>
                                <Box>
                                    <Box className={css({ color: ui.textMuted, fontSize: 'xs', textTransform: 'uppercase', letterSpacing: '0.05em' })}>Network</Box>
                                    <Box className={css({ color: ui.textPrimary, fontSize: 'sm', fontWeight: '500', mt: '1' })}>{audit.network || 'N/A'}</Box>
                                </Box>
                                <Box>
                                    <Box className={css({ color: ui.textMuted, fontSize: 'xs', textTransform: 'uppercase', letterSpacing: '0.05em' })}>Status</Box>
                                    <Box
                                        className={css({
                                            display: 'inline-flex',
                                            fontSize: 'xs',
                                            fontWeight: '600',
                                            mt: '1',
                                            px: '2',
                                            py: '0.5',
                                            borderRadius: 'full',
                                            bg: audit.status === 'in_progress' ? 'rgba(88, 214, 171, 0.15)' : 'rgba(255,255,255,0.05)',
                                            color: audit.status === 'in_progress' ? 'rgba(111, 224, 187, 0.98)' : ui.textPrimary
                                        })}
                                    >
                                        {audit.status.replace('_', ' ').toUpperCase()}
                                    </Box>
                                </Box>
                            </Grid>
                        </Flex>
                    )}
                </Box>

                {/* Placeholder for the rest of the page (Sources / Scope Preview / Confirmation) to be added next */}
                {!isLoading && !error && audit && (
                    <Flex direction="column" flex="1" align="center" justify="center" className={css({
                        border: `1px dashed ${ui.borderSoft}`,
                        borderRadius: '24px',
                        color: ui.textMuted,
                        minH: '300px',
                        bg: 'rgba(22, 22, 27, 0.4)'
                    })}>
                        Layout for Sources and Scope Preview goes here...
                    </Flex>
                )}
            </Flex>
        </Flex>
    )
}
