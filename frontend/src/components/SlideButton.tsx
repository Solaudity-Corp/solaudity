import { useEffect, useRef, useState } from 'react'
import { css } from 'styled-system/css'
import { Box, Flex } from 'styled-system/jsx'
import { ChevronRight } from 'lucide-react'

interface SlideButtonProps {
    onComplete: () => void
    text?: string
}

export default function SlideButton({ onComplete, text = 'Goto Scope' }: SlideButtonProps) {
    const [isDragging, setIsDragging] = useState(false)
    const [dragProgress, setDragProgress] = useState(0) // 0 to 1
    const [isCompleted, setIsCompleted] = useState(false)

    const trackRef = useRef<HTMLDivElement>(null)
    const thumbRef = useRef<HTMLDivElement>(null)

    const handleDragStart = () => {
        if (isCompleted) return
        setIsDragging(true)
    }

    const handleDragEnd = () => {
        if (!isDragging || isCompleted) return
        setIsDragging(false)

        // If we dragged past 90%, snap to complete
        if (dragProgress >= 0.85) {
            setDragProgress(1)
            setIsCompleted(true)
            onComplete()
        } else {
            // Otherwise snap back
            setDragProgress(0)
        }
    }

    const handleDragMove = (clientX: number) => {
        if (!isDragging || isCompleted || !trackRef.current || !thumbRef.current) return

        const trackRect = trackRef.current.getBoundingClientRect()
        const thumbWidth = thumbRef.current.offsetWidth

        // Calculate how far we can actually drag (track width - thumb width)
        const maxDragX = trackRect.width - thumbWidth

        // Calculate current drag X relative to track start
        let currentX = clientX - trackRect.left - (thumbWidth / 2)

        // Clamp between 0 and maxDragX
        currentX = Math.max(0, Math.min(currentX, maxDragX))

        // Convert to 0-1 progress
        const progress = currentX / maxDragX
        setDragProgress(progress)
    }

    useEffect(() => {
        const onPointerMove = (e: PointerEvent) => {
            if (isDragging) handleDragMove(e.clientX)
        }
        const onPointerUp = () => {
            if (isDragging) handleDragEnd()
        }

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

    // Optional styling logic
    const thumbSize = 44
    const borderRadius = 22

    return (
        <Box
            ref={trackRef}
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
                touchAction: 'none'
            })}
        >
            {/* Dynamic Background that fills as you drag */}
            <Box
                className={css({
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    bottom: 0,
                    bg: 'rgba(88, 214, 171, 0.15)',
                    transition: isDragging ? 'none' : 'width 0.3s ease',
                })}
                style={{ width: `calc(52px + ${dragProgress * 100}%)` }} // 52px is thumb start area
            />

            {/* Background Text visible through */}
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
                    paddingLeft: '32px', // offset for thumb
                    transition: 'color 0.3s',
                    zIndex: 1,
                })}
            >
                {isCompleted ? 'Opening...' : text}
            </Flex>

            {/* Draggable Thumb */}
            <Flex
                ref={thumbRef}
                align="center"
                justify="center"
                onPointerDown={handleDragStart}
                className={css({
                    position: 'absolute',
                    top: '4px',
                    left: '4px',
                    width: '44px',
                    height: '44px',
                    borderRadius: '6px',
                    bg: isCompleted ? 'rgba(88, 214, 171, 1)' : 'rgba(88, 214, 171, 0.95)',
                    color: '#08211a',
                    cursor: isCompleted ? 'default' : 'grab',
                    _active: { cursor: isCompleted ? 'default' : 'grabbing' },
                    boxShadow: '0 4px 12px rgba(88, 214, 171, 0.25)',
                    transition: isDragging ? 'none' : 'transform 0.3s ease',
                    zIndex: 2,
                })}
                style={{
                    transform: `translateX(calc(${dragProgress} * (260px - 52px)))`,
                }}
            >
                <ChevronRight size={24} strokeWidth={3} className={css({
                    transform: isDragging ? 'scale(1.1)' : 'scale(1)',
                    transition: 'transform 0.2s',
                    opacity: isCompleted ? 0 : 1
                })} />
                {isCompleted && (
                    <Box className={css({
                        width: '12px',
                        height: '12px',
                        borderRadius: '50%',
                        bg: '#08211a'
                    })} />
                )}
            </Flex>
        </Box>
    )
}
