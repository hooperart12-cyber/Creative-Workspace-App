import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BackupSettings, BackupStatus, RecoveryKind, RecoveryManifest } from '@shared/types'
import {
  applyRetention,
  BACKUP_INTERVAL_MS,
  createRecoveryPoint,
  DEFAULT_RETENTION,
  dueForAutomatic,
  listManifests,
  sameVolume,
  vaultBytes
} from './backup'
import { withProjectLock } from './lock'
import type { Project } from './project'

const EMPTY: BackupSettings = {
  customRoot: null,
  fallbackToDefault: true,
  retention: DEFAULT_RETENTION
}

/**
 * One backup job per project. The vault lives outside the project folder.
 * A missing custom folder falls back to the app's local vault when that is allowed.
 */
export class BackupService {
  private readonly settingsPath: string
  private readonly remembered = new Map<
    string,
    { at: number; error: string | null; location: string; fallback: boolean }
  >()
  private timer: ReturnType<typeof setInterval> | undefined
  readonly running = new Set<string>()

  constructor(
    private readonly userData: string,
    private readonly projects: () => Project[]
  ) {
    this.settingsPath = join(userData, 'backup-settings.json')
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      for (const project of this.projects()) void this.onOpened(project)
    }, 60_000)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  settings(projectId: string): BackupSettings {
    const all = this.readAll()
    return all[projectId] ?? EMPTY
  }

  saveSettings(projectId: string, patch: Partial<BackupSettings>): BackupSettings {
    const all = this.readAll()
    const next = {
      ...EMPTY,
      ...all[projectId],
      ...patch,
      retention: { ...DEFAULT_RETENTION, ...all[projectId]?.retention, ...patch.retention }
    }
    all[projectId] = next
    mkdirSync(this.userData, { recursive: true })
    writeFileSync(this.settingsPath, JSON.stringify(all))
    return next
  }

  /** Folder that will receive this project's recovery points. */
  vaultFor(projectId: string): { root: string; usingFallback: boolean } {
    const settings = this.settings(projectId)
    const fallback = join(this.userData, 'backup-vaults', projectId)
    if (settings.customRoot) {
      const custom = join(settings.customRoot, 'Creative Workspace Backups', projectId)
      try {
        mkdirSync(custom, { recursive: true })
        return { root: custom, usingFallback: false }
      } catch (error) {
        this.remember(projectId, fallback, true, error)
        if (!settings.fallbackToDefault) throw error
      }
    }
    mkdirSync(fallback, { recursive: true })
    return { root: fallback, usingFallback: !!settings.customRoot }
  }

  async onOpened(project: Project): Promise<void> {
    await withProjectLock(project.path, async () => {
      const revision = project.changeRevision()
      const chosen = this.vaultFor(project.id)
      const points = await listManifests(chosen.root)
      const last =
        points.find((point) => point.kind === 'baseline' || point.kind === 'hourly') ?? null
      if (
        !dueForAutomatic({
          now: Date.now(),
          revision,
          lastAutomatic: last
            ? { createdAt: last.createdAt, changeRevision: last.changeRevision }
            : null
        })
      ) {
        return
      }
      await this.write(project, last ? 'hourly' : 'baseline', chosen)
    })
  }

  async create(
    project: Project,
    kind: Extract<RecoveryKind, 'manual' | 'baseline'>
  ): Promise<RecoveryManifest> {
    return withProjectLock(project.path, async () =>
      this.write(project, kind, this.vaultFor(project.id))
    )
  }

  async status(project: Project): Promise<BackupStatus> {
    const chosen = this.vaultFor(project.id)
    const points = await listManifests(chosen.root)
    const last = points.find((point) => point.kind === 'baseline' || point.kind === 'hourly')
    const memory = this.remembered.get(project.id)
    const revision = project.changeRevision()
    const due = dueForAutomatic({
      now: Date.now(),
      revision,
      lastAutomatic: last
        ? { createdAt: last.createdAt, changeRevision: last.changeRevision }
        : null
    })
    return {
      location: memory?.location ?? chosen.root,
      usingFallback: memory?.fallback ?? chosen.usingFallback,
      lastSuccessAt: memory?.at ?? last?.createdAt ?? null,
      lastError: memory?.error ?? null,
      nextEligibleAt: last ? last.createdAt + BACKUP_INTERVAL_MS : Date.now(),
      bytes: await vaultBytes(chosen.root),
      sameVolume: await sameVolume(project.path, chosen.root),
      inProgress: this.running.has(project.id),
      points: due ? points : points
    }
  }

  private async write(
    project: Project,
    kind: RecoveryKind,
    chosen: { root: string; usingFallback: boolean }
  ): Promise<RecoveryManifest> {
    this.running.add(project.id)
    try {
      const manifest = await createRecoveryPoint({
        sqlite: project.connection,
        projectPath: project.path,
        projectId: project.id,
        projectName: project.summary().name,
        vaultRoot: chosen.root,
        kind
      })
      if (kind === 'baseline' || kind === 'hourly') {
        await applyRetention(chosen.root, this.settings(project.id).retention, Date.now())
      }
      this.remembered.set(project.id, {
        at: manifest.createdAt,
        error: null,
        location: chosen.root,
        fallback: chosen.usingFallback
      })
      return manifest
    } catch (error) {
      this.remember(project.id, chosen.root, chosen.usingFallback, error)
      throw error
    } finally {
      this.running.delete(project.id)
    }
  }

  private remember(projectId: string, location: string, fallback: boolean, error: unknown): void {
    const previous = this.remembered.get(projectId)
    this.remembered.set(projectId, {
      at: previous?.at ?? 0,
      error: error instanceof Error ? error.message : String(error),
      location,
      fallback
    })
  }

  private readAll(): Record<string, BackupSettings> {
    if (!existsSync(this.settingsPath)) return {}
    try {
      return JSON.parse(readFileSync(this.settingsPath, 'utf8')) as Record<string, BackupSettings>
    } catch {
      return {}
    }
  }
}
