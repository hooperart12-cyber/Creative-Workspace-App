import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { ZipFile } from 'yazl'
import { afterEach, describe, expect, it } from 'vitest'
import { stageImportNames } from '@shared/collectionImport'
import { listComicArchive } from './comicArchive'
import { stageCollectionPaths } from './stageCollectionImport'

let dir: string

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

async function writeZip(files: { name: string; data: Buffer }[]): Promise<string> {
  dir = mkdtempSync(join(tmpdir(), 'cw-cbz-'))
  const path = join(dir, 'chapter.cbz')
  const zip = new ZipFile()
  for (const file of files) zip.addBuffer(file.data, file.name)
  const done = pipeline(zip.outputStream, createWriteStream(path))
  zip.end()
  await done
  return path
}

/** A stored zip. yazl refuses `..`, so the unsafe case is written directly. */
function zipWithNames(names: string[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const name of names) {
    const fileName = Buffer.from(name, 'utf8')
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(fileName.length, 26)
    locals.push(Buffer.concat([local, fileName]))
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(fileName.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(Buffer.concat([central, fileName]))
    offset += 30 + fileName.length
  }
  const directory = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(names.length, 8)
  eocd.writeUInt16LE(names.length, 10)
  eocd.writeUInt32LE(directory.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, eocd])
}

describe('comic archives', () => {
  it('rejects an unsafe path and does not return the other names', async () => {
    dir = mkdtempSync(join(tmpdir(), 'cw-cbz-'))
    const path = join(dir, 'chapter.cbz')
    writeFileSync(path, zipWithNames(['Page 2.png', '../secret.png']))
    await expect(listComicArchive(path)).rejects.toThrow(/unsafe path|invalid relative path/)
    const staged = await stageCollectionPaths([path])
    expect(staged.files).toEqual([])
    expect(staged.error).toMatch(/unsafe path|invalid relative path/)
  })

  it('lists archive images for staging without creating pages', async () => {
    const path = await writeZip([
      { name: 'Page 10.png', data: Buffer.from('10') },
      { name: 'Page 2.png', data: Buffer.from('2') },
      { name: 'notes.txt', data: Buffer.from('no') }
    ])
    const names = await listComicArchive(path)
    const staged = stageImportNames(names)
    expect(staged.filter((entry) => entry.accepted).map((entry) => entry.name)).toEqual([
      'Page 2.png',
      'Page 10.png'
    ])
    const preview = await stageCollectionPaths([path])
    expect(preview.error).toBeNull()
    expect(
      preview.files.filter((file) => file.accepted).map((file) => file.archive?.entry)
    ).toEqual(['Page 2.png', 'Page 10.png'])
  })
})
