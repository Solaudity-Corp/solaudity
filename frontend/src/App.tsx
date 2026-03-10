import { useCallback, useEffect, useState } from 'react'
import { hasAccessToken } from './auth'
import Login from './Login'
import Menu, { type MenuPath } from './Menu'
import Profile from './Profile'
import Register from './Register'

type AppPath = '/login' | '/register' | '/profile' | MenuPath

function normalizePathname(pathname: string): AppPath {
  const normalized = pathname.toLowerCase()

  if (normalized === '/' || normalized === '/login') return '/login'
  if (normalized === '/register') return '/register'
  if (normalized === '/profile') return '/profile'
  if (normalized === '/menu' || normalized === '/menu/') return '/menu/audits'
  if (normalized === '/menu/audits') return '/menu/audits'
  if (normalized === '/menu/reports') return '/menu/reports'
  if (normalized === '/menu/activity') return '/menu/activity'

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
    navigate('/menu/audits', true)
  }

  // Auth guard: redirect during render (React-approved setState-during-render pattern)
  if (!isAuthenticated && pathname !== '/login' && pathname !== '/register') {
    window.history.replaceState(null, '', '/login')
    setPathname('/login')
    return null
  }
  if (isAuthenticated && (pathname === '/login' || pathname === '/register')) {
    window.history.replaceState(null, '', '/menu/audits')
    setPathname('/menu/audits')
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

  return (
    <Menu
      path={pathname as MenuPath}
      onNavigate={(nextPath) => navigate(nextPath)}
      onOpenProfile={() => navigate('/profile')}
    />
  )
}
