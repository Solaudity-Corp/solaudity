import { useCallback, useEffect, useRef, useState } from 'react'
import { css } from 'styled-system/css'
import { Box, Flex } from 'styled-system/jsx'
import { ChevronLeft, ChevronRight } from 'lucide-react'

export type SlideTheme = 'violet' | 'green' | 'blue' | 'yellow'

interface SlideButtonProps {
    onComplete: () => void
    text?: string
    reversed?: boolean
    theme?: SlideTheme
}

// Completion state is always green — universal "navigating" signal
const DONE = {
    border:  'rgba(88,  214, 171, 0.45)',
    fill:    'rgba(88,  214, 171, 0.18)',
    thumb:   'rgba(88,  214, 171, 1)',
    shadow:  'rgba(88,  214, 171, 0.35)',
    label:   'rgba(88,  214, 171, 0.92)',
    icon:    '#08211a',
}

// Idle color palette per theme
const THEMES: Record<SlideTheme, { border: string; fill: string; thumb: string; shadow: string; icon: string }> = {
    violet: {
        border:  'rgba(168, 130, 255, 0.30)',
        fill:    'rgba(168, 130, 255, 0.12)',
        thumb:   'rgba(168, 130, 255, 0.92)',
        shadow:  'rgba(168, 130, 255, 0.28)',
        icon:    '#180a2e',
    },
    green: {
        border:  'rgba(88, 214, 171, 0.30)',
        fill:    'rgba(88, 214, 171, 0.12)',
        thumb:   'rgba(88, 214, 171, 0.92)',
        shadow:  'rgba(88, 214, 171, 0.28)',
        icon:    '#08211a',
    },
    blue: {
        border:  'rgba(88, 149, 255, 0.30)',
        fill:    'rgba(88, 149, 255, 0.12)',
        thumb:   'rgba(88, 149, 255, 0.92)',
        shadow:  'rgba(88, 149, 255, 0.28)',
        icon:    '#08152e',
    },
    yellow: {
        border:  'rgba(245, 200, 60, 0.32)',
        fill:    'rgba(245, 200, 60, 0.10)',
        thumb:   'rgba(245, 200, 60, 0.92)',
        shadow:  'rgba(245, 200, 60, 0.28)',
        icon:    '#1e1700',
    },
}

