import { comboboxAnatomy } from '@ark-ui/react/anatomy'
import { defineSlotRecipe } from '@pandacss/dev'

// Styled to match the existing `menu` recipe so the model picker feels native
// to the app's Park UI design system (same surface, radii, motion, hover).
export const combobox = defineSlotRecipe({
  className: 'combobox',
  slots: comboboxAnatomy.keys(),
  base: {
    root: {
      display: 'flex',
      flexDirection: 'column',
      gap: '1.5',
      width: 'full',
    },
    label: {
      color: 'fg.subtle',
      fontWeight: 'medium',
      fontSize: 'sm',
    },
    control: {
      position: 'relative',
      width: 'full',
    },
    trigger: {
      position: 'absolute',
      right: '2.5',
      top: '50%',
      transform: 'translateY(-50%)',
      display: 'grid',
      placeItems: 'center',
      color: 'fg.subtle',
      cursor: 'pointer',
      _focusVisible: { focusVisibleRing: 'outside' },
    },
    clearTrigger: {
      position: 'absolute',
      right: '9',
      top: '50%',
      transform: 'translateY(-50%)',
      display: 'grid',
      placeItems: 'center',
      color: 'fg.subtle',
      cursor: 'pointer',
    },
    content: {
      '--combobox-z-index': 'zIndex.dropdown',
      bg: 'gray.surface.bg',
      borderRadius: 'l3',
      boxShadow: 'md',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.5',
      p: '1',
      maxH: 'min(var(--available-height), {sizes.80})',
      minW: 'var(--reference-width)',
      outline: '0',
      overflowY: 'auto',
      zIndex: 'calc(var(--combobox-z-index) + var(--layer-index, 0))',
      _open: {
        animationStyle: 'slide-fade-in',
        animationDuration: 'fast',
      },
      _closed: {
        animationStyle: 'slide-fade-out',
        animationDuration: 'faster',
      },
    },
    list: {
      display: 'flex',
      flexDirection: 'column',
      gap: '0.5',
    },
    itemGroup: {
      display: 'flex',
      flexDirection: 'column',
      gap: '0.5',
    },
    itemGroupLabel: {
      color: 'fg.subtle',
      fontSize: 'xs',
      fontWeight: 'semibold',
      letterSpacing: 'wider',
      textTransform: 'uppercase',
      px: '2',
      pt: '1.5',
      pb: '1',
    },
    item: {
      alignItems: 'center',
      borderRadius: 'l2',
      cursor: 'pointer',
      display: 'flex',
      justifyContent: 'space-between',
      gap: '2',
      px: '2',
      minH: '9',
      fontSize: 'sm',
      userSelect: 'none',
      _highlighted: {
        bg: 'gray.surface.bg.hover',
      },
      _disabled: {
        layerStyle: 'disabled',
      },
    },
    itemText: {
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    },
    itemIndicator: {
      display: 'flex',
      flex: '0 0 auto',
      color: 'fg.default',
      _icon: { boxSize: '4' },
    },
  },
})
