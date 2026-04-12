import { css } from 'styled-system/css'
import { Box, Flex } from 'styled-system/jsx'

interface KEVMViewProps {
  auditId: string
}

export function KEVMView({ auditId: _auditId }: KEVMViewProps) {
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
            bg: 'rgba(255, 90, 90, 0.10)',
            border: '1px solid rgba(255, 90, 90, 0.20)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '18px',
          })}
        >
          ⚙️
        </Box>
        <Box>
          <Box className={css({ color: 'rgba(231, 228, 239, 0.91)', fontSize: 'lg', fontWeight: '700' })}>
            KEVM
          </Box>
          <Box className={css({ color: 'rgba(185, 185, 193, 0.55)', fontSize: 'xs' })}>
            K framework semantics of the EVM — full formal verification
          </Box>
        </Box>
      </Flex>

      <Box
        className={css({
          borderRadius: '12px', border: '1px dashed rgba(185, 185, 189, 0.14)',
          bg: 'rgba(16, 16, 20, 0.5)', p: '8',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          minH: '200px', gap: '3',
        })}
      >
        <Box className={css({ color: 'rgba(185, 185, 193, 0.38)', fontSize: 'sm', textAlign: 'center' })}>
          KEVM — coming soon
        </Box>
        <Box className={css({ color: 'rgba(185, 185, 193, 0.28)', fontSize: 'xs', textAlign: 'center' })}>
          Will run reachability proofs and full formal specs against EVM bytecode using the K framework semantics
        </Box>
      </Box>
    </Box>
  )
}
