import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Login from '../src/Login'

const authMocks = vi.hoisted(() => ({
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
  }
})

describe('Login', () => {
  beforeEach(() => {
    authMocks.loginUser.mockReset()
  })

  it('shows a validation message when required fields are missing', async () => {
    render(
      <Login
        onLoginSuccess={vi.fn()}
        onNavigateRegister={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByText('Please enter both username/email and password.')).toBeInTheDocument()
    expect(authMocks.loginUser).not.toHaveBeenCalled()
  })

  it('submits valid credentials and notifies the parent on success', async () => {
    const onLoginSuccess = vi.fn()
    authMocks.loginUser.mockResolvedValue({ access_token: 'jwt-token', token_type: 'bearer' })

    render(
      <Login
        onLoginSuccess={onLoginSuccess}
        onNavigateRegister={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText('Username or Email'), {
      target: { value: 'alice' },
    })
    fireEvent.change(screen.getByPlaceholderText('Password'), {
      target: { value: 'StrongPass1' },
    })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => expect(authMocks.loginUser).toHaveBeenCalledWith('alice', 'StrongPass1'))
    await waitFor(() => expect(onLoginSuccess).toHaveBeenCalledTimes(1))
    expect(screen.getByText('Welcome alice.')).toBeInTheDocument()
  })
})
