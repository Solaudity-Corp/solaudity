import { useEffect, useMemo, useState } from 'react'
import { css } from 'styled-system/css'
import { Box, Flex, Grid } from 'styled-system/jsx'
import { NavBar } from '../components/NavBar'
import { getAudit } from '../audits/api'
import type { AuditRecord } from '../audits/types'
import { ChevronDown, ChevronRight, Copy, File, Folder, FolderOpen, Github, Link2, Trash2, UploadCloud } from 'lucide-react'
import * as scopeApi from './api'
import type { ScopeAddress, ScopeContract } from './api'
import { getMessageFromError } from './api'
import SlideButton from '../components/SlideButton'
import { ProcessingOverlay } from '../components/ProcessingOverlay'

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
        const ids = new Set(contracts.filter((c) => c.is_in_scope).map((c) => c.id))
        queueMicrotask(() => { setCheckedIds(ids) })
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
        onSave()
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

// ============================= ADDRESS PANEL =============================

const CHAIN_LABELS: Record<number, string> = {
    1: 'ETH',
    56: 'BSC',
    137: 'POL',
    42161: 'ARB',
    8453: 'BASE',
    10: 'OP',
    43114: 'AVAX',
}

const ADDR_TYPE_COLOR: Record<string, string> = {
    deployment: 'rgba(88, 214, 171, 0.85)',
    proxy: 'rgba(120, 160, 255, 0.85)',
    implementation: 'rgba(200, 150, 255, 0.85)',
    role: 'rgba(255, 200, 80, 0.85)',
    token: 'rgba(255, 140, 80, 0.85)',
    external: 'rgba(185, 185, 189, 0.65)',
    other: 'rgba(140, 140, 150, 0.6)',
}

