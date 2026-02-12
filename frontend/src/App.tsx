import { useEffect, useState } from 'react'
import Login from './Login'
import Menu, { type MenuPath } from './Menu'

type AppPath = '/login' | MenuPath

function normalizePathname(pathname: string): AppPath {
  const normalized = pathname.toLowerCase()

  if (normalized === '/' || normalized === '/login') return '/login'
  if (normalized === '/menu' || normalized === '/menu/') return '/menu/audits'
  if (normalized === '/menu/audits') return '/menu/audits'
  if (normalized === '/menu/reports') return '/menu/reports'
  if (normalized === '/menu/activity') return '/menu/activity'

  return '/login'
}

export default function App() {
  const [pathname, setPathname] = useState<AppPath>(() => normalizePathname(window.location.pathname))

  const navigate = (nextPath: AppPath, replace = false) => {
    if (pathname === nextPath) return

    if (replace) {
      window.history.replaceState(null, '', nextPath)
    } else {
      window.history.pushState(null, '', nextPath)
    }

    setPathname(nextPath)
  }

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
    }

    window.addEventListener('popstate', onPopState)
    return () => {
      window.removeEventListener('popstate', onPopState)
    }
  }, [])

  if (pathname !== '/login') {
    return <Menu path={pathname as MenuPath} onNavigate={(nextPath) => navigate(nextPath)} />
  }

  return <Login />
}
