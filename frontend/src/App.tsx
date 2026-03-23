import { useCallback, useEffect, useState } from 'react'
import { hasAccessToken } from './auth'
import Login from './Login'
import Menu, { type MenuPath } from './Menu'
import Profile from './Profile'
import Register from './Register'
import ScopeWorkspace from './scope/ScopeWorkspace'
import { EnumWorkspace } from './enum/EnumWorkspace'

type AppPath = string // Support dynamic paths like /scope/:auditId and /enum/:auditId

function normalizePathname(pathname: string): AppPath {
  const normalized = pathname.toLowerCase()

  if (normalized === '/' || normalized === '/login') return '/login'
  if (normalized === '/register') return '/register'
  if (normalized === '/profile') return '/profile'
  if (normalized === '/menu' || normalized === '/menu/') return '/menu/dashboard'
  if (normalized === '/menu/dashboard') return '/menu/dashboard'
  if (normalized === '/menu/audits') return '/menu/audits'
  if (normalized === '/menu/reports') return '/menu/reports'
  if (normalized === '/menu/activity') return '/menu/activity'

  if (normalized.startsWith('/scope/')) return pathname
  if (normalized.startsWith('/enum/')) return pathname

  return '/login'
}

export default function App() {
  const [pathname, setPathname] = useState<AppPath>(() => normalizePathname(window.location.pathname))
  const [isAuthenticated, setIsAuthenticated] = useState(() => hasAccessToken())

  const navigate = useCallback((nextPath: AppPath, replace = false) => {
    setPathname((current) => {
      if (current === nextPath) return current
      if (replace) {
        window.history.replaceState(null, '', nextPath)
      } else {
        window.history.pushState(null, '', nextPath)
      }
      return nextPath
    })
  }, [])

  useEffect(() => {
    const normalizedPath = normalizePathname(window.location.pathname)
    if (window.location.pathname.toLowerCase() !== normalizedPath) {
      window.history.replaceState(null, '', normalizedPath)
    }

    const onPopState = () => {
      const nextPath = normalizePathname(window.location.pathname)
      if (window.location.pathname.toLowerCase() !== nextPath) {
        window.history.replaceState(null, '', nextPath)
      }
      setPathname(nextPath)
      setIsAuthenticated(hasAccessToken())
    }

    window.addEventListener('popstate', onPopState)
    return () => {
      window.removeEventListener('popstate', onPopState)
    }
  }, [navigate])

  const handleAuthSuccess = () => {
    setIsAuthenticated(true)
    navigate('/menu/dashboard', true)
  }

  // Auth guard
  if (!isAuthenticated && pathname !== '/login' && pathname !== '/register') {
    window.history.replaceState(null, '', '/login')
    setPathname('/login')
    return null
  }
  if (isAuthenticated && (pathname === '/login' || pathname === '/register' || pathname === '/')) {
    window.history.replaceState(null, '', '/menu/dashboard')
    setPathname('/menu/dashboard')
    return null
  }

  if (pathname === '/register') {
    return (
      <Register
        onRegisterSuccess={handleAuthSuccess}
        onNavigateLogin={() => navigate('/login')}
      />
    )
  }

  if (pathname === '/login') {
    return (
      <Login
        onLoginSuccess={handleAuthSuccess}
        onNavigateRegister={() => navigate('/register')}
      />
    )
  }

  if (pathname === '/profile') {
    return (
      <Profile
        onNavigateMenu={(nextPath) => navigate(nextPath)}
        onOpenProfile={() => navigate('/profile')}
      />
    )
  }

  if (pathname.startsWith('/scope/')) {
    const auditId = pathname.split('/')[2]
    return (
      <ScopeWorkspace
        auditId={auditId}
        onNavigate={(nextPath: string) => navigate(nextPath)}
        onOpenProfile={() => navigate('/profile')}
      />
    )
  }

  if (pathname.startsWith('/enum/')) {
    const auditId = pathname.split('/')[2]
    return (
      <EnumWorkspace
        auditId={auditId}
        onNavigate={(nextPath: string) => navigate(nextPath)}
        onOpenProfile={() => navigate('/profile')}
      />
    )
  }

  return (
    <Menu
      path={pathname as MenuPath}
      onNavigate={(nextPath) => navigate(nextPath)}
      onOpenProfile={() => navigate('/profile')}
    />
  )
}
