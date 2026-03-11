import { useEffect, useMemo, useRef, useState } from 'react'
import { css } from 'styled-system/css'
import { Box, Flex, Grid } from 'styled-system/jsx'
import { NavBar } from '../components/NavBar'
import { getAudit } from '../audits/api'
import type { AuditRecord } from '../audits/types'
import { ChevronDown, ChevronRight, File, Folder, FolderOpen, Github, Link2, Trash2, UploadCloud } from 'lucide-react'
import * as scopeApi from './api'
import type { ScopeContract } from './api'
import { getMessageFromError } from './api'
import SlideButton from '../components/SlideButton'

interface ScopeWorkspaceProps {
    auditId: string
    onNavigate: (path: string) => void
    onOpenProfile: () => void
}

const ui = {
    textPrimary: 'rgba(231, 228, 239, 0.96)',
    textSecondary: 'rgba(231, 228, 239, 0.75)',
    textMuted: 'rgba(231, 228, 239, 0.5)',
    borderFaint: 'rgba(185, 185, 189, 0.22)',
    borderSoft: 'rgba(185, 185, 189, 0.35)',
    surfaceContent: 'rgba(26, 26, 32, 0.95)',
    surfaceCard: 'rgba(32, 32, 40, 0.95)',
    accent: 'rgba(88, 214, 171, 0.9)',
    accentStr: '#58D6AB',
}

// --- Date utils ---

function formatDate(dateStr: string | null | undefined): string {
    if (!dateStr) return 'Not set'
    try {
        const d = new Date(dateStr)
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    } catch {
        return dateStr
    }
}

// ============================= ANIMATED LOGO OVERLAY =============================

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
        <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            aria-label="Processing…"
        >
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

function ProcessingOverlay() {
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

// ============================= FILE TREE =============================

interface TreeNode {
    id: string
    name: string
    path: string          // relative path inside the tree
    type: 'file' | 'folder'
    children?: TreeNode[]
    contractId?: string   // backend contract id if it's a file
}

function buildTree(contracts: ScopeContract[]): TreeNode[] {
    // Build a trie where each level is indexed by name
    type TrieNode = { type: 'folder'; children: Record<string, TrieNode> } | { type: 'file'; contract: ScopeContract }
    const root: Record<string, TrieNode> = {}

    for (const contract of contracts) {
        const parts = contract.file_path.split('/').filter(Boolean)
        let level = root
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i]
            const isLast = i === parts.length - 1
            if (isLast) {
                level[part] = { type: 'file', contract }
            } else {
                if (!level[part]) {
                    level[part] = { type: 'folder', children: {} }
                }
                const node = level[part]
                if (node.type === 'folder') level = node.children
            }
        }
    }

    const toTree = (map: Record<string, TrieNode>, prefix = ''): TreeNode[] =>
        Object.entries(map)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([name, n]) => {
                const path = prefix ? `${prefix}/${name}` : name
                if (n.type === 'file') {
                    return { id: n.contract.id, name, path, type: 'file' as const, contractId: n.contract.id }
                }
                return { id: `dir:${path}`, name, path, type: 'folder' as const, children: toTree(n.children, path) }
            })

    return toTree(root)
}


interface TreeNodeRowProps {
    node: TreeNode
    depth: number
    checkedIds: Set<string>
    onToggleCheck: (node: TreeNode) => Promise<void>
}

function getAllFileIds(node: TreeNode): string[] {
    if (node.type === 'file') return [node.id]
    return (node.children ?? []).flatMap(getAllFileIds)
}

