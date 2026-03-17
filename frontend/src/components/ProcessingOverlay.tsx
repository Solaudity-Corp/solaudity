import { useEffect, useRef, useState } from 'react'
import { css } from 'styled-system/css'
import { Box } from 'styled-system/jsx'

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=<>?{}[]|~'
const HOVER_TEXTS = ['S3cAuditX', 'RugTr4ceX', 'TxW4tch3r', 'Bl0ckGu4d', 'Sn1ffCh41n']
const BASE_TEXT = 'S0lAudity'

function randomGlyph() {
  return GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
}

function easeOutCubic(v: number) {
  return 1 - Math.pow(1 - v, 3)
}

function AnimatedLogo() {
  const [displayText, setDisplayText] = useState(BASE_TEXT)
  const rafRef = useRef<number | null>(null)
  const phraseIndexRef = useRef(0)

  const animateTo = (target: string, durationMs: number, onComplete?: () => void) => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)

    const startAt = performance.now()
    const targetChars = target.split('')

    const frame = (now: number) => {
      const elapsed = now - startAt
      const progress = Math.min(1, elapsed / durationMs)
      const eased = easeOutCubic(progress)
      const revealCount = Math.floor(targetChars.length * eased)

      const animated = targetChars.map((finalChar, i) => {
        if (finalChar === ' ') return ' '
        return i < revealCount ? finalChar : randomGlyph()
      }).join('')

      setDisplayText(animated)

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(frame)
        return
      }

      setDisplayText(target)
      rafRef.current = null
      onComplete?.()
    }

    rafRef.current = requestAnimationFrame(frame)
  }

  useEffect(() => {
    let stopped = false
    let timeoutId: ReturnType<typeof setTimeout>

    const cycle = () => {
      if (stopped) return
      const nextPhrase = HOVER_TEXTS[phraseIndexRef.current % HOVER_TEXTS.length]
      phraseIndexRef.current++

      animateTo(nextPhrase, 600, () => {
        if (stopped) return
        timeoutId = setTimeout(() => {
          if (stopped) return
          animateTo(BASE_TEXT, 500, () => {
            if (stopped) return
            timeoutId = setTimeout(cycle, 400)
          })
        }, 600)
      })
    }

    cycle()

    return () => {
      stopped = true
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      clearTimeout(timeoutId)
    }
  }, [])

  const width = 480
  const height = 130
  const fontSize = Math.min(height * 0.6, width * 0.16)
  const centerX = width / 2
  const baselineY = height * 0.664
  const underlineThickness = Math.max(2, fontSize * 0.08)
  const underlineOffset = fontSize * 0.1

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-label="Processing…">
      <defs>
        <linearGradient id="process-grad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#a6a6a6" />
          <stop offset="100%" stopColor="#ffffff" />
        </linearGradient>
      </defs>
      <rect width={width} height={height} rx={0} fill="transparent" />
      <text
        x={centerX}
        y={baselineY}
        fill="url(#process-grad)"
        fontFamily="'Roboto Mono', ui-monospace, monospace"
        fontSize={fontSize}
        fontWeight={800}
        letterSpacing="-0.03em"
        textAnchor="middle"
        dominantBaseline="alphabetic"
        textDecoration="underline"
        style={{
          textDecorationColor: '#a6a6a6',
          textDecorationThickness: `${underlineThickness}px`,
          textUnderlineOffset: `${underlineOffset}px`,
          textDecorationSkipInk: 'auto',
        }}
      >
        {displayText}
      </text>
    </svg>
  )
}

export function ProcessingOverlay() {
  return (
    <Box
      className={css({
        position: 'fixed',
        inset: '0',
        zIndex: '50',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backdropFilter: 'blur(16px)',
        bg: 'rgba(10, 10, 14, 0.72)',
      })}
    >
      <AnimatedLogo />
      <Box
        className={css({
          mt: '2',
          color: 'rgba(231, 228, 239, 0.45)',
          fontSize: 'sm',
          fontFamily: "'Roboto Mono', ui-monospace, monospace",
          letterSpacing: '0.1em',
          fontWeight: '500',
        })}
      >
        PROCESSING…
      </Box>
    </Box>
  )
}
