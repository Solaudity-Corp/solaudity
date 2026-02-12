import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { css, cx } from 'styled-system/css'

interface AccentLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'children'> {
  children: ReactNode
}

const logoGradient =
  'linear-gradient(90deg, #858489 0%, #e7e4ef 28%, #858489 52%, #b9b9b9 72%, #858489 100%)'

const baseClass = css({
  color: '#f0edf7',
  textDecoration: 'none',
  position: 'relative',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '1',
  maxW: '100%',
  overflowWrap: 'anywhere',
  wordBreak: 'break-word',
  transition: 'color 140ms ease',
  '&::after': {
    content: '""',
    position: 'absolute',
    left: '0',
    right: '0',
    bottom: '-2px',
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

export function AccentLink({ children, className, target, rel, ...props }: AccentLinkProps) {
  return (
    <a
      className={cx(baseClass, className)}
      target={target ?? '_blank'}
      rel={rel ?? 'noopener noreferrer'}
      {...props}
    >
      {children}
    </a>
  )
}
