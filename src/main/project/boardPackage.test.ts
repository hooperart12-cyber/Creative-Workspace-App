import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { ZipFile } from 'yazl'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultComment } from '@shared/comments'
import { defaultConnection, parseConnection } from '@shared/connections'
import { parseDestination } from '@shared/destinations'
import { eq } from 'drizzle-orm'
import { taggings } from '../db/schema'
import { exportBoardPackage, importBoardPackage } from './boardPackage'
import { Project } from './project'

const migrations = resolve('drizzle')

describe('board packages', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
    dirs.length = 0
  })

  async function project(name: string): Promise<Project> {
    const dir = mkdtempSync(join(tmpdir(), 'cw-board-'))
    dirs.push(dir)
    return Project.create(dir, name, migrations)
  }

  it('round-trips a board and keeps an outside link unresolved in a new project', async () => {
    const source = await project('Source')
    const png = await sharp({
      create: { width: 8, height: 6, channels: 3, background: 'red' }
    })
      .png()
      .toBuffer()
    const asset = await source.assets.importBytes('red.png', png)
    const board = source.mainBoardId
    const other = source.boards.create(board, 'Elsewhere')
    const [imageId] = source.objects.createImages({
      boardId: board,
      assetIds: [asset.id],
      center: { x: 120, y: 80 }
    })
    const connection = defaultConnection({ x: 10, y: 10 }, { x: 200, y: 80 })
    connection.end.attachment = {
      kind: 'object',
      id: imageId,
      placement: 'auto',
      pin: null,
      missing: false,
      userHeld: false
    }
    connection.label = { text: 'allies', t: 0.4, offset: 8 }
    source.relations.createConnection(board, connection.start, connection.end, connection)
    const comment = defaultComment({ x: 30, y: 30 })
    comment.anchor = {
      ...comment.anchor,
      scope: 'object',
      targetId: imageId,
      detached: 'none'
    }
    const thread = source.relations.createComment(board, { x: 30, y: 30 }, comment, 'Hold this')
    source.relations.addReply(thread.id, thread.revision, 'And this')
    source.relations.createLink(
      board,
      { x: 300, y: 40 },
      {
        version: 1,
        title: 'Elsewhere',
        description: '',
        layout: 'compact',
        destination: { kind: 'board', boardId: other.id, title: 'Elsewhere' }
      }
    )
    const tag = source.tags.createReusable('Hero')
    source.tags.assign(tag.id, { type: 'object', id: imageId })
    const zip = join(dirs[0], 'board.zip')
    await exportBoardPackage({
      project: source,
      boardId: board,
      destination: zip,
      includeComments: false
    })
    const quiet = await project('Quiet')
    const imported = await importBoardPackage({
      project: quiet,
      zipPath: zip,
      parentBoardId: quiet.mainBoardId
    })
    const detail = quiet.relations.decorate(quiet.boards.get(imported.boardId).objects)
    expect(detail.some((object) => object.type === 'comment')).toBe(false)
    const image = detail.find((object) => object.type === 'image')
    const line = detail.find((object) => object.type === 'connection')
    const link = detail.find((object) => object.type === 'link')
    expect(image?.asset?.sha256).toBe(asset.sha256)
    expect(image?.id).not.toBe(imageId)
    const data = parseConnection(line?.data)
    expect(data?.label?.text).toBe('allies')
    expect(data?.end.attachment?.id).toBe(image?.id)
    expect(data?.end.attachment?.missing).toBe(false)
    expect(parseDestination(link?.data.destination)).toMatchObject({
      kind: 'board',
      boardId: other.id,
      title: 'Elsewhere'
    })
    expect(quiet.relations.integrity().some((issue) => issue.id === link?.id)).toBe(true)
    expect(
      quiet.db.select().from(taggings).where(eq(taggings.targetId, image!.id)).all().length
    ).toBe(1)
    const before = quiet.boards.get(quiet.mainBoardId).objects.length
    await expect(
      importBoardPackage({
        project: quiet,
        zipPath: await badArchive(dirs[1]),
        parentBoardId: quiet.mainBoardId
      })
    ).rejects.toThrow()
    expect(quiet.boards.get(quiet.mainBoardId).objects.length).toBe(before)
    source.close()
    quiet.close()
  })

  it('keeps comments when asked and resolves a link that still exists', async () => {
    const source = await project('Source')
    const board = source.mainBoardId
    const other = source.boards.create(board, 'Elsewhere')
    const comment = defaultComment({ x: 12, y: 12 })
    source.relations.createComment(board, { x: 12, y: 12 }, comment, 'Note')
    source.relations.createLink(
      board,
      { x: 40, y: 40 },
      {
        version: 1,
        title: 'Elsewhere',
        description: '',
        layout: 'compact',
        destination: { kind: 'board', boardId: other.id, title: 'Elsewhere' }
      }
    )
    const zip = join(dirs[0], 'with-comments.zip')
    await exportBoardPackage({
      project: source,
      boardId: board,
      destination: zip,
      includeComments: true
    })
    const same = await importBoardPackage({
      project: source,
      zipPath: zip,
      parentBoardId: board
    })
    const detail = source.relations.decorate(source.boards.get(same.boardId).objects)
    const thread = detail.find((object) => object.type === 'comment')
    const link = detail.find((object) => object.type === 'link')
    expect(thread?.messages?.map((message) => message.body)).toEqual(['Note'])
    expect(source.relations.integrity().some((issue) => issue.id === link?.id)).toBe(false)
    expect(
      parseDestination(link?.data.destination)?.kind === 'board' &&
        (parseDestination(link?.data.destination) as { boardId: string }).boardId
    ).toBe(other.id)
    source.close()
  })
})

async function badArchive(dir: string): Promise<string> {
  const destination = join(dir, 'bad.zip')
  const zip = new ZipFile()
  zip.addBuffer(Buffer.from('{"formatVersion":1,"kind":"nope"}'), 'board.json')
  zip.addBuffer(
    Buffer.from(
      JSON.stringify({
        formatVersion: 1,
        kind: 'creative-workspace-board',
        files: [{ path: 'board.json', sha256: '0'.repeat(64), bytes: 3 }]
      })
    ),
    'manifest.json'
  )
  const done = pipeline(zip.outputStream, createWriteStream(destination))
  zip.end()
  await done
  return destination
}
