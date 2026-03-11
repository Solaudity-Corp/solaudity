import { css } from 'styled-system/css'

export const darkMenuContentClass = css({
  minW: '40',
  p: '1.5',
  borderRadius: '10px',
  border: '1px solid rgba(185, 185, 189, 0.22)',
  bg: 'rgba(17, 17, 22, 0.98)',
  backdropFilter: 'blur(8px)',
  boxShadow: '0 10px 24px rgba(0, 0, 0, 0.45)',
})

export const darkMenuItemClass = css({
  px: '3',
  py: '2',
  borderRadius: '8px',
  color: 'rgba(231, 228, 239, 0.9)',
  fontSize: 'sm',
  lineHeight: '1.4',
  cursor: 'pointer',
  _hover: {
    bg: 'rgba(42, 42, 50, 0.92)',
    color: 'rgba(243, 241, 248, 0.98)',
  },
  _highlighted: {
    bg: 'rgba(42, 42, 50, 0.92)',
    color: 'rgba(243, 241, 248, 0.98)',
  },
  _focusVisible: {
    bg: 'rgba(42, 42, 50, 0.92)',
    color: 'rgba(243, 241, 248, 0.98)',
  },
})

export const disconnectMenuItemClass = css({
  px: '3',
  py: '2',
  borderRadius: '8px',
  color: 'rgba(255, 78, 78, 0.9)',
  fontSize: 'sm',
  lineHeight: '1.4',
  cursor: 'pointer',
  _hover: {
    bg: 'rgba(255, 78, 78, 0.1)',
    color: 'rgba(255, 100, 100, 1)',
  },
  _highlighted: {
    bg: 'rgba(255, 78, 78, 0.1)',
    color: 'rgba(255, 100, 100, 1)',
  },
  _focusVisible: {
    bg: 'rgba(255, 78, 78, 0.1)',
    color: 'rgba(255, 100, 100, 1)',
  },
})