function truncateAddr(addr: string): string {
    if (addr.length <= 14) return addr
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

interface AddressPanelProps {
    auditId: string
    addresses: ScopeAddress[]
    onReload: () => Promise<void>
    onReloadContracts: () => Promise<void>
    onShowOverlay: (fn: () => Promise<void>) => Promise<void>
}

function AddressPanel({ auditId, addresses, onReload, onReloadContracts, onShowOverlay }: AddressPanelProps) {
    const [addrInput, setAddrInput] = useState('')
    const [labelInput, setLabelInput] = useState('')
    const [addrType, setAddrType] = useState('other')
    const [addError, setAddError] = useState<string | null>(null)
    const [deletingId, setDeletingId] = useState<string | null>(null)
    const [fetchingId, setFetchingId] = useState<string | null>(null)
    const [expandedBytecode, setExpandedBytecode] = useState<string | null>(null)
    const [saved, setSaved] = useState(false)

    const handleAdd = async () => {
        if (!addrInput.trim()) return
        setAddError(null)
        const addrToAdd = addrInput.trim()
        const labelToAdd = labelInput.trim() || addrInput.trim()
        await onShowOverlay(async () => {
            try {
                await scopeApi.createAddress(auditId, {
                    address: addrToAdd,
                    label: labelToAdd,
                    address_type: addrType,
                })
                setAddrInput('')
                setLabelInput('')
            } catch (err) {
                setAddError(getMessageFromError(err))
            }
        })
        await onReload()
    }

    const handleDelete = async (id: string) => {
        setDeletingId(id)
        try {
            await scopeApi.deleteAddress(id)
            // Reload both: addresses list and contracts (cascade removes linked .sol files)
            await Promise.all([onReload(), onReloadContracts()])
        } catch (err) {
            console.error('Delete address failed:', err)
        } finally {
            setDeletingId(null)
        }
    }

    const handleFetchCode = async (id: string) => {
        setFetchingId(id)
        try {
            await onShowOverlay(async () => {
                await scopeApi.fetchVerifiedCode(id)
            })
            // Reload both: addresses (is_verified/is_contract flags) and contracts
            // (a verified fetch adds .sol files to the file tree)
            await Promise.all([onReload(), onReloadContracts()])
        } finally {
            setFetchingId(null)
        }
    }

    const handleSave = () => {
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
    }

    const verifiedCount = addresses.filter((a) => a.is_verified).length
    const contractCount = addresses.filter((a) => a.is_contract).length

    const inputCls = css({
        w: 'full', bg: 'transparent',
        border: `1px solid ${ui.borderSoft}`, borderRadius: '8px',
        px: '3', py: '1.5', color: ui.textPrimary, fontSize: 'xs', outline: 'none',
        _focus: { border: '1px solid rgba(88, 214, 171, 0.5)' },
    })

    return (
        <Flex direction="column" gap="4">

            {/* ── Add form ── */}
            <Box className={css({ p: '4', borderRadius: '16px', border: `1px solid ${ui.borderSoft}`, bg: ui.surfaceContent })}>
                <Box className={css({ color: ui.textPrimary, fontWeight: '600', fontSize: 'sm', mb: '3' })}>
                    Scope Addresses
                </Box>

                {/* Row 1: address + label */}
                <Flex gap="2" wrap="wrap" mb="2">
                    <Box flex="1" minW="180px">
                        <Box className={css({ color: ui.textSecondary, fontSize: 'xs', mb: '1', fontWeight: '500' })}>Address</Box>
                        <input
                            type="text"
                            value={addrInput}
                            onChange={(e) => setAddrInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                            placeholder="0x…"
                            className={css({
                                w: 'full', bg: 'transparent',
                                border: `1px solid ${ui.borderSoft}`, borderRadius: '8px',
                                px: '3', py: '1.5', color: ui.textPrimary, fontSize: 'xs',
                                fontFamily: "'Roboto Mono', monospace", outline: 'none',
                                _focus: { border: '1px solid rgba(88, 214, 171, 0.5)' },
                            })}
                        />
                    </Box>
                    <Box minW="120px">
                        <Box className={css({ color: ui.textSecondary, fontSize: 'xs', mb: '1', fontWeight: '500' })}>Label</Box>
                        <input
                            type="text"
                            value={labelInput}
                            onChange={(e) => setLabelInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                            placeholder="e.g. Vault"
                            className={inputCls}
                        />
                    </Box>
                </Flex>

                {/* Row 2: type + button */}
                <Flex gap="2" wrap="wrap" align="flex-end">
                    <Box minW="130px">
                        <Box className={css({ color: ui.textSecondary, fontSize: 'xs', mb: '1', fontWeight: '500' })}>Type</Box>
                        <select
                            value={addrType}
                            onChange={(e) => setAddrType(e.target.value)}
                            className={css({
                                w: 'full', bg: 'rgba(26,26,32,0.98)',
                                border: `1px solid ${ui.borderSoft}`, borderRadius: '8px',
                                px: '3', py: '1.5', color: ui.textPrimary, fontSize: 'xs', outline: 'none',
                                _focus: { border: '1px solid rgba(88, 214, 171, 0.5)' },
                            })}
                        >
                            {['deployment', 'proxy', 'implementation', 'role', 'token', 'external', 'other'].map((t) => (
                                <option key={t} value={t}>{t}</option>
                            ))}
                        </select>
                    </Box>
                    <button
                        disabled={!addrInput.trim()}
                        onClick={handleAdd}
                        className={css({
                            bg: addrInput.trim() ? 'rgba(88, 214, 171, 0.9)' : 'rgba(88, 214, 171, 0.3)',
                            color: '#08211a', fontWeight: '600', fontSize: 'xs',
                            px: '4', py: '1.5', borderRadius: '8px',
                            cursor: addrInput.trim() ? 'pointer' : 'not-allowed',
                            transition: 'all 0.2s', whiteSpace: 'nowrap',
                        })}
                    >
                        + Add Address
                    </button>
                </Flex>

                {addError && (
                    <Box className={css({ mt: '2', color: 'rgba(255,130,130,0.9)', fontSize: 'xs', fontFamily: "'Roboto Mono', monospace" })}>
                        {addError}
                    </Box>
                )}
            </Box>

            {/* ── Address table ── */}
            {addresses.length > 0 && (
                <Box className={css({ borderRadius: '16px', border: `1px solid ${ui.borderSoft}`, bg: ui.surfaceContent, overflow: 'hidden' })}>
                    <Box style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ borderBottom: `1px solid ${ui.borderFaint}`, background: 'rgba(0,0,0,0.3)' }}>
                                    {['Address', 'Label', 'Chain', 'Type', 'Contract', 'Verified', 'Actions'].map((h) => (
                                        <th key={h} style={{
                                            padding: '8px 10px', textAlign: 'left',
                                            color: ui.textMuted, fontSize: '10px', fontWeight: 600,
                                            letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap',
                                        }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {addresses.map((addr, i) => (
                                    <>
                                        <tr
                                            key={addr.id}
                                            style={{
                                                borderBottom: expandedBytecode === addr.id ? 'none' : `1px solid ${ui.borderFaint}`,
                                                background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                                            }}
                                        >
                                            {/* Address */}
                                            <td style={{ padding: '8px 10px' }}>
                                                <Flex align="center" gap="1">
                                                    <Box
                                                        title={addr.address}
                                                        className={css({ color: ui.textSecondary, fontSize: 'xs', fontFamily: "'Roboto Mono', monospace" })}
                                                    >
                                                        {truncateAddr(addr.address)}
                                                    </Box>
                                                    <button
                                                        onClick={() => navigator.clipboard?.writeText(addr.address)}
                                                        title="Copy"
                                                        className={css({ color: ui.textMuted, bg: 'transparent', cursor: 'pointer', display: 'flex', _hover: { color: ui.accent } })}
                                                    >
                                                        <Copy size={14} />
                                                    </button>
                                                </Flex>
                                            </td>

                                            {/* Label */}
                                            <td style={{ padding: '8px 10px' }}>
                                                <Box
                                                    title={addr.label}
                                                    className={css({ color: ui.textPrimary, fontSize: 'xs', fontWeight: 500, maxW: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })}
                                                >
                                                    {addr.label}
                                                </Box>
                                            </td>

                                            {/* Chain */}
                                            <td style={{ padding: '8px 10px' }}>
                                                <Box className={css({ color: ui.textMuted, fontSize: '10px', fontFamily: "'Roboto Mono', monospace", bg: 'rgba(255,255,255,0.06)', px: '1.5', py: '0.5', borderRadius: '4px', display: 'inline-block', whiteSpace: 'nowrap' })}>
                                                    {CHAIN_LABELS[addr.chain_id] ?? addr.chain_id}
                                                </Box>
                                            </td>

                                            {/* Type */}
                                            <td style={{ padding: '8px 10px' }}>
                                                <Box style={{
                                                    display: 'inline-block', padding: '1px 7px', borderRadius: '10px',
                                                    fontSize: '10px', fontWeight: 600, whiteSpace: 'nowrap',
                                                    background: `${(ADDR_TYPE_COLOR[addr.address_type] ?? ADDR_TYPE_COLOR.other).replace('0.85)', '0.12)')}`,
                                                    color: ADDR_TYPE_COLOR[addr.address_type] ?? ADDR_TYPE_COLOR.other,
                                                }}>
                                                    {addr.address_type}
                                                </Box>
                                            </td>

                                            {/* is_contract */}
                                            <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                                                <Box style={{ color: addr.is_contract ? ui.accentStr : 'rgba(185,185,189,0.35)', fontSize: '16px', fontWeight: 700, lineHeight: 1 }}>
                                                    {addr.is_contract ? '✓' : '—'}
                                                </Box>
                                            </td>

                                            {/* is_verified */}
                                            <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                                                <Box style={{
                                                    width: 8, height: 8, borderRadius: '50%', margin: '0 auto',
                                                    background: addr.is_verified ? 'rgba(88, 214, 171, 0.85)' : 'rgba(185,185,189,0.25)',
                                                }} />
                                            </td>

                                            {/* Actions */}
                                            <td style={{ padding: '8px 10px' }}>
                                                <Flex gap="1" align="center">
                                                    {addr.is_contract && (
                                                        <button
                                                            disabled={fetchingId === addr.id}
                                                            onClick={() => handleFetchCode(addr.id)}
                                                            title="Fetch verified source code from block explorer"
                                                            className={css({
                                                                fontSize: '10px', px: '2', py: '0.5', borderRadius: '5px',
                                                                border: `1px solid ${ui.borderSoft}`, bg: 'transparent',
                                                                color: ui.textSecondary, cursor: 'pointer', whiteSpace: 'nowrap',
                                                                _hover: { borderColor: 'rgba(88, 214, 171, 0.4)', color: ui.accent },
                                                                opacity: fetchingId === addr.id ? 0.5 : 1,
                                                            })}
                                                        >
                                                            {fetchingId === addr.id ? '…' : 'Fetch Code'}
                                                        </button>
                                                    )}

                                                    {addr.bytecode && (
                                                        <button
                                                            onClick={() => setExpandedBytecode(expandedBytecode === addr.id ? null : addr.id)}
                                                            title="View bytecode"
                                                            className={css({
                                                                fontSize: '10px', px: '2', py: '0.5', borderRadius: '5px',
                                                                border: '1px solid rgba(120, 160, 255, 0.3)',
                                                                bg: expandedBytecode === addr.id ? 'rgba(120, 160, 255, 0.15)' : 'rgba(120, 160, 255, 0.06)',
                                                                color: 'rgba(120, 160, 255, 0.85)', cursor: 'pointer', whiteSpace: 'nowrap',
                                                                _hover: { borderColor: 'rgba(120, 160, 255, 0.5)' },
                                                            })}
                                                        >
                                                            bytecode
                                                        </button>
                                                    )}

                                                    <button
                                                        disabled={deletingId === addr.id}
                                                        onClick={() => handleDelete(addr.id)}
                                                        title="Remove address"
                                                        className={css({
                                                            color: ui.textMuted, bg: 'transparent',
                                                            cursor: deletingId === addr.id ? 'not-allowed' : 'pointer',
                                                            display: 'flex', alignItems: 'center',
                                                            _hover: { color: 'rgba(255,130,130,0.9)' },
                                                            opacity: deletingId === addr.id ? 0.4 : 1,
                                                        })}
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </Flex>
                                            </td>
                                        </tr>

                                        {/* Bytecode expander */}
                                        {expandedBytecode === addr.id && addr.bytecode && (
                                            <tr key={`${addr.id}-bc`} style={{ borderBottom: `1px solid ${ui.borderFaint}` }}>
                                                <td colSpan={7} style={{ padding: '0 10px 10px' }}>
                                                    <Box className={css({
                                                        bg: 'rgba(0,0,0,0.45)', borderRadius: '8px', p: '3', mt: '1',
                                                        fontFamily: "'Roboto Mono', monospace", fontSize: '10px',
                                                        color: 'rgba(120, 160, 255, 0.85)',
                                                        maxH: '80px', overflowY: 'auto', overflowX: 'auto', wordBreak: 'break-all',
                                                    })}>
                                                        {addr.bytecode}
                                                    </Box>
                                                </td>
                                            </tr>
                                        )}
                                    </>
                                ))}
                            </tbody>
                        </table>
                    </Box>
                </Box>
            )}

            {/* ── Address summary / confirmation ── */}
            {addresses.length > 0 && (
                <Box>
                    <Flex align="center" justify="space-between" mb="2">
                        <Box className={css({ color: ui.textPrimary, fontSize: 'sm', fontWeight: '700', letterSpacing: '0.08em', textTransform: 'uppercase' })}>
                            Address Summary
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
                            {saved ? 'Saved ✓' : 'Save Addresses'}
                        </button>
                    </Flex>

                    <Box className={css({ borderRadius: '12px', border: `1px solid ${ui.borderFaint}`, bg: 'rgba(18, 18, 22, 0.6)', overflow: 'hidden' })}>
                        {/* Stats */}
                        <Flex align="center" gap="6" className={css({ px: '4', py: '2', borderBottom: `1px solid ${ui.borderFaint}`, bg: 'rgba(88, 214, 171, 0.04)', flexWrap: 'wrap' })}>
                            <Flex align="center" gap="2">
                                <Box className={css({ w: '6px', h: '6px', borderRadius: '50%', bg: 'rgba(88, 214, 171, 0.8)', flexShrink: 0 })} />
                                <Box className={css({ color: ui.textMuted, fontSize: 'xs' })}>Total</Box>
                                <Box className={css({ color: ui.textPrimary, fontSize: 'xs', fontWeight: '700', fontFamily: "'Roboto Mono', monospace" })}>{addresses.length}</Box>
                            </Flex>
                            <Flex align="center" gap="2">
                                <Box className={css({ w: '6px', h: '6px', borderRadius: '50%', bg: 'rgba(120, 160, 255, 0.8)', flexShrink: 0 })} />
                                <Box className={css({ color: ui.textMuted, fontSize: 'xs' })}>Contracts</Box>
                                <Box className={css({ color: ui.textSecondary, fontSize: 'xs', fontWeight: '700', fontFamily: "'Roboto Mono', monospace" })}>{contractCount}</Box>
                            </Flex>
                            <Flex align="center" gap="2">
                                <Box className={css({ w: '6px', h: '6px', borderRadius: '50%', bg: 'rgba(88, 214, 171, 0.5)', flexShrink: 0 })} />
                                <Box className={css({ color: ui.textMuted, fontSize: 'xs' })}>Verified</Box>
                                <Box className={css({ color: ui.textSecondary, fontSize: 'xs', fontWeight: '700', fontFamily: "'Roboto Mono', monospace" })}>{verifiedCount}</Box>
                            </Flex>
                        </Flex>

                        {/* Address list */}
                        <Box className={css({ maxH: '160px', overflowY: 'auto', px: '4', py: '1' })}>
                            {addresses.map((addr) => (
                                <Flex key={addr.id} align="center" gap="2" className={css({ py: '1', borderBottom: `1px solid ${ui.borderFaint}`, _last: { borderBottom: 'none' } })}>
                                    <Box style={{
                                        width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                                        background: addr.is_verified ? 'rgba(88, 214, 171, 0.85)' : 'rgba(185,185,189,0.3)',
                                    }} />
                                    <Box className={css({ color: ui.textSecondary, fontSize: 'xs', fontFamily: "'Roboto Mono', monospace", flex: 1 })}>
                                        {truncateAddr(addr.address)}
                                    </Box>
                                    <Box className={css({ color: ui.textMuted, fontSize: 'xs', flexShrink: 0 })}>{addr.label}</Box>
                                    <Box style={{
                                        display: 'inline-block', padding: '0 5px', borderRadius: '8px',
                                        fontSize: '9px', fontWeight: 600,
                                        background: `${(ADDR_TYPE_COLOR[addr.address_type] ?? ADDR_TYPE_COLOR.other).replace('0.85)', '0.10)')}`,
                                        color: ADDR_TYPE_COLOR[addr.address_type] ?? ADDR_TYPE_COLOR.other,
                                        whiteSpace: 'nowrap', flexShrink: 0,
                                    }}>
                                        {addr.address_type}
                                    </Box>
                                </Flex>
                            ))}
                        </Box>
                    </Box>
                </Box>
            )}

            {addresses.length === 0 && (
                <Box className={css({
                    p: '8', borderRadius: '16px', border: `1px dashed ${ui.borderFaint}`,
                    bg: 'rgba(0,0,0,0.15)', textAlign: 'center',
                })}>
                    <Box className={css({ color: ui.textMuted, fontSize: 'xs', mb: '1' })}>No addresses yet</Box>
                    <Box className={css({ color: ui.textMuted, fontSize: 'xs', opacity: 0.6 })}>Add an address above to track deployment, proxy, or role addresses.</Box>
                </Box>
            )}
        </Flex>
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

    // Address (source tab — fetches code into file tree)
    const [contractAddress, setContractAddress] = useState('')
    const [isFetchingAddress, setIsFetchingAddress] = useState(false)

    // Upload + file tree
    const [isProcessing, setIsProcessing] = useState(false)
    const [processError, setProcessError] = useState<string | null>(null)
    const [contracts, setContracts] = useState<ScopeContract[]>([])
    const [isDragOver, setIsDragOver] = useState(false)

    // Addresses panel
    const [addresses, setAddresses] = useState<ScopeAddress[]>([])

    // Load audit info
    useEffect(() => {
        let active = true
        getAudit(auditId)
            .then((data) => { if (active) { setAudit(data); setError(null); setIsLoading(false) } })
            .catch((err) => { if (active) { setError(err instanceof Error ? err.message : 'Failed to load audit'); setIsLoading(false) } })
        return () => { active = false }
    }, [auditId])

    // Load contracts + addresses on mount
    useEffect(() => {
        let active = true
        Promise.all([
            scopeApi.listContracts(auditId),
            scopeApi.listAddresses(auditId),
        ]).then(([contractsRes, addressesRes]) => {
            if (!active) return
            setContracts(contractsRes.items)
            setAddresses(addressesRes.items)
        }).catch((err) => console.error('Failed to load scope data:', err))
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

    const loadAddresses = async () => {
        try {
            const { items } = await scopeApi.listAddresses(auditId)
            setAddresses(items)
        } catch (err) {
            console.error('Failed to reload addresses:', err)
        }
    }

    const handleToggleScope = async (contractIds: string[], isInScope: boolean) => {
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
        const elapsed = Date.now() - start
        const remaining = 2000 - elapsed
        if (remaining > 0) await new Promise((r) => setTimeout(r, remaining))
        await loadContracts()
        setIsProcessing(false)
        if (opError) setProcessError(opError)
    }

    // Overlay for address operations (doesn't reload contracts)
    const processAddressWithOverlay = async (fn: () => Promise<void>) => {
        setIsProcessing(true)
        const start = Date.now()
        try {
            await fn()
        } catch (err) {
            console.error('Address fetch error:', err)
        }
        const elapsed = Date.now() - start
        const remaining = 2000 - elapsed
        if (remaining > 0) await new Promise((r) => setTimeout(r, remaining))
        setIsProcessing(false)
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
                address_type: 'deployment',
            })
            await scopeApi.fetchVerifiedCode(addr.id)
            setContractAddress('')
        })
        await loadAddresses()
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
                showSearch={false}
                journeyItems={[
                    { label: 'Scope', isCurrent: true },
                    { label: 'Enum', onClick: () => onNavigate(`/enum/${auditId}`) },
                    { label: 'Static Analysis' },
                ]}
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

                {/* TWO-COLUMN LAYOUT */}
                {!isLoading && !error && audit && (
                    <Grid columns={{ base: 1, xl: 2 }} gap="6" alignItems="start">

                        {/* ── LEFT: Sources + File Tree + Confirmation ── */}
                        <Flex direction="column" gap="4">
                            <Box className={css({ color: ui.textSecondary, fontSize: 'sm', fontWeight: '500' })}>Add New Source</Box>

                            {/* Source type tabs */}
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
                                                _hover: { bg: isActive ? 'rgba(88, 214, 171, 0.08)' : 'rgba(255, 255, 255, 0.03)' },
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

                            {/* Active panel */}
                            <Box className={css({ p: '5', borderRadius: '16px', border: `1px solid ${ui.borderSoft}`, bg: ui.surfaceContent, boxShadow: '0 4px 24px rgba(0,0,0,0.35)' })}>

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
                                        px: '4', py: '3', borderRadius: '10px',
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
                                <ConfirmationSection contracts={contracts} onSave={() => {}} />
                            )}
                        </Flex>

                        {/* ── RIGHT: Addresses Panel ── */}
                        <Flex direction="column" gap="4">
                            <Box className={css({ color: ui.textSecondary, fontSize: 'sm', fontWeight: '500' })}>Add new addresses to scope</Box>
                            <AddressPanel
                                auditId={auditId}
                                addresses={addresses}
                                onReload={loadAddresses}
                                onReloadContracts={loadContracts}
                                onShowOverlay={processAddressWithOverlay}
                            />
                        </Flex>

                    </Grid>
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
                    onComplete={() => onNavigate(`/enum/${auditId}`)}
                />
            </Flex>
        </Flex>
    )
}
