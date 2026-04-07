import { useEffect, useState } from 'react'
import { CheckCircle2, Clock, FileWarning, Presentation, ShieldAlert, Star, Activity } from 'lucide-react'
import { css } from 'styled-system/css'
import { Box, Flex, Grid, Stack } from 'styled-system/jsx'
import { type MenuSection } from '../components/NavBar'
import { Card, Badge, Spinner } from '../components/ui'
import { listAudits, type AuditListResponse } from '../audits/api'

interface DashboardWorkspaceProps {
    onNavigate: (section: MenuSection) => void
}

function StatCard({ title, value, icon, description, color }: { title: string, value: string | number, icon: React.ReactNode, description?: string, color: string }) {
    return (
        <Card.Root
            variant="outline"
            className={css({
                borderRadius: '16px',
                borderColor: 'rgba(185, 185, 189, 0.14)',
                bg: 'rgba(24, 24, 29, 0.82)',
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.2)',
                position: 'relative',
                overflow: 'hidden',
            })}
        >
            <Box
                className={css({
                    position: 'absolute',
                    top: 0,
                    right: 0,
                    w: '120px',
                    h: '120px',
                    background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
                    opacity: 0.1,
                    transform: 'translate(30%, -30%)',
                    borderRadius: 'full',
                    pointerEvents: 'none',
                })}
            />
            <Card.Body className={css({ p: '5' })}>
                <Flex justify="space-between" align="flex-start">
                    <Stack gap="1">
                        <Box className={css({ color: 'rgba(204, 204, 212, 0.7)', fontSize: 'sm', fontWeight: '500' })}>
                            {title}
                        </Box>
                        <Box className={css({ color: 'white', fontSize: '3xl', fontWeight: '700', mt: '1' })}>
                            {value}
                        </Box>
                    </Stack>
                    <Box
                        className={css({
                            p: '2.5',
                            borderRadius: '12px',
                            bg: 'rgba(18, 18, 23, 0.8)',
                            border: '1px solid rgba(185, 185, 189, 0.08)',
                            color: 'rgba(231, 228, 239, 0.9)',
                        })}
                    >
                        {icon}
                    </Box>
                </Flex>
                {description && (
                    <Box className={css({ color: 'rgba(185, 185, 193, 0.55)', fontSize: 'xs', mt: '3' })}>
                        {description}
                    </Box>
                )}
            </Card.Body>
        </Card.Root>
    )
}

function StatusBadge({ status }: { status: string }) {
    if (status === 'completed') {
        return <Badge colorPalette="green">Completed</Badge>
    }
    if (status === 'in_progress') {
        return <Badge colorPalette="orange">In Progress</Badge>
    }
    return <Badge colorPalette="purple">Draft</Badge>
}

// Custom CSS Donut Chart for Dark Theme Glassmorphism
function RiskSummaryChart() {
    const chartRadius = 40
    const circumference = 2 * Math.PI * chartRadius

    // Mock Data for Risk Severity
    const risks = [
        { label: 'Critical', value: 3, color: '#e5484d', dashoffset: 0 },
        { label: 'High', value: 8, color: '#f76b15', dashoffset: circumference * 0.15 },
        { label: 'Medium', value: 12, color: '#f5d90a', dashoffset: circumference * 0.45 },
        { label: 'Low', value: 20, color: '#30a46c', dashoffset: circumference * 0.70 },
    ]

    return (
        <Flex direction="column" align="center" justify="center" h="full" gap="6">
            <Box className={css({ position: 'relative', w: '160px', h: '160px' })}>
                <svg width="100%" height="100%" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r={chartRadius} fill="transparent" stroke="rgba(255,255,255,0.05)" strokeWidth="12" />
                    {risks.map((risk) => (
                        <circle
                            key={risk.label}
                            cx="50"
                            cy="50"
                            r={chartRadius}
                            fill="transparent"
                            stroke={risk.color}
                            strokeWidth="12"
                            strokeDasharray={circumference}
                            strokeDashoffset={risk.dashoffset}
                            strokeLinecap="round"
                            className={css({ transition: 'all 1s ease-out', transformOrigin: 'center', transform: 'rotate(-90deg)' })}
                        />
                    ))}
                </svg>
                <Flex
                    direction="column"
                    align="center"
                    justify="center"
                    className={css({ position: 'absolute', inset: 0 })}
                >
                    <Box className={css({ fontSize: '2xl', fontWeight: 'bold', color: 'white' })}>43</Box>
                    <Box className={css({ fontSize: 'xs', color: 'rgba(255,255,255,0.5)' })}>Total Findings</Box>
                </Flex>
            </Box>
            <Grid columns={2} gap="4" w="full" px="4">
                {risks.map(risk => (
                    <Flex key={risk.label} align="center" gap="2">
                        <Box className={css({ w: '3', h: '3', borderRadius: 'full' })} style={{ backgroundColor: risk.color }} />
                        <Box className={css({ fontSize: 'sm', color: 'rgba(255,255,255,0.8)' })}>{risk.label}</Box>
                        <Box className={css({ ml: 'auto', fontSize: 'sm', fontWeight: 'bold', color: 'white' })}>{risk.value}</Box>
                    </Flex>
                ))}
            </Grid>
        </Flex>
    )
}

