import { useCallback, useEffect, useRef, useState } from 'react'
import { marked } from 'marked'
import { css } from 'styled-system/css'
import { Box, Flex } from 'styled-system/jsx'
import { X, Eye, Pencil, Check } from 'lucide-react'
import * as api from './notesApi'

// ---------------------------------------------------------------------------
// Marked config — open links in new tab, sanitise nothing (user's own notes)
// ---------------------------------------------------------------------------
marked.setOptions({ async: false })

const renderer = new marked.Renderer()
renderer.link = ({ href, title, text }) =>
  `<a href="${href}" title="${title ?? ''}" target="_blank" rel="noopener noreferrer">${text}</a>`
marked.use({ renderer })

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------
const c = {
  bg: 'rgba(14, 14, 18, 0.97)',
  panel: 'rgba(20, 20, 26, 0.99)',
  border: 'rgba(185, 185, 189, 0.14)',
  borderSoft: 'rgba(185, 185, 189, 0.22)',
  accent: '#b48cff',
  accentFaint: 'rgba(180, 140, 255, 0.08)',
  accentBorder: 'rgba(180, 140, 255, 0.22)',
  text: 'rgba(231, 228, 239, 0.91)',
  textSub: 'rgba(231, 228, 239, 0.72)',
  muted: 'rgba(185, 185, 193, 0.55)',
  mono: "'Roboto Mono', ui-monospace, monospace",
}

