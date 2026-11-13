/**
 * Lists files for the import preview. It does not create pages or copy assets.
 */
import { lstat, readdir } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { stageImportNames, type StagedSource } from '@shared/collectionImport'
import { listComicArchive } from './comicArchive'

const ARCHIVE = new Set(['.zip', '.cbz'])

interface FoundFile {
  name: string
  filePath: string | null
  archive: { zipPath: string; entry: string } | null
}

export async function stageCollectionPaths(paths: readonly string[]): Promise<{
  files: StagedSource[]
  error: string | null
}> {
  const found: FoundFile[] = []
  const errors: string[] = []
  for (const path of paths) {
    try {
      const info = await lstat(path)
      if (info.isSymbolicLink()) {
        errors.push('A link was skipped.')
        continue
      }
      if (info.isDirectory()) await walkFolder(path, '', found)
      else if (ARCHIVE.has(extname(path).toLowerCase())) {
        try {
          const names = await listComicArchive(path)
          for (const entry of names) {
            found.push({ name: entry, filePath: null, archive: { zipPath: path, entry } })
          }
        } catch (error) {
          errors.push(error instanceof Error ? error.message : 'The archive could not be staged.')
        }
      } else {
        found.push({ name: basename(path), filePath: path, archive: null })
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'A file could not be read.')
    }
    if (found.length > 2000) return { files: [], error: 'More than 2000 files.' }
  }
  const staged = stageImportNames(found.map((item) => item.name))
  const pending = new Map<string, FoundFile[]>()
  for (const item of found) {
    const list = pending.get(item.name) ?? []
    list.push(item)
    pending.set(item.name, list)
  }
  const files = staged.map((entry) => {
    const list = pending.get(entry.name) ?? []
    const source = list.shift()
    return { ...entry, filePath: source?.filePath ?? null, archive: source?.archive ?? null }
  })
  return { files, error: errors[0] ?? null }
}

async function walkFolder(root: string, prefix: string, found: FoundFile[]): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    const full = join(root, entry.name)
    if (entry.isDirectory()) await walkFolder(full, rel, found)
    else if (entry.isFile()) found.push({ name: rel, filePath: full, archive: null })
    if (found.length > 2000) return
  }
}
