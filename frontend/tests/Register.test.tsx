import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Register from '../src/Register'

const authMocks = vi.hoisted(() => ({
  registerUser: vi.fn(),
  loginUser: vi.fn(),
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
    loginUser: authMocks.loginUser,
    registerUser: authMocks.registerUser,
  }
})

describe('Register', () => {
  beforeEach(() => {
    authMocks.registerUser.mockReset()
    authMocks.loginUser.mockReset()
  })

  it('shows a validation message when passwords do not match', async () => {
    render(
      <Register
        onRegisterSuccess={vi.fn()}
        onNavigateLogin={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText('Username'), {
      target: { value: 'alice' },
    })
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
      target: { value: 'alice@example.com' },
    })
    fireEvent.change(screen.getByPlaceholderText('Password'), {
      target: { value: 'StrongPass1' },
    })
    fireEvent.change(screen.getByPlaceholderText('Confirm password'), {
      target: { value: 'Mismatch1' },
    })
    fireEvent.click(screen.getByRole('button', { name: /create account/i }))

    expect(await screen.findByText('Password confirmation does not match.')).toBeInTheDocument()
    expect(authMocks.registerUser).not.toHaveBeenCalled()
    expect(authMocks.loginUser).not.toHaveBeenCalled()
  })

  it('creates the account, logs in, and notifies the parent on success', async () => {
    const onRegisterSuccess = vi.fn()
    authMocks.registerUser.mockResolvedValue({
      id: 1,
      username: 'alice',
      email: 'alice@example.com',
      date_created: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    })
    authMocks.loginUser.mockResolvedValue({ access_token: 'jwt-token', token_type: 'bearer' })

    render(
      <Register
        onRegisterSuccess={onRegisterSuccess}
        onNavigateLogin={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText('Username'), {
      target: { value: 'alice' },
    })
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
      target: { value: 'alice@example.com' },
    })
    fireEvent.change(screen.getByPlaceholderText('Password'), {
      target: { value: 'StrongPass1' },
    })
    fireEvent.change(screen.getByPlaceholderText('Confirm password'), {
      target: { value: 'StrongPass1' },
    })
    fireEvent.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() => expect(authMocks.registerUser).toHaveBeenCalledWith({
      username: 'alice',
      email: 'alice@example.com',
      password: 'StrongPass1',
    }))
    await waitFor(() => expect(authMocks.loginUser).toHaveBeenCalledWith('alice', 'StrongPass1'))
    await waitFor(() => expect(onRegisterSuccess).toHaveBeenCalledTimes(1))
    expect(screen.getByText('Account created. Welcome alice.')).toBeInTheDocument()
  })
})
