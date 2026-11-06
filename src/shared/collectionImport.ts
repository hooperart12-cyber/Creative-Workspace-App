/**
 * Staged import planning. Suggestions are labels until the caller opts in.
 * Planning writes nothing.
 */
import { naturalCompare } from './collections'

/** Formats this app can store as artwork. PDF is never converted into an image. */
export const COMIC_IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp'])

const VERSION_WORD = /\b(sketch|inks|tones|lettering|pencils|colors|letters|final)\b/i

export interface StagedSource extends StagedEntry {
  filePath: string | null
  archive: { zipPath: string; entry: string } | null
}

export interface StagedEntry {
  name: string
  accepted: boolean
  reason: string | null
  /** Set only when another accepted file shares the stem. It is not applied by itself. */
  suggestion: 'version' | null
  groupKey: string | null
}

export type ImportAction =
  { kind: 'page'; names: string[] } | { kind: 'fill'; pageId: string; names: string[] }

export interface ImportPlan {
  actions: ImportAction[]
  leftover: string[]
}

export interface CommittedAsset {
  assetId: string
  name: string
}

/** The approved plan, with library asset ids in place of file names. */
export type CommittedAction =
  | { kind: 'page'; assets: CommittedAsset[] }
  | { kind: 'fill'; pageId: string; assets: CommittedAsset[] }

/** Natural-sorts accepted images. Unsafe paths, other formats, and duplicate names stay out. */
export function stageImportNames(names: readonly string[]): StagedEntry[] {
  if (names.length > 2000) {
    return [
      {
        name: '',
        accepted: false,
        reason: 'More than 2000 files.',
        suggestion: null,
        groupKey: null
      }
    ]
  }
  const inspected = names.map((name) => inspectName(name))
  const accepted = inspected.filter((entry) => entry.accepted)
  accepted.sort((a, b) => naturalCompare(a.name, b.name))
  const seen = new Set<string>()
  for (const entry of accepted) {
    const key = entry.name.toLowerCase()
    if (seen.has(key)) {
      entry.accepted = false
      entry.reason = 'Duplicate file name.'
    } else {
      seen.add(key)
    }
  }
  const groups = new Map<string, StagedEntry[]>()
  for (const entry of accepted) {
    if (!entry.accepted || !entry.groupKey) continue
    const list = groups.get(entry.groupKey) ?? []
    list.push(entry)
    groups.set(entry.groupKey, list)
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue
    for (const entry of list) entry.suggestion = 'version'
  }
  return [
    ...accepted.filter((entry) => entry.accepted),
    ...inspected.filter((entry) => !entry.accepted)
  ]
}

/**
 * `applyVersionGroups` must be explicit. Otherwise each file is its own page,
 * even when a version suggestion is present. Fill does not create extra pages.
 */
export function planStagedImport(input: {
  entries: readonly StagedEntry[]
  placeholders: readonly { id: string; hasArtwork: boolean }[]
  mode: 'append' | 'insert' | 'fill'
  applyVersionGroups: boolean
}): ImportPlan {
  const accepted = input.entries.filter((entry) => entry.accepted)
  const blanks = input.placeholders.filter((page) => !page.hasArtwork).map((page) => page.id)
  const actions: ImportAction[] = []
  const leftover: string[] = []
  const used = new Set<string>()
  for (const entry of accepted) {
    if (used.has(entry.name)) continue
    const group =
      input.applyVersionGroups && entry.groupKey
        ? accepted.filter((item) => item.groupKey === entry.groupKey)
        : [entry]
    for (const item of group) used.add(item.name)
    const names = group.map((item) => item.name)
    if (input.mode === 'fill') {
      const pageId = blanks.shift()
      if (!pageId) leftover.push(...names)
      else actions.push({ kind: 'fill', pageId, names })
    } else {
      actions.push({ kind: 'page', names })
    }
  }
  return { actions, leftover }
}

function inspectName(name: string): StagedEntry {
  const empty: StagedEntry = {
    name,
    accepted: false,
    reason: null,
    suggestion: null,
    groupKey: null
  }
  const unsafe = unsafeReason(name)
  if (unsafe) return { ...empty, reason: unsafe }
  const base = name.replace(/\\/g, '/').split('/').pop() ?? name
  const ext = base.includes('.') ? (base.split('.').pop() ?? '').toLowerCase() : ''
  if (ext === 'pdf') return { ...empty, reason: 'PDF pages are not converted to images.' }
  if (!COMIC_IMAGE_EXTENSIONS.has(ext))
    return { ...empty, reason: 'This file is not a supported image.' }
  return { ...empty, accepted: true, reason: null, groupKey: versionGroup(base) }
}

function versionGroup(base: string): string | null {
  const stem = base.replace(/\.[^.]+$/, '')
  if (!VERSION_WORD.test(stem)) return null
  const stripped = stem
    .replace(VERSION_WORD, ' ')
    .replace(/[_\-\s]+/g, ' ')
    .trim()
    .toLowerCase()
  return stripped || null
}

function unsafeReason(name: string): string | null {
  if (name.includes('\0')) return 'Unsafe path.'
  const normalized = name.replace(/\\/g, '/')
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) return 'Unsafe path.'
  const parts = normalized.split('/')
  if (parts.some((part) => part === '' || part === '.' || part === '..')) return 'Unsafe path.'
  return null
}
