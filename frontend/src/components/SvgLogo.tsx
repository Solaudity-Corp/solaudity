import { useEffect, useId, useMemo, useRef, useState } from 'react'

type SvgLogoProps = {
  text?: string
  width?: number
  height?: number
  backgroundColor?: string
  gradientStart?: string
  gradientEnd?: string
  gradientStops?: string[]
  underlineColor?: string
  cornerRadius?: number
  hoverTexts?: string[]
  className?: string
}

const DEFAULT_TEXT = 'S0lAudity'
const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=<>?{}[]|~'

function easeOutCubic(value: number) {
  return 1 - Math.pow(1 - value, 3)
}

function randomGlyph() {
  return GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
}

export function SvgLogo({
  text = DEFAULT_TEXT,
  width = 720,
  height = 200,
  backgroundColor = '#2a2a2a',
  gradientStart = '#a6a6a6',
  gradientEnd = '#ffffff',
  gradientStops,
  underlineColor,
  cornerRadius = 0,
  hoverTexts = ['S3cAuditX', 'RugTr4ceX', 'TxW4tch3r', 'Bl0ckGu4d', 'Sn1ffCh41n'],
  className,
}: SvgLogoProps) {
  const rawId = useId()
  const uid = useMemo(() => rawId.replace(/[^a-zA-Z0-9_-]/g, ''), [rawId])
  const gradientId = `${uid}-gradient`
  const resolvedStops = gradientStops && gradientStops.length > 1 ? gradientStops : [gradientStart, gradientEnd]

  const [displayText, setDisplayText] = useState(text)

  const rafRef = useRef<number | null>(null)
  const leaveDelayRef = useRef<number | null>(null)
  const hoverRef = useRef(false)

  useEffect(() => {
    setDisplayText(text)
  }, [text])

  const fontSize = Math.min(height * 0.6, width * 0.14)
  const centerX = width / 2
  const baselineY = height * 0.664
  const underlineThickness = Math.max(2, fontSize * 0.08)
  const underlineOffset = fontSize * 0.1

  useEffect(() => {
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
      }
      if (leaveDelayRef.current != null) {
        window.clearTimeout(leaveDelayRef.current)
      }
    }
  }, [])

  const validHoverTexts = useMemo(
    () => hoverTexts.filter((candidate) => candidate.length === text.length),
    [hoverTexts, text],
  )

  const stopFrame = () => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }

  const clearLeaveDelay = () => {
    if (leaveDelayRef.current != null) {
      window.clearTimeout(leaveDelayRef.current)
      leaveDelayRef.current = null
    }
  }

  const animateTo = (target: string, durationMs: number) => {
    stopFrame()

    const startAt = performance.now()
    const targetChars = target.split('')

    const frame = (now: number) => {
      const elapsed = now - startAt
      const progress = Math.min(1, elapsed / durationMs)
      const eased = easeOutCubic(progress)
      const revealCount = Math.floor(targetChars.length * eased)

      const animated = targetChars
        .map((finalChar, index) => {
          if (finalChar === ' ') return ' '
          return index < revealCount ? finalChar : randomGlyph()
        })
        .join('')

      setDisplayText(animated)

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(frame)
        return
      }

      setDisplayText(target)
      rafRef.current = null
    }

    rafRef.current = requestAnimationFrame(frame)
  }

  const pickHoverWord = () => {
    if (validHoverTexts.length === 0) return text
    const selected = validHoverTexts[Math.floor(Math.random() * validHoverTexts.length)]
    return selected
  }

  const handleMouseEnter = () => {
    hoverRef.current = true
    clearLeaveDelay()
    const hoverWord = pickHoverWord()
    animateTo(hoverWord, 500)
  }

  const handleMouseLeave = () => {
    hoverRef.current = false
    clearLeaveDelay()
    leaveDelayRef.current = window.setTimeout(() => {
      if (!hoverRef.current) {
        animateTo(text, 500)
      }
    }, 500)
  }

  return (
    <svg
      role="img"
      aria-label={text}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
          {resolvedStops.map((color, index) => (
            <stop
              key={`${gradientId}-${index}`}
              offset={`${(index / (resolvedStops.length - 1)) * 100}%`}
              stopColor={color}
            />
          ))}
        </linearGradient>
      </defs>

      <rect width={width} height={height} rx={cornerRadius} fill={backgroundColor} />

      <text
        x={centerX}
        y={baselineY}
        fill={`url(#${gradientId})`}
        fontFamily="'Roboto Mono', 'Roboto Mono Variable', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace"
        fontSize={fontSize}
        fontWeight={800}
        letterSpacing="-0.03em"
        textAnchor="middle"
        dominantBaseline="alphabetic"
        textDecoration="underline"
        style={{
          textDecorationColor: underlineColor ?? resolvedStops[Math.floor(resolvedStops.length / 2)] ?? gradientEnd,
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
