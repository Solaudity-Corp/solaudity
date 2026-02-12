import { useState } from 'react'
import { css } from 'styled-system/css'
import { Box, Flex, Stack } from 'styled-system/jsx'
import { Button, Card, Field, Input } from './components/ui'
import { SvgLogo } from './components/SvgLogo'

type AuthStatus =
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string }
  | null

export default function Login() {
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('admin')
  const [status, setStatus] = useState<AuthStatus>(null)
  const [loading, setLoading] = useState(false)

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLoading(true)
    setStatus(null)

    try {
      const response = await fetch('http://localhost:8001/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })

      if (!response.ok) {
        setStatus({ kind: 'error', message: 'Invalid credentials.' })
        return
      }

      const data = await response.json()
      setStatus({ kind: 'success', message: `Welcome ${data.user?.username ?? 'admin'}.` })
    } catch {
      setStatus({ kind: 'error', message: 'Unable to reach the server.' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Flex minH="100vh" align="center" justify="center" px={{ base: '4', md: '8' }} py="12">
      <Box className={css({ width: '100%', maxWidth: '500px', position: 'relative', zIndex: 1 })}>
        <Stack gap="4" align="center">
          <SvgLogo
            width={280}
            height={68}
            backgroundColor="transparent"
            gradientStops={['#858489', '#e7e4ef', '#858489', '#b9b9b9', '#858489']}
            underlineColor="#b9b9b9"
            cornerRadius={3}
          />

          <Card.Root
            variant="outline"
            className={css({
              width: '100%',
              borderRadius: '10px',
              borderColor: 'rgba(185, 185, 189, 0.26)',
              borderWidth: '1px',
              bg: 'rgba(36, 36, 40, 0.82)',
              boxShadow:
                '0 20px 46px rgba(0, 0, 0, 0.52), 0 0 20px rgba(231, 228, 239, 0.05), inset 0 1px 0 rgba(255, 255, 255, 0.04)',
              backdropFilter: 'blur(12px)',
            })}
          >
            <Card.Header>
              <Card.Title
                className={css({
                  color: '#efeff2',
                  fontSize: '2xl',
                  fontWeight: '700',
                  letterSpacing: '-0.02em',
                })}
              >
                Access Console
              </Card.Title>
              <Card.Description
                className={css({
                  color: 'rgba(210, 210, 218, 0.72)',
                  fontSize: 'sm',
                })}
              >
                Sign in to continue to your security workspace.
              </Card.Description>
            </Card.Header>

            <Card.Body>
              <form onSubmit={submit} className={css({ display: 'grid', gap: '4' })}>
                <Field.Root>
                  <Field.Label className={css({ color: 'rgba(224, 224, 231, 0.86)' })}>
                    Username
                  </Field.Label>
                  <Input
                    placeholder="admin"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    autoComplete="username"
                    className={css({
                      bg: 'rgba(20, 20, 24, 0.94)',
                      borderRadius: '6px',
                      borderColor: 'rgba(176, 176, 184, 0.46)',
                      color: '#e7e4ef',
                      _placeholder: { color: 'rgba(167, 167, 174, 0.52)' },
                      _focusVisible: {
                        borderColor: '#e7e4ef',
                        boxShadow: '0 0 0 1px rgba(231, 228, 239, 0.42)',
                      },
                    })}
                  />
                </Field.Root>

                <Field.Root>
                  <Field.Label className={css({ color: 'rgba(224, 224, 231, 0.86)' })}>
                    Password
                  </Field.Label>
                  <Input
                    type="password"
                    placeholder="admin"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="current-password"
                    className={css({
                      bg: 'rgba(20, 20, 24, 0.94)',
                      borderRadius: '6px',
                      borderColor: 'rgba(176, 176, 184, 0.46)',
                      color: '#e7e4ef',
                      _placeholder: { color: 'rgba(167, 167, 174, 0.52)' },
                      _focusVisible: {
                        borderColor: '#e7e4ef',
                        boxShadow: '0 0 0 1px rgba(231, 228, 239, 0.42)',
                      },
                    })}
                  />
                </Field.Root>

                {status && (
                  <Box
                    className={css({
                      fontSize: 'sm',
                      color:
                        status.kind === 'success' ? 'rgba(110, 255, 192, 0.92)' : 'rgba(255, 123, 143, 0.96)',
                    })}
                  >
                    {status.message}
                  </Box>
                )}

                <Button
                  loading={loading}
                  type="submit"
                  className={css({
                    bg: '#b9b9b9',
                    borderRadius: '6px',
                    color: '#121214',
                    fontWeight: '700',
                    border: '0',
                    _hover: {
                      bg: '#c8c8c8',
                    },
                  })}
                >
                  Sign in
                </Button>
              </form>
            </Card.Body>
          </Card.Root>
        </Stack>
      </Box>
    </Flex>
  )
}
