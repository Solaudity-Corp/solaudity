import { css } from 'styled-system/css'
import { Box, Flex } from 'styled-system/jsx'
import { NavBar } from './components/NavBar'

export default function Menu() {
  return (
    <Flex
      minH="100vh"
      direction="column"
      className={css({
        background: '#121214',
      })}
    >
      <NavBar />
      <Flex flex="1" align="center" justify="center" px="4">
        <Box
          className={css({
            color: 'rgba(231, 228, 239, 0.75)',
            fontSize: 'sm',
            border: '1px dashed rgba(176, 176, 184, 0.35)',
            borderRadius: '8px',
            px: '5',
            py: '4',
          })}
        >
          Menu page content
        </Box>
      </Flex>
    </Flex>
  )
}
