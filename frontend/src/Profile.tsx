import { useEffect, useState } from 'react'
import { Check, ChevronDown, Eye, EyeOff, X } from 'lucide-react'
import { css, cx } from 'styled-system/css'
import { Box, Flex, Stack } from 'styled-system/jsx'
import { type MenuPath } from './Menu'
import { type MenuSection, NavBar } from './components/NavBar'
import { Card, Input } from './components/ui'
import {
  AuthApiError,
  getCurrentUser,
  getSupportedAIProviders,
  getUserAIConfig,
  type UserAIConfigRead,
  type UserRead,
  updateUserAIConfig,
  updateUserProfile,
} from './auth'

interface ProfileProps {
  onNavigateMenu: (path: MenuPath) => void
  onOpenProfile: () => void
}

type StatusState =
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string }
  | null

const fallbackProviders = ['openai', 'groq', 'xai', 'gemini']

function getErrorMessage(error: unknown): string {
  if (error instanceof AuthApiError && error.message.trim()) return error.message
  if (error instanceof Error && error.message.trim()) return error.message
  return 'Unexpected error while saving profile settings.'
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

export default function Profile({ onNavigateMenu, onOpenProfile }: ProfileProps) {
  const [search, setSearch] = useState('')
  const [user, setUser] = useState<UserRead | null>(null)
  const [aiConfig, setAiConfig] = useState<UserAIConfigRead | null>(null)
  const [supportedProviders, setSupportedProviders] = useState<string[]>(fallbackProviders)
  const [isLoading, setIsLoading] = useState(true)
  const [status, setStatus] = useState<StatusState>(null)

  const [emailDraft, setEmailDraft] = useState('')
  const [isSavingEmail, setIsSavingEmail] = useState(false)

  const [providerDraft, setProviderDraft] = useState('')
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [isSavingAiSettings, setIsSavingAiSettings] = useState(false)

  useEffect(() => {
    let isMounted = true

    const load = async () => {
      setIsLoading(true)
      setStatus(null)
      try {
        const [currentUser, config, providers] = await Promise.all([
          getCurrentUser(),
          getUserAIConfig(),
          getSupportedAIProviders(),
        ])
        if (!isMounted) return

        setUser(currentUser)
        setAiConfig(config)
        if (providers.length > 0) {
          setSupportedProviders(providers)
        }

        setEmailDraft(currentUser.email)
        setProviderDraft(config.ai_provider ?? '')
        setApiKeyDraft(config.ai_api_key ?? '')
      } catch (error) {
        if (!isMounted) return
        setStatus({ kind: 'error', message: getErrorMessage(error) })
      } finally {
        if (isMounted) setIsLoading(false)
      }
    }

    void load()
    return () => {
      isMounted = false
    }
  }, [])

  const currentEmail = user?.email ?? ''
  const currentProvider = aiConfig?.ai_provider ?? ''
  const currentApiKey = aiConfig?.ai_api_key ?? ''

  const emailDirty = emailDraft.trim() !== currentEmail.trim()
  const providerDirty = providerDraft !== currentProvider
  const apiKeyDirty = apiKeyDraft.trim() !== currentApiKey
  const aiSettingsDirty = providerDirty || apiKeyDirty
  const bothEmpty = !providerDraft && !apiKeyDraft.trim()
  const bothFilled = !!providerDraft && !!apiKeyDraft.trim()
  const aiSettingsValid = aiSettingsDirty && (bothEmpty || bothFilled)

  const iconButtonClass = css({
    width: '2rem',
    height: '2rem',
    borderRadius: '8px',
    border: '1px solid rgba(185, 185, 189, 0.22)',
    background: 'rgba(20, 20, 25, 0.88)',
    color: 'rgba(220, 218, 227, 0.9)',
    display: 'grid',
    placeItems: 'center',
    cursor: 'pointer',
    _hover: { background: 'rgba(34, 34, 41, 0.95)' },
    _disabled: {
      opacity: 0.5,
      cursor: 'not-allowed',
    },
  })

  const confirmButtonActiveClass = css({
    borderColor: 'rgba(64, 176, 112, 0.55)',
    bg: 'rgba(35, 93, 63, 0.35)',
    color: 'rgba(150, 255, 196, 0.96)',
    _hover: { background: 'rgba(39, 102, 70, 0.48)' },
  })

  const confirmButtonDirtyClass = css({
    borderColor: 'rgba(88, 214, 141, 0.82)',
    bg: 'rgba(43, 119, 79, 0.58)',
    color: 'rgba(194, 255, 222, 1)',
  })

  const rowLabelClass = css({
    color: 'rgba(191, 191, 200, 0.76)',
    fontSize: 'xs',
    minW: '0',
    fontWeight: '600',
    letterSpacing: '0.01em',
  })

  const rowClass = css({
    display: 'grid',
    gridTemplateColumns: { base: '1fr', md: '110px minmax(0, 1fr)' },
    alignItems: 'center',
    gap: '3',
  })

  const fieldWithActionsClass = css({
    display: 'grid',
    gridTemplateColumns: { base: '1fr', md: 'minmax(0, 1fr) auto' },
    alignItems: 'center',
    gap: '2',
    minW: '0',
    w: 'full',
    maxW: { base: 'full', md: '560px' },
    justifySelf: { md: 'end' },
  })

  const actionGroupClass = css({
    display: 'flex',
    alignItems: 'center',
    gap: '2',
    justifyContent: { base: 'flex-start', md: 'flex-end' },
  })

  const inputClass = css({
    bg: 'rgba(10, 10, 12, 0.62)',
    borderRadius: '8px',
    borderColor: 'rgba(255, 255, 255, 0.14)',
    color: '#e7e4ef',
    fontSize: 'sm',
    h: '10',
    _placeholder: { color: 'rgba(167, 167, 174, 0.52)' },
    _focusVisible: {
      borderColor: '#e7e4ef',
      bg: 'rgba(10, 10, 12, 0.84)',
      boxShadow: '0 0 0 1px rgba(231, 228, 239, 0.35)',
    },
    _disabled: {
      opacity: 1,
      cursor: 'not-allowed',
      color: 'rgba(223, 221, 231, 0.88)',
      bg: 'rgba(10, 10, 12, 0.48)',
    },
  })

  const selectClass = css({
    w: 'full',
    h: '10',
    borderRadius: '8px',
    border: '1px solid rgba(255, 255, 255, 0.14)',
    background: 'rgba(10, 10, 12, 0.62)',
    color: '#e7e4ef',
    appearance: 'none',
    px: '2.5',
    pr: '10',
    fontSize: 'sm',
    outline: 'none',
    _focusVisible: {
      borderColor: '#e7e4ef',
      boxShadow: '0 0 0 1px rgba(231, 228, 239, 0.35)',
    },
    _disabled: {
      opacity: 1,
      cursor: 'not-allowed',
      color: 'rgba(223, 221, 231, 0.88)',
      background: 'rgba(10, 10, 12, 0.48)',
    },
  })

  const navigateBySection = (section: MenuSection) => {
    onNavigateMenu(`/menu/${section}` as MenuPath)
  }

  const saveEmail = async () => {
    if (!user) return
    const normalizedEmail = emailDraft.trim()
    if (!normalizedEmail) {
      setStatus({ kind: 'error', message: 'Email is required.' })
      return
    }
    if (!isValidEmail(normalizedEmail)) {
      setStatus({ kind: 'error', message: 'Please enter a valid email address.' })
      return
    }

    setIsSavingEmail(true)
    setStatus(null)
    try {
      const updated = await updateUserProfile({ email: normalizedEmail })
      setUser(updated)
      setEmailDraft(updated.email)
      setStatus({ kind: 'success', message: 'Email updated.' })
    } catch (error) {
      setStatus({ kind: 'error', message: getErrorMessage(error) })
    } finally {
      setIsSavingEmail(false)
    }
  }

  const saveAiSettings = async () => {
    const normalizedProvider = providerDraft.trim().toLowerCase()
    const normalizedApiKey = apiKeyDraft.trim()

    if (normalizedProvider && !supportedProviders.includes(normalizedProvider)) {
      setStatus({ kind: 'error', message: 'Please choose a provider from the list.' })
      return
    }
    if (normalizedProvider && !normalizedApiKey) {
      setStatus({ kind: 'error', message: 'An API key is required when selecting a provider.' })
      return
    }
    if (normalizedApiKey.length > 512) {
      setStatus({ kind: 'error', message: 'API key is too long (max 512 characters).' })
      return
    }

    setIsSavingAiSettings(true)
    setStatus(null)
    try {
      const updated = await updateUserAIConfig(
        normalizedProvider || null,
        normalizedApiKey || null,
      )
      setAiConfig(updated)
      setProviderDraft(updated.ai_provider ?? '')
      setApiKeyDraft(updated.ai_api_key ?? '')
      setStatus({ kind: 'success', message: 'AI settings updated.' })
    } catch (error) {
      setStatus({ kind: 'error', message: getErrorMessage(error) })
    } finally {
      setIsSavingAiSettings(false)
    }
  }

  return (
    <Flex minH="100vh" direction="column" className={css({ background: '#101014' })}>
      <NavBar
        activeSection="audits"
        searchValue={search}
        onSearchChange={setSearch}
        onNavigate={navigateBySection}
        onOpenProfile={onOpenProfile}
        showSearch={false}
      />

      <Flex flex="1" px={{ base: '4', md: '8' }} py={{ base: '5', md: '7' }}>
        <Card.Root
          variant="outline"
          className={css({
            width: '100%',
            maxW: '820px',
            mx: 'auto',
            borderRadius: '18px',
            borderColor: 'rgba(185, 185, 189, 0.14)',
            bg: 'rgba(24, 24, 29, 0.82)',
            boxShadow: '0 12px 28px rgba(0, 0, 0, 0.3)',
          })}
        >
          <Card.Header>
            <Card.Title className={css({ color: 'rgba(231, 228, 239, 0.91)', fontSize: 'xl', fontWeight: '700' })}>
              Profile Settings
            </Card.Title>
            <Card.Description className={css({ color: 'rgba(204, 204, 212, 0.7)', lineHeight: '1.55', fontSize: 'sm' })}>
              Manage your account information and AI provider credentials.
            </Card.Description>
          </Card.Header>

          <Card.Body>
            <Stack gap="4">
              {status && (
                <Box
                  className={css({
                    borderRadius: '10px',
                    px: '3',
                    py: '2',
                    fontSize: 'xs',
                    border:
                      status.kind === 'success'
                        ? '1px solid rgba(48, 173, 96, 0.36)'
                        : '1px solid rgba(229, 72, 77, 0.38)',
                    bg:
                      status.kind === 'success'
                        ? 'rgba(48, 173, 96, 0.14)'
                        : 'rgba(229, 72, 77, 0.12)',
                    color:
                      status.kind === 'success'
                        ? 'rgba(140, 255, 192, 0.96)'
                        : 'rgba(255, 174, 180, 0.96)',
                  })}
                >
                  {status.message}
                </Box>
              )}

              <Card.Root
                variant="outline"
                className={css({
                  borderColor: 'rgba(185, 185, 189, 0.14)',
                  bg: 'rgba(18, 18, 23, 0.78)',
                })}
              >
                <Card.Header>
                  <Card.Title className={css({ color: 'rgba(231, 228, 239, 0.9)', fontSize: 'md' })}>
                    Account
                  </Card.Title>
                </Card.Header>
                <Card.Body>
                  <Stack gap="3">
                    <Box className={rowClass}>
                      <Box className={rowLabelClass}>Username</Box>
                      <Box className={fieldWithActionsClass}>
                        <Input
                          value={isLoading ? 'Loading...' : (user?.username ?? '')}
                          disabled
                          readOnly
                          className={cx(inputClass, css({ w: 'full' }))}
                        />
                        <Box />
                      </Box>
                    </Box>

                    <Box className={rowClass}>
                      <Box className={rowLabelClass}>Email</Box>
                      <Box className={fieldWithActionsClass}>
                        <Input
                          value={isLoading ? 'Loading...' : emailDraft}
                          onChange={(event) => {
                            setEmailDraft(event.target.value)
                            setStatus(null)
                          }}
                          placeholder="Email address"
                          className={cx(inputClass, css({ w: 'full' }))}
                          disabled={isLoading || !user}
                        />
                        <Box className={actionGroupClass}>
                          <button
                            type="button"
                            className={cx(
                              iconButtonClass,
                              emailDirty && confirmButtonActiveClass,
                              emailDirty && confirmButtonDirtyClass,
                            )}
                            onClick={() => { void saveEmail() }}
                            aria-label="Save email"
                            disabled={!emailDirty || isSavingEmail}
                          >
                            <Check size={14} />
                          </button>
                          <button
                            type="button"
                            className={iconButtonClass}
                            onClick={() => setEmailDraft(currentEmail)}
                            aria-label="Reset email"
                            disabled={!emailDirty || isSavingEmail}
                          >
                            <X size={14} />
                          </button>
                        </Box>
                      </Box>
                    </Box>
                  </Stack>
                </Card.Body>
              </Card.Root>

              <Card.Root
                variant="outline"
                className={css({
                  borderColor: 'rgba(185, 185, 189, 0.14)',
                  bg: 'rgba(18, 18, 23, 0.78)',
                })}
              >
                <Card.Header>
                  <Card.Title className={css({ color: 'rgba(231, 228, 239, 0.9)', fontSize: 'md' })}>
                    AI Settings
                  </Card.Title>
                </Card.Header>
                <Card.Body>
                  <Stack gap="3">
                    <Box className={rowClass}>
                      <Box className={rowLabelClass}>Provider</Box>
                      <Box className={fieldWithActionsClass}>
                        <Box className={css({ position: 'relative', w: 'full' })}>
                          <select
                            value={providerDraft}
                            onChange={(event) => {
                              setProviderDraft(event.target.value)
                              setStatus(null)
                            }}
                            className={selectClass}
                            disabled={isLoading || isSavingAiSettings}
                          >
                            <option value="">Select provider</option>
                            {supportedProviders.map((provider) => (
                              <option key={provider} value={provider}>
                                {provider}
                              </option>
                            ))}
                          </select>
                          <ChevronDown
                            size={14}
                            className={css({
                              position: 'absolute',
                              right: '2.5',
                              top: '50%',
                              transform: 'translateY(-50%)',
                              pointerEvents: 'none',
                              color: 'rgba(201, 201, 208, 0.84)',
                            })}
                          />
                        </Box>
                        <Box />
                      </Box>
                    </Box>

                    <Box className={rowClass}>
                      <Box className={rowLabelClass}>API Key</Box>
                      <Box className={fieldWithActionsClass}>
                        <Input
                          type={showApiKey ? 'text' : 'password'}
                          value={apiKeyDraft}
                          onChange={(event) => {
                            setApiKeyDraft(event.target.value)
                            setStatus(null)
                          }}
                          placeholder="Enter API key"
                          className={cx(inputClass, css({ w: 'full' }))}
                          disabled={isLoading || isSavingAiSettings}
                        />
                        <Box className={actionGroupClass}>
                          <button
                            type="button"
                            className={iconButtonClass}
                            onClick={() => setShowApiKey((previous) => !previous)}
                            aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
                            disabled={!apiKeyDraft}
                          >
                            {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                          </button>
                          <button
                            type="button"
                            className={cx(
                              iconButtonClass,
                              aiSettingsValid && confirmButtonActiveClass,
                              aiSettingsValid && confirmButtonDirtyClass,
                            )}
                            onClick={() => { void saveAiSettings() }}
                            aria-label="Save AI settings"
                            disabled={!aiSettingsValid || isSavingAiSettings}
                          >
                            <Check size={14} />
                          </button>
                          <button
                            type="button"
                            className={iconButtonClass}
                            onClick={() => {
                              setProviderDraft(currentProvider)
                              setApiKeyDraft(currentApiKey)
                              setStatus(null)
                            }}
                            aria-label="Reset AI settings"
                            disabled={!aiSettingsDirty || isSavingAiSettings}
                          >
                            <X size={14} />
                          </button>
                        </Box>
                      </Box>
                    </Box>
                  </Stack>
                </Card.Body>
              </Card.Root>
            </Stack>
          </Card.Body>
        </Card.Root>
      </Flex>
    </Flex>
  )
}
