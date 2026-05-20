import { useCallback, useEffect, useRef, useState } from 'react'
import { marked } from 'marked'
import { css } from 'styled-system/css'
import { Box, Flex } from 'styled-system/jsx'
import { X, Eye, Pencil, Check } from 'lucide-react'
import * as api from './notesApi'

// ---------------------------------------------------------------------------
// Marked — GFM enabled by default; override checkbox to make it interactive
// ---------------------------------------------------------------------------
marked.use({
  renderer: {
    checkbox({ checked }: { checked: boolean }) {
      return `<input type="checkbox" ${checked ? 'checked' : ''} data-task />`
    },
    link({ href, title, text }: { href: string; title?: string | null; text: string }) {
      return `<a href="${href}" title="${title ?? ''}" target="_blank" rel="noopener noreferrer">${text}</a>`
    },
  },
})

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

// ---------------------------------------------------------------------------
// Toggle the Nth task checkbox in raw markdown content
// ---------------------------------------------------------------------------
function toggleTaskAtIndex(content: string, idx: number): string {
  let count = 0
  return content.split('\n').map(line => {
    if (/^\s*[-*+]\s+\[([ xX])\]/.test(line)) {
      if (count === idx) {
        count++
        return /^\s*[-*+]\s+\[[xX]\]/.test(line)
          ? line.replace(/\[[xX]\]/, '[ ]')
          : line.replace(/\[ \]/, '[x]')
      }
      count++
    }
    return line
  }).join('\n')
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
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Load note on mount
  useEffect(() => {
    api.getNote(auditId).then(note => {
      setContent(note.content)
      setLoaded(true)
    }).catch(() => setLoaded(true))
  }, [auditId])

  // Auto-save with 1s debounce
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

  const handleChange = useCallback((value: string) => {
    setContent(value)
    triggerSave(value)
  }, [triggerSave])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // Cmd+L / Ctrl+L — insert a new task checkbox on the current line
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'l') {
      e.preventDefault()
      const ta = e.currentTarget
      const pos = ta.selectionStart
      const val = content
      const lineStart = val.lastIndexOf('\n', pos - 1) + 1
      const lineEnd = val.indexOf('\n', pos)
      const currentLine = val.slice(lineStart, lineEnd === -1 ? val.length : lineEnd)

      let newVal: string
      let newPos: number

      if (currentLine.trim() === '') {
        // Empty line — prepend checkbox prefix in-place
        newVal = val.slice(0, lineStart) + '- [ ] ' + val.slice(lineStart)
        newPos = lineStart + 6
      } else {
        // Non-empty line — add a new checkbox line below
        const insertAt = lineEnd === -1 ? val.length : lineEnd
        newVal = val.slice(0, insertAt) + '\n- [ ] ' + val.slice(insertAt)
        newPos = insertAt + 7
      }

      handleChange(newVal)
      requestAnimationFrame(() => {
        ta.setSelectionRange(newPos, newPos)
      })
    }
  }

  // Click on a checkbox in preview — toggle it in raw markdown
  const handlePreviewClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (target.tagName !== 'INPUT' || (target as HTMLInputElement).type !== 'checkbox') return
    e.preventDefault()
    const allCheckboxes = Array.from(e.currentTarget.querySelectorAll('input[data-task]'))
    const idx = allCheckboxes.indexOf(target)
    if (idx === -1) return
    handleChange(toggleTaskAtIndex(content, idx))
  }, [content, handleChange])

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

        /* Headings */
        .notes-preview h1 { font-size: 1.4em; font-weight: 700; color: ${c.accent}; margin: 0 0 12px; padding-bottom: 6px; border-bottom: 1px solid ${c.accentBorder}; }
        .notes-preview h2 { font-size: 1.2em; font-weight: 700; color: ${c.text}; margin: 16px 0 8px; border-left: 2px solid ${c.accent}; padding-left: 8px; }
        .notes-preview h3 { font-size: 1.05em; font-weight: 600; color: ${c.accent}; margin: 14px 0 6px; }
        .notes-preview h4 { font-size: 0.95em; font-weight: 600; color: ${c.textSub}; margin: 12px 0 4px; }
        /* Body */
        .notes-preview p { margin: 0 0 10px; line-height: 1.75; color: ${c.textSub}; }
        .notes-preview strong { font-weight: 700; color: ${c.text}; }
        .notes-preview em { font-style: italic; color: ${c.textSub}; }
        /* Code */
        .notes-preview code { background: rgba(180,140,255,0.10); color: ${c.accent}; border-radius: 3px; padding: 1px 5px; font-size: 0.88em; font-family: ${c.mono}; }
        .notes-preview pre { background: #0d0d11; border: 1px solid rgba(185,185,189,0.12); border-radius: 6px; padding: 12px 16px; overflow-x: auto; margin: 10px 0; }
        .notes-preview pre code { background: none; padding: 0; font-size: 12px; color: rgba(220,215,240,0.85); line-height: 1.65; }
        /* Lists */
        .notes-preview ul, .notes-preview ol { padding-left: 20px; margin: 0 0 10px; color: ${c.textSub}; line-height: 1.75; }
        .notes-preview li { margin-bottom: 4px; }
        /* Task checkboxes */
        .notes-preview li:has(input[data-task]) { list-style: none; margin-left: -20px; display: flex; align-items: flex-start; gap: 8px; }
        .notes-preview input[data-task] {
          appearance: none; -webkit-appearance: none;
          width: 14px; height: 14px; flex-shrink: 0; margin-top: 3px;
          border: 1.5px solid rgba(180,140,255,0.38); border-radius: 3px;
          cursor: pointer; background: transparent;
          transition: background 0.12s, border-color 0.12s;
        }
        .notes-preview input[data-task]:hover { border-color: rgba(180,140,255,0.65); }
        .notes-preview input[data-task]:checked {
          background: rgba(180,140,255,0.82);
          border-color: rgba(180,140,255,1);
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpolyline points='2,6 5,9 10,3' stroke='white' stroke-width='1.8' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
          background-size: 10px 10px;
          background-position: center;
          background-repeat: no-repeat;
        }
        .notes-preview li:has(input[data-task]:checked) > *:not(input) { color: ${c.muted}; text-decoration: line-through; text-decoration-color: rgba(185,185,193,0.35); }
        /* Other elements */
        .notes-preview blockquote { border-left: 3px solid ${c.accentBorder}; margin: 10px 0; padding: 4px 12px; color: ${c.muted}; font-style: italic; }
        .notes-preview a { color: ${c.accent}; text-decoration: underline; text-underline-offset: 2px; }
        .notes-preview hr { border: none; border-top: 1px solid rgba(185,185,189,0.12); margin: 16px 0; }
        .notes-preview table { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 12.5px; }
        .notes-preview th, .notes-preview td { border: 1px solid rgba(185,185,189,0.14); padding: 6px 10px; text-align: left; color: ${c.textSub}; }
        .notes-preview th { background: rgba(180,140,255,0.06); color: ${c.text}; font-weight: 600; }
      `}</style>

      {/* Panel */}
      <Box style={{
        width: '100%', maxWidth: 1020, height: 'min(86vh, 840px)',
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
          padding: '12px 18px',
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
              minWidth: 52,
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
                    padding: '4px 11px', border: 'none', cursor: 'pointer',
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
              ref={textareaRef}
              value={content}
              onChange={e => handleChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={'# Audit notes\n\nWrite your findings, observations, and ideas here…\n\nSupports **markdown** — headers, lists, code blocks, and more.\n\n⌘L / Ctrl+L — insert a new task checkbox'}
              autoFocus
              style={{
                width: '100%', height: '100%',
                background: 'transparent', border: 'none', outline: 'none',
                resize: 'none', padding: '22px 26px',
                fontSize: 13, fontFamily: c.mono,
                color: c.text, lineHeight: 1.8,
                caretColor: c.accent,
              }}
            />
          ) : (
            <Box
              className="notes-preview"
              onClick={handlePreviewClick}
              style={{
                height: '100%', overflowY: 'auto',
                padding: '22px 26px',
                fontSize: 13, fontFamily: c.mono, lineHeight: 1.8,
              }}
              dangerouslySetInnerHTML={{ __html: previewHtml || '<p style="color: rgba(185,185,193,0.4); font-style: italic;">Nothing to preview yet.</p>' }}
            />
          )}
        </Box>

        {/* Footer */}
        <Flex align="center" justify="space-between" style={{
          padding: '8px 18px',
          borderTop: `1px solid ${c.border}`,
          flexShrink: 0,
        }}>
          <Flex align="center" gap="3" style={{ fontSize: 10.5, color: 'rgba(185,185,193,0.35)', fontFamily: c.mono }}>
            <span>Markdown · auto-saved</span>
            <span style={{ color: 'rgba(185,185,193,0.25)' }}>·</span>
            <span>⌘L — new task</span>
          </Flex>
          <Flex align="center" gap="1" style={{ fontSize: 10.5, color: 'rgba(185,185,193,0.35)', fontFamily: c.mono }}>
            <Check size={10} strokeWidth={2} />
            <span>Esc to close</span>
          </Flex>
        </Flex>
      </Box>
    </Box>
  )
}
