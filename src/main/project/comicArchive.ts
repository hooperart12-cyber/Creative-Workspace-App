/**
 * Lists image names inside a CBZ or ZIP. It does not extract files.
 * An unsafe path, a link, or an oversized archive rejects the whole file.
 */
import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import yauzl, { type Entry } from 'yauzl'
import { safeRelative } from './projectZip'

const MAX_ENTRIES = 2000
const MAX_ENTRY_BYTES = 80 * 1024 * 1024
const MAX_TOTAL_BYTES = 512 * 1024 * 1024

export function listComicArchive(zipPath: string): Promise<string[]> {
  return new Promise((resolveNames, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (error, zip) => {
      if (error || !zip) {
        reject(error ?? new Error('The archive could not be opened.'))
        return
      }
      const names: string[] = []
      let total = 0
      let failed = false
      const fail = (reason: unknown) => {
        if (failed) return
        failed = true
        zip.close()
        reject(reason instanceof Error ? reason : new Error(String(reason)))
      }
      zip.on('error', fail)
      zip.on('end', () => {
        if (!failed) resolveNames(names)
      })
      zip.readEntry()
      zip.on('entry', (entry: Entry) => {
        if (failed) return
        if (/\/$/.test(entry.fileName)) {
          zip.readEntry()
          return
        }
        const mode = entry.externalFileAttributes >>> 16
        if ((mode & 0o170000) === 0o120000) {
          fail(new Error('The archive contains a link, which was not read.'))
          return
        }
        if (!safeRelative(entry.fileName)) {
          fail(new Error('The archive contains an unsafe path.'))
          return
        }
        if (names.length >= MAX_ENTRIES) {
          fail(new Error('This archive has more than 2000 files.'))
          return
        }
        const size = entry.uncompressedSize
        if (size > MAX_ENTRY_BYTES || total + size > MAX_TOTAL_BYTES) {
          fail(new Error('This archive is too large to stage.'))
          return
        }
        total += size
        names.push(entry.fileName.replace(/\\/g, '/'))
        zip.readEntry()
      })
    })
  })
}

/** Extracts only the named entries. Byte counts are checked while reading, not only from the header. */
export function extractComicEntries(
  zipPath: string,
  wantedNames: readonly string[],
  destination: string
): Promise<Map<string, string>> {
  const wanted = new Set(wantedNames)
  return new Promise((resolveMap, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (error, zip) => {
      if (error || !zip) {
        reject(error ?? new Error('The archive could not be opened.'))
        return
      }
      const written = new Map<string, string>()
      let total = 0
      let failed = false
      const fail = (reason: unknown) => {
        if (failed) return
        failed = true
        zip.close()
        reject(reason instanceof Error ? reason : new Error(String(reason)))
      }
      zip.on('error', fail)
      zip.on('end', () => {
        if (failed) return
        if (written.size !== wanted.size) fail(new Error('A staged file was not in the archive.'))
        else resolveMap(written)
      })
      zip.readEntry()
      zip.on('entry', (entry: Entry) => {
        if (failed) return
        const name = entry.fileName.replace(/\\/g, '/')
        const safe = safeRelative(entry.fileName)
        if (/\/$/.test(entry.fileName) || !wanted.has(name)) {
          zip.readEntry()
          return
        }
        const mode = entry.externalFileAttributes >>> 16
        if ((mode & 0o170000) === 0o120000 || !safe) {
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
            let count = 0
            stream.on('data', (chunk: Buffer) => {
              count += chunk.length
              total += chunk.length
              if (count > MAX_ENTRY_BYTES || total > MAX_TOTAL_BYTES) {
                fail(new Error('This archive is too large to stage.'))
              }
            })
            const output = createWriteStream(target)
            stream.pipe(output)
            output.on('finish', () => {
              written.set(name, target)
              zip.readEntry()
            })
            output.on('error', fail)
            stream.on('error', fail)
          })
        }, fail)
      })
    })
  })
}
