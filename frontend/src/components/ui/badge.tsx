import { ark } from '@ark-ui/react'
import type { ComponentProps } from 'react'
import { styled } from 'styled-system/jsx'
import { type BadgeVariantProps, badge } from 'styled-system/recipes'

export interface BadgeProps extends ComponentProps<typeof Badge>, BadgeVariantProps {}
export const Badge = styled(ark.span, badge)