function TreeNodeRow({ node, depth, checkedIds, onToggleCheck }: TreeNodeRowProps) {
    const [expanded, setExpanded] = useState(true)
    const fileIds = getAllFileIds(node)
    const allChecked = fileIds.length > 0 && fileIds.every((id) => checkedIds.has(id))
    const someChecked = fileIds.some((id) => checkedIds.has(id))

    return (
        <Box>
            <Flex
                align="center"
                gap="2"
                className={css({
                    px: '2',
                    py: '1',
                    borderRadius: '6px',
                    _hover: { bg: 'rgba(255, 255, 255, 0.03)' },
                    cursor: 'pointer',
                })}
            >
                {/* Indentation */}
                {depth > 0 && (
                    <Box style={{ width: `${depth * 16}px`, flexShrink: 0 }} />
                )}

                {/* Expand/Collapse chevron for folders */}
                <Box
                    style={{ width: '16px', flexShrink: 0 }}
                    onClick={() => node.type === 'folder' && setExpanded((e) => !e)}
                >
                    {node.type === 'folder'
                        ? (expanded
                            ? <ChevronDown size={14} style={{ color: ui.textMuted }} />
                            : <ChevronRight size={14} style={{ color: ui.textMuted }} />)
                        : null}
                </Box>

                {/* Checkbox */}
                <input
                    type="checkbox"
                    checked={allChecked}
                    ref={(el) => {
                        if (el) el.indeterminate = someChecked && !allChecked
                    }}
                    onChange={() => onToggleCheck(node)}
                    style={{
                        width: '14px',
                        height: '14px',
                        flexShrink: 0,
                        accentColor: ui.accentStr,
                        cursor: 'pointer',
                    }}
                />

                {/* Icon */}
                <Box style={{ flexShrink: 0, color: node.type === 'folder' ? '#f5a623' : ui.textMuted }}>
                    {node.type === 'folder'
                        ? (expanded ? <FolderOpen size={14} /> : <Folder size={14} />)
                        : <File size={14} />}
                </Box>

                {/* Name */}
                <Box
                    onClick={() => node.type === 'folder' && setExpanded((e) => !e)}
                    className={css({
                        fontSize: 'xs',
                        color: node.type === 'file' ? ui.textSecondary : ui.textPrimary,
                        fontFamily: "'Roboto Mono', ui-monospace, monospace",
                        fontWeight: node.type === 'folder' ? '600' : '400',
                        userSelect: 'none',
                        flex: '1',
                    })}
                >
                    {node.name}
                </Box>

                {/* .sol tag */}
                {node.type === 'file' && (
                    <Box className={css({
                        fontSize: '10px',
                        color: 'rgba(88, 214, 171, 0.7)',
                        fontFamily: "'Roboto Mono', ui-monospace, monospace",
                        bg: 'rgba(88, 214, 171, 0.08)',
                        px: '1.5',
                        py: '0',
                        borderRadius: '4px',
                    })}>
                        .sol
                    </Box>
                )}
            </Flex>

            {node.type === 'folder' && expanded && node.children && (
                <Box>
                    {node.children.map((child) => (
                        <TreeNodeRow
                            key={child.id}
                            node={child}
                            depth={depth + 1}
                            checkedIds={checkedIds}
                            onToggleCheck={onToggleCheck}
                        />
                    ))}
                </Box>
            )}
        </Box>
    )
}

// Filter tree: folder name match → keep all children; else recurse
function filterTree(nodes: TreeNode[], query: string): TreeNode[] {
    if (!query.trim()) return nodes
    const q = query.toLowerCase()
    return nodes.flatMap((node) => {
        if (node.type === 'file') {
            return node.name.toLowerCase().includes(q) ? [node] : []
        }
        // folder name matches → include as-is (all children visible)
        if (node.name.toLowerCase().includes(q)) return [node]
        // recurse
        const filteredChildren = filterTree(node.children ?? [], q)
        if (filteredChildren.length === 0) return []
        return [{ ...node, children: filteredChildren }]
    })
}