interface NotesOverlayProps {
  auditId: string
  onClose: () => void
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export function NotesOverlay({ auditId, onClose }: NotesOverlayProps) {
  const [content, setContent] = useState('')
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [loaded, setLoaded] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load note on mount
  useEffect(() => {
    api.getNote(auditId).then(note => {
      setContent(note.content)
      setLoaded(true)
    }).catch(() => setLoaded(true))
  }, [auditId])

  // Auto-save with 1s debounce after content changes
  const triggerSave = useCallback((value: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setSaveState('saving')
    debounceRef.current = setTimeout(async () => {
      try {
        await api.saveNote(auditId, value)
        setSaveState('saved')
        setTimeout(() => setSaveState('idle'), 2000)
      } catch {
        setSaveState('error')
      }
    }, 1000)
  }, [auditId])

  const handleChange = (value: string) => {
    setContent(value)
    triggerSave(value)
  }

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const previewHtml = mode === 'preview' ? marked.parse(content) as string : ''

  return (
    <Box
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(8, 8, 12, 0.72)',
        backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '24px',
        animation: 'fadeIn 0.15s ease',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(12px) } to { opacity: 1; transform: translateY(0) } }
        .notes-preview h1 { font-size: 1.4em; font-weight: 700; color: ${c.accent}; margin: 0 0 12px; padding-bottom: 6px; border-bottom: 1px solid ${c.accentBorder}; }
        .notes-preview h2 { font-size: 1.2em; font-weight: 700; color: ${c.text}; margin: 16px 0 8px; border-left: 2px solid ${c.accent}; padding-left: 8px; }
        .notes-preview h3 { font-size: 1.05em; font-weight: 600; color: ${c.accent}; margin: 14px 0 6px; }
        .notes-preview h4 { font-size: 0.95em; font-weight: 600; color: ${c.textSub}; margin: 12px 0 4px; }
        .notes-preview p { margin: 0 0 10px; line-height: 1.75; color: ${c.textSub}; }
        .notes-preview strong { font-weight: 700; color: ${c.text}; }
        .notes-preview em { font-style: italic; color: ${c.textSub}; }
        .notes-preview code { background: rgba(180,140,255,0.10); color: ${c.accent}; border-radius: 3px; padding: 1px 5px; font-size: 0.88em; font-family: ${c.mono}; }
        .notes-preview pre { background: #0d0d11; border: 1px solid rgba(185,185,189,0.12); border-radius: 6px; padding: 12px 16px; overflow-x: auto; margin: 10px 0; }
        .notes-preview pre code { background: none; padding: 0; font-size: 12px; color: rgba(220,215,240,0.85); line-height: 1.65; }
        .notes-preview ul, .notes-preview ol { padding-left: 20px; margin: 0 0 10px; color: ${c.textSub}; line-height: 1.75; }
        .notes-preview li { margin-bottom: 3px; }
        .notes-preview blockquote { border-left: 3px solid ${c.accentBorder}; margin: 10px 0; padding: 4px 12px; color: ${c.muted}; font-style: italic; }
        .notes-preview a { color: ${c.accent}; text-decoration: underline; text-underline-offset: 2px; }
        .notes-preview hr { border: none; border-top: 1px solid rgba(185,185,189,0.12); margin: 16px 0; }
        .notes-preview table { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 12.5px; }
        .notes-preview th, .notes-preview td { border: 1px solid rgba(185,185,189,0.14); padding: 6px 10px; text-align: left; color: ${c.textSub}; }
        .notes-preview th { background: rgba(180,140,255,0.06); color: ${c.text}; font-weight: 600; }
      `}</style>

      {/* Panel */}
      <Box style={{
        width: '100%', maxWidth: 860, height: 'min(78vh, 720px)',
        background: c.panel,
        border: `1px solid ${c.borderSoft}`,
        borderRadius: 14,
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 24px 64px rgba(0,0,0,0.55)',
        animation: 'slideUp 0.18s ease',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <Flex align="center" justify="space-between" style={{
          padding: '12px 16px',
          borderBottom: `1px solid ${c.border}`,
          flexShrink: 0,
        }}>
          <Flex align="center" gap="2">
            <Pencil size={13} color={c.accent} strokeWidth={2} />
            <span style={{ fontSize: 13, fontWeight: 600, color: c.text, fontFamily: c.mono }}>
              Notes
            </span>
          </Flex>

          <Flex align="center" gap="2">
            {/* Save indicator */}
            <span style={{
              fontSize: 11, fontFamily: c.mono,
              color: saveState === 'saved' ? 'rgba(88,214,171,0.85)'
                : saveState === 'saving' ? c.muted
                : saveState === 'error' ? 'rgba(255,90,90,0.85)'
                : 'transparent',
              transition: 'color 0.2s ease',
              minWidth: 50,
            }}>
              {saveState === 'saved' && '✓ saved'}
              {saveState === 'saving' && 'saving…'}
              {saveState === 'error' && '✗ error'}
            </span>

            {/* Edit / Preview toggle */}
            <Flex style={{
              background: 'rgba(255,255,255,0.04)',
              border: `1px solid ${c.border}`,
              borderRadius: 7, overflow: 'hidden',
            }}>
              {(['edit', 'preview'] as const).map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    padding: '4px 10px', border: 'none', cursor: 'pointer',
                    fontSize: 11, fontFamily: c.mono, fontWeight: mode === m ? 600 : 400,
                    background: mode === m ? c.accentFaint : 'transparent',
                    color: mode === m ? c.accent : c.muted,
                    transition: 'all 0.12s ease',
                  }}
                >
                  {m === 'edit' ? <Pencil size={10} strokeWidth={2} /> : <Eye size={10} strokeWidth={2} />}
                  {m === 'edit' ? 'Edit' : 'Preview'}
                </button>
              ))}
            </Flex>

            {/* Close */}
            <button
              type="button"
              onClick={onClose}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 28, height: 28, borderRadius: 6, border: `1px solid ${c.border}`,
                background: 'transparent', cursor: 'pointer', color: c.muted,
                transition: 'all 0.12s ease',
              }}
              className={css({ _hover: { background: 'rgba(255,255,255,0.06)', color: c.text } })}
            >
              <X size={13} strokeWidth={2.5} />
            </button>
          </Flex>
        </Flex>

        {/* Body */}
        <Box style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          {!loaded ? (
            <Flex align="center" justify="center" style={{ height: '100%' }}>
              <span style={{ fontSize: 12, color: c.muted, fontFamily: c.mono }}>Loading…</span>
            </Flex>
          ) : mode === 'edit' ? (
            <textarea
              value={content}
              onChange={e => handleChange(e.target.value)}
              placeholder={'# Audit notes\n\nWrite your findings, observations, and ideas here…\n\nSupports **markdown** — headers, lists, code blocks, and more.'}
              autoFocus
              style={{
                width: '100%', height: '100%',
                background: 'transparent', border: 'none', outline: 'none',
                resize: 'none', padding: '20px 24px',
                fontSize: 13, fontFamily: c.mono,
                color: c.text, lineHeight: 1.75,
                caretColor: c.accent,
              }}
            />
          ) : (
            <Box
              className="notes-preview"
              style={{
                height: '100%', overflowY: 'auto',
                padding: '20px 24px',
                fontSize: 13, fontFamily: c.mono, lineHeight: 1.75,
              }}
              dangerouslySetInnerHTML={{ __html: previewHtml || '<p style="color: rgba(185,185,193,0.4); font-style: italic;">Nothing to preview yet.</p>' }}
            />
          )}
        </Box>

        {/* Footer hint */}
        <Flex align="center" justify="space-between" style={{
          padding: '8px 16px',
          borderTop: `1px solid ${c.border}`,
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 10.5, color: 'rgba(185,185,193,0.35)', fontFamily: c.mono }}>
            Markdown supported · auto-saved
          </span>
          <Flex align="center" gap="1" style={{ fontSize: 10.5, color: 'rgba(185,185,193,0.35)', fontFamily: c.mono }}>
            <Check size={10} strokeWidth={2} />
            <span>Esc to close</span>
          </Flex>
        </Flex>
      </Box>
    </Box>
  )
}
