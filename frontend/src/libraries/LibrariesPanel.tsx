import { useCallback, useEffect, useRef, useState } from 'react'
import { Box, Flex } from 'styled-system/jsx'
import { css } from 'styled-system/css'
import { X, Download, Check, AlertCircle } from 'lucide-react'
import { listLibraries, installLibrary } from './librariesApi'
import type { Library, LibraryStatus } from './librariesApi'

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------
const c = {
  bg: '#13131a',
  border: 'rgba(185,185,189,0.13)',
  text: 'rgba(231,228,239,0.91)',
  muted: 'rgba(185,185,193,0.52)',
  accent: '#58d6ab',
  accentBg: 'rgba(88,214,171,0.09)',
  accentBorder: 'rgba(88,214,171,0.22)',
  card: 'rgba(22,22,28,0.95)',
  cardBorder: 'rgba(185,185,189,0.10)',
  mono: '"Roboto Mono", "JetBrains Mono", monospace',
}

const POLL_MS = 1500

// ---------------------------------------------------------------------------
// Package icon (inline SVG — reused in NavBar too via export)
// ---------------------------------------------------------------------------
export function PackageIcon({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M8 1L14 4.5V11.5L8 15L2 11.5V4.5L8 1Z" stroke={color} strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M8 1V15" stroke={color} strokeWidth="1.2" />
      <path d="M2 4.5L8 8L14 4.5" stroke={color} strokeWidth="1.2" />
      <path d="M5 2.75L11 6.25" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------
function StatusBadge({ status }: { status: LibraryStatus }) {
  if (status === 'downloaded') return (
    <Flex align="center" gap="1" style={{ color: c.accent, fontSize: 11, fontFamily: c.mono }}>
      <Check size={11} strokeWidth={2.5} />
      <span>Installed</span>
    </Flex>
  )
  if (status === 'downloading') return (
    <Flex align="center" gap="1" style={{ color: c.muted, fontSize: 11, fontFamily: c.mono }}>
      <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>
        <Download size={11} strokeWidth={2} />
      </span>
      <span>Downloading…</span>
    </Flex>
  )
  if (status === 'error') return (
    <Flex align="center" gap="1" style={{ color: '#f85149', fontSize: 11, fontFamily: c.mono }}>
      <AlertCircle size={11} strokeWidth={2} />
      <span>Error</span>
    </Flex>
  )
  return null
}

// ---------------------------------------------------------------------------
// Library card
// ---------------------------------------------------------------------------
function LibraryCard({ lib, onInstall }: { lib: Library; onInstall: (id: string) => void }) {
  const busy = lib.status === 'downloading'
  const done = lib.status === 'downloaded'

  return (
    <Box
      style={{
        background: c.card,
        border: `1px solid ${done ? c.accentBorder : c.cardBorder}`,
        borderRadius: 10,
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        transition: 'border-color 0.2s',
      }}
    >
      <Flex align="center" justify="space-between" gap="2">
        <Flex align="center" gap="2">
          <PackageIcon size={13} color={done ? c.accent : c.muted} />
          <span style={{ fontSize: 13, fontWeight: 600, color: c.text, fontFamily: c.mono }}>
            {lib.display_name}
          </span>
        </Flex>
        <StatusBadge status={lib.status} />
      </Flex>

      <span style={{ fontSize: 11.5, color: c.muted, lineHeight: 1.5 }}>
        {lib.description}
      </span>

      {!done && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onInstall(lib.id)}
          className={css({
            alignSelf: 'flex-start',
            mt: '1',
            px: '3',
            py: '1',
            borderRadius: '6px',
            fontSize: '11px',
            fontFamily: 'var(--font-mono, monospace)',
            fontWeight: '600',
            cursor: busy ? 'not-allowed' : 'pointer',
            transition: 'all 0.15s ease',
            border: '1px solid',
          })}
          style={{
            background: busy ? 'rgba(88,214,171,0.04)' : c.accentBg,
            borderColor: busy ? 'rgba(88,214,171,0.1)' : c.accentBorder,
            color: busy ? c.muted : c.accent,
            opacity: busy ? 0.7 : 1,
          }}
        >
          {busy ? 'Downloading…' : lib.status === 'error' ? 'Retry' : 'Download'}
        </button>
      )}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// LibrariesPanel
// ---------------------------------------------------------------------------
interface LibrariesPanelProps {
  open: boolean
  onClose: () => void
}

export function LibrariesPanel({ open, onClose }: LibrariesPanelProps) {
  const [libraries, setLibraries] = useState<Library[]>([])
  const [loading, setLoading] = useState(true)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    try {
      const libs = await listLibraries()
      setLibraries(libs)
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }, [])

  // Start/stop polling based on open state and whether any lib is downloading
  useEffect(() => {
    if (!open) {
      if (pollRef.current) clearInterval(pollRef.current)
      return
    }
    setLoading(true)
    load()
    pollRef.current = setInterval(load, POLL_MS)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [open, load])

  // Stop polling when nothing is downloading
  useEffect(() => {
    const anyDownloading = libraries.some((l) => l.status === 'downloading')
    if (!anyDownloading && pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    } else if (anyDownloading && !pollRef.current && open) {
      pollRef.current = setInterval(load, POLL_MS)
    }
  }, [libraries, open, load])

  const handleInstall = useCallback(async (id: string) => {
    // Optimistically set downloading
    setLibraries((prev) =>
      prev.map((l) => (l.id === id ? { ...l, status: 'downloading' } : l))
    )
    try {
      await installLibrary(id)
    } catch {
      setLibraries((prev) =>
        prev.map((l) => (l.id === id ? { ...l, status: 'error' } : l))
      )
      return
    }
    // Resume polling to catch the real status
    if (!pollRef.current && open) {
      pollRef.current = setInterval(load, POLL_MS)
    }
  }, [open, load])

  const downloaded = libraries.filter((l) => l.status === 'downloaded').length

  return (
    <>
      {/* Backdrop */}
      {open && (
        <Box
          onClick={onClose}
          style={{
            position: 'fixed', inset: 0, zIndex: 40,
            background: 'rgba(0,0,0,0.45)',
            backdropFilter: 'blur(2px)',
          }}
        />
      )}

      {/* Drawer */}
      <Box
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 360,
          zIndex: 41,
          background: c.bg,
          borderLeft: `1px solid ${c.border}`,
          boxShadow: '-12px 0 40px rgba(0,0,0,0.5)',
          display: 'flex',
          flexDirection: 'column',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.25s cubic-bezier(0.4,0,0.2,1)',
        }}
      >
        {/* Header */}
        <Flex
          align="center"
          justify="space-between"
          style={{
            padding: '18px 20px 14px',
            borderBottom: `1px solid ${c.border}`,
            flexShrink: 0,
          }}
        >
          <Flex align="center" gap="2">
            <PackageIcon size={15} color={c.accent} />
            <span style={{ fontSize: 15, fontWeight: 700, color: c.text }}>Libraries</span>
          </Flex>
          <Flex align="center" gap="3">
            {libraries.length > 0 && (
              <span style={{ fontSize: 11, fontFamily: c.mono, color: c.muted }}>
                {downloaded}/{libraries.length} installed
              </span>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className={css({
                display: 'grid', placeItems: 'center',
                w: '7', h: '7', borderRadius: '6px',
                border: '1px solid rgba(185,185,189,0.15)',
                background: 'transparent',
                color: 'rgba(185,185,193,0.6)',
                cursor: 'pointer',
                _hover: { background: 'rgba(255,255,255,0.06)', color: 'rgba(231,228,239,0.9)' },
              })}
            >
              <X size={13} strokeWidth={2} />
            </button>
          </Flex>
        </Flex>

        {/* Description */}
        <Box style={{ padding: '12px 20px 4px', flexShrink: 0 }}>
          <span style={{ fontSize: 12, color: c.muted, lineHeight: 1.6 }}>
            Download Solidity libraries on-demand. Installed libraries are available immediately for import resolution in all analysis tools.
          </span>
        </Box>

        {/* Library list */}
        <Box style={{ flex: 1, overflowY: 'auto', padding: '12px 16px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {loading ? (
            <Flex align="center" justify="center" style={{ height: 120, color: c.muted, fontSize: 13 }}>
              Loading…
            </Flex>
          ) : (
            libraries.map((lib) => (
              <LibraryCard key={lib.id} lib={lib} onInstall={handleInstall} />
            ))
          )}
        </Box>
      </Box>

      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </>
  )
}
