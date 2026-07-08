import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { css } from 'styled-system/css'
import { Box, Flex } from 'styled-system/jsx'
import { X, Download, Check, AlertCircle, ChevronRight, ChevronLeft, LayoutGrid, Cpu, Wrench } from 'lucide-react'
import { listLibraries, installLibrary } from '../libraries/librariesApi'
import type { Library, LibraryStatus } from '../libraries/librariesApi'
import { listSolcVersions, installSolcVersion } from '../solcVersions/solcVersionsApi'
import type { SolcVersion } from '../solcVersions/solcVersionsApi'
import { listTools, installTool } from '../tools/toolsApi'
import type { Tool, ToolStatus } from '../tools/toolsApi'

const cl = {
  bg: '#111116',
  border: 'rgba(185,185,189,0.12)',
  text: 'rgba(231,228,239,0.91)',
  muted: 'rgba(185,185,193,0.45)',
  accent: '#58d6ab',
  accentBg: 'rgba(88,214,171,0.09)',
  accentBorder: 'rgba(88,214,171,0.22)',
  card: 'rgba(20,20,26,0.98)',
  cardBorder: 'rgba(185,185,189,0.10)',
  hover: 'rgba(255,255,255,0.045)',
  mono: '"Roboto Mono", "JetBrains Mono", monospace',
}

const POLL_MS = 1500

const defiProtocols = [
  { name: 'Uniswap',   tag: 'DEX',        color: '#58d6ab' },
  { name: 'Aave',      tag: 'Lending',    color: '#64a0ff' },
  { name: 'Compound',  tag: 'Lending',    color: '#64a0ff' },
  { name: 'MakerDAO',  tag: 'Stablecoin', color: '#f5d250' },
  { name: 'Curve',     tag: 'DEX',        color: '#58d6ab' },
  { name: 'Balancer',  tag: 'DEX',        color: '#58d6ab' },
  { name: 'GMX',       tag: 'Perps',      color: '#ff8c50' },
  { name: 'Lido',      tag: 'Staking',    color: '#b482ff' },
  { name: 'Yearn',     tag: 'Yield',      color: '#50dc82' },
  { name: 'dYdX',      tag: 'Perps',      color: '#ff8c50' },
]

const securityTools = [
  { name: 'Slither',   tag: 'Static',   color: '#58d6ab' },
  { name: 'Mythril',   tag: 'Symbolic', color: '#ff8c50' },
  { name: 'Echidna',   tag: 'Fuzzer',   color: '#ff5050' },
  { name: 'Foundry',   tag: 'Testing',  color: '#64a0ff' },
  { name: 'Hardhat',   tag: 'Testing',  color: '#64a0ff' },
  { name: 'Certora',   tag: 'Formal',   color: '#b482ff' },
  { name: 'Manticore', tag: 'Symbolic', color: '#ff8c50' },
  { name: 'Halmos',    tag: 'Formal',   color: '#b482ff' },
]

