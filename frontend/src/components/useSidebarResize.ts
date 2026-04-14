import { useCallback, useRef, useState } from 'react'

const COLLAPSED_W = 32

interface UseSidebarResizeOptions {
  defaultWidth?: number
  min?: number
  max?: number
  defaultOpen?: boolean
}

export function useSidebarResize({
  defaultWidth = 220,
  min = 140,
  max = 500,
  defaultOpen = true,
}: UseSidebarResizeOptions = {}) {
  const [sidebarWidth, setSidebarWidth] = useState(defaultWidth)
  const [sidebarOpen, setSidebarOpen] = useState(defaultOpen)
  const [isResizing, setIsResizing] = useState(false)
  const isDragging = useRef(false)
  const dragStartX = useRef(0)
  const dragStartWidth = useRef(0)

  const handleResizerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!sidebarOpen) return
      e.preventDefault()
      isDragging.current = true
      dragStartX.current = e.clientX
      dragStartWidth.current = sidebarWidth
      setIsResizing(true)

      const onMouseMove = (ev: MouseEvent) => {
        if (!isDragging.current) return
        setSidebarWidth(
          Math.max(min, Math.min(max, dragStartWidth.current + ev.clientX - dragStartX.current)),
        )
      }
      const onMouseUp = () => {
        isDragging.current = false
        setIsResizing(false)
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
      }
      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    },
    [sidebarOpen, sidebarWidth, min, max],
  )

  const effectiveWidth = sidebarOpen ? sidebarWidth : COLLAPSED_W

  return {
    sidebarWidth,
    effectiveWidth,
    sidebarOpen,
    setSidebarOpen,
    isResizing,
    handleResizerMouseDown,
    COLLAPSED_W,
  }
}
