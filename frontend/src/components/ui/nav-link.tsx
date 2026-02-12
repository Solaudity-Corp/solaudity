import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { css, cx } from 'styled-system/css'

interface NavLinkProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  children: ReactNode
  active?: boolean
}

const logoGradient =
  'linear-gradient(90deg, #858489 0%, #e7e4ef 28%, #858489 52%, #b9b9b9 72%, #858489 100%)'

const baseClass = css({
  background: 'transparent',
  border: 'none',
  fontFamily: 'inherit',
  fontSize: 'sm',
  lineHeight: '1.5',
  fontWeight: '500',
  cursor: 'pointer',
  position: 'relative',
  pb: '0.5',
  px: '0.5',
  color: 'rgba(231, 228, 239, 0.67)',
  transition: 'color 140ms ease, opacity 140ms ease',
  outline: 'none',
  '&::after': {
    content: '""',
    position: 'absolute',
    left: '0.5',
    right: '0.5',
    bottom: '0',
    height: '1px',
    backgroundImage: logoGradient,
    transform: 'scaleX(0)',
    transformOrigin: 'left center',
    transition: 'transform 160ms ease',
  },
  '&:hover, &:focus-visible': {
    color: 'transparent',
    backgroundImage: logoGradient,
    backgroundClip: 'text',
  },
  '&:hover::after, &:focus-visible::after': {
    transform: 'scaleX(1)',
  },
})

const activeClass = css({
  color: 'rgba(231, 228, 239, 0.92)',
  '&::after': {
    transform: 'scaleX(1)',
  },
})

export function NavLink({ children, active = false, className, ...props }: NavLinkProps) {
  return (
    <button type="button" className={cx(baseClass, active && activeClass, className)} {...props}>
      {children}
    </button>
  )
}
