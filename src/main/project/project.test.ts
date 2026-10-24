import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Project, PROJECT_SUBDIRS, sanitizeProjectName } from './project'
import { ProjectRegistry } from './projectRegistry'
import { RecentProjects } from './recentProjects'

const migrations = resolve('drizzle')
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cw-test-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('Project', () => {
  it('creates the .cwproj folder layout, database and main board', () => {
    const project = Project.create(dir, 'My Manga', migrations)
    const path = join(dir, 'My Manga.cwproj')

    expect(project.path).toBe(path)
    expect(existsSync(join(path, 'project.db'))).toBe(true)
    for (const sub of PROJECT_SUBDIRS) expect(existsSync(join(path, sub))).toBe(true)

    const summary = project.summary()
    expect(summary.name).toBe('My Manga')
    expect(summary.boardCount).toBe(1)
    expect(summary.assetCount).toBe(0)
    expect(summary.mainBoardId).toMatch(/^[0-9a-f-]{36}$/)
    project.close()
  })

  it('reopens a project and keeps its data', () => {
    const created = Project.create(dir, 'Reopen', migrations)
    created.rename('Renamed')
    const { id, mainBoardId } = created.summary()
    created.close()

    const reopened = Project.open(join(dir, 'Reopen.cwproj'), migrations)
    expect(reopened.summary()).toMatchObject({ id, mainBoardId, name: 'Renamed' })
    reopened.close()
  })

  it('uses WAL mode and enforces foreign keys', () => {
    const project = Project.create(dir, 'Pragmas', migrations)
    const sqlite = (project as unknown as { sqlite: import('better-sqlite3').Database }).sqlite
    expect(sqlite.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
    project.close()
  })

  it('refuses to overwrite an existing project or open a non-project folder', () => {
    Project.create(dir, 'Dup', migrations).close()
    expect(() => Project.create(dir, 'Dup', migrations)).toThrow(/already exists/)
    expect(() => Project.open(dir, migrations)).toThrow(/Not a Creative Workspace project/)
  })

  it('rejects empty names on rename', () => {
    const project = Project.create(dir, 'Name', migrations)
    expect(() => project.rename('   ')).toThrow(/cannot be empty/)
    project.close()
  })
})

describe('sanitizeProjectName', () => {
  it('strips characters that are invalid in Windows folder names', () => {
    expect(sanitizeProjectName(' Chapter 1: "Intro"? ')).toBe('Chapter 1 Intro')
    expect(sanitizeProjectName('Draft...')).toBe('Draft')
  })
  it('rejects empty and reserved names', () => {
    expect(() => sanitizeProjectName('???')).toThrow(/enter a project name/)
    expect(() => sanitizeProjectName('CON')).toThrow(/reserved/)
  })
})

describe('ProjectRegistry', () => {
  it('shares one project between windows and closes it after the last release', () => {
    const registry = new ProjectRegistry(migrations)
    const project = registry.create(1, dir, 'Shared')
    expect(registry.share(1, 2)).toBe(project)
    expect(registry.ownersOf(project).sort()).toEqual([1, 2])

    registry.release(1)
    expect(registry.get(2)).toBe(project)
    expect(() => project.summary()).not.toThrow()

    registry.release(2)
    expect(registry.get(2)).toBeUndefined()
    expect(() => project.summary()).toThrow()
  })

  it('reuses the open connection when a second window opens the same path', () => {
    const registry = new ProjectRegistry(migrations)
    const project = registry.create(1, dir, 'Same')
    expect(registry.open(2, project.path)).toBe(project)
    registry.closeAll()
  })
})

describe('RecentProjects', () => {
  it('keeps the most recent first, without duplicates', () => {
    const recent = new RecentProjects(join(dir, 'nested', 'recent.json'))
    expect(recent.list()).toEqual([])
    recent.touch({ name: 'A', path: '/a' })
    recent.touch({ name: 'B', path: '/b' })
    recent.touch({ name: 'A2', path: '/a' })
    expect(recent.list().map((p) => p.name)).toEqual(['A2', 'B'])
    expect(recent.remove('/b').map((p) => p.path)).toEqual(['/a'])
  })
})