// ---------------------------------------------------------------------------
// Package icon
// ---------------------------------------------------------------------------
export function PackageIcon({ size = 15, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M8 1L14 4.5V11.5L8 15L2 11.5V4.5L8 1Z" stroke={color} strokeWidth="1.25" strokeLinejoin="round" />
      <path d="M8 1V15" stroke={color} strokeWidth="1.25" />
      <path d="M2 4.5L8 8L14 4.5" stroke={color} strokeWidth="1.25" />
      <path d="M5 2.75L11 6.25" stroke={color} strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Library status badge
// ---------------------------------------------------------------------------
function LibBadge({ status }: { status: LibraryStatus }) {
  if (status === 'downloaded') return (
    <Flex align="center" gap="1" style={{ color: cl.accent, fontSize: 10.5, fontFamily: cl.mono }}>
      <Check size={10} strokeWidth={2.5} /><span>Installed</span>
    </Flex>
  )
  if (status === 'downloading') return (
    <Flex align="center" gap="1" style={{ color: cl.muted, fontSize: 10.5, fontFamily: cl.mono }}>
      <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>
        <Download size={10} strokeWidth={2} />
      </span>
      <span>Downloading…</span>
    </Flex>
  )
  if (status === 'error') return (
    <Flex align="center" gap="1" style={{ color: '#f85149', fontSize: 10.5, fontFamily: cl.mono }}>
      <AlertCircle size={10} strokeWidth={2} /><span>Error</span>
    </Flex>
  )
  return null
}

// ---------------------------------------------------------------------------
// Library card
// ---------------------------------------------------------------------------
function LibCard({ lib, onInstall }: { lib: Library; onInstall: (id: string) => void }) {
  const busy = lib.status === 'downloading'
  const done = lib.status === 'downloaded'
  return (
    <Box style={{
      background: cl.card,
      border: `1px solid ${done ? cl.accentBorder : cl.cardBorder}`,
      borderRadius: 9, padding: '10px 12px',
      display: 'flex', flexDirection: 'column', gap: 5,
      transition: 'border-color 0.2s',
    }}>
      <Flex align="center" justify="space-between" gap="2">
        <Flex align="center" gap="2">
          <PackageIcon size={12} color={done ? cl.accent : cl.muted} />
          <span style={{ fontSize: 12.5, fontWeight: 600, color: cl.text, fontFamily: cl.mono }}>
            {lib.display_name}
          </span>
        </Flex>
        <LibBadge status={lib.status} />
      </Flex>
      <span style={{ fontSize: 11, color: cl.muted, lineHeight: 1.5 }}>{lib.description}</span>
      {!done && (
        <button
          type="button" disabled={busy} onClick={() => onInstall(lib.id)}
          className={css({
            alignSelf: 'flex-start', px: '3', py: '0.5', borderRadius: '5px',
            fontSize: '10.5px', fontWeight: '600', cursor: busy ? 'not-allowed' : 'pointer',
            transition: 'all 0.15s ease', border: '1px solid',
          })}
          style={{
            background: busy ? 'rgba(88,214,171,0.04)' : cl.accentBg,
            borderColor: busy ? 'rgba(88,214,171,0.1)' : cl.accentBorder,
            color: busy ? cl.muted : cl.accent,
            opacity: busy ? 0.7 : 1, fontFamily: cl.mono,
          }}
        >
          {busy ? 'Downloading…' : lib.status === 'error' ? 'Retry' : 'Download'}
        </button>
      )}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Solc version row
// ---------------------------------------------------------------------------
function SolcVersionRow({ ver, onInstall }: { ver: SolcVersion; onInstall: (v: string) => void }) {
  const installed = ver.status === 'installed'
  const installing = ver.status === 'installing'
  const err = ver.status === 'error'

  return (
    <Flex align="center" justify="space-between" style={{
      padding: '7px 10px', borderRadius: 7,
      background: installed ? 'rgba(88,214,171,0.04)' : 'rgba(255,255,255,0.02)',
      border: `1px solid ${installed ? cl.accentBorder : cl.cardBorder}`,
    }}>
      <span style={{ fontSize: 12, fontFamily: cl.mono, color: installed ? cl.accent : cl.text }}>
        {ver.version}
      </span>
      {installed && <Check size={11} color={cl.accent} strokeWidth={2.5} />}
      {installing && (
        <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite', color: cl.muted }}>
          <Download size={11} strokeWidth={2} />
        </span>
      )}
      {err && <AlertCircle size={11} color="#f85149" strokeWidth={2} />}
      {!installed && !installing && (
        <button
          type="button"
          onClick={() => onInstall(ver.version)}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: err ? '#f85149' : cl.muted, padding: '2px 4px', borderRadius: 4,
            fontSize: 10, fontFamily: cl.mono,
            transition: 'color 0.15s',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = cl.accent }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = err ? '#f85149' : cl.muted }}
        >
          {err ? 'Retry' : 'Install'}
        </button>
      )}
    </Flex>
  )
}

// ---------------------------------------------------------------------------
// Tool status badge
// ---------------------------------------------------------------------------
function ToolBadge({ status }: { status: ToolStatus }) {
  if (status === 'installed') return (
    <Flex align="center" gap="1" style={{ color: cl.accent, fontSize: 10.5, fontFamily: cl.mono }}>
      <Check size={10} strokeWidth={2.5} /><span>Installed</span>
    </Flex>
  )
  if (status === 'installing') return (
    <Flex align="center" gap="1" style={{ color: '#ff8c50', fontSize: 10.5, fontFamily: cl.mono }}>
      <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>
        <Download size={10} strokeWidth={2} />
      </span>
      <span>Installing…</span>
    </Flex>
  )
  if (status === 'error') return (
    <Flex align="center" gap="1" style={{ color: '#f85149', fontSize: 10.5, fontFamily: cl.mono }}>
      <AlertCircle size={10} strokeWidth={2} /><span>Error</span>
    </Flex>
  )
  if (status === 'not_supported') return (
    <Flex align="center" gap="1" style={{ color: 'rgba(185,185,193,0.45)', fontSize: 10.5, fontFamily: cl.mono }}>
      <span>Not supported</span>
    </Flex>
  )
  return null
}

// ---------------------------------------------------------------------------
// Tool card
// ---------------------------------------------------------------------------
function ToolCard({ tool, onInstall }: { tool: Tool; onInstall: (id: string) => void }) {
  const busy = tool.status === 'installing'
  const done = tool.status === 'installed'
  const unsupported = tool.status === 'not_supported'
  const tagColor = unsupported ? 'rgba(185,185,193,0.35)' : '#ff8c50'
  return (
    <Box style={{
      background: unsupported ? 'rgba(255,255,255,0.01)' : cl.card,
      border: `1px solid ${done ? cl.accentBorder : unsupported ? 'rgba(185,185,189,0.08)' : cl.cardBorder}`,
      borderRadius: 9, padding: '10px 12px',
      display: 'flex', flexDirection: 'column', gap: 5,
      transition: 'border-color 0.2s',
      opacity: unsupported ? 0.55 : 1,
    }}>
      <Flex align="center" justify="space-between" gap="2">
        <Flex align="center" gap="2">
          <span style={{
            fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em',
            color: tagColor, background: `${tagColor}1a`,
            borderRadius: 4, padding: '1px 6px', fontFamily: cl.mono,
          }}>{tool.tag}</span>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: unsupported ? 'rgba(185,185,193,0.55)' : cl.text, fontFamily: cl.mono }}>
            {tool.name}
          </span>
        </Flex>
        <ToolBadge status={tool.status} />
      </Flex>
      <span style={{ fontSize: 11, color: cl.muted, lineHeight: 1.5 }}>{tool.description}</span>
      {unsupported && tool.error_message && (
        <span style={{
          fontSize: 10, color: 'rgba(185,185,193,0.55)', fontFamily: cl.mono, lineHeight: 1.5,
          padding: '5px 8px', borderRadius: 5,
          background: 'rgba(185,185,193,0.05)', border: '1px solid rgba(185,185,189,0.12)',
        }}>
          {tool.error_message}
        </span>
      )}
      {!done && !unsupported && (
        <button
          type="button" disabled={busy} onClick={() => onInstall(tool.id)}
          className={css({
            alignSelf: 'flex-start', px: '3', py: '0.5', borderRadius: '5px',
            fontSize: '10.5px', fontWeight: '600', cursor: busy ? 'not-allowed' : 'pointer',
            transition: 'all 0.15s ease', border: '1px solid',
          })}
          style={{
            background: busy ? 'rgba(255,140,80,0.04)' : 'rgba(255,140,80,0.09)',
            borderColor: busy ? 'rgba(255,140,80,0.1)' : 'rgba(255,140,80,0.28)',
            color: busy ? cl.muted : tagColor,
            opacity: busy ? 0.7 : 1, fontFamily: cl.mono,
          }}
        >
          {busy ? 'Installing…' : tool.status === 'error' ? 'Retry' : 'Install'}
        </button>
      )}
      {tool.status === 'error' && tool.error_message && (
        <span style={{
          fontSize: 10, color: '#f85149', fontFamily: cl.mono, lineHeight: 1.5,
          padding: '5px 8px', borderRadius: 5,
          background: 'rgba(248,81,73,0.07)', border: '1px solid rgba(248,81,73,0.18)',
          wordBreak: 'break-word',
        }}>
          {tool.error_message}
        </span>
      )}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Main menu item row
// ---------------------------------------------------------------------------
function MenuItem({
  icon, label, sublabel, onClick,
}: {
  icon: React.ReactNode
  label: string
  sublabel?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        width: '100%', padding: '11px 16px',
        background: 'transparent', border: 'none',
        borderRadius: 8, cursor: 'pointer',
        transition: 'background 0.15s ease',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = cl.hover }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
    >
      <Flex align="center" justify="center" style={{
        width: 32, height: 32, borderRadius: 8, flexShrink: 0,
        background: 'rgba(255,255,255,0.04)',
        border: `1px solid ${cl.border}`,
        color: cl.muted,
      }}>
        {icon}
      </Flex>
      <Box style={{ flex: 1, textAlign: 'left' }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: cl.text }}>{label}</div>
        {sublabel && <div style={{ fontSize: 11, color: cl.muted, marginTop: 1 }}>{sublabel}</div>}
      </Box>
      <ChevronRight size={14} color={cl.muted} />
    </button>
  )
}

