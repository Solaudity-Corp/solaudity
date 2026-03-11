import { useEffect, useRef, useState } from 'react'
import { css } from 'styled-system/css'
import { Box, Flex } from 'styled-system/jsx'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface SlideButtonProps {
    onComplete: () => void
    text?: string
    reversed?: boolean
}

export default function SlideButton({ onComplete, text = 'Goto Scope', reversed = false }: SlideButtonProps) {
    const [isDragging, setIsDragging] = useState(false)
    const [dragProgress, setDragProgress] = useState(0)
    const [isCompleted, setIsCompleted] = useState(false)
    const [isAnimating, setIsAnimating] = useState(false)

    const trackRef = useRef<HTMLDivElement>(null)
    const animFrameRef = useRef<number | null>(null)

    const TRACK_W = 260
    const THUMB_W = 44
    const MAX_DRAG = TRACK_W - THUMB_W - 8

    const complete = () => {
        setDragProgress(1)
        setIsCompleted(true)
        onComplete()
    }

    // Auto-slide animation (triggered on click)
    const triggerAutoSlide = () => {
        if (isCompleted || isAnimating || isDragging) return
        setIsAnimating(true)
        const startTime = performance.now()
        const duration = 380

        const animate = (now: number) => {
            const t = Math.min((now - startTime) / duration, 1)
            // ease-out cubic
            const eased = 1 - Math.pow(1 - t, 3)
            setDragProgress(eased)
            if (t < 1) {
                animFrameRef.current = requestAnimationFrame(animate)
            } else {
                setIsAnimating(false)
                complete()
            }
        }
        animFrameRef.current = requestAnimationFrame(animate)
    }

    const handleDragStart = (e: React.PointerEvent) => {
        if (isCompleted || isAnimating) return
        // Cancel any running auto-animation
        if (animFrameRef.current) {
            cancelAnimationFrame(animFrameRef.current)
            animFrameRef.current = null
            setIsAnimating(false)
            setDragProgress(0)
        }
        e.stopPropagation()
        setIsDragging(true)
    }

    const handleDragEnd = () => {
        if (!isDragging || isCompleted) return
        setIsDragging(false)
        if (dragProgress >= 0.85) {
            complete()
        } else {
            setDragProgress(0)
        }
    }

    const handleDragMove = (clientX: number) => {
        if (!isDragging || isCompleted || !trackRef.current) return
        const trackRect = trackRef.current.getBoundingClientRect()
        const raw = reversed
            ? trackRect.right - clientX - THUMB_W / 2
            : clientX - trackRect.left - THUMB_W / 2
        setDragProgress(Math.max(0, Math.min(raw, MAX_DRAG)) / MAX_DRAG)
    }

    useEffect(() => {
        const onPointerMove = (e: PointerEvent) => { if (isDragging) handleDragMove(e.clientX) }
        const onPointerUp = () => { if (isDragging) handleDragEnd() }
        if (isDragging) {
            window.addEventListener('pointermove', onPointerMove)
            window.addEventListener('pointerup', onPointerUp)
            window.addEventListener('pointercancel', onPointerUp)
        }
        return () => {
            window.removeEventListener('pointermove', onPointerMove)
            window.removeEventListener('pointerup', onPointerUp)
            window.removeEventListener('pointercancel', onPointerUp)
        }
    }, [isDragging, dragProgress])

    useEffect(() => {
        return () => { if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current) }
    }, [])

    const thumbOffset = dragProgress * MAX_DRAG
    const isMoving = isDragging || isAnimating

    return (
        <Box
            ref={trackRef}
            onClick={triggerAutoSlide}
            className={css({
                position: 'relative',
                width: '260px',
                height: '52px',
                borderRadius: '8px',
                bg: 'rgba(20, 20, 24, 0.8)',
                border: '1px solid rgba(88, 214, 171, 0.2)',
                overflow: 'hidden',
                boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.2)',
                userSelect: 'none',
                touchAction: 'none',
                flexShrink: 0,
                cursor: isCompleted ? 'default' : 'pointer',
            })}
        >
            {/* Fill background */}
            <Box
                className={css({
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    bg: 'rgba(88, 214, 171, 0.15)',
                    ...(reversed ? { right: 0 } : { left: 0 }),
                })}
                style={{
                    width: `${THUMB_W + 8 + thumbOffset}px`,
                    transition: isMoving ? 'none' : 'width 0.3s ease',
                }}
            />

            {/* Label */}
            <Flex
                align="center"
                justify="center"
                className={css({
                    position: 'absolute',
                    inset: 0,
                    color: isCompleted ? 'rgba(88, 214, 171, 0.9)' : 'rgba(231, 228, 239, 0.5)',
                    fontSize: 'sm',
                    fontWeight: '600',
                    letterSpacing: '0.05em',
                    textTransform: 'uppercase',
                    transition: 'color 0.3s',
                    zIndex: 1,
                    pointerEvents: 'none',
                    ...(reversed ? { paddingRight: '52px' } : { paddingLeft: '52px' }),
                })}
            >
                {isCompleted ? 'Opening...' : text}
            </Flex>

            {/* Draggable Thumb */}
            <Flex
                align="center"
                justify="center"
                onPointerDown={handleDragStart}
                className={css({
                    position: 'absolute',
                    top: '4px',
                    width: `${THUMB_W}px`,
                    height: `${THUMB_W}px`,
                    borderRadius: '6px',
                    bg: isCompleted ? 'rgba(88, 214, 171, 1)' : 'rgba(88, 214, 171, 0.95)',
                    color: '#08211a',
                    cursor: isCompleted ? 'default' : isDragging ? 'grabbing' : 'grab',
                    boxShadow: '0 4px 12px rgba(88, 214, 171, 0.25)',
                    zIndex: 2,
                    ...(reversed ? { right: '4px' } : { left: '4px' }),
                })}
                style={{
                    transition: isMoving ? 'none' : 'transform 0.3s ease',
                    transform: reversed ? `translateX(${-thumbOffset}px)` : `translateX(${thumbOffset}px)`,
                }}
            >
                {reversed
                    ? <ChevronLeft size={24} strokeWidth={3} style={{ opacity: isCompleted ? 0 : 1 }} />
                    : <ChevronRight size={24} strokeWidth={3} style={{ opacity: isCompleted ? 0 : 1 }} />
                }
                {isCompleted && (
                    <Box className={css({ width: '12px', height: '12px', borderRadius: '50%', bg: '#08211a' })} />
                )}
            </Flex>
        </Box>
    )
}