function FileTree({ contracts, onClearAll, onToggleScope }: {
    contracts: ScopeContract[]
    onClearAll?: () => void
    onToggleScope?: (contractIds: string[], isInScope: boolean) => Promise<void>
}) {
    // Initialize checkedIds from DB is_in_scope, keep in sync when contracts changes
    const [checkedIds, setCheckedIds] = useState<Set<string>>(
        () => new Set(contracts.filter((c) => c.is_in_scope).map((c) => c.id))
    )
    const [confirmClear, setConfirmClear] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')
    const tree = useMemo(() => buildTree(contracts), [contracts])
    const visibleTree = useMemo(() => filterTree(tree, searchQuery), [tree, searchQuery])

    // Sync checkedIds when contracts reload from server
    useEffect(() => {
        setCheckedIds(new Set(contracts.filter((c) => c.is_in_scope).map((c) => c.id)))
    }, [contracts])

    const handleToggleCheck = async (node: TreeNode) => {
        const ids = getAllFileIds(node)
        const allIn = ids.every((id) => checkedIds.has(id))
        const newValue = !allIn
        // Optimistic local update
        setCheckedIds((prev) => {
            const next = new Set(prev)
            if (allIn) ids.forEach((id) => next.delete(id))
            else ids.forEach((id) => next.add(id))
            return next
        })
        // Persist to DB
        if (onToggleScope) {
            await onToggleScope(ids, newValue)
        }
    }

    const totalFiles = contracts.length
    const selectedFiles = checkedIds.size

    return (
        <Box
            className={css({
                mt: '2',
                p: '4',
                borderRadius: '16px',
                border: `1px solid ${ui.borderSoft}`,
                bg: ui.surfaceContent,
            })}
        >
            <Flex justify="space-between" align="center" mb="3">
                <Box className={css({ color: ui.textPrimary, fontWeight: '600', fontSize: 'sm' })}>
                    File Explorer
                </Box>
                <Flex align="center" gap="3">
                    <Box className={css({ color: ui.textMuted, fontSize: 'xs', fontFamily: "'Roboto Mono', ui-monospace, monospace" })}>
                        {selectedFiles} / {totalFiles} in scope
                    </Box>
                    {onClearAll && (
                        confirmClear ? (
                            <Flex align="center" gap="2">
                                <Box className={css({ color: 'rgba(255,130,130,0.9)', fontSize: 'xs' })}>Clear all?</Box>
                                <button
                                    onClick={() => { setConfirmClear(false); onClearAll() }}
                                    className={css({ color: 'rgba(255,100,100,0.9)', fontSize: 'xs', fontWeight: '600', cursor: 'pointer', bg: 'transparent', px: '2', py: '0.5', borderRadius: '5px', border: '1px solid rgba(255,100,100,0.3)', _hover: { bg: 'rgba(255,100,100,0.1)' } })}
                                >Yes</button>
                                <button
                                    onClick={() => setConfirmClear(false)}
                                    className={css({ color: ui.textMuted, fontSize: 'xs', cursor: 'pointer', bg: 'transparent', px: '2', py: '0.5', borderRadius: '5px', border: `1px solid ${ui.borderFaint}`, _hover: { color: ui.textPrimary } })}
                                >Cancel</button>
                            </Flex>
                        ) : (
                            <button
                                onClick={() => setConfirmClear(true)}
                                title="Clear all contracts"
                                className={css({ color: ui.textMuted, cursor: 'pointer', bg: 'transparent', display: 'flex', alignItems: 'center', _hover: { color: 'rgba(255,130,130,0.9)' } })}
                            >
                                <Trash2 size={14} />
                            </button>
                        )
                    )}
                </Flex>
            </Flex>

            {/* Search bar */}
            <Box mb="3">
                <input
                    type="text"
                    placeholder="Search files and folders…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className={css({
                        w: 'full',
                        px: '3',
                        py: '1.5',
                        bg: 'rgba(0,0,0,0.3)',
                        border: `1px solid ${ui.borderFaint}`,
                        borderRadius: '8px',
                        color: ui.textSecondary,
                        fontSize: 'xs',
                        fontFamily: "'Roboto Mono', ui-monospace, monospace",
                        outline: 'none',
                        _placeholder: { color: ui.textMuted },
                        _focus: { borderColor: 'rgba(88, 214, 171, 0.35)' },
                    })}
                />
            </Box>

            <Box
                className={css({
                    bg: 'rgba(0,0,0,0.25)',
                    borderRadius: '10px',
                    p: '3',
                    maxH: '400px',
                    overflowY: 'auto',
                })}
            >
                {visibleTree.length === 0 ? (
                    <Box className={css({ color: ui.textMuted, fontSize: 'xs', textAlign: 'center', py: '4' })}>
                        No results for "{searchQuery}"
                    </Box>
                ) : (
                    visibleTree.map((node) => (
                        <TreeNodeRow
                            key={node.id}
                            node={node}
                            depth={0}
                            checkedIds={checkedIds}
                            onToggleCheck={handleToggleCheck}
                        />
                    ))
                )}
            </Box>
        </Box>
    )
}

// ============================= DRAG-AND-DROP FOLDER HELPERS =============================

async function readDirectory(entry: FileSystemDirectoryEntry): Promise<File[]> {
    return new Promise((resolve) => {
        const reader = entry.createReader()
        const results: File[] = []

        const readBatch = () => {
            reader.readEntries(async (entries) => {
                if (entries.length === 0) {
                    resolve(results)
                    return
                }
                for (const e of entries) {
                    if (e.isFile) {
                        const f = await new Promise<File>((res) => (e as FileSystemFileEntry).file(res))
                        results.push(f)
                    } else if (e.isDirectory) {
                        const children = await readDirectory(e as FileSystemDirectoryEntry)
                        results.push(...children)
                    }
                }
                readBatch()
            })
        }
        readBatch()
    })
}

async function collectDroppedSolFiles(items: DataTransferItemList): Promise<File[]> {
    const solFiles: File[] = []

    for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry?.()
        if (!entry) continue

        if (entry.isFile) {
            const f = await new Promise<File>((res) => (entry as FileSystemFileEntry).file(res))
            if (f.name.endsWith('.sol') || f.name.endsWith('.zip') || f.name.endsWith('.tar') || f.name.endsWith('.tar.gz') || f.name.endsWith('.tgz')) {
                solFiles.push(f)
            }
        } else if (entry.isDirectory) {
            const children = await readDirectory(entry as FileSystemDirectoryEntry)
            children.filter((f) => f.name.endsWith('.sol')).forEach((f) => solFiles.push(f))
        }
    }

    return solFiles
}

