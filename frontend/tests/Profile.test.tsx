import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Profile from '../src/Profile'

const authMocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getSupportedAIProviders: vi.fn(),
  getUserAIConfig: vi.fn(),
  updateUserAIApiKey: vi.fn(),
  updateUserAIProvider: vi.fn(),
  updateUserProfile: vi.fn(),
}))

vi.mock('../src/auth', () => {
  class AuthApiError extends Error {
    status: number
    detail: unknown

    constructor(status: number, detail: unknown) {
      super(typeof detail === 'string' ? detail : 'Request failed.')
      this.status = status
      this.detail = detail
    }
  }

  return {
    AuthApiError,
    getCurrentUser: authMocks.getCurrentUser,
    getSupportedAIProviders: authMocks.getSupportedAIProviders,
    getUserAIConfig: authMocks.getUserAIConfig,
    updateUserAIApiKey: authMocks.updateUserAIApiKey,
    updateUserAIProvider: authMocks.updateUserAIProvider,
    updateUserProfile: authMocks.updateUserProfile,
  }
})

vi.mock('../src/components/NavBar', () => ({
  NavBar: () => <div data-testid="nav-bar">profile-nav</div>,
}))

describe('Profile', () => {
  beforeEach(() => {
    authMocks.getCurrentUser.mockReset()
    authMocks.getSupportedAIProviders.mockReset()
    authMocks.getUserAIConfig.mockReset()
    authMocks.updateUserAIApiKey.mockReset()
    authMocks.updateUserAIProvider.mockReset()
    authMocks.updateUserProfile.mockReset()

    authMocks.getCurrentUser.mockResolvedValue({
      id: 1,
      username: 'alice',
      email: 'alice@example.com',
      date_created: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    })
    authMocks.getUserAIConfig.mockResolvedValue({
      ai_provider: 'openai',
      ai_api_key: 'secret-key',
      has_api_key: true,
    })
    authMocks.getSupportedAIProviders.mockResolvedValue(['openai', 'groq'])
    authMocks.updateUserProfile.mockImplementation(async ({ email }: { email: string }) => ({
      id: 1,
      username: 'alice',
      email,
      date_created: '2026-01-01T00:00:00Z',
      updated_at: '2026-02-01T00:00:00Z',
    }))
  })

  it('loads the current user profile without rendering errors', async () => {
    render(
      <Profile
        onNavigateMenu={vi.fn()}
        onOpenProfile={vi.fn()}
      />,
    )

    expect(await screen.findByDisplayValue('alice')).toBeInTheDocument()
    expect(screen.getByDisplayValue('alice@example.com')).toBeInTheDocument()
    expect(await screen.findByDisplayValue('openai')).toBeInTheDocument()
  })

  it('updates the user email from the profile page', async () => {
    render(
      <Profile
        onNavigateMenu={vi.fn()}
        onOpenProfile={vi.fn()}
      />,
    )

    const emailInput = await screen.findByDisplayValue('alice@example.com')

    fireEvent.change(emailInput, { target: { value: 'new@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /save email/i }))

    await waitFor(() => expect(authMocks.updateUserProfile).toHaveBeenCalledWith({ email: 'new@example.com' }))
    expect(await screen.findByText('Email updated.')).toBeInTheDocument()
    expect(screen.getByDisplayValue('new@example.com')).toBeInTheDocument()
  })
})
