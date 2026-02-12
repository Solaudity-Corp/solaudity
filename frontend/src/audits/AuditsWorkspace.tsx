import { useMemo, useState } from 'react'
import { css, cx } from 'styled-system/css'
import { Box, Flex, Grid, Stack } from 'styled-system/jsx'
import { ArrowUpRight, CircleDot, Clock3, GitBranch, Link2, Paperclip, Pin, Plus } from 'lucide-react'
import { AccentLink, Badge, Button, Card } from '../components/ui'
import { createDraftAudit, mockAudits, type AuditRecord, type AuditStatus } from './mockAudits'

interface AuditsWorkspaceProps {
  searchQuery: string
}

const statusLabel: Record<AuditStatus, string> = {
  draft: 'Not started',
  in_progress: 'Ongoing',
  completed: 'Finished',
  archived: 'Archived',
}

const statusPaletteByState: Record<AuditStatus, 'green' | 'orange' | 'purple' | 'gray'> = {
  draft: 'purple',
  in_progress: 'orange',
  completed: 'green',
  archived: 'gray',
}

const ui = {
  textPrimary: 'rgba(231, 228, 239, 0.91)',
  textSecondary: 'rgba(231, 228, 239, 0.67)',
  textMuted: 'rgba(231, 228, 239, 0.61)',
  borderFaint: 'rgba(185, 185, 189, 0.14)',
  borderSoft: 'rgba(185, 185, 189, 0.22)',
  surfaceSidebar: 'rgba(16, 16, 21, 0.92)',
  surfaceContent: 'rgba(22, 22, 27, 0.88)',
  surfaceCard: 'rgba(24, 24, 29, 0.84)',
}

function formatRelativeTime(date: string) {
  const diffMs = Date.now() - new Date(date).getTime()
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour

  if (diffMs < hour) return `${Math.max(1, Math.floor(diffMs / minute))}m ago`
  if (diffMs < day) return `${Math.floor(diffMs / hour)}h ago`
  return `${Math.floor(diffMs / day)}d ago`
}

