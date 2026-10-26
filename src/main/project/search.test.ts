import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildPdf } from './buildPdf'
import { Project } from './project'

const migrations = resolve('drizzle')
let dir: string
let project: Project

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cw-search-'))
  project = Project.create(dir, 'Search', migrations)
})
afterEach(() => {
  try {
    project?.close()
  } catch {
    // Already closed.
  }
  rmSync(dir, { recursive: true, force: true })
})

describe('project search', () => {
  it('finds a note, a partial filename, and hides a trashed entry', async () => {
    const path = join(dir, 'chapter.txt')
    writeFileSync(path, 'chapter')
    await project.assets.importFiles([path])
    project.notes.create({
      boardId: project.mainBoardId,
      at: { x: 10, y: 10 },
      content: {
        schemaVersion: 1,
        doc: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'lighthouse sketch' }] }]
        }
      }
    })
    expect(project.search.search('lighthouse').some((hit) => hit.kind === 'note')).toBe(true)
    expect(project.search.search('hap', 'file').some((hit) => hit.title === 'chapter.txt')).toBe(
      true
    )
    const entry = project.library.list({ folderId: null, scope: 'project' }).entries[0]
    project.library.trash([entry.id])
    expect(project.search.search('chapter', 'file').some((hit) => hit.kind === 'entry')).toBe(false)
    expect(project.search.search('"lighthouse sketch"', 'note', true).length).toBeGreaterThan(0)
  })

  it('queues a new PDF and finds a page once it is indexed', async () => {
    const path = join(dir, 'chapter.pdf')
    writeFileSync(path, buildPdf(['alpha beacon', 'second page']))
    const imported = await project.assets.importFiles([path])
    const assetId = imported.imported[0].id
    const job = project.connection
      .prepare('SELECT state FROM search_jobs WHERE asset_id = ?')
      .get(assetId) as { state: string }
    expect(job.state).toBe('pending')
    project.search.addPdfPage(assetId, 1, 'alpha beacon', 'chapter.pdf')
    const hits = project.search.search('beacon', 'pdf')
    expect(hits.some((hit) => hit.kind === 'pdf-page' && hit.page === 1)).toBe(true)
  })

  it('rebuilds after the index is cleared', () => {
    project.connection.exec('DELETE FROM search_documents')
    project.search.rebuild()
    expect(project.search.search('Search').some((hit) => hit.kind === 'board')).toBe(true)
  })
})