// ---------------------------------------------------------------------------
// SideNav
// ---------------------------------------------------------------------------
interface SideNavProps {
  open: boolean
  onClose: () => void
  openToPanel?: SubPanel | null
}

export type SubPanel = 'libraries' | 'solcVersions' | 'tools' | 'useful'

export function SideNav({ open, onClose, openToPanel }: SideNavProps) {
  const [subPanel, setSubPanel] = useState<SubPanel | null>(null)

  // When caller requests a specific panel, jump straight to it.
  useEffect(() => {
    if (open && openToPanel) setSubPanel(openToPanel)
  }, [open, openToPanel])

  // Libraries state
  const [libraries, setLibraries] = useState<Library[]>([])
  const [libLoading, setLibLoading] = useState(true)
  const [libError, setLibError] = useState<string | null>(null)
  const libPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Solc versions state
  const [solcVersions, setSolcVersions] = useState<SolcVersion[]>([])
  const [solcLoading, setSolcLoading] = useState(true)
  const [solcError, setSolcError] = useState<string | null>(null)
  const solcPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Tools state
  const [tools, setTools] = useState<Tool[]>([])
  const [toolsLoading, setToolsLoading] = useState(true)
  const [toolsError, setToolsError] = useState<string | null>(null)
  const toolsPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Reset to main panel when drawer closes
  useEffect(() => {
    if (!open) setSubPanel(null)
  }, [open])

  // ── Libraries polling ──
  const loadLibs = useCallback(async () => {
    try {
      const libs = await listLibraries()
      setLibraries(libs)
      setLibError(null)
    } catch (err) {
      setLibError(err instanceof Error ? err.message : 'Failed to load libraries')
    } finally {
      setLibLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open || subPanel !== 'libraries') {
      if (libPollRef.current) { clearInterval(libPollRef.current); libPollRef.current = null }
      return
    }
    setLibLoading(true)
    loadLibs()
    libPollRef.current = setInterval(loadLibs, POLL_MS)
    return () => { if (libPollRef.current) { clearInterval(libPollRef.current); libPollRef.current = null } }
  }, [open, subPanel, loadLibs])

  useEffect(() => {
    const any = libraries.some((l) => l.status === 'downloading')
    if (!any && libPollRef.current) { clearInterval(libPollRef.current); libPollRef.current = null }
    else if (any && !libPollRef.current && open && subPanel === 'libraries') {
      libPollRef.current = setInterval(loadLibs, POLL_MS)
    }
  }, [libraries, open, subPanel, loadLibs])

  const handleInstall = useCallback(async (id: string) => {
    setLibraries((prev) => prev.map((l) => l.id === id ? { ...l, status: 'downloading' } : l))
    try { await installLibrary(id) } catch {
      setLibraries((prev) => prev.map((l) => l.id === id ? { ...l, status: 'error' } : l))
      return
    }
    if (!libPollRef.current && open) libPollRef.current = setInterval(loadLibs, POLL_MS)
  }, [open, loadLibs])

  // ── Solc versions polling ──
  const loadSolcVersions = useCallback(async () => {
    try {
      const versions = await listSolcVersions()
      setSolcVersions(versions)
      setSolcError(null)
    } catch (err) {
      setSolcError(err instanceof Error ? err.message : 'Failed to load versions')
    } finally {
      setSolcLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open || subPanel !== 'solcVersions') {
      if (solcPollRef.current) { clearInterval(solcPollRef.current); solcPollRef.current = null }
      return
    }
    setSolcLoading(true)
    loadSolcVersions()
    solcPollRef.current = setInterval(loadSolcVersions, POLL_MS)
    return () => { if (solcPollRef.current) { clearInterval(solcPollRef.current); solcPollRef.current = null } }
  }, [open, subPanel, loadSolcVersions])

  useEffect(() => {
    const any = solcVersions.some((v) => v.status === 'installing')
    if (!any && solcPollRef.current) { clearInterval(solcPollRef.current); solcPollRef.current = null }
    else if (any && !solcPollRef.current && open && subPanel === 'solcVersions') {
      solcPollRef.current = setInterval(loadSolcVersions, POLL_MS)
    }
  }, [solcVersions, open, subPanel, loadSolcVersions])

  const handleSolcInstall = useCallback(async (version: string) => {
    setSolcVersions((prev) => prev.map((v) => v.version === version ? { ...v, status: 'installing' } : v))
    try { await installSolcVersion(version) } catch {
      setSolcVersions((prev) => prev.map((v) => v.version === version ? { ...v, status: 'error' } : v))
      return
    }
    if (!solcPollRef.current && open) solcPollRef.current = setInterval(loadSolcVersions, POLL_MS)
  }, [open, loadSolcVersions])

  // ── Tools polling ──
  const loadTools = useCallback(async () => {
    try {
      const data = await listTools()
      setTools(data)
      setToolsError(null)
    } catch (err) {
      setToolsError(err instanceof Error ? err.message : 'Failed to load tools')
    } finally {
      setToolsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open || subPanel !== 'tools') {
      if (toolsPollRef.current) { clearInterval(toolsPollRef.current); toolsPollRef.current = null }
      return
    }
    setToolsLoading(true)
    loadTools()
    toolsPollRef.current = setInterval(loadTools, POLL_MS)
    return () => { if (toolsPollRef.current) { clearInterval(toolsPollRef.current); toolsPollRef.current = null } }
  }, [open, subPanel, loadTools])

  useEffect(() => {
    const any = tools.some((t) => t.status === 'installing')
    if (!any && toolsPollRef.current) { clearInterval(toolsPollRef.current); toolsPollRef.current = null }
    else if (any && !toolsPollRef.current && open && subPanel === 'tools') {
      toolsPollRef.current = setInterval(loadTools, POLL_MS)
    }
  }, [tools, open, subPanel, loadTools])

  const handleToolInstall = useCallback(async (id: string) => {
    setTools((prev) => prev.map((t) => t.id === id ? { ...t, status: 'installing' } : t))
    try { await installTool(id) } catch {
      setTools((prev) => prev.map((t) => t.id === id ? { ...t, status: 'error' } : t))
      return
    }
    if (!toolsPollRef.current && open) toolsPollRef.current = setInterval(loadTools, POLL_MS)
  }, [open, loadTools])

  const downloaded = libraries.filter((l) => l.status === 'downloaded').length
  const installedSolc = solcVersions.filter((v) => v.status === 'installed').length
  const installedTools = tools.filter((t) => t.status === 'installed').length
  const inSub = subPanel !== null

  const subPanelTitle = subPanel === 'libraries' ? 'Libraries'
    : subPanel === 'solcVersions' ? 'Sol Versions'
    : subPanel === 'tools' ? 'Tools'
    : 'Useful'

  return createPortal(
    <>
      {open && (
        <Box
          onClick={onClose}
          style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)' }}
        />
      )}

      <Box style={{
        position: 'fixed', top: 0, left: 0, bottom: 0, width: 300, zIndex: 2001,
        background: cl.bg,
        borderRight: `1px solid ${cl.border}`,
        boxShadow: '12px 0 40px rgba(0,0,0,0.5)',
        overflow: 'hidden',
        transform: open ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform 0.26s cubic-bezier(0.4,0,0.2,1)',
        display: 'flex', flexDirection: 'column',
      }}>

        {/* Sliding track — two panels side by side */}
        <Box style={{
          display: 'flex', flex: 1, overflow: 'hidden',
          width: '200%',
          transform: inSub ? 'translateX(-50%)' : 'translateX(0)',
          transition: 'transform 0.24s cubic-bezier(0.4,0,0.2,1)',
        }}>

          {/* ── MAIN PANEL ── */}
          <Box style={{ width: 300, flexShrink: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
            {/* Header */}
            <Flex align="center" justify="space-between" style={{
              padding: '18px 16px 14px', borderBottom: `1px solid ${cl.border}`, flexShrink: 0,
            }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: cl.text }}>Menu</span>
              <button
                type="button" onClick={onClose} aria-label="Close"
                className={css({
                  display: 'grid', placeItems: 'center', w: '7', h: '7', borderRadius: '6px',
                  border: '1px solid rgba(185,185,189,0.15)', background: 'transparent', color: cl.muted,
                  cursor: 'pointer', _hover: { background: cl.hover, color: cl.text },
                })}
              >
                <X size={13} strokeWidth={2} />
              </button>
            </Flex>

            {/* Menu items */}
            <Box style={{ padding: '8px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
              <MenuItem
                icon={<LayoutGrid size={15} strokeWidth={2} />}
                label="Useful"
                sublabel="DeFi protocols & security tools"
                onClick={() => setSubPanel('useful')}
              />
              <MenuItem
                icon={<PackageIcon size={15} />}
                label="Libraries"
                sublabel="Manage Solidity libraries"
                onClick={() => setSubPanel('libraries')}
              />
              <MenuItem
                icon={<Cpu size={15} strokeWidth={2} />}
                label="Sol Versions"
                sublabel="Install Solidity compiler versions"
                onClick={() => setSubPanel('solcVersions')}
              />
              <MenuItem
                icon={<Wrench size={15} strokeWidth={2} />}
                label="Tools"
                sublabel="Install analysis tools (Mythril, …)"
                onClick={() => setSubPanel('tools')}
              />
            </Box>
          </Box>

          {/* ── SUB PANEL ── */}
          <Box style={{ width: 300, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Sub-panel header */}
            <Flex align="center" justify="space-between" style={{
              padding: '18px 16px 14px', borderBottom: `1px solid ${cl.border}`, flexShrink: 0,
            }}>
              <Flex align="center" gap="2">
                <button
                  type="button"
                  onClick={() => setSubPanel(null)}
                  aria-label="Back"
                  className={css({
                    display: 'grid', placeItems: 'center', w: '7', h: '7', borderRadius: '6px',
                    border: '1px solid rgba(185,185,189,0.15)', background: 'transparent', color: cl.muted,
                    cursor: 'pointer', _hover: { background: cl.hover, color: cl.text },
                  })}
                >
                  <ChevronLeft size={13} strokeWidth={2.5} />
                </button>
                <span style={{ fontSize: 14, fontWeight: 700, color: cl.text }}>{subPanelTitle}</span>
              </Flex>
              <Flex align="center" gap="2">
                {subPanel === 'libraries' && libraries.length > 0 && (
                  <span style={{ fontSize: 10.5, fontFamily: cl.mono, color: cl.muted }}>
                    {downloaded}/{libraries.length} installed
                  </span>
                )}
                {subPanel === 'solcVersions' && solcVersions.length > 0 && (
                  <span style={{ fontSize: 10.5, fontFamily: cl.mono, color: cl.muted }}>
                    {installedSolc}/{solcVersions.length} installed
                  </span>
                )}
                {subPanel === 'tools' && tools.length > 0 && (
                  <span style={{ fontSize: 10.5, fontFamily: cl.mono, color: cl.muted }}>
                    {installedTools}/{tools.length} installed
                  </span>
                )}
                <button
                  type="button" onClick={onClose} aria-label="Close"
                  className={css({
                    display: 'grid', placeItems: 'center', w: '7', h: '7', borderRadius: '6px',
                    border: '1px solid rgba(185,185,189,0.15)', background: 'transparent', color: cl.muted,
                    cursor: 'pointer', _hover: { background: cl.hover, color: cl.text },
                  })}
                >
                  <X size={13} strokeWidth={2} />
                </button>
              </Flex>
            </Flex>

            {/* Sub-panel content */}
            <Box style={{ flex: 1, overflowY: 'auto' }}>

              {/* ── Libraries ── */}
              {subPanel === 'libraries' && (
                <Box style={{ padding: '8px 12px 20px', display: 'flex', flexDirection: 'column', gap: 7 }}>
                  <Box style={{ padding: '6px 4px 2px' }}>
                    <span style={{ fontSize: 11.5, color: cl.muted, lineHeight: 1.55 }}>
                      Download Solidity libraries on-demand for import resolution.
                    </span>
                  </Box>
                  {libLoading ? (
                    <Flex align="center" justify="center" style={{ height: 100, color: cl.muted, fontSize: 12 }}>
                      Loading…
                    </Flex>
                  ) : libError ? (
                    <Flex align="center" gap="2" style={{
                      padding: '10px 12px', borderRadius: 8,
                      background: 'rgba(248,81,73,0.08)', border: '1px solid rgba(248,81,73,0.2)',
                      color: '#f85149', fontSize: 11.5,
                    }}>
                      <AlertCircle size={13} strokeWidth={2} />
                      <span>{libError}</span>
                    </Flex>
                  ) : libraries.map((lib) => (
                    <LibCard key={lib.id} lib={lib} onInstall={handleInstall} />
                  ))}
                </Box>
              )}

              {/* ── Sol Versions ── */}
              {subPanel === 'solcVersions' && (
                <Box style={{ padding: '8px 12px 20px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <Box style={{ padding: '6px 4px 2px' }}>
                    <span style={{ fontSize: 11.5, color: cl.muted, lineHeight: 1.55 }}>
                      Install solc compiler versions for Slither analysis.
                    </span>
                  </Box>
                  {solcLoading ? (
                    <Flex align="center" justify="center" style={{ height: 100, color: cl.muted, fontSize: 12 }}>
                      Loading…
                    </Flex>
                  ) : solcError ? (
                    <Flex align="center" gap="2" style={{
                      padding: '10px 12px', borderRadius: 8,
                      background: 'rgba(248,81,73,0.08)', border: '1px solid rgba(248,81,73,0.2)',
                      color: '#f85149', fontSize: 11.5,
                    }}>
                      <AlertCircle size={13} strokeWidth={2} />
                      <span>{solcError}</span>
                    </Flex>
                  ) : (
                    <Box style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {solcVersions.slice().reverse().map((ver) => (
                        <SolcVersionRow key={ver.version} ver={ver} onInstall={handleSolcInstall} />
                      ))}
                    </Box>
                  )}
                </Box>
              )}

              {/* ── Tools ── */}
              {subPanel === 'tools' && (
                <Box style={{ padding: '8px 12px 20px', display: 'flex', flexDirection: 'column', gap: 7 }}>
                  <Box style={{ padding: '6px 4px 2px' }}>
                    <span style={{ fontSize: 11.5, color: cl.muted, lineHeight: 1.55 }}>
                      Install heavyweight analysis tools on-demand to keep Docker build times short.
                    </span>
                  </Box>
                  {toolsLoading ? (
                    <Flex align="center" justify="center" style={{ height: 100, color: cl.muted, fontSize: 12 }}>
                      Loading…
                    </Flex>
                  ) : toolsError ? (
                    <Flex align="center" gap="2" style={{
                      padding: '10px 12px', borderRadius: 8,
                      background: 'rgba(248,81,73,0.08)', border: '1px solid rgba(248,81,73,0.2)',
                      color: '#f85149', fontSize: 11.5,
                    }}>
                      <AlertCircle size={13} strokeWidth={2} />
                      <span>{toolsError}</span>
                    </Flex>
                  ) : tools.map((tool) => (
                    <ToolCard key={tool.id} tool={tool} onInstall={handleToolInstall} />
                  ))}
                </Box>
              )}

              {/* ── Useful ── */}
              {subPanel === 'useful' && (
                <Box style={{ padding: '12px 12px 24px' }}>
                  <Box style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(88,214,171,0.7)', padding: '0 4px 8px' }}>
                    DeFi Protocols
                  </Box>
                  <Box style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {defiProtocols.map((item) => (
                      <Flex key={item.name} align="center" justify="space-between" style={{
                        padding: '8px 10px', borderRadius: 8,
                        background: 'rgba(255,255,255,0.02)',
                        border: '1px solid rgba(185,185,189,0.07)',
                      }}>
                        <span style={{ fontSize: 13, fontWeight: 500, color: cl.text }}>{item.name}</span>
                        <span style={{
                          fontSize: 10, fontWeight: 600,
                          color: item.color, background: `${item.color}1a`,
                          borderRadius: 4, padding: '2px 6px',
                        }}>{item.tag}</span>
                      </Flex>
                    ))}
                  </Box>
                  <Box style={{ height: 1, background: 'rgba(185,185,189,0.1)', margin: '16px 0' }} />
                  <Box style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,140,80,0.7)', padding: '0 4px 8px' }}>
                    Security & Pentest
                  </Box>
                  <Box style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {securityTools.map((item) => (
                      <Flex key={item.name} align="center" justify="space-between" style={{
                        padding: '8px 10px', borderRadius: 8,
                        background: 'rgba(255,255,255,0.02)',
                        border: '1px solid rgba(185,185,189,0.07)',
                      }}>
                        <span style={{ fontSize: 13, fontWeight: 500, color: cl.text }}>{item.name}</span>
                        <span style={{
                          fontSize: 10, fontWeight: 600,
                          color: item.color, background: `${item.color}1a`,
                          borderRadius: 4, padding: '2px 6px',
                        }}>{item.tag}</span>
                      </Flex>
                    ))}
                  </Box>
                </Box>
              )}
            </Box>
          </Box>
        </Box>
      </Box>

      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </>,
    document.body,
  )
}
