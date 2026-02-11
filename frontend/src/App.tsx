import { useEffect, useState } from 'react'
import Login from './Login'
import Menu from './Menu'

function getPathname() {
  return window.location.pathname.toLowerCase()
}

export default function App() {
  const [pathname, setPathname] = useState(getPathname())

  useEffect(() => {
    const onPopState = () => {
      setPathname(getPathname())
    }

    window.addEventListener('popstate', onPopState)
    return () => {
      window.removeEventListener('popstate', onPopState)
    }
  }, [])

  useEffect(() => {
    if (pathname === '/') {
      window.history.replaceState(null, '', '/login')
      setPathname('/login')
      return
    }

    if (pathname !== '/login' && pathname !== '/menu') {
      window.history.replaceState(null, '', '/login')
      setPathname('/login')
    }
  }, [pathname])

  if (pathname === '/menu') {
    return <Menu />
  }

  return <Login />
}
