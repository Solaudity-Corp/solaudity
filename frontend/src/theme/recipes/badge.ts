import { defineRecipe } from '@pandacss/dev'

export const badge = defineRecipe({
  className: 'badge',
  jsx: ['Badge'],
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    px: '2.5',
    py: '1',
    borderRadius: 'md',
    fontSize: 'xs',
    fontWeight: '600',
    lineHeight: '1',
    whiteSpace: 'nowrap',
  },
  defaultVariants: {
    colorPalette: 'gray',
    size: 'sm',
  },
  variants: {
    colorPalette: {
      gray: {
        bg: 'rgba(185, 185, 189, 0.16)',
        color: 'rgba(234, 234, 239, 0.92)',
      },
      green: {
        bg: 'rgba(48, 164, 108, 0.2)',
        color: 'rgba(150, 247, 205, 0.98)',
      },
      orange: {
        bg: 'rgba(249, 115, 22, 0.2)',
        color: 'rgba(255, 198, 141, 0.98)',
      },
      purple: {
        bg: 'rgba(168, 85, 247, 0.2)',
        color: 'rgba(221, 181, 255, 0.98)',
      },
      red: {
        bg: 'rgba(229, 72, 77, 0.2)',
        color: 'rgba(255, 174, 180, 0.98)',
      },
    },
    size: {
      sm: {
        fontSize: 'xs',
      },
      md: {
        fontSize: 'sm',
        px: '3',
        py: '1.5',
      },
    },
  },
})
