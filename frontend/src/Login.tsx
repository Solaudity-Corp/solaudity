import { useState, useEffect } from 'react'
import { css } from 'styled-system/css'
import { Box, Flex, Stack } from 'styled-system/jsx'
import { Button, Card, Field, Input } from './components/ui'
import { SvgLogo } from './components/SvgLogo'
import { AuthApiError, loginUser } from './auth'

type AuthStatus = { kind: 'success'; message: string } | { kind: 'error'; message: string } | null

interface LoginProps {
  onLoginSuccess: () => void
  onNavigateRegister: () => void
}

const titles = [
  'Protocol Security',
  'Smart Contract Audit',
  'On-Chain Monitor',
  'DeFi Protection',
  'EVM Security'
]

function getLoginErrorMessage(error: unknown): string {
  if (error instanceof AuthApiError && error.status === 401) {
    return 'Invalid username or password.'
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  return 'Unable to reach the server.'
}

export default function Login({ onLoginSuccess, onNavigateRegister }: LoginProps) {
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<AuthStatus>(null)
  const [loading, setLoading] = useState(false)

  const [titleIndex, setTitleIndex] = useState(0)
  const [displayedTitle, setDisplayedTitle] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)

  useEffect(() => {
    const currentFullTitle = titles[titleIndex]
    const timeout = setTimeout(() => {
      if (!isDeleting) {
        setDisplayedTitle(currentFullTitle.substring(0, displayedTitle.length + 1))
        if (displayedTitle === currentFullTitle) {
          setTimeout(() => setIsDeleting(true), 2000)
        }
      } else {
        setDisplayedTitle(currentFullTitle.substring(0, displayedTitle.length - 1))
        if (displayedTitle === '') {
          setIsDeleting(false)
          setTitleIndex((prev) => (prev + 1) % titles.length)
        }
      }
    }, isDeleting ? 50 : 50)
    return () => clearTimeout(timeout)
  }, [displayedTitle, isDeleting, titleIndex])

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLoading(true)
    setStatus(null)

    try {
      const normalizedIdentifier = identifier.trim()
      if (!normalizedIdentifier || !password) {
        setStatus({ kind: 'error', message: 'Please enter both username/email and password.' })
        return
      }

      await loginUser(normalizedIdentifier, password)
      setStatus({ kind: 'success', message: `Welcome ${normalizedIdentifier}.` })
      onLoginSuccess()
    } catch (error) {
      setStatus({ kind: 'error', message: getLoginErrorMessage(error) })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Flex minH="100vh" align="center" justify="center" px={{ base: '4', md: '8' }} py="12" position="relative" overflow="hidden">
      <Box position="absolute" top="0" left="0" right="0" bottom="0" zIndex="0" overflow="hidden" bg="#0f0f12ff">
        <div className={css({
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          backgroundImage: 'radial-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
          maskImage: 'radial-gradient(circle at 50% 50%, black 40%, transparent 80%)',
          animation: 'pulse-grid 8s infinite alternate ease-in-out',
        })} />

      </Box>

      <Box className={css({ width: '100%', maxWidth: '500px', position: 'relative', zIndex: 1 })}>
        <Stack gap="4" align="center">
          <SvgLogo width={280} height={68} backgroundColor="transparent" gradientStops={['#858489', '#e7e4ef', '#858489', '#b9b9b9', '#858489']} underlineColor="#b9b9b9" cornerRadius={3} />

          <Card.Root variant="outline" className={css({
            width: '100%', borderRadius: '16px', borderColor: 'rgba(255, 255, 255, 0.15)', borderWidth: '1px',
            bg: 'rgba(20, 20, 24, 0.4)', boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.36)', backdropFilter: 'blur(16px)',
            transition: 'all 0.3s ease', _hover: { boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.5)' }
          })}>
            <Card.Header>
              <Card.Title className={css({
                color: 'rgba(239, 239, 242, 0.75)', fontSize: '2xl', fontWeight: '700', letterSpacing: '-0.02em',
                minHeight: '1.5em', display: 'flex', alignItems: 'center', gap: '2', textShadow: '0 0 20px rgba(0,0,0,0.5)',
              })}>
                {displayedTitle}
                <span className={css({ display: 'inline-block', width: '2px', height: '1.2em', bg: '#e7e4ef', animation: 'cursor-blink 1s infinite' })} />
              </Card.Title>
              <Card.Description className={css({ color: 'rgba(210, 210, 218, 0.72)', fontSize: 'sm' })}>
                Sign in to access your security workspace
              </Card.Description>
            </Card.Header>

            <Card.Body>
              <form onSubmit={submit} className={css({ display: 'grid', gap: '4' })}>
                <Field.Root>
                  <Field.Label className={css({ color: 'rgba(224, 224, 231, 0.86)' })}>Username or Email</Field.Label>
                  <Input placeholder="Username or Email" value={identifier} onChange={(event) => setIdentifier(event.target.value)} autoComplete="username"
                    className={css({
                      bg: 'rgba(10, 10, 12, 0.6)', borderRadius: '8px', borderColor: 'rgba(255, 255, 255, 0.1)', color: '#e7e4ef',
                      _placeholder: { color: 'rgba(167, 167, 174, 0.52)' }, transition: 'all 0.2s',
                      _focusVisible: { borderColor: '#e7e4ef', bg: 'rgba(10, 10, 12, 0.8)', boxShadow: '0 0 0 1px rgba(231, 228, 239, 0.42)' },
                    })}
                  />
                </Field.Root>

                <Field.Root>
                  <Field.Label className={css({ color: 'rgba(224, 224, 231, 0.86)' })}>Password</Field.Label>
                  <Input type="password" placeholder="Password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password"
                    className={css({
                      bg: 'rgba(10, 10, 12, 0.6)', borderRadius: '8px', borderColor: 'rgba(255, 255, 255, 0.1)', color: '#e7e4ef',
                      _placeholder: { color: 'rgba(167, 167, 174, 0.52)' }, transition: 'all 0.2s',
                      _focusVisible: { borderColor: '#e7e4ef', bg: 'rgba(10, 10, 12, 0.8)', boxShadow: '0 0 0 1px rgba(231, 228, 239, 0.42)' },
                    })}
                  />
                </Field.Root>

                {status && (
                  <Box className={css({ fontSize: 'sm', color: status.kind === 'success' ? 'rgba(110, 255, 192, 0.92)' : 'rgba(255, 123, 143, 0.96)' })}>
                    {status.message}
                  </Box>
                )}

                <Button loading={loading} type="submit" className="btn-primary" width="100%">Sign in</Button>
                <Box className={css({ color: 'rgba(210, 210, 218, 0.72)', fontSize: 'sm', textAlign: 'center' })}>
                  No account yet?{' '}
                  <button
                    type="button"
                    onClick={onNavigateRegister}
                    className={css({
                      color: '#e7e4ef',
                      fontWeight: '600',
                      textDecoration: 'underline',
                      textUnderlineOffset: '3px',
                      cursor: 'pointer',
                      bg: 'transparent',
                      border: 'none',
                      p: '0',
                    })}
                  >
                    Register
                  </button>
                </Box>
              </form>
            </Card.Body>
          </Card.Root>
        </Stack>
      </Box>
    </Flex>
  )
}
