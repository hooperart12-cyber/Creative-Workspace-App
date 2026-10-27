import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { copyFile, lstat, mkdir, open, readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { dirname, join, parse, resolve } from 'node:path'
import Database from 'better-sqlite3'
import type { RecoveryAsset, RecoveryKind, RecoveryManifest, RetentionLimits } from '@shared/types'
import { readChangeRevision } from './schemaInfo'

export const BACKUP_INTERVAL_MS = 60 * 60 * 1000
export const MANIFEST_VERSION = 1

export type { RecoveryAsset, RecoveryKind, RecoveryManifest, RetentionLimits }

export const DEFAULT_RETENTION: RetentionLimits = {
  hourly: 12,
  daily: 7,
  weekly: 4,
  monthly: 3
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/
const EXT_PATTERN = /^[a-z0-9]{1,16}$/i

export function storedOriginalPath(projectPath: string, sha256: string, ext: string): string {
  return join(projectPath, 'assets', sha256.slice(0, 2), `${sha256}.${ext}`)
}

export function blobPath(vaultRoot: string, sha256: string): string {
  return join(vaultRoot, 'blobs', sha256)
}

export function dueForAutomatic(input: {
  now: number
  revision: number | null
  lastAutomatic: { createdAt: number; changeRevision: number | null } | null
  intervalMs?: number
}): boolean {
  if (!input.lastAutomatic) return true
  const interval = input.intervalMs ?? BACKUP_INTERVAL_MS
  if (input.now - input.lastAutomatic.createdAt < interval) return false
  if (input.revision == null || input.lastAutomatic.changeRevision == null) return true
  return input.revision !== input.lastAutomatic.changeRevision
}

export function chooseKept(
  manifests: RecoveryManifest[],
  limits: RetentionLimits,
  now: number
): Set<string> {
  const kept = new Set<string>()
  const automatic = manifests
    .filter((point) => point.kind === 'baseline' || point.kind === 'hourly')
    .sort((a, b) => b.createdAt - a.createdAt)
  for (const point of manifests) if (point.protected) kept.add(point.id)
  for (const point of automatic.slice(0, limits.hourly)) kept.add(point.id)

  const newestOn = (keyOf: (createdAt: number) => string, keys: string[]) => {
    const found = new Map<string, RecoveryManifest>()
    for (const point of automatic) {
      const key = keyOf(point.createdAt)
      const current = found.get(key)
      if (!current || point.createdAt > current.createdAt) found.set(key, point)
    }
    for (const key of keys) {
      const point = found.get(key)
      if (point) kept.add(point.id)
    }
  }
  const today = utcDay(now)
  newestOn(
    utcDay,
    Array.from({ length: limits.daily }, (_, index) => addDays(today, -index))
  )
  newestOn(isoWeek, recentWeeks(now, limits.weekly))
  newestOn(utcMonth, recentMonths(now, limits.monthly))
  return kept
}

export async function createRecoveryPoint(input: {
  sqlite: Database.Database
  projectPath: string
  projectId: string
  projectName: string
  vaultRoot: string
  kind: RecoveryKind
  now?: number
  signal?: { cancelled: boolean }
  copy?: (from: string, to: string) => Promise<void>
}): Promise<RecoveryManifest> {
  const id = randomUUID()
  const staging = join(input.vaultRoot, 'staging', id)
  await cleanupStaging(input.vaultRoot)
  await mkdir(staging, { recursive: true })
  const databasePath = join(staging, 'database.db')
  try {
    await input.sqlite.backup(databasePath)
    const snapshot = new Database(databasePath, { readonly: true, fileMustExist: true })
    let assets: RecoveryAsset[]
    let changeRevision: number | null
    try {
      const check = snapshot.prepare('PRAGMA integrity_check').get() as { integrity_check: string }
      if (check.integrity_check !== 'ok') {
        throw new Error('The database snapshot failed its integrity check.')
      }
      assets = (
        snapshot.prepare('SELECT sha256, ext, bytes FROM assets').all() as RecoveryAsset[]
      ).map(checkedAsset)
      changeRevision = readChangeRevision(snapshot)
    } finally {
      snapshot.close()
    }
    const copied = new Set<string>()
    for (const asset of assets) {
      if (input.signal?.cancelled) throw new Error('Backup cancelled.')
      const destination = blobPath(input.vaultRoot, asset.sha256)
      const existed = await fileSize(destination)
      if (existed == null) {
        const source = storedOriginalPath(input.projectPath, asset.sha256, asset.ext)
        await mkdir(dirname(destination), { recursive: true })
        await (input.copy ?? copyFile)(source, destination)
        copied.add(asset.sha256)
      }
      await assertBlobSize(destination, asset)
      if (copied.has(asset.sha256)) await assertChecksum(destination, asset.sha256)
    }
    for (const asset of assets) await assertBlobSize(blobPath(input.vaultRoot, asset.sha256), asset)
    const database = {
      sha256: await hashFile(databasePath),
      bytes: (await stat(databasePath)).size
    }
    const manifest: RecoveryManifest = {
      formatVersion: MANIFEST_VERSION,
      id,
      projectId: input.projectId,
      projectName: input.projectName,
      createdAt: input.now ?? Date.now(),
      kind: input.kind,
      protected: input.kind === 'manual' || input.kind === 'premigration',
      changeRevision,
      assets,
      database
    }
    const handle = await open(join(staging, 'manifest.json'), 'w')
    try {
      await handle.writeFile(JSON.stringify(manifest))
      await handle.sync()
    } finally {
      await handle.close()
    }
    const finalDir = join(input.vaultRoot, 'points', id)
    await mkdir(join(input.vaultRoot, 'points'), { recursive: true })
    await rename(staging, finalDir)
    return manifest
  } catch (error) {
    await rm(join(input.vaultRoot, 'staging'), { recursive: true, force: true })
    throw error
  }
}

export async function listManifests(vaultRoot: string): Promise<RecoveryManifest[]> {
  const dir = join(vaultRoot, 'points')
  if (!existsSync(dir)) return []
  const names = await readdir(dir)
  const manifests: RecoveryManifest[] = []
  for (const name of names) {
    const file = join(dir, name, 'manifest.json')
    if (!existsSync(file)) continue
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8')) as RecoveryManifest
      if (parsed.formatVersion !== MANIFEST_VERSION || parsed.id !== name) continue
      manifests.push(parsed)
    } catch {
      // A half-written directory is not a recovery point.
    }
  }
  return manifests.sort((a, b) => b.createdAt - a.createdAt)
}

export async function verifyPoint(
  vaultRoot: string,
  id: string,
  mode: 'size' | 'checksum'
): Promise<{ ok: true } | { ok: false; errors: string[] }> {
  const manifest = (await listManifests(vaultRoot)).find((point) => point.id === id)
  if (!manifest) return { ok: false, errors: ['That recovery point is not in this backup folder.'] }
  const errors: string[] = []
  const databasePath = join(vaultRoot, 'points', id, 'database.db')
  const databaseSize = await fileSize(databasePath)
  if (databaseSize !== manifest.database.bytes)
    errors.push('The database snapshot is the wrong size.')
  if (
    mode === 'checksum' &&
    databaseSize != null &&
    (await hashFile(databasePath)) !== manifest.database.sha256
  ) {
    errors.push('The database snapshot does not match its checksum.')
  }
  if (databaseSize != null) {
    const snapshot = new Database(databasePath, { readonly: true, fileMustExist: true })
    try {
      const check = snapshot.prepare('PRAGMA integrity_check').get() as { integrity_check: string }
      if (check.integrity_check !== 'ok')
        errors.push('The database snapshot failed its integrity check.')
    } finally {
      snapshot.close()
    }
  }
  for (const asset of manifest.assets) {
    const path = blobPath(vaultRoot, asset.sha256)
    const size = await fileSize(path)
    if (size == null) errors.push(`${asset.sha256} is missing from the backup.`)
    else if (size !== asset.bytes) errors.push(`${asset.sha256} is the wrong size.`)
    else if (mode === 'checksum' && (await hashFile(path)) !== asset.sha256) {
      errors.push(`${asset.sha256} does not match its checksum.`)
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true }
}

export async function applyRetention(
  vaultRoot: string,
  limits: RetentionLimits,
  now: number
): Promise<string[]> {
  const manifests = await listManifests(vaultRoot)
  const kept = chooseKept(manifests, limits, now)
  const removed: string[] = []
  for (const manifest of manifests) {
    if (kept.has(manifest.id)) continue
    await rm(join(vaultRoot, 'points', manifest.id), { recursive: true, force: true })
    removed.push(manifest.id)
  }
  await collectGarbage(vaultRoot)
  return removed
}

/** Deletes blob files no remaining manifest names. */
export async function collectGarbage(vaultRoot: string): Promise<string[]> {
  const referenced = new Set<string>()
  for (const manifest of await listManifests(vaultRoot)) {
    for (const asset of manifest.assets) referenced.add(asset.sha256)
  }
  const dir = join(vaultRoot, 'blobs')
  if (!existsSync(dir)) return []
  const removed: string[] = []
  for (const name of await readdir(dir)) {
    if (referenced.has(name)) continue
    await rm(join(dir, name), { force: true })
    removed.push(name)
  }
  return removed
}

export async function deleteRecoveryPoint(vaultRoot: string, id: string): Promise<void> {
  const manifests = await listManifests(vaultRoot)
  if (!manifests.some((point) => point.id === id))
    throw new Error('That recovery point was not found.')
  await rm(join(vaultRoot, 'points', id), { recursive: true, force: true })
  await collectGarbage(vaultRoot)
}

export async function vaultBytes(vaultRoot: string): Promise<number> {
  return directoryBytes(vaultRoot)
}

export async function cleanupStaging(vaultRoot: string): Promise<void> {
  await rm(join(vaultRoot, 'staging'), { recursive: true, force: true })
}

/** True when both paths are on the same drive letter (Windows) or device (macOS). */
export async function sameVolume(projectPath: string, vaultRoot: string): Promise<boolean> {
  const projectRoot = await existingAncestor(projectPath)
  const vault = await existingAncestor(vaultRoot)
  if (process.platform === 'win32') return parse(projectRoot).root === parse(vault).root
  const [left, right] = await Promise.all([stat(projectRoot), stat(vault)])
  return left.dev === right.dev
}

export async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolveHash, reject) => {
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolveHash())
    stream.on('error', reject)
  })
  return hash.digest('hex')
}

