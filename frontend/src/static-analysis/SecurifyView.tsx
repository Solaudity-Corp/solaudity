import { css } from 'styled-system/css'
import { Box, Flex } from 'styled-system/jsx'

interface SecurifyViewProps {
  auditId: string
}

export function SecurifyView({ auditId: _auditId }: SecurifyViewProps) {
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
            bg: 'rgba(100, 160, 255, 0.12)',
            border: '1px solid rgba(100, 160, 255, 0.22)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '18px',
          })}
        >
          🛡️
        </Box>
        <Box>
          <Box className={css({ color: 'rgba(231, 228, 239, 0.91)', fontSize: 'lg', fontWeight: '700' })}>
            Securify
          </Box>
          <Box className={css({ color: 'rgba(185, 185, 193, 0.55)', fontSize: 'xs' })}>
            Formal verification tool by ETH Zurich
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
          Securify analysis — coming soon
        </Box>
        <Box className={css({ color: 'rgba(185, 185, 193, 0.28)', fontSize: 'xs', textAlign: 'center' })}>
          Will verify compliance patterns and detect security violations using semantic analysis on EVM bytecode
        </Box>
      </Box>
    </Box>
  )
}
