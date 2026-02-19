import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { css, cx } from 'styled-system/css'
import { Box, Flex, Grid, Stack } from 'styled-system/jsx'
import { ArrowUpRight, ChevronDown, CircleDot, Clock3, GitBranch, Link2, Paperclip, Pin, Plus, Sparkles, Trash2, X } from 'lucide-react'
import { AccentLink, Badge, Button, Card, Field, Input } from '../components/ui'
import {
  ApiError,
  createAudit as createAuditRequest,
  deleteAudit as deleteAuditRequest,
  extractAuditFields,
  type ExtractAuditFieldsRead,
  type AuditStatusCounts,
  listAudits,
  markAuditOpened,
  setAuditPin,
} from './api'
import { type AuditRecord, type AuditStatus } from './types'

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

const EMPTY_STATUS_COUNTS: AuditStatusCounts = {
  draft: 0,
  in_progress: 0,
  completed: 0,
  archived: 0,
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

const MAX_TITLE_LENGTH = 255
const MAX_SLUG_LENGTH = 120
const MAX_DESCRIPTION_LENGTH = 5000
const MAX_CONTEXT_LENGTH = 100
const MAX_URL_LENGTH = 2048
const MAX_EXTRACTION_TEXT_LENGTH = 50_000
const COMMIT_HASH_RE = /^[0-9a-f]{7,40}$/
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

interface CreateAuditFormValues {
  title: string
  slug: string
  description: string
  status: AuditStatus
  is_pinned: boolean
  chain: string
  network: string
  repo_url: string
  commit_hash: string
  docs_url: string
  start_date: string
  end_date: string
}

type CreateAuditFormErrors = Partial<Record<keyof CreateAuditFormValues, string>>
type ExtractStatus = { kind: 'success' | 'error'; message: string } | null

function getInitialCreateAuditForm(): CreateAuditFormValues {
  return {
    title: '',
    slug: '',
    description: '',
    status: 'draft',
    is_pinned: false,
    chain: '',
    network: '',
    repo_url: '',
    commit_hash: '',
    docs_url: '',
    start_date: '',
    end_date: '',
  }
}

function toOptionalText(value: string): string | null {
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function normalizeExtractedSlug(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')

  return normalized.slice(0, MAX_SLUG_LENGTH)
}

function mergeExtractedFields(
  current: CreateAuditFormValues,
  fields: ExtractAuditFieldsRead,
): CreateAuditFormValues {
  const next: CreateAuditFormValues = { ...current }

  if (fields.title !== null) next.title = fields.title.slice(0, MAX_TITLE_LENGTH)
  if (fields.slug !== null) next.slug = normalizeExtractedSlug(fields.slug)
  if (fields.description !== null) next.description = fields.description.slice(0, MAX_DESCRIPTION_LENGTH)
  if (fields.chain !== null) next.chain = fields.chain.slice(0, MAX_CONTEXT_LENGTH)
  if (fields.network !== null) next.network = fields.network.slice(0, MAX_CONTEXT_LENGTH)
  if (fields.repo_url !== null) next.repo_url = fields.repo_url.slice(0, MAX_URL_LENGTH)
  if (fields.commit_hash !== null) next.commit_hash = fields.commit_hash.trim().toLowerCase().slice(0, 40)
  if (fields.docs_url !== null) next.docs_url = fields.docs_url.slice(0, MAX_URL_LENGTH)
  if (fields.start_date !== null) next.start_date = fields.start_date.slice(0, 10)
  if (fields.end_date !== null) next.end_date = fields.end_date.slice(0, 10)

  return next
}

function isValidHttpUrl(value: string) {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function validateCreateAuditForm(values: CreateAuditFormValues, audits: AuditRecord[]): CreateAuditFormErrors {
  const errors: CreateAuditFormErrors = {}
  const title = values.title.trim()
  const slug = values.slug.trim().toLowerCase()
  const description = values.description.trim()
  const chain = values.chain.trim()
  const network = values.network.trim()
  const repoUrl = values.repo_url.trim()
  const docsUrl = values.docs_url.trim()
  const commitHash = values.commit_hash.trim().toLowerCase()

  if (!title) errors.title = 'Title is required.'
  else if (title.length > MAX_TITLE_LENGTH) {
    errors.title = `Title must be at most ${MAX_TITLE_LENGTH} characters.`
  }

  if (slug) {
    if (slug.length > MAX_SLUG_LENGTH) {
      errors.slug = `Slug must be at most ${MAX_SLUG_LENGTH} characters.`
    } else if (!SLUG_RE.test(slug)) {
      errors.slug = 'Slug must be lowercase kebab-case (example: my-audit).'
    } else if (audits.some((audit) => audit.slug?.toLowerCase() === slug)) {
      errors.slug = 'Slug is already used by another audit.'
    }
  }

  if (description.length > MAX_DESCRIPTION_LENGTH) {
    errors.description = `Description must be at most ${MAX_DESCRIPTION_LENGTH} characters.`
  }

  if (chain.length > MAX_CONTEXT_LENGTH) {
    errors.chain = `Chain must be at most ${MAX_CONTEXT_LENGTH} characters.`
  }

  if (network.length > MAX_CONTEXT_LENGTH) {
    errors.network = `Network must be at most ${MAX_CONTEXT_LENGTH} characters.`
  }

  if (repoUrl) {
    if (repoUrl.length > MAX_URL_LENGTH) {
      errors.repo_url = `Repository URL must be at most ${MAX_URL_LENGTH} characters.`
    } else if (!isValidHttpUrl(repoUrl)) {
      errors.repo_url = 'Repository URL must be a valid http(s) URL.'
    }
  }

  if (docsUrl) {
    if (docsUrl.length > MAX_URL_LENGTH) {
      errors.docs_url = `Docs URL must be at most ${MAX_URL_LENGTH} characters.`
    } else if (!isValidHttpUrl(docsUrl)) {
      errors.docs_url = 'Docs URL must be a valid http(s) URL.'
    }
  }

  if (commitHash) {
    if (!COMMIT_HASH_RE.test(commitHash)) {
      errors.commit_hash = 'Commit hash must be 7-40 lowercase hex characters.'
    }
  }

  if (values.start_date && values.end_date && values.end_date < values.start_date) {
    errors.end_date = 'End date must be greater than or equal to start date.'
  }

  return errors
}

function getMessageFromError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return 'Unexpected error while calling audits API.'
}

function getCreateAuditServerErrors(error: unknown): CreateAuditFormErrors {
  if (!(error instanceof ApiError) || error.status !== 422 || !Array.isArray(error.detail)) {
    return {}
  }

  const errors: CreateAuditFormErrors = {}
  for (const issue of error.detail) {
    if (!issue || typeof issue !== 'object') continue

    const locValue = 'loc' in issue ? issue.loc : undefined
    const msgValue = 'msg' in issue ? issue.msg : undefined
    if (!Array.isArray(locValue) || typeof msgValue !== 'string') continue

    const fieldName = String(locValue[locValue.length - 1] ?? '')
    if (
      fieldName === 'title' ||
      fieldName === 'slug' ||
      fieldName === 'description' ||
      fieldName === 'status' ||
      fieldName === 'is_pinned' ||
      fieldName === 'chain' ||
      fieldName === 'network' ||
      fieldName === 'repo_url' ||
      fieldName === 'commit_hash' ||
      fieldName === 'docs_url' ||
      fieldName === 'start_date' ||
      fieldName === 'end_date'
    ) {
      errors[fieldName] = msgValue
    }
  }

  return errors
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
  const [audits, setAudits] = useState<AuditRecord[]>([])
  const [selectedAuditId, setSelectedAuditId] = useState<string>('')
  const [statusCounts, setStatusCounts] = useState<AuditStatusCounts>(EMPTY_STATUS_COUNTS)
  const [isLoadingAudits, setIsLoadingAudits] = useState(true)
  const [auditsError, setAuditsError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false)
  const [pinningAuditId, setPinningAuditId] = useState<string | null>(null)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [isDeletingAudit, setIsDeletingAudit] = useState(false)
  const [deleteModalError, setDeleteModalError] = useState<string | null>(null)
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(searchQuery)
  const [createAuditForm, setCreateAuditForm] = useState<CreateAuditFormValues>(getInitialCreateAuditForm)
  const [createAuditErrors, setCreateAuditErrors] = useState<CreateAuditFormErrors>({})
  const [isExtractionPanelOpen, setIsExtractionPanelOpen] = useState(false)
  const [extractInputText, setExtractInputText] = useState('')
  const [extractStatus, setExtractStatus] = useState<ExtractStatus>(null)
  const [extractMeta, setExtractMeta] = useState<{ provider: string; model: string } | null>(null)
  const [extractNeedsProfileSetup, setExtractNeedsProfileSetup] = useState(false)
  const [isExtractingFields, setIsExtractingFields] = useState(false)
  const fetchRequestIdRef = useRef(0)

  const filteredAudits = audits

  const selectedAudit = useMemo(
    () => filteredAudits.find((audit) => audit.id === selectedAuditId) ?? filteredAudits[0] ?? null,
    [filteredAudits, selectedAuditId],
  )

  const inProgressCount = statusCounts.in_progress
  const completedCount = statusCounts.completed
  const draftCount = statusCounts.draft
  const isAnyModalOpen = isCreateModalOpen || isDeleteModalOpen

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery)
    }, 250)

    return () => window.clearTimeout(timeout)
  }, [searchQuery])

  const loadAudits = useCallback(
    async (options?: { preferredAuditId?: string }) => {
      const requestId = fetchRequestIdRef.current + 1
      fetchRequestIdRef.current = requestId

      setIsLoadingAudits(true)
      setAuditsError(null)

      try {
        const response = await listAudits({
          search: debouncedSearchQuery.trim() || undefined,
          include_archived: true,
          limit: 200,
          offset: 0,
        })

        if (requestId !== fetchRequestIdRef.current) return

        setAudits(response.items)
        setStatusCounts(response.counts)
        setSelectedAuditId((previous) => {
          const preferredAuditId = options?.preferredAuditId
          if (
            preferredAuditId &&
            response.items.some((audit) => audit.id === preferredAuditId)
          ) {
            return preferredAuditId
          }
          if (previous && response.items.some((audit) => audit.id === previous)) return previous
          return response.items[0]?.id ?? ''
        })
      } catch (error) {
        if (requestId !== fetchRequestIdRef.current) return
        setAudits([])
        setStatusCounts(EMPTY_STATUS_COUNTS)
        setSelectedAuditId('')
        setAuditsError(getMessageFromError(error))
      } finally {
        if (requestId === fetchRequestIdRef.current) {
          setIsLoadingAudits(false)
        }
      }
    },
    [debouncedSearchQuery],
  )

  useEffect(() => {
    void loadAudits()
  }, [loadAudits])

  useEffect(() => {
    if (!isAnyModalOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [isAnyModalOpen])

  useEffect(() => {
    if (!isAnyModalOpen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (isDeleteModalOpen) {
        setIsDeleteModalOpen(false)
        setDeleteConfirmText('')
        setDeleteModalError(null)
        return
      }
      if (isCreateModalOpen) {
        if (!isExtractingFields && !isSubmittingCreate) {
          setIsCreateModalOpen(false)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isAnyModalOpen, isCreateModalOpen, isDeleteModalOpen, isExtractingFields, isSubmittingCreate])

  const openCreateAuditModal = () => {
    setCreateAuditForm(getInitialCreateAuditForm())
    setCreateAuditErrors({})
    setIsExtractionPanelOpen(false)
    setExtractInputText('')
    setExtractStatus(null)
    setExtractMeta(null)
    setExtractNeedsProfileSetup(false)
    setActionError(null)
    setIsCreateModalOpen(true)
  }

  const closeCreateAuditModal = () => {
    if (isExtractingFields || isSubmittingCreate) return
    setIsCreateModalOpen(false)
  }

  const openDeleteModal = () => {
    if (!selectedAudit) return
    setDeleteConfirmText('')
    setDeleteModalError(null)
    setActionError(null)
    setIsDeleteModalOpen(true)
  }

  const closeDeleteModal = () => {
    if (isDeletingAudit) return
    setIsDeleteModalOpen(false)
    setDeleteConfirmText('')
    setDeleteModalError(null)
  }

  const updateCreateAuditField = <K extends keyof CreateAuditFormValues>(
    key: K,
    value: CreateAuditFormValues[K],
  ) => {
    setCreateAuditForm((previous) => ({ ...previous, [key]: value }))
    setCreateAuditErrors((previous) => {
      if (!previous[key]) return previous
      const next = { ...previous }
      delete next[key]
      return next
    })
  }

  const goToProfile = () => {
    if (window.location.pathname.toLowerCase() === '/profile') return
    window.history.pushState(null, '', '/profile')
    window.dispatchEvent(new PopStateEvent('popstate'))
  }

  const runAiExtraction = async () => {
    const sourceText = extractInputText.trim()
    if (!sourceText) {
      setExtractStatus({ kind: 'error', message: 'Paste or type text first to run extraction.' })
      return
    }

    setIsExtractingFields(true)
    setExtractStatus(null)
    setExtractNeedsProfileSetup(false)
    setActionError(null)

    try {
      const response = await extractAuditFields({
        text: sourceText,
      })

      setCreateAuditForm((previous) => mergeExtractedFields(previous, response.fields))
      setCreateAuditErrors((previous) => {
        if (Object.keys(previous).length === 0) return previous

        const next = { ...previous }
        delete next.title
        delete next.slug
        delete next.description
        delete next.chain
        delete next.network
        delete next.repo_url
        delete next.commit_hash
        delete next.docs_url
        delete next.start_date
        delete next.end_date
        return next
      })

      setExtractMeta({ provider: response.provider, model: response.model })
      setExtractStatus({
        kind: 'success',
        message: 'Fields extracted. Review and adjust the values before creating the audit.',
      })
    } catch (error) {
      const message = getMessageFromError(error)
      const normalizedMessage = message.toLowerCase()
      setExtractNeedsProfileSetup(
        normalizedMessage.includes('ai provider is not configured') ||
          normalizedMessage.includes('ai api key is not configured') ||
          normalizedMessage.includes('not configured for this user'),
      )
      setExtractStatus({ kind: 'error', message })
    } finally {
      setIsExtractingFields(false)
    }
  }

  const submitCreateAudit = async (event: React.FormEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (isExtractingFields) return

    const errors = validateCreateAuditForm(createAuditForm, audits)
    if (Object.keys(errors).length > 0) {
      setCreateAuditErrors(errors)
      return
    }

    setIsSubmittingCreate(true)
    setActionError(null)

    try {
      const createdAudit = await createAuditRequest({
        title: createAuditForm.title.trim(),
        slug: toOptionalText(createAuditForm.slug)?.toLowerCase(),
        description: toOptionalText(createAuditForm.description),
        status: createAuditForm.status,
        is_pinned: createAuditForm.is_pinned,
        chain: toOptionalText(createAuditForm.chain),
        network: toOptionalText(createAuditForm.network),
        repo_url: toOptionalText(createAuditForm.repo_url),
        commit_hash: toOptionalText(createAuditForm.commit_hash)?.toLowerCase(),
        docs_url: toOptionalText(createAuditForm.docs_url),
        start_date: toOptionalText(createAuditForm.start_date),
        end_date: toOptionalText(createAuditForm.end_date),
      })

      setIsCreateModalOpen(false)
      setCreateAuditForm(getInitialCreateAuditForm())
      setCreateAuditErrors({})
      await loadAudits({ preferredAuditId: createdAudit.id })
    } catch (error) {
      const serverErrors = getCreateAuditServerErrors(error)
      if (Object.keys(serverErrors).length > 0) {
        setCreateAuditErrors((previous) => ({ ...previous, ...serverErrors }))
      } else if (error instanceof ApiError && error.status === 409) {
        if (/slug/i.test(error.message)) {
          setCreateAuditErrors((previous) => ({ ...previous, slug: error.message }))
        } else {
          setActionError(error.message)
        }
      } else {
        setActionError(getMessageFromError(error))
      }
    } finally {
      setIsSubmittingCreate(false)
    }
  }

  const selectAudit = async (auditId: string) => {
    setSelectedAuditId(auditId)
    setActionError(null)
    try {
      const updatedAudit = await markAuditOpened(auditId)
      setAudits((previous) =>
        previous.map((audit) => (audit.id === updatedAudit.id ? updatedAudit : audit)),
      )
    } catch (error) {
      setActionError(getMessageFromError(error))
    }
  }

  const togglePin = async (auditId: string) => {
    if (pinningAuditId) return

    const currentAudit = audits.find((audit) => audit.id === auditId)
    if (!currentAudit) return

    setPinningAuditId(auditId)
    setActionError(null)
    try {
      const updatedAudit = await setAuditPin(auditId, { is_pinned: !currentAudit.is_pinned })
      setAudits((previous) =>
        previous.map((audit) => (audit.id === updatedAudit.id ? updatedAudit : audit)),
      )
    } catch (error) {
      setActionError(getMessageFromError(error))
    } finally {
      setPinningAuditId(null)
    }
  }

  const confirmDeleteAudit = async (event: React.FormEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (!selectedAudit) return

    if (deleteConfirmText.trim().toLowerCase() !== 'delete') {
      setDeleteModalError("Type 'delete' to confirm.")
      return
    }

    setIsDeletingAudit(true)
    setDeleteModalError(null)
    setActionError(null)
    try {
      await deleteAuditRequest(selectedAudit.id)
      setIsDeleteModalOpen(false)
      setDeleteConfirmText('')
      setDeleteModalError(null)
      await loadAudits()
    } catch (error) {
      setDeleteModalError(getMessageFromError(error))
    } finally {
      setIsDeletingAudit(false)
    }
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
              onClick={openCreateAuditModal}
              className="btn-primary"
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

          {actionError && (
            <Box
              className={css({
                mt: '3',
                borderRadius: '10px',
                border: '1px solid rgba(229, 72, 77, 0.38)',
                bg: 'rgba(229, 72, 77, 0.12)',
                px: '3',
                py: '2',
                color: 'rgba(255, 174, 180, 0.95)',
                fontSize: 'xs',
                lineHeight: '1.55',
              })}
            >
              {actionError}
            </Box>
          )}
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
              {isLoadingAudits && filteredAudits.length === 0 && (
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
                  Loading audits...
                </Box>
              )}

              {auditsError && (
                <Box
                  className={css({
                    borderRadius: '14px',
                    border: '1px solid rgba(229, 72, 77, 0.4)',
                    bg: 'rgba(229, 72, 77, 0.12)',
                    px: '4',
                    py: '4',
                    color: 'rgba(255, 174, 180, 0.95)',
                    fontSize: 'sm',
                    lineHeight: '1.58',
                  })}
                >
                  <Box>{auditsError}</Box>
                  <Button
                    type="button"
                    onClick={() => {
                      void loadAudits()
                    }}
                    className={cx(css({ mt: '3' }), 'btn-secondary')}
                  >
                    Retry
                  </Button>
                </Box>
              )}

              {!isLoadingAudits && !auditsError && filteredAudits.length === 0 && (
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

              {!auditsError && filteredAudits.map((audit) => {
                const isActive = audit.id === selectedAudit?.id
                return (
                  <div
                    key={audit.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      void selectAudit(audit.id)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        void selectAudit(audit.id)
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
                        disabled={pinningAuditId === audit.id}
                        aria-label={audit.is_pinned ? 'Unpin audit' : 'Pin audit'}
                        onClick={(event) => {
                          event.stopPropagation()
                          void togglePin(audit.id)
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
                            _disabled: {
                              opacity: 0.55,
                              cursor: 'wait',
                            },
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
            {!selectedAudit && isLoadingAudits && !auditsError && (
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
                Loading audit details...
              </Flex>
            )}

            {!selectedAudit && !isLoadingAudits && !auditsError && (
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

                <Flex justify="flex-end">
                  <Button
                    type="button"
                    onClick={openDeleteModal}
                    className="btn-danger"
                  >
                    <Trash2 size={14} />
                    Delete Audit
                  </Button>
                </Flex>
              </Stack>
            )}
          </Box>
        </Flex>
      </Box>

      {isCreateModalOpen && (
        <Box
          role="presentation"
          onClick={closeCreateAuditModal}
          className={css({
            position: 'fixed',
            inset: 0,
            zIndex: '999',
            bg: 'rgba(8, 8, 12, 0.7)',
            backdropFilter: 'blur(10px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            p: { base: '4', md: '6' },
          })}
        >
          <Box
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-audit-title"
            onClick={(event) => event.stopPropagation()}
            className={css({
              width: '100%',
              maxW: '920px',
              maxH: '90vh',
              borderRadius: '18px',
              border: `1px solid ${ui.borderSoft}`,
              bg: 'linear-gradient(160deg, rgba(22, 22, 27, 0.96), rgba(15, 15, 20, 0.95))',
              boxShadow: '0 24px 48px rgba(0, 0, 0, 0.5)',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            })}
          >
            <Flex
              align="center"
              justify="space-between"
              px={{ base: '4', md: '5' }}
              py="4"
              className={css({ borderBottom: `1px solid ${ui.borderFaint}` })}
            >
              <Box>
                <Box
                  id="new-audit-title"
                  className={css({
                    color: ui.textPrimary,
                    fontSize: 'calc(1.125rem + 2px)',
                    fontWeight: '800',
                    lineHeight: '1.35',
                  })}
                >
                  Create New Audit
                </Box>
                <Box className={css({ mt: '1', color: ui.textSecondary, fontSize: 'sm', lineHeight: '1.55' })}>
                  Enter audit information only. IDs, timestamps, and owner fields are system-managed.
                </Box>
              </Box>

              <button
                type="button"
                disabled={isSubmittingCreate || isExtractingFields}
                aria-label="Close create audit modal"
                onClick={closeCreateAuditModal}
                className={css({
                  width: '2.25rem',
                  height: '2.25rem',
                  borderRadius: '10px',
                  border: `1px solid ${ui.borderSoft}`,
                  background: 'rgba(16, 16, 21, 0.9)',
                  color: ui.textSecondary,
                  display: 'grid',
                  placeItems: 'center',
                  cursor: 'pointer',
                  _disabled: {
                    opacity: 0.55,
                    cursor: 'not-allowed',
                  },
                  _hover: {
                    background: 'rgba(28, 28, 34, 0.95)',
                    color: ui.textPrimary,
                  },
                })}
              >
                <X size={16} />
              </button>
            </Flex>

            <Box as="form" onSubmit={submitCreateAudit} className={css({ display: 'flex', flexDirection: 'column', minH: '0', flex: '1' })}>
              {actionError && (
                <Box
                  className={css({
                    mx: { base: '4', md: '5' },
                    mt: '4',
                    borderRadius: '10px',
                    border: '1px solid rgba(229, 72, 77, 0.38)',
                    bg: 'rgba(229, 72, 77, 0.12)',
                    px: '3',
                    py: '2',
                    color: 'rgba(255, 174, 180, 0.95)',
                    fontSize: 'xs',
                    lineHeight: '1.55',
                  })}
                >
                  {actionError}
                </Box>
              )}

              <Box className={css({ overflowY: 'auto', px: { base: '4', md: '5' }, py: '5' })}>
                <Box
                  className={css({
                    mb: '5',
                    borderRadius: '14px',
                    border: '1px solid rgba(120, 225, 196, 0.22)',
                    bg: 'linear-gradient(140deg, rgba(14, 56, 45, 0.42), rgba(18, 24, 28, 0.96))',
                    boxShadow: '0 10px 22px rgba(0, 0, 0, 0.25), inset 0 1px 0 rgba(160, 255, 224, 0.08)',
                    px: { base: '3.5', md: '4' },
                    py: isExtractionPanelOpen ? '4' : '3.5',
                  })}
                >
                  <button
                    type="button"
                    onClick={() => setIsExtractionPanelOpen((previous) => !previous)}
                    className={css({
                      width: 'full',
                      border: 'none',
                      bg: 'transparent',
                      textAlign: 'left',
                      cursor: 'pointer',
                      p: '0',
                    })}
                  >
                    <Flex align="center" justify="space-between" gap="3">
                      <Box>
                        <Box className={css({ color: 'rgba(220, 250, 242, 0.95)', fontSize: 'sm', fontWeight: '700', lineHeight: '1.4' })}>
                          Quick Fill
                        </Box>
                        <Box className={css({ color: 'rgba(212, 233, 228, 0.78)', fontSize: 'xs', lineHeight: '1.55' })}>
                          {isExtractionPanelOpen
                            ? 'Paste source notes, links, and scope details to auto-fill the fields below.'
                            : 'Click to expand and fill this form from your source text.'}
                        </Box>
                      </Box>

                      <ChevronDown
                        size={16}
                        className={css({
                          color: 'rgba(186, 224, 213, 0.9)',
                          transition: 'transform 160ms ease',
                          transform: isExtractionPanelOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                        })}
                      />
                    </Flex>
                  </button>

                  {isExtractionPanelOpen && (
                    <Stack gap="3" mt="4">
                      <Field.Root invalid={extractStatus?.kind === 'error'}>
                        <Field.Label className={css({ color: 'rgba(210, 235, 229, 0.88)', fontSize: 'xs' })}>
                          Source Text
                        </Field.Label>
                        <textarea
                          value={extractInputText}
                          onChange={(event) => {
                            setExtractInputText(event.target.value)
                            if (extractStatus?.kind === 'error') setExtractStatus(null)
                            if (extractNeedsProfileSetup) setExtractNeedsProfileSetup(false)
                          }}
                          maxLength={MAX_EXTRACTION_TEXT_LENGTH}
                          placeholder="Example: Pentest name, dates, scope details, github repository, docs, chain, network, and any useful notes."
                          className={css({
                            minH: '24',
                            w: 'full',
                            resize: 'vertical',
                            px: '3',
                            py: '2.5',
                            borderRadius: '10px',
                            border: `1px solid ${ui.borderSoft}`,
                            bg: 'rgba(8, 12, 13, 0.68)',
                            color: ui.textPrimary,
                            outline: 'none',
                            lineHeight: '1.58',
                            fontSize: 'sm',
                            _placeholder: { color: 'rgba(177, 206, 199, 0.58)' },
                            _focusVisible: {
                              borderColor: 'rgba(134, 236, 201, 0.6)',
                              boxShadow: '0 0 0 1px rgba(134, 236, 201, 0.36)',
                            },
                          })}
                        />
                        <Flex justify="space-between" gap="3" mt="1.5" wrap="wrap">
                          <Box className={css({ color: 'rgba(174, 204, 197, 0.72)', fontSize: 'xs', lineHeight: '1.45' })}>
                            {extractInputText.length}/{MAX_EXTRACTION_TEXT_LENGTH}
                          </Box>
                          <Box className={css({ color: 'rgba(174, 204, 197, 0.72)', fontSize: 'xs', lineHeight: '1.45' })}>
                            Missing fields stay unchanged so you can continue editing manually.
                          </Box>
                        </Flex>
                      </Field.Root>

                      <Flex justify="flex-end">
                        <Button
                          type="button"
                          loading={isExtractingFields}
                          disabled={isSubmittingCreate || isExtractingFields || extractInputText.trim().length === 0}
                          onClick={() => {
                            void runAiExtraction()
                          }}
                          className={css({
                            borderRadius: '10px',
                            px: '4',
                            bg: 'rgba(88, 214, 171, 0.95)',
                            color: '#08211a',
                            border: '1px solid rgba(88, 214, 171, 0.95)',
                            fontWeight: '700',
                            _hover: { bg: 'rgba(111, 224, 187, 0.98)' },
                            _disabled: { opacity: 0.5, cursor: 'not-allowed' },
                          })}
                        >
                          <Sparkles size={14} />
                          Fill Fields
                        </Button>
                      </Flex>

                      {(extractMeta || extractStatus || extractNeedsProfileSetup) && (
                        <Flex align={{ base: 'flex-start', md: 'center' }} justify="space-between" gap="3" wrap="wrap">
                          {extractMeta && (
                            <Flex align="center" gap="2" className={css({ color: 'rgba(185, 228, 215, 0.9)', fontSize: 'xs' })}>
                              <Box
                                className={css({
                                  borderRadius: 'full',
                                  px: '2.5',
                                  py: '1',
                                  border: '1px solid rgba(134, 236, 201, 0.46)',
                                  bg: 'rgba(18, 74, 59, 0.38)',
                                })}
                              >
                                {extractMeta.provider}
                              </Box>
                              <Box
                                className={css({
                                  borderRadius: 'full',
                                  px: '2.5',
                                  py: '1',
                                  border: `1px solid ${ui.borderSoft}`,
                                  bg: 'rgba(18, 21, 27, 0.75)',
                                })}
                              >
                                {extractMeta.model}
                              </Box>
                            </Flex>
                          )}

                          <Flex align="center" gap="2.5" wrap="wrap">
                            {extractNeedsProfileSetup && (
                              <Button
                                type="button"
                                onClick={goToProfile}
                                className={css({
                                  h: '8',
                                  px: '3',
                                  borderRadius: '8px',
                                  fontSize: 'xs',
                                  fontWeight: '700',
                                  bg: 'rgba(120, 225, 196, 0.95)',
                                  color: '#0a2b22',
                                  border: '1px solid rgba(120, 225, 196, 0.95)',
                                  _hover: { bg: 'rgba(138, 232, 208, 0.98)' },
                                })}
                              >
                                Open Profile
                              </Button>
                            )}

                            {extractStatus && (
                              <Box
                                className={css({
                                  borderRadius: '8px',
                                  px: '2.5',
                                  py: '1.5',
                                  fontSize: 'xs',
                                  lineHeight: '1.5',
                                  border:
                                    extractStatus.kind === 'success'
                                      ? '1px solid rgba(70, 198, 149, 0.4)'
                                      : '1px solid rgba(229, 72, 77, 0.38)',
                                  bg:
                                    extractStatus.kind === 'success'
                                      ? 'rgba(70, 198, 149, 0.15)'
                                      : 'rgba(229, 72, 77, 0.12)',
                                  color:
                                    extractStatus.kind === 'success'
                                      ? 'rgba(168, 255, 218, 0.94)'
                                      : 'rgba(255, 174, 180, 0.95)',
                                })}
                              >
                                {extractStatus.message}
                              </Box>
                            )}
                          </Flex>
                        </Flex>
                      )}
                    </Stack>
                  )}
                </Box>

                <Grid columns={{ base: 1, md: 2 }} gap="4">
                  <Field.Root invalid={Boolean(createAuditErrors.title)}>
                    <Field.Label className={css({ color: ui.textSecondary, fontSize: 'xs' })}>
                      Title
                      <Field.RequiredIndicator />
                    </Field.Label>
                    <Input
                      value={createAuditForm.title}
                      onChange={(event) => updateCreateAuditField('title', event.target.value)}
                      maxLength={MAX_TITLE_LENGTH}
                      placeholder="Aave V3 Fork Treasury Flow"
                      className={css({
                        bg: 'rgba(16, 16, 21, 0.92)',
                        borderColor: ui.borderSoft,
                        color: ui.textPrimary,
                        _placeholder: { color: ui.textMuted },
                      })}
                    />
                    {createAuditErrors.title && <Field.ErrorText>{createAuditErrors.title}</Field.ErrorText>}
                  </Field.Root>

                  <Field.Root invalid={Boolean(createAuditErrors.slug)}>
                    <Field.Label className={css({ color: ui.textSecondary, fontSize: 'xs' })}>Slug (optional)</Field.Label>
                    <Input
                      value={createAuditForm.slug}
                      onChange={(event) => updateCreateAuditField('slug', event.target.value)}
                      maxLength={MAX_SLUG_LENGTH}
                      placeholder="aave-v3-fork-treasury-flow"
                      className={css({
                        bg: 'rgba(16, 16, 21, 0.92)',
                        borderColor: ui.borderSoft,
                        color: ui.textPrimary,
                        _placeholder: { color: ui.textMuted },
                      })}
                    />
                    {createAuditErrors.slug && <Field.ErrorText>{createAuditErrors.slug}</Field.ErrorText>}
                  </Field.Root>

                  <Field.Root>
                    <Field.Label className={css({ color: ui.textSecondary, fontSize: 'xs' })}>Status</Field.Label>
                    <select
                      value={createAuditForm.status}
                      onChange={(event) => updateCreateAuditField('status', event.target.value as AuditStatus)}
                      className={css({
                        h: '10',
                        w: 'full',
                        px: '3',
                        borderRadius: '10px',
                        border: `1px solid ${ui.borderSoft}`,
                        bg: 'rgba(16, 16, 21, 0.92)',
                        color: ui.textPrimary,
                        outline: 'none',
                        _focusVisible: {
                          borderColor: 'rgba(231, 228, 239, 0.36)',
                          boxShadow: '0 0 0 1px rgba(231, 228, 239, 0.2)',
                        },
                      })}
                    >
                      <option value="draft">Not started (draft)</option>
                      <option value="in_progress">Ongoing</option>
                      <option value="completed">Finished</option>
                      <option value="archived">Archived</option>
                    </select>
                  </Field.Root>

                  <Field.Root>
                    <Field.Label className={css({ color: ui.textSecondary, fontSize: 'xs' })}>Pin</Field.Label>
                    <label
                      className={css({
                        h: '10',
                        borderRadius: '10px',
                        border: `1px solid ${ui.borderSoft}`,
                        bg: 'rgba(16, 16, 21, 0.92)',
                        display: 'flex',
                        alignItems: 'center',
                        px: '3',
                        gap: '2',
                        color: ui.textPrimary,
                        cursor: 'pointer',
                      })}
                    >
                      <input
                        type="checkbox"
                        checked={createAuditForm.is_pinned}
                        onChange={(event) => updateCreateAuditField('is_pinned', event.target.checked)}
                        className={css({ accentColor: '#10b981' })}
                      />
                      Pin this audit in the list
                    </label>
                  </Field.Root>

                  <Field.Root invalid={Boolean(createAuditErrors.chain)}>
                    <Field.Label className={css({ color: ui.textSecondary, fontSize: 'xs' })}>Chain (optional)</Field.Label>
                    <Input
                      value={createAuditForm.chain}
                      onChange={(event) => updateCreateAuditField('chain', event.target.value)}
                      maxLength={MAX_CONTEXT_LENGTH}
                      placeholder="base / ethereum / solana / tron ..."
                      className={css({
                        bg: 'rgba(16, 16, 21, 0.92)',
                        borderColor: ui.borderSoft,
                        color: ui.textPrimary,
                        _placeholder: { color: ui.textMuted },
                      })}
                    />
                    {createAuditErrors.chain && <Field.ErrorText>{createAuditErrors.chain}</Field.ErrorText>}
                  </Field.Root>

                  <Field.Root invalid={Boolean(createAuditErrors.network)}>
                    <Field.Label className={css({ color: ui.textSecondary, fontSize: 'xs' })}>Network (optional)</Field.Label>
                    <Input
                      value={createAuditForm.network}
                      onChange={(event) => updateCreateAuditField('network', event.target.value)}
                      maxLength={MAX_CONTEXT_LENGTH}
                      placeholder="mainnet / testnet / devnet ..."
                      className={css({
                        bg: 'rgba(16, 16, 21, 0.92)',
                        borderColor: ui.borderSoft,
                        color: ui.textPrimary,
                        _placeholder: { color: ui.textMuted },
                      })}
                    />
                    {createAuditErrors.network && <Field.ErrorText>{createAuditErrors.network}</Field.ErrorText>}
                  </Field.Root>

                  <Field.Root invalid={Boolean(createAuditErrors.repo_url)}>
                    <Field.Label className={css({ color: ui.textSecondary, fontSize: 'xs' })}>Repository URL (optional)</Field.Label>
                    <Input
                      value={createAuditForm.repo_url}
                      onChange={(event) => updateCreateAuditField('repo_url', event.target.value)}
                      maxLength={MAX_URL_LENGTH}
                      placeholder="https://github.com/org/repo"
                      className={css({
                        bg: 'rgba(16, 16, 21, 0.92)',
                        borderColor: ui.borderSoft,
                        color: ui.textPrimary,
                        _placeholder: { color: ui.textMuted },
                      })}
                    />
                    {createAuditErrors.repo_url && <Field.ErrorText>{createAuditErrors.repo_url}</Field.ErrorText>}
                  </Field.Root>

                  <Field.Root invalid={Boolean(createAuditErrors.docs_url)}>
                    <Field.Label className={css({ color: ui.textSecondary, fontSize: 'xs' })}>Docs URL (optional)</Field.Label>
                    <Input
                      value={createAuditForm.docs_url}
                      onChange={(event) => updateCreateAuditField('docs_url', event.target.value)}
                      maxLength={MAX_URL_LENGTH}
                      placeholder="https://docs.example.com/audit"
                      className={css({
                        bg: 'rgba(16, 16, 21, 0.92)',
                        borderColor: ui.borderSoft,
                        color: ui.textPrimary,
                        _placeholder: { color: ui.textMuted },
                      })}
                    />
                    {createAuditErrors.docs_url && <Field.ErrorText>{createAuditErrors.docs_url}</Field.ErrorText>}
                  </Field.Root>

                  <Field.Root invalid={Boolean(createAuditErrors.commit_hash)}>
                    <Field.Label className={css({ color: ui.textSecondary, fontSize: 'xs' })}>Commit Hash (optional)</Field.Label>
                    <Input
                      value={createAuditForm.commit_hash}
                      onChange={(event) => updateCreateAuditField('commit_hash', event.target.value)}
                      maxLength={40}
                      placeholder="4d72f7e8db0a1f0..."
                      className={css({
                        bg: 'rgba(16, 16, 21, 0.92)',
                        borderColor: ui.borderSoft,
                        color: ui.textPrimary,
                        _placeholder: { color: ui.textMuted },
                      })}
                    />
                    {createAuditErrors.commit_hash && <Field.ErrorText>{createAuditErrors.commit_hash}</Field.ErrorText>}
                  </Field.Root>

                  <Field.Root>
                    <Field.Label className={css({ color: ui.textSecondary, fontSize: 'xs' })}>Start Date (optional)</Field.Label>
                    <Input
                      type="date"
                      value={createAuditForm.start_date}
                      onChange={(event) => updateCreateAuditField('start_date', event.target.value)}
                      className={css({
                        bg: 'rgba(16, 16, 21, 0.92)',
                        borderColor: ui.borderSoft,
                        color: ui.textPrimary,
                      })}
                    />
                  </Field.Root>

                  <Field.Root invalid={Boolean(createAuditErrors.end_date)}>
                    <Field.Label className={css({ color: ui.textSecondary, fontSize: 'xs' })}>End Date (optional)</Field.Label>
                    <Input
                      type="date"
                      value={createAuditForm.end_date}
                      onChange={(event) => updateCreateAuditField('end_date', event.target.value)}
                      className={css({
                        bg: 'rgba(16, 16, 21, 0.92)',
                        borderColor: ui.borderSoft,
                        color: ui.textPrimary,
                      })}
                    />
                    {createAuditErrors.end_date && <Field.ErrorText>{createAuditErrors.end_date}</Field.ErrorText>}
                  </Field.Root>

                  <Field.Root invalid={Boolean(createAuditErrors.description)} className={css({ gridColumn: '1 / -1' })}>
                    <Field.Label className={css({ color: ui.textSecondary, fontSize: 'xs' })}>Description (optional)</Field.Label>
                    <textarea
                      value={createAuditForm.description}
                      onChange={(event) => updateCreateAuditField('description', event.target.value)}
                      maxLength={MAX_DESCRIPTION_LENGTH}
                      placeholder="Scope, goals, assumptions, and what to review."
                      className={css({
                        minH: '32',
                        w: 'full',
                        resize: 'vertical',
                        px: '3',
                        py: '2.5',
                        borderRadius: '10px',
                        border: `1px solid ${ui.borderSoft}`,
                        bg: 'rgba(16, 16, 21, 0.92)',
                        color: ui.textPrimary,
                        outline: 'none',
                        lineHeight: '1.58',
                        _placeholder: { color: ui.textMuted },
                        _focusVisible: {
                          borderColor: 'rgba(231, 228, 239, 0.36)',
                          boxShadow: '0 0 0 1px rgba(231, 228, 239, 0.2)',
                        },
                      })}
                    />
                    {createAuditErrors.description && <Field.ErrorText>{createAuditErrors.description}</Field.ErrorText>}
                  </Field.Root>
                </Grid>
              </Box>

              <Flex
                justify="flex-end"
                gap="3"
                px={{ base: '4', md: '5' }}
                py="4"
                className={css({ borderTop: `1px solid ${ui.borderFaint}` })}
              >
                <Button
                  type="button"
                  disabled={isSubmittingCreate || isExtractingFields}
                  onClick={closeCreateAuditModal}
                  className="btn-secondary"
                >
                  Cancel
                </Button>
                <Button
                  loading={isSubmittingCreate}
                  type="submit"
                  disabled={isExtractingFields}
                  className="btn-primary"
                >
                  Create Audit
                </Button>
              </Flex>
            </Box>
          </Box>
        </Box>
      )}

      {isDeleteModalOpen && selectedAudit && (
        <Box
          role="presentation"
          onClick={closeDeleteModal}
          className={css({
            position: 'fixed',
            inset: 0,
            zIndex: '1000',
            bg: 'rgba(8, 8, 12, 0.72)',
            backdropFilter: 'blur(10px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            p: { base: '4', md: '6' },
          })}
        >
          <Box
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-audit-title"
            onClick={(event) => event.stopPropagation()}
            className={css({
              width: '100%',
              maxW: '520px',
              borderRadius: '18px',
              border: `1px solid ${ui.borderSoft}`,
              bg: 'linear-gradient(160deg, rgba(22, 22, 27, 0.97), rgba(14, 14, 19, 0.96))',
              boxShadow: '0 24px 48px rgba(0, 0, 0, 0.52)',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            })}
          >
            <Flex
              align="center"
              justify="space-between"
              px={{ base: '4', md: '5' }}
              py="4"
              className={css({ borderBottom: `1px solid ${ui.borderFaint}` })}
            >
              <Box>
                <Box
                  id="delete-audit-title"
                  className={css({
                    color: 'rgba(255, 186, 192, 0.96)',
                    fontSize: 'calc(1rem + 2px)',
                    fontWeight: '800',
                    lineHeight: '1.35',
                  })}
                >
                  Delete Audit
                </Box>
                <Box className={css({ mt: '1', color: ui.textSecondary, fontSize: 'sm', lineHeight: '1.55' })}>
                  This action is permanent and removes this audit from the database.
                </Box>
              </Box>

              <button
                type="button"
                disabled={isDeletingAudit}
                aria-label="Close delete modal"
                onClick={closeDeleteModal}
                className={css({
                  width: '2.25rem',
                  height: '2.25rem',
                  borderRadius: '10px',
                  border: `1px solid ${ui.borderSoft}`,
                  background: 'rgba(16, 16, 21, 0.9)',
                  color: ui.textSecondary,
                  display: 'grid',
                  placeItems: 'center',
                  cursor: 'pointer',
                  _disabled: {
                    opacity: 0.55,
                    cursor: 'not-allowed',
                  },
                  _hover: {
                    background: 'rgba(28, 28, 34, 0.95)',
                    color: ui.textPrimary,
                  },
                })}
              >
                <X size={16} />
              </button>
            </Flex>

            <Box
              as="form"
              onSubmit={confirmDeleteAudit}
              className={css({ px: { base: '4', md: '5' }, py: '5', display: 'grid', gap: '4' })}
            >
              <Box className={css({ color: ui.textPrimary, fontSize: 'sm', lineHeight: '1.65' })}>
                To delete <b>{selectedAudit.title}</b>, type <b>delete</b> below.
              </Box>

              <Field.Root invalid={Boolean(deleteModalError)}>
                <Field.Label className={css({ color: ui.textSecondary, fontSize: 'xs' })}>
                  Confirmation
                </Field.Label>
                <Input
                  value={deleteConfirmText}
                  onChange={(event) => {
                    setDeleteConfirmText(event.target.value)
                    if (deleteModalError) setDeleteModalError(null)
                  }}
                  placeholder="type delete"
                  className={css({
                    bg: 'rgba(16, 16, 21, 0.92)',
                    borderColor: ui.borderSoft,
                    color: ui.textPrimary,
                    _placeholder: { color: ui.textMuted },
                  })}
                />
                {deleteModalError && <Field.ErrorText>{deleteModalError}</Field.ErrorText>}
              </Field.Root>

              <Flex justify="flex-end" gap="3" className={css({ borderTop: `1px solid ${ui.borderFaint}`, pt: '4' })}>
                <Button
                  type="button"
                  disabled={isDeletingAudit}
                  onClick={closeDeleteModal}
                  className={css({
                    bg: 'transparent',
                    border: `1px solid ${ui.borderSoft}`,
                    color: ui.textSecondary,
                    _hover: { bg: 'rgba(33, 33, 39, 0.75)', color: ui.textPrimary },
                  })}
                >
                  Cancel
                </Button>
                <Button
                  loading={isDeletingAudit}
                  type="submit"
                  disabled={deleteConfirmText.trim().toLowerCase() !== 'delete'}
                  className={css({
                    bg: 'rgba(229, 72, 77, 0.95)',
                    color: '#1a0f11',
                    borderRadius: '10px',
                    px: '5',
                    fontWeight: '700',
                    border: '1px solid rgba(229, 72, 77, 0.95)',
                    _hover: { bg: 'rgba(238, 93, 98, 0.98)' },
                    _disabled: {
                      opacity: 0.45,
                      cursor: 'not-allowed',
                    },
                  })}
                >
                  Delete
                </Button>
              </Flex>
            </Box>
          </Box>
        </Box>
      )}
    </Flex>
  )
}