export default function SlideButton({ onComplete, text = 'Goto Scope', reversed = false, theme = 'violet' }: SlideButtonProps) {
    const [isDragging, setIsDragging] = useState(false)
    const [dragProgress, setDragProgress] = useState(0)
    const [isCompleted, setIsCompleted] = useState(false)
    const [isAnimating, setIsAnimating] = useState(false)

    const trackRef = useRef<HTMLDivElement>(null)
    const animFrameRef = useRef<number | null>(null)

    const TRACK_W = 260
    const THUMB_W = 44
    const MAX_DRAG = TRACK_W - THUMB_W - 8

    const T = THEMES[theme]
    const animName = `arriveGreen-${theme}`

    const complete = useCallback(() => {
        setDragProgress(1)
        setIsCompleted(true)
        onComplete()
    }, [onComplete])

    const triggerAutoSlide = () => {
        if (isCompleted || isAnimating || isDragging) return
        setIsAnimating(true)
        const startTime = performance.now()
        const duration = 380

        const animate = (now: number) => {
            const t = Math.min((now - startTime) / duration, 1)
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
        if (animFrameRef.current) {
            cancelAnimationFrame(animFrameRef.current)
            animFrameRef.current = null
            setIsAnimating(false)
            setDragProgress(0)
        }
        e.stopPropagation()
        setIsDragging(true)
    }

    const handleDragEnd = useCallback(() => {
        if (!isDragging || isCompleted) return
        setIsDragging(false)
        if (dragProgress >= 0.85) {
            complete()
        } else {
            setDragProgress(0)
        }
    }, [isDragging, isCompleted, dragProgress, complete])

    const handleDragMove = useCallback((clientX: number) => {
        if (!isDragging || isCompleted || !trackRef.current) return
        const trackRect = trackRef.current.getBoundingClientRect()
        const raw = reversed
            ? trackRect.right - clientX - THUMB_W / 2
            : clientX - trackRect.left - THUMB_W / 2
        setDragProgress(Math.max(0, Math.min(raw, MAX_DRAG)) / MAX_DRAG)
    }, [isDragging, isCompleted, reversed, THUMB_W, MAX_DRAG])

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
    }, [isDragging, handleDragEnd, handleDragMove])

    useEffect(() => {
        return () => { if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current) }
    }, [])

    const thumbOffset = dragProgress * MAX_DRAG
    const isMoving = isDragging || isAnimating

    return (
        <>
            <Box
                ref={trackRef}
                onClick={triggerAutoSlide}
                style={{
                    border: `1px solid ${isCompleted ? DONE.border : T.border}`,
                    transition: 'border-color 0.4s ease',
                }}
                className={css({
                    position: 'relative',
                    width: '260px',
                    height: '52px',
                    borderRadius: '8px',
                    bg: 'rgba(20, 20, 24, 0.85)',
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
                    style={{
                        position: 'absolute',
                        top: 0,
                        bottom: 0,
                        background: isCompleted ? DONE.fill : T.fill,
                        transition: isMoving ? 'none' : 'width 0.3s ease, background 0.4s ease',
                        width: `${THUMB_W + 8 + thumbOffset}px`,
                        ...(reversed ? { right: 0 } : { left: 0 }),
                    }}
                />

                {/* Label */}
                <Flex
                    align="center"
                    justify="center"
                    style={{
                        position: 'absolute',
                        inset: 0,
                        color: isCompleted ? DONE.label : 'rgba(231, 228, 239, 0.5)',
                        fontSize: '13px',
                        fontWeight: 600,
                        letterSpacing: '0.05em',
                        textTransform: 'uppercase',
                        transition: 'color 0.4s ease',
                        zIndex: 1,
                        pointerEvents: 'none',
                        ...(reversed ? { paddingRight: '52px' } : { paddingLeft: '52px' }),
                    }}
                >
                    {isCompleted ? 'Opening...' : text}
                </Flex>

                {/* Draggable Thumb */}
                <Flex
                    align="center"
                    justify="center"
                    onPointerDown={handleDragStart}
                    style={{
                        position: 'absolute',
                        top: '4px',
                        width: `${THUMB_W}px`,
                        height: `${THUMB_W}px`,
                        borderRadius: '6px',
                        background: isCompleted ? DONE.thumb : T.thumb,
                        color: isCompleted ? DONE.icon : T.icon,
                        cursor: isCompleted ? 'default' : isDragging ? 'grabbing' : 'grab',
                        boxShadow: isCompleted
                            ? `0 4px 14px ${DONE.shadow}, 0 0 20px rgba(88,214,171,0.25)`
                            : `0 4px 12px ${T.shadow}`,
                        zIndex: 2,
                        animation: isCompleted ? `${animName} 0.55s ease-out forwards` : 'none',
                        transition: isMoving ? 'none' : 'background 0.4s ease, box-shadow 0.4s ease',
                        ...(reversed ? { right: '4px' } : { left: '4px' }),
                        transform: reversed ? `translateX(${-thumbOffset}px)` : `translateX(${thumbOffset}px)`,
                    }}
                >
                    {!isCompleted && (
                        reversed
                            ? <ChevronLeft size={24} strokeWidth={3} />
                            : <ChevronRight size={24} strokeWidth={3} />
                    )}
                    {isCompleted && (
                        <Box style={{ width: '12px', height: '12px', borderRadius: '50%', background: DONE.icon }} />
                    )}
                </Flex>
            </Box>

            <style>{`
                @keyframes ${animName} {
                    0%   { box-shadow: 0 4px 12px ${T.shadow}, 0 0 0px rgba(88,214,171,0); background: ${T.thumb}; }
                    35%  { box-shadow: 0 4px 20px rgba(88,214,171,0.5),  0 0 32px rgba(88,214,171,0.35); background: rgba(120,230,200,0.95); }
                    70%  { box-shadow: 0 4px 16px rgba(88,214,171,0.42), 0 0 18px rgba(88,214,171,0.28); background: rgba(88,214,171,1); }
                    100% { box-shadow: 0 4px 14px rgba(88,214,171,0.35), 0 0 20px rgba(88,214,171,0.25); background: rgba(88,214,171,1); }
                }
            `}</style>
        </>
    )
}