function checkedAsset(row: RecoveryAsset): RecoveryAsset {
  if (
    !SHA256_PATTERN.test(row.sha256) ||
    !EXT_PATTERN.test(row.ext) ||
    !Number.isInteger(row.bytes)
  ) {
    throw new Error('The snapshot lists a file this backup cannot store safely.')
  }
  return { sha256: row.sha256, ext: row.ext, bytes: Number(row.bytes) }
}

async function assertBlobSize(path: string, asset: RecoveryAsset): Promise<void> {
  const size = await fileSize(path)
  if (size == null) throw new Error(`${asset.sha256} is missing from the backup.`)
  if (size !== asset.bytes) throw new Error(`${asset.sha256} is the wrong size.`)
}

async function assertChecksum(path: string, sha256: string): Promise<void> {
  if ((await hashFile(path)) !== sha256) {
    await rm(path, { force: true })
    throw new Error(`${sha256} did not match its checksum.`)
  }
}

async function fileSize(path: string): Promise<number | null> {
  try {
    const info = await lstat(path)
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new Error(`${path} is not a regular file.`)
    }
    return info.size
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

async function directoryBytes(path: string): Promise<number> {
  if (!existsSync(path)) return 0
  let total = 0
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name)
    if (entry.isDirectory()) total += await directoryBytes(child)
    else if (entry.isFile()) total += (await stat(child)).size
  }
  return total
}

async function existingAncestor(path: string): Promise<string> {
  let current = resolve(path)
  while (!existsSync(current)) {
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return current
}

function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function utcMonth(ms: number): string {
  return new Date(ms).toISOString().slice(0, 7)
}

function addDays(day: string, count: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + count)
  return date.toISOString().slice(0, 10)
}

function isoWeek(ms: number): string {
  const date = new Date(ms)
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = utc.getUTCDay() || 7
  utc.setUTCDate(utc.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

function recentWeeks(now: number, count: number): string[] {
  const keys: string[] = []
  for (let index = 0; index < count; index++) keys.push(isoWeek(now - index * 7 * 86400000))
  return keys
}

function recentMonths(now: number, count: number): string[] {
  const date = new Date(now)
  const keys: string[] = []
  for (let index = 0; index < count; index++) {
    const month = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - index, 1))
    keys.push(month.toISOString().slice(0, 7))
  }
  return keys
}
