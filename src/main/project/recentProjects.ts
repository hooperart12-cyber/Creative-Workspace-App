import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { RecentProject } from '@shared/types'

const MAX_RECENT = 10

/** Recently opened projects, stored as JSON in the app's user-data folder. */
export class RecentProjects {
  constructor(private readonly file: string) {}

  list(): RecentProject[] {
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8'))
      return Array.isArray(parsed) ? parsed.filter(isRecentProject) : []
    } catch {
      return []
    }
  }

  touch(project: { name: string; path: string }): RecentProject[] {
    const next = [
      { name: project.name, path: project.path, lastOpenedAt: Date.now() },
      ...this.list().filter((p) => p.path !== project.path)
    ].slice(0, MAX_RECENT)
    this.write(next)
    return next
  }

  remove(path: string): RecentProject[] {
    const next = this.list().filter((p) => p.path !== path)
    this.write(next)
    return next
  }

  private write(list: RecentProject[]): void {
    const dir = dirname(this.file)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(this.file, JSON.stringify(list, null, 2))
  }
}

function isRecentProject(value: unknown): value is RecentProject {
  const v = value as RecentProject
  return (
    typeof v?.name === 'string' &&
    typeof v?.path === 'string' &&
    typeof v?.lastOpenedAt === 'number'
  )
}
