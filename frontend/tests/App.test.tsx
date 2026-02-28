import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App'

const authMocks = vi.hoisted(() => ({
  hasAccessToken: vi.fn(),
}))

vi.mock('../src/auth', () => ({
  hasAccessToken: authMocks.hasAccessToken,
}))

vi.mock('../src/Login', () => ({
  default: ({
    onLoginSuccess,
    onNavigateRegister,
  }: {
    onLoginSuccess: () => void
    onNavigateRegister: () => void
  }) => (
    <div>
      <div>login-page</div>
      <button type="button" onClick={onLoginSuccess}>login-success</button>
      <button type="button" onClick={onNavigateRegister}>go-register</button>
    </div>
  ),
}))

vi.mock('../src/Register', () => ({
  default: ({
    onRegisterSuccess,
    onNavigateLogin,
  }: {
    onRegisterSuccess: () => void
    onNavigateLogin: () => void
  }) => (
    <div>
      <div>register-page</div>
      <button type="button" onClick={onRegisterSuccess}>register-success</button>
      <button type="button" onClick={onNavigateLogin}>go-login</button>
    </div>
  ),
}))

vi.mock('../src/Menu', () => ({
  default: ({
    path,
    onOpenProfile,
  }: {
    path: string
    onOpenProfile: () => void
  }) => (
    <div>
      <div>menu-page:{path}</div>
      <button type="button" onClick={onOpenProfile}>open-profile</button>
    </div>
  ),
}))

vi.mock('../src/Profile', () => ({
  default: ({
    onNavigateMenu,
  }: {
    onNavigateMenu: (path: '/menu/audits') => void
  }) => (
    <div>
      <div>profile-page</div>
      <button type="button" onClick={() => onNavigateMenu('/menu/audits')}>back-to-menu</button>
    </div>
  ),
}))

describe('App', () => {
  beforeEach(() => {
    authMocks.hasAccessToken.mockReset()
    window.history.replaceState(null, '', '/')
  })

  it('redirects unauthenticated users to login from protected paths', async () => {
    authMocks.hasAccessToken.mockReturnValue(false)
    window.history.replaceState(null, '', '/profile')

    render(<App />)

    expect(screen.getByText('login-page')).toBeInTheDocument()
    await waitFor(() => expect(window.location.pathname).toBe('/login'))
  })

  it('redirects authenticated users away from login to the audits menu', async () => {
    authMocks.hasAccessToken.mockReturnValue(true)
    window.history.replaceState(null, '', '/login')

    render(<App />)

    await waitFor(() => expect(screen.getByText('menu-page:/menu/audits')).toBeInTheDocument())
    expect(window.location.pathname).toBe('/menu/audits')
  })

  it('navigates through auth success and profile actions', async () => {
    authMocks.hasAccessToken.mockReturnValue(false)
    window.history.replaceState(null, '', '/login')

    render(<App />)

    fireEvent.click(screen.getByText('login-success'))
    await waitFor(() => expect(screen.getByText('menu-page:/menu/audits')).toBeInTheDocument())

    fireEvent.click(screen.getByText('open-profile'))
    await waitFor(() => expect(screen.getByText('profile-page')).toBeInTheDocument())

    fireEvent.click(screen.getByText('back-to-menu'))
    await waitFor(() => expect(screen.getByText('menu-page:/menu/audits')).toBeInTheDocument())
  })

  it('allows navigation from register back to login', async () => {
    authMocks.hasAccessToken.mockReturnValue(false)
    window.history.replaceState(null, '', '/register')

    render(<App />)

    expect(screen.getByText('register-page')).toBeInTheDocument()
    fireEvent.click(screen.getByText('go-login'))

    await waitFor(() => expect(screen.getByText('login-page')).toBeInTheDocument())
    expect(window.location.pathname).toBe('/login')
  })
})
