import { useState } from 'react'
import { css } from 'styled-system/css'
import { Box, Stack, Flex } from 'styled-system/jsx'
import { Button } from './components/ui'
import { Input } from './components/ui'
import logo from './assets/logo.png'

function App() {
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('admin')
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLoading(true)
    setStatus('')
    try {
      const response = await fetch('http://localhost:8001/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })

      if (!response.ok) {
        setStatus('Invalid credentials.')
        return
      }

      const data = await response.json()
      setStatus(`Welcome ${data.user?.username ?? 'admin'}.`)
    } catch (error) {
      setStatus('Unable to reach the server.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Flex
      minH="100vh"
      align="center"
      justify="center"
      px="6"
      className={css({
        paddingY: '16',
      })}
    >
      <Box className={css({ width: '100%', maxWidth: '460px' })}>
        <Stack gap="4" align="center">
          <Box
            as="img"
            src={logo}
            alt="Solaudity"
            className={css({
              width: '350px',
              maxWidth: '100%',
              height: 'auto',
              display: 'block',
            })}
          />

          <Box
            className={css({
              width: '100%',
              background: 'rgba(8, 12, 10, 0.9)',
              borderRadius: 'lg',
              boxShadow: '0 30px 80px rgba(2, 6, 5, 0.65)',
              border: '1px solid',
              borderColor: 'rgba(198, 254, 225, 0.18)',
              padding: '8',
            })}
          >
            <Stack gap="6">
              <Stack gap="2">
            <Box
              className={css({
                fontSize: '2xl',
                fontWeight: '700',
                letterSpacing: '-0.02em',
                color: '#f4fff9',
              })}
            >
              Sign in
            </Box>
            <Box className={css({ color: 'rgba(244, 255, 249, 0.7)', fontSize: 'sm' })}>
              Use <strong>admin / admin</strong> for now.
            </Box>
              </Stack>

              <Box as="form" onSubmit={submit}>
                <Stack gap="4">
                  <Stack gap="2">
                    <Box
                      className={css({
                        fontSize: 'sm',
                        fontWeight: '600',
                        color: 'rgba(244, 255, 249, 0.75)',
                      })}
                    >
                      Username
                    </Box>
                    <Input
                      className={css({
                        background: 'rgba(8, 12, 10, 0.6)',
                        borderColor: 'rgba(198, 254, 225, 0.18)',
                        color: '#f4fff9',
                        _placeholder: { color: 'rgba(244, 255, 249, 0.5)' },
                      })}
                      name="username"
                      placeholder="admin"
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      autoComplete="username"
                    />
                  </Stack>

                  <Stack gap="2">
                    <Box
                      className={css({
                        fontSize: 'sm',
                        fontWeight: '600',
                        color: 'rgba(244, 255, 249, 0.75)',
                      })}
                    >
                      Password
                    </Box>
                    <Input
                      className={css({
                        background: 'rgba(8, 12, 10, 0.6)',
                        borderColor: 'rgba(198, 254, 225, 0.18)',
                        color: '#f4fff9',
                        _placeholder: { color: 'rgba(244, 255, 249, 0.5)' },
                      })}
                      name="password"
                      type="password"
                      placeholder="admin"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete="current-password"
                    />
                  </Stack>

                  {status && (
                    <Box
                      className={css({
                        fontSize: 'sm',
                        color: status.startsWith('Welcome') ? 'green.11' : 'red.11',
                      })}
                    >
                      {status}
                    </Box>
                  )}

                  <Button loading={loading} type="submit">
                    Sign in
                  </Button>
                </Stack>
              </Box>
            </Stack>
          </Box>
        </Stack>
      </Box>
    </Flex>
  )
}

export default App
