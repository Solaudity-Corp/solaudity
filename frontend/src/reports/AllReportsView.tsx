import { useEffect, useState } from 'react'
import { Box, Flex } from 'styled-system/jsx'
import { FileText, ChevronRight } from 'lucide-react'
import * as api from './api'
import type { FindingWithAudit } from './api'

const t = {
  text: 'rgba(231,228,239,0.91)',
  textSub: 'rgba(231,228,239,0.65)',
  muted: 'rgba(185,185,193,0.5)',
  border: 'rgba(185,185,189,0.1)',
  borderMid: 'rgba(185,185,189,0.16)',
  card: 'rgba(18,18,24,0.82)',
  mono: "'Roboto Mono', ui-monospace, monospace",
}

const severityColor: Record<string, string> = {
  Critical:      'rgba(255,59,59,0.9)',
  High:          'rgba(255,112,67,0.9)',
  Medium:        'rgba(255,183,77,0.9)',
  Low:           'rgba(255,230,100,0.9)',
  Informational: 'rgba(129,212,250,0.9)',
  Gas:           'rgba(165,214,167,0.9)',
}

const severityBg: Record<string, string> = {
  Critical:      'rgba(255,59,59,0.12)',
  High:          'rgba(255,112,67,0.12)',
  Medium:        'rgba(255,183,77,0.12)',
  Low:           'rgba(255,230,100,0.1)',
  Informational: 'rgba(129,212,250,0.1)',
  Gas:           'rgba(165,214,167,0.1)',
}

const SEVERITIES = ['Critical', 'High', 'Medium', 'Low', 'Informational', 'Gas']

interface Props {
  searchQuery: string
  onNavigate: (path: string) => void
}