function formatDate(date: string | null) {
  if (!date) return 'Not set'
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatDateTime(date: string | null) {
  if (!date) return 'Never'
  return new Date(date).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function matchAudit(audit: AuditRecord, query: string) {
  const value = query.trim().toLowerCase()
  if (!value) return true

  const blob = [
    audit.title,
    audit.slug ?? '',
    audit.description ?? '',
    audit.status,
    audit.chain ?? '',
    audit.network ?? '',
    audit.repo_url ?? '',
    audit.commit_hash ?? '',
    audit.docs_url ?? '',
  ]
    .join(' ')
    .toLowerCase()

  return blob.includes(value)
}

function buildCommitUrl(repoUrl: string | null, commitHash: string | null): string | null {
  if (!repoUrl || !commitHash) return null
  const repo = repoUrl.replace(/\/+$/, '')
  return `${repo}/commit/${commitHash}`
}

function buildAttachmentUrl(audit: AuditRecord, storageKey: string): string {
  if (/^https?:\/\//i.test(storageKey)) return storageKey

  const safePath = storageKey
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')

  if (audit.repo_url) {
    const repo = audit.repo_url.replace(/\/+$/, '')
    const ref = audit.commit_hash ?? 'main'
    return `${repo}/blob/${ref}/${safePath}`
  }

  return `https://files.example.com/${safePath}`
}

function ValueCell(props: { value: string; href?: string | null }) {
  if (props.href) {
    return (
      <AccentLink
        href={props.href}
        className={css({
          justifyContent: 'flex-end',
          textAlign: 'right',
        })}
      >
        {props.value}
      </AccentLink>
    )
  }

  return <>{props.value}</>
}

function InfoRow(props: { label: string; value: string; href?: string | null }) {
  return (
    <Flex justify="space-between" gap="4" className={css({ py: '2', borderBottom: `1px solid ${ui.borderFaint}` })}>
      <Box className={css({ color: ui.textSecondary, fontSize: 'xs', lineHeight: '1.55' })}>{props.label}</Box>
      <Box
        className={css({
          color: ui.textPrimary,
          fontSize: 'sm',
          lineHeight: '1.58',
          textAlign: 'right',
          maxW: '66%',
          minW: '0',
          overflowWrap: 'anywhere',
          wordBreak: 'break-word',
          whiteSpace: 'normal',
        })}
      >
        <ValueCell value={props.value} href={props.href} />
      </Box>
    </Flex>
  )
}

export function AuditsWorkspace({ searchQuery }: AuditsWorkspaceProps) {
  const [audits, setAudits] = useState<AuditRecord[]>(mockAudits)
  const [selectedAuditId, setSelectedAuditId] = useState<string>(mockAudits[0]?.id ?? '')

  const filteredAudits = useMemo(
    () => audits.filter((audit) => matchAudit(audit, searchQuery)),
    [audits, searchQuery],
  )

  const selectedAudit = useMemo(
    () => filteredAudits.find((audit) => audit.id === selectedAuditId) ?? filteredAudits[0] ?? null,
    [filteredAudits, selectedAuditId],
  )

  const inProgressCount = audits.filter((audit) => audit.status === 'in_progress').length
  const completedCount = audits.filter((audit) => audit.status === 'completed').length
  const draftCount = audits.filter((audit) => audit.status === 'draft').length

  const createAudit = () => {
    const nextAudit = createDraftAudit(audits.length + 1)
    setAudits((previous) => [nextAudit, ...previous])
    setSelectedAuditId(nextAudit.id)
  }

  const togglePin = (auditId: string) => {
    setAudits((previous) =>
      previous.map((audit) =>
        audit.id === auditId
          ? { ...audit, is_pinned: !audit.is_pinned, updated_at: new Date().toISOString() }
          : audit,
      ),
    )
  }

  return (
    <Flex direction="column" flex="1" minH="0" px={{ base: '4', md: '8' }} py={{ base: '5', md: '7' }}>
      <Box
        className={css({
          flex: '1',
          minH: '0',
          borderRadius: '24px',
          border: `1px solid ${ui.borderSoft}`,
          bg: 'linear-gradient(145deg, rgba(20, 20, 25, 0.95), rgba(14, 14, 18, 0.94))',
          boxShadow: '0 14px 30px rgba(0, 0, 0, 0.34), inset 0 1px 0 rgba(255, 255, 255, 0.03)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        })}
      >
        <Box
          className={css({
            px: { base: '3', md: '4' },
            py: '4',
            bg: ui.surfaceSidebar,
            borderBottom: `1px solid ${ui.borderFaint}`,
          })}
        >
          <Flex align={{ base: 'flex-start', md: 'center' }} justify="space-between" wrap="wrap" gap="3">
            <Button
              onClick={createAudit}
              className={css({
                bg: '#e7e4ef',
                color: '#17171a',
                borderRadius: '10px',
                px: '7',
                fontWeight: '700',
                border: '1px solid rgba(231, 228, 239, 0.9)',
                _hover: { bg: '#f2effb' },
              })}
            >
              <Plus size={16} />
              New Audit
            </Button>

            <Flex gap="2.5" wrap="wrap" align="center">
              <Flex align="center" gap="2">
                <Badge colorPalette="orange">Ongoing</Badge>
                <Box
                  className={css({
                    minW: '7',
                    h: '6',
                    px: '2',
                    borderRadius: '8px',
                    border: `1px solid ${ui.borderSoft}`,
                    bg: 'transparent',
                    color: ui.textPrimary,
                    fontSize: 'xs',
                    fontWeight: '700',
                    display: 'grid',
                    placeItems: 'center',
                  })}
                >
                  {inProgressCount}
                </Box>
              </Flex>
              <Flex align="center" gap="2">
                <Badge colorPalette="green">Finished</Badge>
                <Box
                  className={css({
                    minW: '7',
                    h: '6',
                    px: '2',
                    borderRadius: '8px',
                    border: `1px solid ${ui.borderSoft}`,
                    bg: 'transparent',
                    color: ui.textPrimary,
                    fontSize: 'xs',
                    fontWeight: '700',
                    display: 'grid',
                    placeItems: 'center',
                  })}
                >
                  {completedCount}
                </Box>
              </Flex>
              <Flex align="center" gap="2">
                <Badge colorPalette="purple">Not started</Badge>
                <Box
                  className={css({
                    minW: '7',
                    h: '6',
                    px: '2',
                    borderRadius: '8px',
                    border: `1px solid ${ui.borderSoft}`,
                    bg: 'transparent',
                    color: ui.textPrimary,
                    fontSize: 'xs',
                    fontWeight: '700',
                    display: 'grid',
                    placeItems: 'center',
                  })}
                >
                  {draftCount}
                </Box>
              </Flex>
            </Flex>
          </Flex>
        </Box>

        <Flex flex="1" minH="0" direction={{ base: 'column', lg: 'row' }}>
          <Box
            className={css({
              w: { base: 'full', lg: '370px' },
              borderRight: { base: 'none', lg: `1px solid ${ui.borderFaint}` },
              borderBottom: { base: `1px solid ${ui.borderFaint}`, lg: 'none' },
              bg: ui.surfaceSidebar,
              display: 'flex',
              flexDirection: 'column',
              minH: { base: '280px', lg: '0' },
            })}
          >
            <Flex align="center" justify="space-between" px="5" py="4" className={css({ borderBottom: `1px solid ${ui.borderFaint}` })}>
              <Box className={css({ fontSize: 'calc(1.125rem + 2px)', color: ui.textPrimary, fontWeight: '800', letterSpacing: '0.03em' })}>
                AUDITS
              </Box>
              <Box className={css({ fontSize: 'xs', color: ui.textSecondary, border: `1px solid ${ui.borderSoft}`, borderRadius: 'full', px: '2.5', py: '1' })}>
                {filteredAudits.length}
              </Box>
            </Flex>

            <Stack gap="3.5" px="4" pb="5" pt="4" className={css({ overflowY: 'auto', minH: '0' })}>
              {filteredAudits.length === 0 && (
                <Box
                  className={css({
                    borderRadius: '14px',
                    border: `1px dashed ${ui.borderSoft}`,
                    px: '4',
                    py: '5',
                    color: ui.textSecondary,
                    fontSize: 'sm',
                    lineHeight: '1.58',
                  })}
                >
                  No audits match your search.
                </Box>
              )}

              {filteredAudits.map((audit) => {
                const isActive = audit.id === selectedAudit?.id
                return (
                  <div
                    key={audit.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedAuditId(audit.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        setSelectedAuditId(audit.id)
                      }
                    }}
                    className={cx(
                      css({
                        textAlign: 'left',
                        borderRadius: '14px',
                        border: `1px solid ${ui.borderSoft}`,
                        background: 'rgba(24, 24, 29, 0.74)',
                        px: '4',
                        py: '3',
                        cursor: 'pointer',
                        transition: 'all 160ms ease',
                        boxShadow: '0 6px 16px rgba(0, 0, 0, 0.2)',
                        _hover: {
                          borderColor: 'rgba(225, 225, 231, 0.32)',
                          background: 'rgba(30, 30, 36, 0.84)',
                        },
                        _focusVisible: {
                          outline: '1px solid rgba(225, 225, 231, 0.28)',
                          outlineOffset: '1px',
                        },
                      }),
                      isActive &&
                        css({
                          borderColor: 'rgba(143, 230, 255, 0.5)',
                          background: 'rgba(0, 162, 199, 0.08)',
                          boxShadow: '0 0 0 1px rgba(0, 162, 199, 0.22) inset, 0 6px 16px rgba(0, 0, 0, 0.22)',
                        }),
                    )}
                  >
                    <Flex align="center" justify="space-between" gap="2">
                      <Flex align="center" gap="2">
                        <CircleDot size={14} className={css({ color: 'rgba(229, 229, 235, 0.84)' })} />
                        <Box className={css({ color: ui.textPrimary, fontWeight: '600', fontSize: 'sm', lineHeight: '1.45' })}>
                          {audit.title}
                        </Box>
                      </Flex>
                      <button
                        type="button"
                        aria-label={audit.is_pinned ? 'Unpin audit' : 'Pin audit'}
                        onClick={(event) => {
                          event.stopPropagation()
                          togglePin(audit.id)
                        }}
                        className={cx(
                          css({
                            display: 'grid',
                            placeItems: 'center',
                            width: '1.5rem',
                            height: '1.5rem',
                            borderRadius: 'full',
                            border: '1px solid transparent',
                            background: 'transparent',
                            color: ui.textSecondary,
                            transform: 'rotate(90deg)',
                            transition: 'all 160ms ease',
                            cursor: 'pointer',
                            '& svg': {
                              fill: 'transparent',
                            },
                            _hover: {
                              borderColor: 'rgba(185, 185, 189, 0.32)',
                              background: 'rgba(45, 45, 52, 0.55)',
                              color: ui.textPrimary,
                            },
                          }),
                          audit.is_pinned &&
                            css({
                              transform: 'rotate(0deg)',
                              borderColor: 'rgba(185, 185, 189, 0.4)',
                              background: 'rgba(54, 54, 62, 0.72)',
                              color: ui.textPrimary,
                              '& svg': {
                                fill: 'currentColor',
                              },
                            }),
                        )}
                      >
                        <Pin size={14} strokeWidth={2.2} />
                      </button>
                    </Flex>
                    <Flex align="center" justify="space-between" mt="2">
                      <Badge colorPalette={statusPaletteByState[audit.status]}>{statusLabel[audit.status]}</Badge>
                      <Box className={css({ color: ui.textSecondary, fontSize: 'xs', lineHeight: '1.55' })}>
                        {formatRelativeTime(audit.updated_at)}
                      </Box>
                    </Flex>
                    <Flex align="center" gap="2" mt="2">
                      <GitBranch size={13} className={css({ color: ui.textMuted })} />
                      <Box className={css({ color: ui.textSecondary, fontSize: 'xs', lineHeight: '1.55' })}>
                        {(audit.chain ?? 'unknown').toLowerCase()} / {(audit.network ?? 'unknown').toLowerCase()}
                      </Box>
                    </Flex>
                  </div>
                )
              })}
            </Stack>
          </Box>

          <Box
            className={css({
              flex: '1',
              minH: '0',
              overflowY: 'auto',
              p: { base: '4', md: '6' },
              bg: ui.surfaceContent,
            })}
          >
            {!selectedAudit && (
              <Flex
                h="full"
                align="center"
                justify="center"
                className={css({
                  color: ui.textSecondary,
                  border: `1px dashed ${ui.borderSoft}`,
                  borderRadius: '16px',
                  minH: '220px',
                  lineHeight: '1.58',
                })}
              >
                Select an audit to print audit information.
              </Flex>
            )}

            {selectedAudit && (
              <Stack gap="5">
                <Flex justify="space-between" align={{ base: 'flex-start', md: 'center' }} wrap="wrap" gap="3">
                  <Box>
                    <Flex align="center" gap="2">
                      <Box className={css({ fontSize: 'calc(1.25rem + 2px)', fontWeight: '800', color: ui.textPrimary, lineHeight: '1.4' })}>
                        {selectedAudit.title}
                      </Box>
                      {selectedAudit.is_pinned && (
                        <Pin size={14} className={css({ color: ui.textSecondary })} />
                      )}
                    </Flex>
                    <Box className={css({ mt: '1', color: ui.textSecondary, fontSize: 'sm', lineHeight: '1.55' })}>
                      {selectedAudit.slug ?? 'No slug yet'}
                    </Box>
                  </Box>

                  <Badge colorPalette={statusPaletteByState[selectedAudit.status]}>
                    {statusLabel[selectedAudit.status]}
                  </Badge>
                </Flex>

                <Card.Root
                  variant="outline"
                  className={css({
                    borderColor: ui.borderFaint,
                    bg: ui.surfaceCard,
                    boxShadow: '0 8px 18px rgba(0, 0, 0, 0.22)',
                  })}
                >
                  <Card.Header className={css({ pb: '3' })}>
                    <Card.Title className={css({ fontSize: 'calc(1rem + 2px)', color: ui.textPrimary, fontWeight: '700' })}>
                      Description
                    </Card.Title>
                  </Card.Header>
                  <Card.Body>
                    <Box className={css({ color: ui.textPrimary, fontSize: 'sm', lineHeight: '1.72' })}>
                      {selectedAudit.description ?? 'No description provided yet.'}
                    </Box>
                  </Card.Body>
                </Card.Root>

                <Grid columns={{ base: 1, xl: 2 }} gap="5">
                  <Card.Root
                    variant="outline"
                    className={css({
                      borderColor: ui.borderFaint,
                      bg: ui.surfaceCard,
                      boxShadow: '0 8px 18px rgba(0, 0, 0, 0.22)',
                    })}
                  >
                    <Card.Header className={css({ pb: '2' })}>
                      <Card.Title className={css({ fontSize: 'calc(1rem + 2px)', color: ui.textPrimary, fontWeight: '700' })}>
                        Context
                      </Card.Title>
                    </Card.Header>
                    <Card.Body className={css({ pt: '0' })}>
                      <InfoRow label="Chain" value={selectedAudit.chain ?? 'Not set'} />
                      <InfoRow label="Network" value={selectedAudit.network ?? 'Not set'} />
                      <InfoRow
                        label="Repository"
                        value={selectedAudit.repo_url ?? 'Not set'}
                        href={selectedAudit.repo_url}
                      />
                      <InfoRow
                        label="Commit"
                        value={selectedAudit.commit_hash ?? 'Not set'}
                        href={buildCommitUrl(selectedAudit.repo_url, selectedAudit.commit_hash)}
                      />
                      <InfoRow
                        label="Docs"
                        value={selectedAudit.docs_url ?? 'Not set'}
                        href={selectedAudit.docs_url}
                      />
                    </Card.Body>
                  </Card.Root>

                  <Card.Root
                    variant="outline"
                    className={css({
                      borderColor: ui.borderFaint,
                      bg: ui.surfaceCard,
                      boxShadow: '0 8px 18px rgba(0, 0, 0, 0.22)',
                    })}
                  >
                    <Card.Header className={css({ pb: '2' })}>
                      <Card.Title className={css({ fontSize: 'calc(1rem + 2px)', color: ui.textPrimary, fontWeight: '700' })}>
                        Timeline & Resume
                      </Card.Title>
                    </Card.Header>
                    <Card.Body className={css({ pt: '0' })}>
                      <InfoRow label="Start date" value={formatDate(selectedAudit.start_date)} />
                      <InfoRow label="End date" value={formatDate(selectedAudit.end_date)} />
                      <InfoRow label="Created at" value={formatDateTime(selectedAudit.created_at)} />
                      <InfoRow label="Updated at" value={formatDateTime(selectedAudit.updated_at)} />
                      <InfoRow label="Last opened" value={formatDateTime(selectedAudit.last_opened_at)} />
                    </Card.Body>
                  </Card.Root>
                </Grid>

                <Card.Root
                  variant="outline"
                  className={css({
                    borderColor: ui.borderFaint,
                    bg: ui.surfaceCard,
                    boxShadow: '0 8px 18px rgba(0, 0, 0, 0.22)',
                  })}
                >
                  <Card.Header className={css({ pb: '3' })}>
                    <Flex align="center" gap="2">
                      <Paperclip size={15} className={css({ color: ui.textMuted })} />
                      <Card.Title className={css({ fontSize: 'calc(1rem + 2px)', color: ui.textPrimary, fontWeight: '700' })}>
                        Attachments ({selectedAudit.attachments.length})
                      </Card.Title>
                    </Flex>
                  </Card.Header>
                  <Card.Body>
                    {selectedAudit.attachments.length === 0 && (
                      <Box className={css({ color: ui.textSecondary, fontSize: 'sm', lineHeight: '1.58' })}>
                        No files uploaded yet.
                      </Box>
                    )}
                    <Stack gap="2.5">
                      {selectedAudit.attachments.map((attachment) => (
                        <Flex
                          key={attachment.id}
                          align={{ base: 'flex-start', md: 'center' }}
                          justify="space-between"
                          gap="3"
                          wrap="wrap"
                          className={css({
                            border: `1px solid ${ui.borderFaint}`,
                            borderRadius: '12px',
                            px: '3',
                            py: '2.5',
                            bg: 'rgba(27, 27, 31, 0.62)',
                            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)',
                          })}
                        >
                          <Box>
                            <Flex align="center" gap="2">
                              <Link2 size={13} className={css({ color: ui.textSecondary })} />
                              <AccentLink
                                href={buildAttachmentUrl(selectedAudit, attachment.storage_key)}
                                className={css({
                                  fontSize: 'sm',
                                  fontWeight: '600',
                                  lineHeight: '1.55',
                                  maxW: '100%',
                                })}
                              >
                                {attachment.original_name}
                                <ArrowUpRight size={12} />
                              </AccentLink>
                            </Flex>
                            <Box className={css({ color: ui.textSecondary, fontSize: 'xs', mt: '1', lineHeight: '1.55' })}>
                              {attachment.mime_type} • .{attachment.file_ext} • {formatBytes(attachment.size_bytes)}
                            </Box>
                          </Box>
                          <Flex align="center" gap="2" className={css({ color: ui.textMuted, fontSize: 'xs', lineHeight: '1.55' })}>
                            <Clock3 size={12} />
                            {formatRelativeTime(selectedAudit.updated_at)}
                          </Flex>
                        </Flex>
                      ))}
                    </Stack>
                  </Card.Body>
                </Card.Root>
              </Stack>
            )}
          </Box>
        </Flex>
      </Box>
    </Flex>
  )
}