export function DashboardWorkspace({ onNavigate }: DashboardWorkspaceProps) {
    const [data, setData] = useState<AuditListResponse | null>(null)
    const [pinned, setPinned] = useState<AuditListResponse | null>(null)
    const [isLoading, setIsLoading] = useState(true)

    useEffect(() => {
        async function loadData() {
            try {
                const [recentRes, pinnedRes] = await Promise.all([
                    listAudits({ limit: 5 }),
                    listAudits({ pinned: true, limit: 5 })
                ])
                setData(recentRes)
                setPinned(pinnedRes)
            } catch (err) {
                console.error(err)
            } finally {
                setIsLoading(false)
            }
        }
        void loadData()
    }, [])

    if (isLoading) {
        return (
            <Flex flex="1" align="center" justify="center">
                <Spinner size="lg" />
            </Flex>
        )
    }

    const { total = 0, counts = { draft: 0, in_progress: 0, completed: 0, archived: 0 } } = data || {}
    const recentItems = data?.items || []
    const pinnedItems = pinned?.items || []

    return (
        <Flex flex="1" px={{ base: '4', md: '8' }} py={{ base: '5', md: '7' }} direction="column" gap="6">

            {/* HEADER SECTION */}
            <Flex justify="space-between" align="flex-end">
                <Stack gap="1">
                    <h1 className={css({ color: 'white', fontSize: '2xl', fontWeight: 'bold' })}>
                        Command Center
                    </h1>
                    <p className={css({ color: 'rgba(204, 204, 212, 0.66)', fontSize: 'sm' })}>
                        Welcome to your SolAudity workspace overview.
                    </p>
                </Stack>
            </Flex>

            {/* STATS ROW */}
            <Grid columns={{ base: 1, sm: 2, lg: 4 }} gap="5">
                <StatCard
                    title="Total Audits"
                    value={total}
                    icon={<Presentation size={20} />}
                    color="#858489"
                    description="All active and draft audits."
                />
                <StatCard
                    title="In Progress"
                    value={counts.in_progress}
                    icon={<Clock size={20} />}
                    color="#f5d90a"
                    description="Audits currently being worked on."
                />
                <StatCard
                    title="Completed"
                    value={counts.completed}
                    icon={<CheckCircle2 size={20} />}
                    color="#30a46c"
                    description="Finalized audit reports."
                />
                <StatCard
                    title="Critical Findings"
                    value="3"
                    icon={<ShieldAlert size={20} />}
                    color="#e5484d"
                    description="High severity vulnerabilities found."
                />
            </Grid>

            {/* MIDDLE ROW (RECENT + CHART) */}
            <Grid columns={{ base: 1, lg: 3 }} gap="5" alignItems="stretch">

                {/* RECENT AUDITS */}
                <Card.Root
                    variant="outline"
                    className={css({
                        gridColumn: { lg: 'span 2' },
                        borderRadius: '18px',
                        borderColor: 'rgba(185, 185, 189, 0.14)',
                        bg: 'rgba(24, 24, 29, 0.82)',
                        boxShadow: '0 12px 28px rgba(0, 0, 0, 0.3)',
                    })}
                >
                    <Card.Header className={css({ borderBottom: '1px solid rgba(255,255,255,0.05)', pb: '4' })}>
                        <Flex justify="space-between" align="center">
                            <Card.Title className={css({ color: 'rgba(231, 228, 239, 0.91)', fontSize: 'lg', fontWeight: '700' })}>
                                Recent Audits
                            </Card.Title>
                            <button
                                onClick={() => onNavigate('audits')}
                                className={css({ color: 'rgba(185, 185, 193, 0.8)', fontSize: 'sm', cursor: 'pointer', _hover: { color: 'white' } })}
                            >
                                View All
                            </button>
                        </Flex>
                    </Card.Header>
                    <Card.Body className={css({ p: 0 })}>
                        {recentItems.length === 0 ? (
                            <Box className={css({ p: '6', textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 'sm' })}>
                                No recent audits found.
                            </Box>
                        ) : (
                            <Stack gap="0">
                                {recentItems.map((audit, idx) => (
                                    <Flex
                                        key={audit.id}
                                        justify="space-between"
                                        align="center"
                                        onClick={(e) => {
                                            e.preventDefault()
                                            window.history.pushState(null, '', `/scope/${audit.id}`)
                                            window.dispatchEvent(new PopStateEvent('popstate'))
                                        }}
                                        className={css({
                                            p: '4',
                                            borderBottom: idx !== recentItems.length - 1 ? '1px solid rgba(255,255,255,0.03)' : 'none',
                                            cursor: 'pointer',
                                            _hover: { bg: 'rgba(255,255,255,0.02)' }
                                        })}
                                    >
                                        <Stack gap="1">
                                            <Box className={css({ color: 'white', fontWeight: '500' })}>{audit.title}</Box>
                                            <Box className={css({ color: 'rgba(255,255,255,0.5)', fontSize: 'xs' })}>
                                                {audit.chain || 'No chain'} • {audit.network || 'No network'}
                                            </Box>
                                        </Stack>
                                        <StatusBadge status={audit.status} />
                                    </Flex>
                                ))}
                            </Stack>
                        )}
                    </Card.Body>
                </Card.Root>

                {/* RISK CHART */}
                <Card.Root
                    variant="outline"
                    className={css({
                        borderRadius: '18px',
                        borderColor: 'rgba(185, 185, 189, 0.14)',
                        bg: 'rgba(24, 24, 29, 0.82)',
                        boxShadow: '0 12px 28px rgba(0, 0, 0, 0.3)',
                    })}
                >
                    <Card.Header className={css({ borderBottom: '1px solid rgba(255,255,255,0.05)', pb: '4' })}>
                        <Card.Title className={css({ color: 'rgba(231, 228, 239, 0.91)', fontSize: 'lg', fontWeight: '700' })}>
                            Risk Summary
                        </Card.Title>
                    </Card.Header>
                    <Card.Body className={css({ p: '6' })}>
                        <RiskSummaryChart />
                    </Card.Body>
                </Card.Root>

            </Grid>


            {/* BOTTOM ROW (PINNED + ACTIVITY) */}
            <Grid columns={{ base: 1, lg: 2 }} gap="5" alignItems="stretch">

                {/* PINNED AUDITS */}
                <Card.Root
                    variant="outline"
                    className={css({
                        borderRadius: '18px',
                        borderColor: 'rgba(185, 185, 189, 0.14)',
                        bg: 'rgba(24, 24, 29, 0.82)',
                        boxShadow: '0 12px 28px rgba(0, 0, 0, 0.3)',
                    })}
                >
                    <Card.Header className={css({ borderBottom: '1px solid rgba(255,255,255,0.05)', pb: '4' })}>
                        <Flex align="center" gap="2">
                            <Star size={16} className={css({ color: '#f5d90a' })} fill="#f5d90a" />
                            <Card.Title className={css({ color: 'rgba(231, 228, 239, 0.91)', fontSize: 'lg', fontWeight: '700' })}>
                                Pinned Audits
                            </Card.Title>
                        </Flex>
                    </Card.Header>
                    <Card.Body className={css({ p: 0 })}>
                        {pinnedItems.length === 0 ? (
                            <Box className={css({ p: '6', textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 'sm' })}>
                                No pinned audits. Click the star on an audit to pin it here.
                            </Box>
                        ) : (
                            <Stack gap="0">
                                {pinnedItems.map((audit, idx) => (
                                    <Flex
                                        key={audit.id}
                                        justify="space-between"
                                        align="center"
                                        onClick={(e) => {
                                            e.preventDefault()
                                            window.history.pushState(null, '', `/scope/${audit.id}`)
                                            window.dispatchEvent(new PopStateEvent('popstate'))
                                        }}
                                        className={css({
                                            p: '4',
                                            borderBottom: idx !== pinnedItems.length - 1 ? '1px solid rgba(255,255,255,0.03)' : 'none',
                                            cursor: 'pointer',
                                            _hover: { bg: 'rgba(255,255,255,0.02)' }
                                        })}
                                    >
                                        <Box className={css({ color: 'white', fontWeight: '500' })}>{audit.title}</Box>
                                        <StatusBadge status={audit.status} />
                                    </Flex>
                                ))}
                            </Stack>
                        )}
                    </Card.Body>
                </Card.Root>

                {/* RECENT ACTIVITY */}
                <Card.Root
                    variant="outline"
                    className={css({
                        borderRadius: '18px',
                        borderColor: 'rgba(185, 185, 189, 0.14)',
                        bg: 'rgba(24, 24, 29, 0.82)',
                        boxShadow: '0 12px 28px rgba(0, 0, 0, 0.3)',
                    })}
                >
                    <Card.Header className={css({ borderBottom: '1px solid rgba(255,255,255,0.05)', pb: '4' })}>
                        <Flex align="center" gap="2">
                            <Activity size={16} className={css({ color: 'rgba(255,255,255,0.7)' })} />
                            <Card.Title className={css({ color: 'rgba(231, 228, 239, 0.91)', fontSize: 'lg', fontWeight: '700' })}>
                                Recent Activity
                            </Card.Title>
                        </Flex>
                    </Card.Header>
                    <Card.Body className={css({ p: '5' })}>
                        <Stack gap="4">
                            <Flex gap="3">
                                <Box className={css({ mt: '1', color: '#30a46c' })}><CheckCircle2 size={16} /></Box>
                                <Box>
                                    <Box className={css({ color: 'white', fontSize: 'sm' })}>Uniswap V4 Audit completed.</Box>
                                    <Box className={css({ color: 'rgba(255,255,255,0.4)', fontSize: 'xs' })}>2 hours ago</Box>
                                </Box>
                            </Flex>
                            <Flex gap="3">
                                <Box className={css({ mt: '1', color: '#e5484d' })}><FileWarning size={16} /></Box>
                                <Box>
                                    <Box className={css({ color: 'white', fontSize: 'sm' })}>Found 2 Critical vulnerabilities in Aave Staking.</Box>
                                    <Box className={css({ color: 'rgba(255,255,255,0.4)', fontSize: 'xs' })}>5 hours ago</Box>
                                </Box>
                            </Flex>
                            <Flex gap="3">
                                <Box className={css({ mt: '1', color: 'rgba(255,255,255,0.6)' })}><Presentation size={16} /></Box>
                                <Box>
                                    <Box className={css({ color: 'white', fontSize: 'sm' })}>Created new draft: Curve Finance Router</Box>
                                    <Box className={css({ color: 'rgba(255,255,255,0.4)', fontSize: 'xs' })}>Yesterday</Box>
                                </Box>
                            </Flex>
                        </Stack>
                    </Card.Body>
                </Card.Root>

            </Grid>
        </Flex>
    )
}
