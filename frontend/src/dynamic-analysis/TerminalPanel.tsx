import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

export interface TerminalHandle {
  sendCmd: (cmd: string) => void
  clear: () => void
  focus: () => void
  write: (data: string) => void
}

interface Props {
  wsUrl: string | null
  onStatusChange?: (s: 'connecting' | 'connected' | 'disconnected') => void
}

export const TerminalPanel = forwardRef<TerminalHandle, Props>(
  ({ wsUrl, onStatusChange }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const termRef = useRef<Terminal | null>(null)
    const fitRef = useRef<FitAddon | null>(null)
    const wsRef = useRef<WebSocket | null>(null)

    useImperativeHandle(ref, () => ({
      sendCmd(cmd) {
        const ws = wsRef.current
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'cmd', cmd }))
        }
      },
      clear() { termRef.current?.clear() },
      focus() { termRef.current?.focus() },
      write(data) { termRef.current?.write(data) },
    }))

    // Mount terminal once
    useEffect(() => {
      if (!containerRef.current) return
      const term = new Terminal({
        theme: {
          background: '#0e0e12',
          foreground: '#e7e4ef',
          cursor: '#f5c83c',
          cursorAccent: '#0e0e12',
          selectionBackground: 'rgba(245,200,60,0.18)',
          black: '#101014',   brightBlack: '#454550',
          red: '#ff5a5a',     brightRed: '#ff7b7b',
          green: '#58d6ab',   brightGreen: '#7de8c0',
          yellow: '#f5c83c',  brightYellow: '#ffd96a',
          blue: '#5895ff',    brightBlue: '#7ab4ff',
          magenta: '#b48cff', brightMagenta: '#cc9fff',
          cyan: '#56d6d6',    brightCyan: '#77e8e8',
          white: '#e7e4ef',   brightWhite: '#ffffff',
        },
        fontSize: 14,
        fontFamily: "'Roboto Mono', ui-monospace, Consolas, 'Courier New', monospace",
        fontWeight: '500',
        lineHeight: 1.4,
        cursorBlink: true,
        cursorStyle: 'block',
        scrollback: 5000,
        allowProposedApi: true,
      })
      const fit = new FitAddon()
      term.loadAddon(fit)
      term.open(containerRef.current)
      fit.fit()
      termRef.current = term
      fitRef.current = fit

      const ro = new ResizeObserver(() => { try { fit.fit() } catch { /* */ } })
      ro.observe(containerRef.current)

      return () => {
        ro.disconnect()
        term.dispose()
        termRef.current = null
        fitRef.current = null
      }
    }, [])

    // Connect WebSocket when wsUrl changes
    useEffect(() => {
      if (!wsUrl) return
      const term = termRef.current
      if (!term) return

      onStatusChange?.('connecting')
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws
      ws.binaryType = 'arraybuffer'

      ws.onopen = () => {
        onStatusChange?.('connected')
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
      }
      ws.onmessage = (e) => {
        if (e.data instanceof ArrayBuffer) {
          termRef.current?.write(new Uint8Array(e.data))
        }
      }
      ws.onclose = () => {
        onStatusChange?.('disconnected')
        termRef.current?.write('\r\n\x1b[90m[session closed — click reconnect to start a new one]\x1b[0m\r\n')
      }
      ws.onerror = () => { onStatusChange?.('disconnected') }

      const dataDisp = term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(new TextEncoder().encode(data))
        }
      })
      const resizeDisp = term.onResize(({ cols, rows }) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols, rows }))
        }
      })

      return () => {
        dataDisp.dispose()
        resizeDisp.dispose()
        ws.close()
        wsRef.current = null
      }
    }, [wsUrl, onStatusChange])

    return (
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%', padding: '6px 4px 4px' }}
      />
    )
  },
)
TerminalPanel.displayName = 'TerminalPanel'
