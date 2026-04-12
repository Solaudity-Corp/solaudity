import { css } from 'styled-system/css'
import { Box, Flex } from 'styled-system/jsx'

interface OrchestrationViewProps {
  auditId: string
}

const tools = [
  { name: 'Slither', color: 'rgba(255, 150, 80, 0.85)', bg: 'rgba(255, 150, 80, 0.08)', border: 'rgba(255, 150, 80, 0.20)' },
  { name: 'Mythril', color: 'rgba(180, 140, 255, 0.85)', bg: 'rgba(180, 140, 255, 0.08)', border: 'rgba(180, 140, 255, 0.20)' },
  { name: 'Securify', color: 'rgba(100, 160, 255, 0.85)', bg: 'rgba(100, 160, 255, 0.08)', border: 'rgba(100, 160, 255, 0.20)' },
  { name: 'Aderyn', color: 'rgba(88, 214, 171, 0.85)', bg: 'rgba(88, 214, 171, 0.08)', border: 'rgba(88, 214, 171, 0.20)' },
  { name: 'Certora', color: 'rgba(255, 200, 60, 0.85)', bg: 'rgba(255, 200, 60, 0.08)', border: 'rgba(255, 200, 60, 0.20)' },
  { name: 'SMTChecker', color: 'rgba(100, 200, 255, 0.85)', bg: 'rgba(100, 200, 255, 0.08)', border: 'rgba(100, 200, 255, 0.20)' },
  { name: 'KEVM', color: 'rgba(255, 90, 90, 0.85)', bg: 'rgba(255, 90, 90, 0.08)', border: 'rgba(255, 90, 90, 0.20)' },
  { name: 'Solhint', color: 'rgba(88, 214, 171, 0.85)', bg: 'rgba(88, 214, 171, 0.06)', border: 'rgba(88, 214, 171, 0.16)' },
  { name: 'Ethlint', color: 'rgba(180, 140, 255, 0.85)', bg: 'rgba(180, 140, 255, 0.06)', border: 'rgba(180, 140, 255, 0.16)' },
]

export function OrchestrationView(_props: OrchestrationViewProps) {
  return (
    <Box
      className={css({
        width: '100%', borderRadius: '18px',
        border: '1px solid rgba(185, 185, 189, 0.14)',
        bg: 'rgba(24, 24, 29, 0.82)',
        boxShadow: '0 12px 28px rgba(0, 0, 0, 0.3)',
        minH: '320px', p: '6',
      })}
    >
      <Flex align="center" gap="3" mb="5">
        <Box
          className={css({
            w: '10', h: '10', borderRadius: '10px',
            bg: 'rgba(88, 214, 171, 0.10)',
            border: '1px solid rgba(88, 214, 171, 0.22)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '18px',
          })}
        >
          🎛️
        </Box>
        <Box>
          <Box className={css({ color: 'rgba(231, 228, 239, 0.91)', fontSize: 'lg', fontWeight: '700' })}>
            Solaudity Orchestration
          </Box>
          <Box className={css({ color: 'rgba(185, 185, 193, 0.55)', fontSize: 'xs' })}>
            Run all tools in sequence and aggregate findings into a unified report
          </Box>
        </Box>
      </Flex>

      {/* Tool selector */}
      <Box mb="4">
        <Box className={css({ color: 'rgba(185, 185, 193, 0.55)', fontSize: 'xs', mb: '2', textTransform: 'uppercase', letterSpacing: '0.08em' })}>
          Tools to run
        </Box>
        <Flex gap="2" wrap="wrap">
          {tools.map((tool) => (
            <Box
              key={tool.name}
              className={css({
                px: '3', py: '1', borderRadius: '6px', fontSize: 'xs', fontWeight: '500',
                cursor: 'not-allowed', userSelect: 'none',
              })}
              style={{ color: tool.color, background: tool.bg, border: `1px solid ${tool.border}` }}
            >
              {tool.name}
            </Box>
          ))}
        </Flex>
      </Box>

      {/* Run area */}
      <Box
        className={css({
          borderRadius: '12px', border: '1px dashed rgba(185, 185, 189, 0.14)',
          bg: 'rgba(16, 16, 20, 0.5)', p: '8',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          minH: '160px', gap: '4',
        })}
      >
        <Box
          className={css({
            px: '5', py: '2', borderRadius: '8px', fontSize: 'sm', fontWeight: '600',
            color: 'rgba(88, 214, 171, 0.4)',
            bg: 'rgba(88, 214, 171, 0.06)',
            border: '1px solid rgba(88, 214, 171, 0.12)',
            cursor: 'not-allowed', userSelect: 'none',
          })}
        >
          Run all — coming soon
        </Box>
        <Box className={css({ color: 'rgba(185, 185, 193, 0.28)', fontSize: 'xs', textAlign: 'center' })}>
          Will orchestrate all selected tools, deduplicate findings, and produce a consolidated severity-ranked report
        </Box>
      </Box>
    </Box>
  )
}