// ============================= CONFIRMATION SECTION =============================

function ConfirmationSection({ contracts, onSave }: { contracts: ScopeContract[], onSave: () => void }) {
    const inScope = contracts.filter((c) => c.is_in_scope)
    const outOfScope = contracts.filter((c) => !c.is_in_scope)
    const totalSloc = inScope.reduce((sum, c) => sum + c.sloc, 0)
    const [saved, setSaved] = useState(false)

    const handleSave = () => {
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
    }

    return (
        <Box className={css({ mt: '4' })}>
            <Flex align="center" justify="space-between" mb="2">
                <Box className={css({ color: ui.textPrimary, fontSize: 'sm', fontWeight: '700', letterSpacing: '0.08em', textTransform: 'uppercase' })}>
                    Confirmation
                </Box>
                <button
                    onClick={handleSave}
                    className={css({
                        px: '4', py: '1.5', borderRadius: '7px', fontSize: 'xs', fontWeight: '600',
                        letterSpacing: '0.05em', textTransform: 'uppercase', cursor: 'pointer',
                        border: saved ? '1px solid rgba(88, 214, 171, 0.5)' : `1px solid ${ui.borderSoft}`,
                        color: saved ? ui.accent : ui.textSecondary,
                        bg: saved ? 'rgba(88, 214, 171, 0.08)' : 'transparent',
                        transition: 'all 0.2s',
                        _hover: { borderColor: 'rgba(88, 214, 171, 0.4)', color: ui.accent },
                    })}
                >
                    {saved ? 'Saved ✓' : 'Save Scope'}
                </button>
            </Flex>

            <Box className={css({
                borderRadius: '12px',
                border: `1px solid ${ui.borderFaint}`,
                bg: 'rgba(18, 18, 22, 0.6)',
                overflow: 'hidden',
            })}>
                {/* Stats row */}
                <Flex
                    align="center"
                    gap="6"
                    className={css({
                        px: '4', py: '2',
                        borderBottom: `1px solid ${ui.borderFaint}`,
                        bg: 'rgba(88, 214, 171, 0.04)',
                    })}
                >
                    <Flex align="center" gap="2">
                        <Box className={css({ w: '6px', h: '6px', borderRadius: '50%', bg: 'rgba(88, 214, 171, 0.8)', flexShrink: 0 })} />
                        <Box className={css({ color: ui.textMuted, fontSize: 'xs' })}>In scope</Box>
                        <Box className={css({ color: ui.textPrimary, fontSize: 'xs', fontWeight: '700', fontFamily: "'Roboto Mono', monospace" })}>{inScope.length}</Box>
                    </Flex>
                    <Flex align="center" gap="2">
                        <Box className={css({ w: '6px', h: '6px', borderRadius: '50%', bg: 'rgba(185, 185, 189, 0.3)', flexShrink: 0 })} />
                        <Box className={css({ color: ui.textMuted, fontSize: 'xs' })}>Out of scope</Box>
                        <Box className={css({ color: ui.textSecondary, fontSize: 'xs', fontWeight: '700', fontFamily: "'Roboto Mono', monospace" })}>{outOfScope.length}</Box>
                    </Flex>
                    <Flex align="center" gap="2" ml="auto">
                        <Box className={css({ color: ui.textMuted, fontSize: 'xs' })}>Total SLOC</Box>
                        <Box className={css({ color: ui.accent, fontSize: 'xs', fontWeight: '700', fontFamily: "'Roboto Mono', monospace" })}>{totalSloc.toLocaleString()}</Box>
                    </Flex>
                </Flex>

                {/* In-scope file list */}
                <Box className={css({ maxH: '140px', overflowY: 'auto', px: '4', py: '1' })}>
                    {inScope.length === 0 ? (
                        <Box className={css({ color: ui.textMuted, fontSize: 'xs', py: '4', textAlign: 'center' })}>
                            No files marked in scope yet
                        </Box>
                    ) : (
                        inScope.map((c) => (
                            <Flex key={c.id} align="center" gap="2" className={css({ py: '1', borderBottom: `1px solid ${ui.borderFaint}`, _last: { borderBottom: 'none' } })}>
                                <File size={12} color="rgba(88, 214, 171, 0.6)" />
                                <Box className={css({ color: ui.textSecondary, fontSize: 'xs', fontFamily: "'Roboto Mono', monospace", flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })}>
                                    {c.file_path}
                                </Box>
                                <Box className={css({ color: ui.textMuted, fontSize: 'xs', flexShrink: 0 })}>
                                    {c.sloc} loc
                                </Box>
                            </Flex>
                        ))
                    )}
                </Box>
            </Box>
        </Box>
    )
}

