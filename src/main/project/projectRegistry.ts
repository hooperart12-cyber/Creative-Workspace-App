import { Project } from './project'

/**
 * Tracks which window has which project open. Several windows may share one
 * project (§2); the database connection is shared and closed when the last
 * window releases it. Owners are identified by their webContents id.
 */
export class ProjectRegistry {
  private readonly projects = new Map<string, { project: Project; owners: Set<number> }>()
  private readonly ownerToPath = new Map<number, string>()

  constructor(private readonly migrationsFolder: string) {}

  create(owner: number, parentDir: string, name: string): Project {
    const project = Project.create(parentDir, name, this.migrationsFolder)
    this.attach(owner, project)
    return project
  }

  open(
    owner: number,
    path: string,
    options?: { vaultFor?: (projectId: string) => string }
  ): Promise<Project> {
    const existing = this.projects.get(path)
    if (existing) {
      this.release(owner)
      existing.owners.add(owner)
      this.ownerToPath.set(owner, path)
      return Promise.resolve(existing.project)
    }
    return Project.open(path, this.migrationsFolder, options).then((project) => {
      this.attach(owner, project)
      return project
    })
  }

  /** Gives `owner` access to the project already opened by `sourceOwner`. */
  share(sourceOwner: number, owner: number): Promise<Project | undefined> {
    const path = this.ownerToPath.get(sourceOwner)
    return path ? this.open(owner, path) : Promise.resolve(undefined)
  }

  get(owner: number): Project | undefined {
    const path = this.ownerToPath.get(owner)
    return path ? this.projects.get(path)?.project : undefined
  }

  /** An open project by its id (asset URLs name the project they belong to). */
  findById(id: string): Project | undefined {
    for (const { project } of this.projects.values()) if (project.id === id) return project
    return undefined
  }

  /** Projects that currently have at least one window. */
  all(): Project[] {
    return [...this.projects.values()].map((entry) => entry.project)
  }

  /** All owners (windows) that currently have the given project open. */
  ownersOf(project: Project): number[] {
    return [...(this.projects.get(project.path)?.owners ?? [])]
  }

  release(owner: number): void {
    const path = this.ownerToPath.get(owner)
    if (!path) return
    this.ownerToPath.delete(owner)
    const entry = this.projects.get(path)
    if (!entry) return
    entry.owners.delete(owner)
    if (entry.owners.size === 0) {
      entry.project.close()
      this.projects.delete(path)
    }
  }

  closeAll(): void {
    for (const { project } of this.projects.values()) project.close()
    this.projects.clear()
    this.ownerToPath.clear()
  }

  private attach(owner: number, project: Project): void {
    this.release(owner)
    this.projects.set(project.path, { project, owners: new Set([owner]) })
    this.ownerToPath.set(owner, project.path)
  }
}
