import type { FC } from 'react'
import { css } from 'styled-system/css'
import { Box, Flex } from 'styled-system/jsx'

interface CodeQualityViewProps {
  auditId: string
}

export const CodeQualityView: FC<CodeQualityViewProps> = () => {
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
            border: '1px solid rgba(88, 214, 171, 0.20)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '18px',
          })}
        >
          ✨
        </Box>
        <Box>
          <Box className={css({ color: 'rgba(231, 228, 239, 0.91)', fontSize: 'lg', fontWeight: '700' })}>
            Qualité de code
          </Box>
          <Box className={css({ color: 'rgba(185, 185, 193, 0.55)', fontSize: 'xs' })}>
            Solhint · Ethlint / Solium — linting & style enforcement
          </Box>
        </Box>
      </Flex>

      <Flex gap="4" mb="4" wrap="wrap">
        {/* Solhint card */}
        <Box
          className={css({
            flex: '1', minW: '260px', borderRadius: '12px',
            border: '1px solid rgba(88, 214, 171, 0.14)',
            bg: 'rgba(88, 214, 171, 0.04)', p: '4',
          })}
        >
          <Flex align="center" gap="2" mb="2">
            <Box
              className={css({
                px: '2', py: '0.5', borderRadius: '5px', fontSize: 'xs', fontWeight: '600',
                bg: 'rgba(88, 214, 171, 0.12)', color: 'rgba(88, 214, 171, 0.9)',
                border: '1px solid rgba(88, 214, 171, 0.20)',
              })}
            >
              Solhint
            </Box>
          </Flex>
          <Box className={css({ color: 'rgba(185, 185, 193, 0.5)', fontSize: 'xs', lineHeight: '1.6' })}>
            Security rules, best practices, and style guide enforcement for Solidity source code
          </Box>
        </Box>

        {/* Ethlint card */}
        <Box
          className={css({
            flex: '1', minW: '260px', borderRadius: '12px',
            border: '1px solid rgba(180, 140, 255, 0.14)',
            bg: 'rgba(180, 140, 255, 0.04)', p: '4',
          })}
        >
          <Flex align="center" gap="2" mb="2">
            <Box
              className={css({
                px: '2', py: '0.5', borderRadius: '5px', fontSize: 'xs', fontWeight: '600',
                bg: 'rgba(180, 140, 255, 0.12)', color: 'rgba(180, 140, 255, 0.9)',
                border: '1px solid rgba(180, 140, 255, 0.20)',
              })}
            >
              Ethlint / Solium
            </Box>
          </Flex>
          <Box className={css({ color: 'rgba(185, 185, 193, 0.5)', fontSize: 'xs', lineHeight: '1.6' })}>
            Style and security linting for Solidity with configurable rules and auto-fix support
          </Box>
        </Box>
      </Flex>

      <Box
        className={css({
          borderRadius: '12px', border: '1px dashed rgba(185, 185, 189, 0.14)',
          bg: 'rgba(16, 16, 20, 0.5)', p: '8',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          minH: '140px', gap: '3',
        })}
      >
        <Box className={css({ color: 'rgba(185, 185, 193, 0.38)', fontSize: 'sm', textAlign: 'center' })}>
          Code quality analysis — coming soon
        </Box>
        <Box className={css({ color: 'rgba(185, 185, 193, 0.28)', fontSize: 'xs', textAlign: 'center' })}>
          Will surface lint warnings, style violations, and best-practice recommendations inline
        </Box>
      </Box>
    </Box>
  )
}