// ============================= MAIN COMPONENT =============================

export default function ScopeWorkspace({ auditId, onNavigate, onOpenProfile }: ScopeWorkspaceProps) {
    const [audit, setAudit] = useState<AuditRecord | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    // Source tabs
    const [activeTab, setActiveTab] = useState<'github' | 'address' | 'upload'>('github')

    // Github
    const [githubUrl, setGithubUrl] = useState('')
    const [isConnectingGithub, setIsConnectingGithub] = useState(false)

    // Address
    const [contractAddress, setContractAddress] = useState('')
    const [isFetchingAddress, setIsFetchingAddress] = useState(false)

    // Upload + file tree
    const [isProcessing, setIsProcessing] = useState(false)
    const [processError, setProcessError] = useState<string | null>(null)
    const [contracts, setContracts] = useState<ScopeContract[]>([])
    const [isDragOver, setIsDragOver] = useState(false)

    // Load audit info
    useEffect(() => {
        let active = true
        setIsLoading(true)
        setError(null)

        getAudit(auditId)
            .then((data) => { if (active) { setAudit(data); setIsLoading(false) } })
            .catch((err) => { if (active) { setError(err instanceof Error ? err.message : 'Failed to load audit'); setIsLoading(false) } })

        return () => { active = false }
    }, [auditId])

    // Load existing contracts on mount
    useEffect(() => {
        let active = true
        scopeApi.listContracts(auditId)
            .then(({ items }) => { if (active) setContracts(items) })
            .catch((err) => console.error('Failed to load contracts:', err))
        return () => { active = false }
    }, [auditId])

    const loadContracts = async () => {
        try {
            const { items } = await scopeApi.listContracts(auditId)
            setContracts(items)
        } catch (err) {
            console.error('Failed to reload contracts:', err)
        }
    }

    const handleToggleScope = async (contractIds: string[], isInScope: boolean) => {
        // Fire all updates in parallel, then reload to sync confirmation section
        await Promise.all(contractIds.map((id) => scopeApi.updateContract(id, { is_in_scope: isInScope })))
        await loadContracts()
    }

    // Minimum 2s animation enforcer — always reloads contracts from server afterwards
    const processWithMinDuration = async (fn: () => Promise<void>) => {
        setIsProcessing(true)
        setProcessError(null)
        const start = Date.now()
        let opError: string | null = null
        try {
            await fn()
        } catch (err) {
            opError = getMessageFromError(err)
        }
        // Always enforce 2s minimum — even on error
        const elapsed = Date.now() - start
        const remaining = 2000 - elapsed
        if (remaining > 0) await new Promise((r) => setTimeout(r, remaining))
        await loadContracts()
        setIsProcessing(false)
        if (opError) setProcessError(opError)
    }

    const handleFilesSelected = async (files: File[]) => {
        if (files.length === 0) return
        await processWithMinDuration(async () => {
            const src = await scopeApi.createSource(auditId, { source_type: 'upload' })
            await Promise.all(
                files.map((f) => scopeApi.uploadContract(
                    auditId,
                    f,
                    src.id,
                    (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
                ))
            )
        })
    }

    const openFilePicker = () => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = '.sol,.zip,.tar,.gz,.tgz'
        input.multiple = true
        input.onchange = async (e) => {
            const files = Array.from((e.target as HTMLInputElement).files ?? [])
            await handleFilesSelected(files)
        }
        input.click()
    }

    const openFolderPicker = () => {
        const input = document.createElement('input')
        input.type = 'file'
            ; (input as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true
        input.multiple = true
        input.onchange = async (e) => {
            const files = Array.from((e.target as HTMLInputElement).files ?? []).filter((f) => f.name.endsWith('.sol'))
            await handleFilesSelected(files)
        }
        input.click()
    }

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault()
        setIsDragOver(false)
        const files = await collectDroppedSolFiles(e.dataTransfer.items)
        await handleFilesSelected(files)
    }

    const handleGithubClone = async () => {
        if (!githubUrl) return
        await processWithMinDuration(async () => {
            const src = await scopeApi.createSource(auditId, {
                source_type: 'github',
                url: githubUrl,
            })
            await scopeApi.triggerSourceFetch(src.id)
            setGithubUrl('')
        })
    }

    const handleClearAll = async () => {
        await processWithMinDuration(async () => {
            await scopeApi.deleteAuditScope(auditId)
        })
    }

    const handleAddressLookup = async () => {
        if (!contractAddress) return
        await processWithMinDuration(async () => {
            const addr = await scopeApi.createAddress(auditId, {
                address: contractAddress,
                label: contractAddress,
                address_type: 'contract',
            })
            await scopeApi.fetchVerifiedCode(addr.id)
            setContractAddress('')
        })
    }

    return (
        <Flex minH="100vh" direction="column" className={css({ background: '#101014' })}>
            {/* Processing overlay */}
            {isProcessing && <ProcessingOverlay />}

            <NavBar
                activeSection="audits"
                searchValue=""
                onSearchChange={() => { }}
                onNavigate={(section) => onNavigate(`/menu/${section}`)}
                onOpenProfile={onOpenProfile}
            />

            <Flex flex="1" px={{ base: '4', md: '8' }} py={{ base: '4', md: '6' }} direction="column" gap="6">

                {/* HEADER */}
                {!isLoading && !error && audit && (
                    <Box
                        className={css({
                            p: '4',
                            borderRadius: '18px',
                            border: `1px solid ${ui.borderSoft}`,
                            bg: ui.surfaceContent,
                            boxShadow: '0 0 0 1px rgba(88, 214, 171, 0.06), 0 4px 24px rgba(0,0,0,0.4)',
                        })}
                    >
                        <Flex justify="space-between" align="center" flexWrap="wrap" gap="4">
                            <Flex direction="column" gap="1">
                                <Box className={css({ color: ui.textMuted, fontSize: 'xs', fontWeight: '500', letterSpacing: '0.05em' })}>
                                    MODULE: SCOPE DEFINITION
                                </Box>
                                <Flex align="center" gap="2">
                                    <Box
                                        className={css({ color: ui.textPrimary, fontSize: 'lg', fontWeight: '700', cursor: 'pointer', _hover: { color: 'white' } })}
                                        onClick={() => onNavigate('/menu/audits')}
                                    >
                                        {audit.title}
                                    </Box>
                                </Flex>
                            </Flex>
                            <Flex direction="column" align="flex-end" gap="1">
                                <Box className={css({ color: ui.textMuted, fontSize: 'xs' })}>Start date: {formatDate(audit.start_date)}</Box>
                                {audit.chain && <Box className={css({ color: ui.textMuted, fontSize: 'xs' })}>Chain: {audit.chain}</Box>}
                            </Flex>
                        </Flex>
                    </Box>
                )}

                {/* SOURCE SELECTION */}
                {!isLoading && !error && audit && (
                    <Flex direction="column" gap="4">
                        <Box className={css({ color: ui.textSecondary, fontSize: 'sm', fontWeight: '500', mb: '-2' })}>Add New Source</Box>
                        <Grid columns={{ base: 1, md: 3 }} gap="4">
                            {([
                                { id: 'github', label: 'Github Repository', icon: Github, desc: 'Clone a public or private repo' },
                                { id: 'address', label: 'Smart Contract', icon: Link2, desc: 'Fetch verified code from explorer' },
                                { id: 'upload', label: 'Manual Upload', icon: UploadCloud, desc: 'Upload .sol, ZIP, TAR or folder' },
                            ] as const).map((tab) => {
                                const Icon = tab.icon
                                const isActive = activeTab === tab.id
                                return (
                                    <Flex
                                        key={tab.id}
                                        onClick={() => setActiveTab(tab.id)}
                                        direction="column"
                                        className={css({
                                            p: '4',
                                            borderRadius: '16px',
                                            border: `1px solid ${isActive ? 'rgba(88, 214, 171, 0.4)' : ui.borderSoft}`,
                                            bg: isActive ? 'rgba(88, 214, 171, 0.05)' : ui.surfaceContent,
                                            cursor: 'pointer',
                                            transition: 'all 0.2s',
                                            _hover: {
                                                bg: isActive ? 'rgba(88, 214, 171, 0.08)' : 'rgba(255, 255, 255, 0.03)',
                                            },
                                        })}
                                    >
                                        <Flex align="center" gap="3" mb="2">
                                            <Icon size={20} style={{ color: isActive ? 'rgba(111, 224, 187, 0.98)' : ui.textMuted }} />
                                            <Box className={css({ color: isActive ? ui.textPrimary : ui.textSecondary, fontWeight: '600', fontSize: 'sm' })}>
                                                {tab.label}
                                            </Box>
                                        </Flex>
                                        <Box className={css({ color: ui.textMuted, fontSize: 'xs' })}>{tab.desc}</Box>
                                    </Flex>
                                )
                            })}
                        </Grid>

                        {/* ACTIVE PANEL */}
                        <Box className={css({ mt: '2', p: '5', borderRadius: '16px', border: `1px solid ${ui.borderSoft}`, bg: ui.surfaceContent, boxShadow: '0 4px 24px rgba(0,0,0,0.35)' })}>

                            {/* -- GitHub -- */}
                            {activeTab === 'github' && (
                                <Flex direction="column" gap="4">
                                    <Box>
                                        <Box className={css({ color: ui.textPrimary, fontWeight: '600', fontSize: 'sm', mb: '1' })}>Import from Github</Box>
                                        <Box className={css({ color: ui.textMuted, fontSize: 'xs' })}>Enter the URL of the repository you want to audit.</Box>
                                    </Box>
                                    <Flex gap="3" align="flex-end" wrap="wrap">
                                        <Box flex="1" minW="260px">
                                            <Box className={css({ color: ui.textSecondary, fontSize: 'xs', mb: '1.5', fontWeight: '500' })}>Repository URL</Box>
                                            <input
                                                type="text"
                                                value={githubUrl}
                                                onChange={(e) => setGithubUrl(e.target.value)}
                                                placeholder="https://github.com/organization/repo"
                                                className={css({
                                                    w: 'full', bg: 'transparent',
                                                    border: `1px solid ${ui.borderSoft}`, borderRadius: '8px',
                                                    px: '3', py: '2', color: ui.textPrimary, fontSize: 'sm', outline: 'none',
                                                    _focus: { border: '1px solid rgba(88, 214, 171, 0.5)' },
                                                })}
                                            />
                                        </Box>
                                        <button
                                            disabled={!githubUrl || isConnectingGithub}
                                            onClick={() => {
                                                setIsConnectingGithub(true)
                                                handleGithubClone().finally(() => setIsConnectingGithub(false))
                                            }}
                                            className={css({
                                                bg: 'rgba(88, 214, 171, 0.9)', color: '#08211a', fontWeight: '600',
                                                fontSize: 'sm', px: '5', py: '2', borderRadius: '8px',
                                                cursor: githubUrl && !isConnectingGithub ? 'pointer' : 'not-allowed',
                                                opacity: githubUrl && !isConnectingGithub ? 1 : 0.5,
                                            })}
                                        >
                                            {isConnectingGithub ? 'Cloning…' : 'Clone Repository'}
                                        </button>
                                    </Flex>
                                </Flex>
                            )}

                            {/* -- Address -- */}
                            {activeTab === 'address' && (
                                <Flex direction="column" gap="4">
                                    <Box>
                                        <Box className={css({ color: ui.textPrimary, fontWeight: '600', fontSize: 'sm', mb: '1' })}>Import from Block Explorer</Box>
                                        <Box className={css({ color: ui.textMuted, fontSize: 'xs' })}>Fetch verified smart contract source code directly from the blockchain.</Box>
                                    </Box>
                                    <Flex gap="3" align="flex-end" wrap="wrap">
                                        <Box flex="1" minW="260px">
                                            <Box className={css({ color: ui.textSecondary, fontSize: 'xs', mb: '1.5', fontWeight: '500' })}>Contract Address</Box>
                                            <input
                                                type="text"
                                                value={contractAddress}
                                                onChange={(e) => setContractAddress(e.target.value)}
                                                placeholder="0x…"
                                                className={css({
                                                    w: 'full', bg: 'transparent',
                                                    border: `1px solid ${ui.borderSoft}`, borderRadius: '8px',
                                                    px: '3', py: '2', color: ui.textPrimary, fontSize: 'sm', outline: 'none',
                                                    _focus: { border: '1px solid rgba(88, 214, 171, 0.5)' },
                                                })}
                                            />
                                        </Box>
                                        <button
                                            disabled={!contractAddress || isFetchingAddress}
                                            onClick={() => {
                                                setIsFetchingAddress(true)
                                                handleAddressLookup().finally(() => setIsFetchingAddress(false))
                                            }}
                                            className={css({
                                                bg: 'rgba(88, 214, 171, 0.9)', color: '#08211a', fontWeight: '600',
                                                fontSize: 'sm', px: '5', py: '2', borderRadius: '8px',
                                                cursor: contractAddress && !isFetchingAddress ? 'pointer' : 'not-allowed',
                                                opacity: contractAddress && !isFetchingAddress ? 1 : 0.5,
                                            })}
                                        >
                                            {isFetchingAddress ? 'Fetching…' : 'Fetch Contracts'}
                                        </button>
                                    </Flex>
                                </Flex>
                            )}

                            {/* -- Upload -- */}
                            {activeTab === 'upload' && (
                                <Flex direction="column" gap="4">
                                    <Box>
                                        <Box className={css({ color: ui.textPrimary, fontWeight: '600', fontSize: 'sm', mb: '1' })}>Manual Upload</Box>
                                        <Box className={css({ color: ui.textMuted, fontSize: 'xs' })}>Upload ZIP, TAR or just grab the folder directly to the audit scope.</Box>
                                    </Box>

                                    {/* Drop zone */}
                                    <Flex
                                        direction="column"
                                        align="center"
                                        justify="center"
                                        className={css({
                                            border: `1px dashed ${isDragOver ? 'rgba(88, 214, 171, 0.6)' : ui.borderSoft}`,
                                            borderRadius: '12px',
                                            py: '8',
                                            bg: isDragOver ? 'rgba(88, 214, 171, 0.04)' : 'rgba(0,0,0,0.2)',
                                            transition: 'all 0.2s',
                                            cursor: 'pointer',
                                        })}
                                        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
                                        onDragLeave={() => setIsDragOver(false)}
                                        onDrop={handleDrop}
                                    >
                                        <UploadCloud size={32} style={{ color: isDragOver ? ui.accentStr : ui.textMuted, marginBottom: '12px', transition: 'color 0.2s' }} />
                                        <Box className={css({ color: ui.textPrimary, fontSize: 'sm', fontWeight: '500', mb: '1' })}>
                                            Drag &amp; drop a folder here, or
                                        </Box>
                                        <Flex gap="3" mt="2">
                                            <button
                                                onClick={openFilePicker}
                                                className={css({
                                                    bg: 'rgba(88, 214, 171, 0.9)', color: '#08211a', fontWeight: '600',
                                                    fontSize: 'xs', px: '4', py: '1.5', borderRadius: '7px', cursor: 'pointer',
                                                    _hover: { bg: 'rgba(88, 214, 171, 1)' }
                                                })}
                                            >
                                                Select Files (.sol / .zip / .tar)
                                            </button>
                                            <button
                                                onClick={openFolderPicker}
                                                className={css({
                                                    bg: 'transparent', color: ui.textSecondary,
                                                    border: `1px solid ${ui.borderSoft}`, fontWeight: '500',
                                                    fontSize: 'xs', px: '4', py: '1.5', borderRadius: '7px', cursor: 'pointer',
                                                    _hover: { borderColor: 'rgba(88, 214, 171, 0.4)', color: ui.textPrimary }
                                                })}
                                            >
                                                Select Folder
                                            </button>
                                        </Flex>
                                        <Box className={css({ color: ui.textMuted, fontSize: 'xs', mt: '2' })}>
                                            Only .sol files are indexed · ZIP and TAR archives are extracted automatically
                                        </Box>
                                    </Flex>
                                </Flex>
                            )}
                        </Box>

                        {/* ERROR */}
                        {processError && (
                            <Box
                                className={css({
                                    mt: '3',
                                    px: '4',
                                    py: '3',
                                    borderRadius: '10px',
                                    border: '1px solid rgba(255, 80, 80, 0.3)',
                                    bg: 'rgba(255, 80, 80, 0.06)',
                                    color: 'rgba(255, 130, 130, 0.9)',
                                    fontSize: 'xs',
                                    fontFamily: "'Roboto Mono', ui-monospace, monospace",
                                })}
                            >
                                {processError}
                            </Box>
                        )}

                        {/* FILE TREE */}
                        {contracts.length > 0 && (
                            <FileTree contracts={contracts} onClearAll={handleClearAll} onToggleScope={handleToggleScope} />
                        )}

                        {/* CONFIRMATION SECTION */}
                        {contracts.length > 0 && (
                            <ConfirmationSection
                                contracts={contracts}
                                onSave={() => onNavigate(`/menu/audits`)}
                            />
                        )}
                    </Flex>
                )}
            </Flex>

            {/* BOTTOM NAVIGATION */}
            <Flex
                align="center"
                justify="space-between"
                className={css({
                    px: '8',
                    py: '6',
                    borderTop: `1px solid ${ui.borderSoft}`,
                    bg: 'rgba(14, 14, 18, 0.9)',
                    flexShrink: 0,
                })}
            >
                <SlideButton
                    reversed
                    text="Goto Audits"
                    onComplete={() => onNavigate('/menu/audits')}
                />
                <SlideButton
                    text="Goto Enum"
                    onComplete={() => onNavigate(`/menu/enum/${auditId}`)}
                />
            </Flex>
        </Flex>
    )
}
