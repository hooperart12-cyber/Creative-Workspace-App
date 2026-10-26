import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import Database from 'better-sqlite3'
import { ZipFile } from 'yazl'
import yauzl, { type Entry } from 'yauzl'
import { openRawDatabase } from '../db/client'
import { hashFile, storedOriginalPath } from './backup'
import { Project, PROJECT_DB_FILE, PROJECT_EXTENSION, sanitizeProjectName } from './project'

interface ZipManifestFile {
  path: string
  sha256: string
  bytes: number
}

interface ZipManifest {
  formatVersion: 1
  kind: 'creative-workspace-project'
  files: ZipManifestFile[]
}

/** Writes a self-contained project archive from a consistent database snapshot. */
export async function exportProjectZip(input: {
  sqlite: Database.Database
  projectPath: string
  destination: string
}): Promise<void> {
  const snapshot = join(dirname(input.destination), `.${randomUUID()}.db`)
  const staging = `${input.destination}.${randomUUID()}.partial`
  await input.sqlite.backup(snapshot)
  try {
    const db = new Database(snapshot, { readonly: true, fileMustExist: true })
    let assets: { sha256: string; ext: string; bytes: number }[]
    try {
      assets = db.prepare('SELECT sha256, ext, bytes FROM assets').all() as typeof assets
    } finally {
      db.close()
    }
    const files: ZipManifestFile[] = [
      {
        path: PROJECT_DB_FILE,
        sha256: await hashFile(snapshot),
        bytes: (await stat(snapshot)).size
      }
    ]
    const zip = new ZipFile()
    zip.addFile(snapshot, PROJECT_DB_FILE)
    for (const asset of assets) {
      const path = `assets/${asset.sha256.slice(0, 2)}/${asset.sha256}.${asset.ext}`
      files.push({ path, sha256: asset.sha256, bytes: asset.bytes })
      zip.addFile(storedOriginalPath(input.projectPath, asset.sha256, asset.ext), path)
    }
    const manifest: ZipManifest = { formatVersion: 1, kind: 'creative-workspace-project', files }
    zip.addBuffer(Buffer.from(JSON.stringify(manifest)), 'manifest.json')
    const done = pipeline(zip.outputStream, createWriteStream(staging))
    zip.end()
    await done
    await rename(staging, input.destination)
  } finally {
    await rm(snapshot, { force: true })
    await rm(staging, { force: true })
  }
}

export async function importProjectZip(input: {
  zipPath: string
  parentDir: string
  name: string
  migrationsFolder: string
  vaultFor?: (projectId: string) => string
}): Promise<string> {
  let folder: string
  try {
    folder = sanitizeProjectName(input.name)
  } catch {
    throw new Error('Enter a name for the imported project.')
  }
  const partial = join(input.parentDir, `.${folder}.${randomUUID()}.partial`)
  await mkdir(partial, { recursive: true })
  try {
    await extractZip(input.zipPath, partial)
    const manifest = JSON.parse(
      await readFile(join(partial, 'manifest.json'), 'utf8')
    ) as ZipManifest
    if (manifest.formatVersion !== 1 || manifest.kind !== 'creative-workspace-project') {
      throw new Error('This archive is not a Creative Workspace project.')
    }
    const declared = manifest.files.reduce((sum, file) => sum + file.bytes, 0)
    let total = 0
    for (const file of manifest.files) {
      const safe = safeRelative(file.path)
      if (!safe) throw new Error('The archive contains an unsafe path.')
      const full = join(partial, safe)
      if ((await stat(full)).size !== file.bytes) throw new Error(`${file.path} is the wrong size.`)
      if ((await hashFile(full)) !== file.sha256)
        throw new Error(`${file.path} does not match its checksum.`)
      total += file.bytes
      if (total > declared) throw new Error('The archive expanded past its manifest.')
    }
    const sqlite = openRawDatabase(join(partial, PROJECT_DB_FILE))
    try {
      sqlite.prepare('UPDATE project_meta SET id = ?').run(randomUUID())
    } finally {
      sqlite.close()
    }
    const opened = await Project.open(partial, input.migrationsFolder, { vaultFor: input.vaultFor })
    opened.close()
    const finalPath = join(input.parentDir, folder + PROJECT_EXTENSION)
    await rename(partial, finalPath)
    return finalPath
  } catch (error) {
    await rm(partial, { recursive: true, force: true })
    throw error
  }
}

function safeRelative(value: string): string | null {
  if (value.includes('\0')) return null
  const normalized = value.replace(/\\/g, '/')
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) return null
  const parts = normalized.split('/')
  if (parts.some((part) => part === '..' || part === '.' || part === '')) return null
  return parts.join('/')
}

function extractZip(zipPath: string, destination: string): Promise<void> {
  return new Promise((resolveZip, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (error, zip) => {
      if (error || !zip) {
        reject(error ?? new Error('The archive could not be opened.'))
        return
      }
      let failed = false
      const fail = (reason: unknown) => {
        if (failed) return
        failed = true
        zip.close()
        reject(reason instanceof Error ? reason : new Error(String(reason)))
      }
      zip.on('error', fail)
      zip.on('end', () => {
        if (!failed) resolveZip()
      })
      zip.readEntry()
      zip.on('entry', (entry: Entry) => {
        const mode = entry.externalFileAttributes >>> 16
        if ((mode & 0o170000) === 0o120000) {
          fail(new Error('The archive contains a link, which was not extracted.'))
          return
        }
        if (/\/$/.test(entry.fileName)) {
          zip.readEntry()
          return
        }
        const safe = safeRelative(entry.fileName)
        if (!safe) {
          fail(new Error('The archive contains an unsafe path.'))
          return
        }
        const target = resolve(destination, safe)
        if (!target.startsWith(resolve(destination))) {
          fail(new Error('The archive contains an unsafe path.'))
          return
        }
        void mkdir(dirname(target), { recursive: true }).then(() => {
          zip.openReadStream(entry, (streamError, stream) => {
            if (streamError || !stream) {
              fail(streamError ?? new Error('A file in the archive could not be read.'))
              return
            }
            const output = createWriteStream(target)
            stream.pipe(output)
            output.on('finish', () => zip.readEntry())
            output.on('error', fail)
            stream.on('error', fail)
          })
        }, fail)
      })
    })
  })
}