export function AllReportsView({ searchQuery, onNavigate }: Props) {
  const [findings, setFindings] = useState<FindingWithAudit[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.allFindings()
      .then(setFindings)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const q = searchQuery.toLowerCase()
  const filtered = findings.filter(f =>
    !q ||
    f.title.toLowerCase().includes(q) ||
    f.audit_title.toLowerCase().includes(q) ||
    f.severity.toLowerCase().includes(q) ||
    f.scope.toLowerCase().includes(q)
  )

  // Group by audit_id
  const grouped = filtered.reduce<Record<string, { title: string; items: FindingWithAudit[] }>>((acc, f) => {
    if (!acc[f.audit_id]) acc[f.audit_id] = { title: f.audit_title, items: [] }
    acc[f.audit_id].items.push(f)
    return acc
  }, {})

  if (loading) {
    return (
      <Flex flex="1" align="center" justify="center">
        <span style={{ fontSize: 12, fontFamily: t.mono, color: t.muted }}>Loading…</span>
      </Flex>
    )
  }

  if (Object.keys(grouped).length === 0) {
    return (
      <Flex flex="1" align="center" justify="center" direction="column" gap="2">
        <FileText size={32} style={{ color: 'rgba(185,185,193,0.25)' }} />
        <span style={{ fontSize: 13, fontFamily: t.mono, color: t.muted }}>
          {searchQuery ? 'No findings match your search' : 'No findings across any audit yet'}
        </span>
      </Flex>
    )
  }

  return (
    <Box style={{ padding: '28px 32px', flex: 1, overflowY: 'auto' }}>
      {/* Summary row */}
      <Flex align="center" justify="space-between" style={{ marginBottom: 24 }}>
        <span style={{ fontSize: 13, fontFamily: t.mono, color: t.muted }}>
          {filtered.length} finding{filtered.length !== 1 ? 's' : ''} across {Object.keys(grouped).length} audit{Object.keys(grouped).length !== 1 ? 's' : ''}
        </span>
        <Flex gap="2" wrap="wrap">
          {SEVERITIES.map(s => {
            const count = filtered.filter(f => f.severity === s).length
            if (!count) return null
            return (
              <span key={s} style={{
                fontSize: 10, fontFamily: t.mono, fontWeight: 700,
                padding: '2px 7px', borderRadius: 4,
                background: severityBg[s], color: severityColor[s],
                border: `1px solid ${severityColor[s].replace('0.9', '0.25')}`,
              }}>
                {count} {s}
              </span>
            )
          })}
        </Flex>
      </Flex>

      {/* Audit groups */}
      <Flex direction="column" gap="5">
        {Object.entries(grouped).map(([auditId, group]) => {
          const counts = group.items.reduce<Record<string, number>>((acc, f) => {
            acc[f.severity] = (acc[f.severity] ?? 0) + 1
            return acc
          }, {})

          return (
            <Box key={auditId} style={{ borderRadius: 10, border: `1px solid ${t.border}`, background: t.card, overflow: 'hidden' }}>
              {/* Group header */}
              <Flex
                align="center"
                justify="space-between"
                style={{
                  padding: '12px 16px',
                  borderBottom: `1px solid ${t.border}`,
                  background: 'rgba(0,0,0,0.2)',
                  cursor: 'pointer',
                }}
                onClick={() => onNavigate(`/reports/${auditId}`)}
              >
                <Flex align="center" gap="2">
                  <FileText size={14} style={{ color: 'rgba(255,90,80,0.7)', flexShrink: 0 }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: t.text }}>{group.title}</span>
                  <span style={{ fontSize: 10, fontFamily: t.mono, color: t.muted }}>
                    — {group.items.length} finding{group.items.length !== 1 ? 's' : ''}
                  </span>
                </Flex>
                <Flex align="center" gap="2">
                  {SEVERITIES.filter(s => counts[s]).map(s => (
                    <span key={s} style={{
                      fontSize: 9.5, fontFamily: t.mono, fontWeight: 700,
                      padding: '2px 6px', borderRadius: 4,
                      background: severityBg[s], color: severityColor[s],
                      border: `1px solid ${severityColor[s].replace('0.9', '0.25')}`,
                    }}>
                      {counts[s]} {s}
                    </span>
                  ))}
                  <ChevronRight size={13} style={{ color: t.muted }} />
                </Flex>
              </Flex>

              {/* Findings list */}
              {group.items.map((f, i) => (
                <Flex
                  key={f.id}
                  align="center"
                  gap="3"
                  style={{
                    padding: '9px 16px',
                    borderBottom: i < group.items.length - 1 ? `1px solid ${t.border}` : 'none',
                    cursor: 'pointer',
                  }}
                  onClick={() => onNavigate(`/reports/${auditId}`)}
                  className="finding-row"
                >
                  <span style={{ fontSize: 10, fontFamily: t.mono, color: t.muted, minWidth: 22 }}>#{i + 1}</span>
                  <span style={{
                    fontSize: 9.5, fontFamily: t.mono, fontWeight: 700,
                    padding: '1px 6px', borderRadius: 4, flexShrink: 0,
                    background: severityBg[f.severity] ?? 'transparent',
                    color: severityColor[f.severity] ?? t.muted,
                    border: `1px solid ${(severityColor[f.severity] ?? t.muted).replace('0.9', '0.25')}`,
                  }}>
                    {f.severity.toUpperCase()}
                  </span>
                  <span style={{ flex: 1, fontSize: 12.5, color: f.title ? t.text : t.muted, fontStyle: f.title ? 'normal' : 'italic' }}>
                    {f.title || 'Untitled finding'}
                  </span>
                  {f.scope && (
                    <span style={{ fontSize: 10.5, fontFamily: t.mono, color: t.muted, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {f.scope}
                    </span>
                  )}
                  <span style={{
                    fontSize: 9.5, fontFamily: t.mono,
                    padding: '1px 6px', borderRadius: 4,
                    background: f.status === 'Fixed' ? 'rgba(88,214,171,0.1)' : 'rgba(185,185,193,0.06)',
                    color: f.status === 'Fixed' ? 'rgba(88,214,171,0.8)' : t.muted,
                    border: `1px solid ${f.status === 'Fixed' ? 'rgba(88,214,171,0.2)' : t.border}`,
                    flexShrink: 0,
                  }}>
                    {f.status}
                  </span>
                </Flex>
              ))}
            </Box>
          )
        })}
      </Flex>

      <style>{`.finding-row:hover { background: rgba(255,255,255,0.02); }`}</style>
    </Box>
  )
}
