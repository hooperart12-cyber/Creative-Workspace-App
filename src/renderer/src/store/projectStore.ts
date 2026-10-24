import { create } from 'zustand'
import type { ProjectSummary, RecentProject } from '@shared/types'

interface ProjectState {
  status: 'loading' | 'ready'
  project: ProjectSummary | null
  recent: RecentProject[]
  error: string | null
  init: () => Promise<void>
  createProject: (name: string) => Promise<void>
  openProject: (path?: string) => Promise<void>
  closeProject: () => Promise<void>
  renameProject: (name: string) => Promise<void>
  removeRecent: (path: string) => Promise<void>
  openNewWindow: () => Promise<void>
  clearError: () => void
}

/** Electron wraps errors from the main process; show only the original message. */
function messageOf(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

export const useProjectStore = create<ProjectState>((set, get) => {
  const run = async (action: () => Promise<void>): Promise<void> => {
    try {
      set({ error: null })
      await action()
    } catch (error) {
      set({ error: messageOf(error) })
    }
  }

  return {
    status: 'loading',
    project: null,
    recent: [],
    error: null,

    init: () =>
      run(async () => {
        const [project, recent] = await Promise.all([
          window.api.invoke('project:current'),
          window.api.invoke('recent:list')
        ])
        set({ project, recent, status: 'ready' })
      }),

    createProject: (name) =>
      run(async () => {
        const parentDir = await window.api.invoke('dialog:pickDirectory')
        if (!parentDir) return
        const project = await window.api.invoke('project:create', { parentDir, name })
        set({ project, recent: await window.api.invoke('recent:list') })
      }),

    openProject: (path) =>
      run(async () => {
        const target = path ?? (await window.api.invoke('dialog:pickProject'))
        if (!target) return
        const project = await window.api.invoke('project:open', target)
        set({ project, recent: await window.api.invoke('recent:list') })
      }),

    closeProject: () =>
      run(async () => {
        await window.api.invoke('project:close')
        set({ project: null, recent: await window.api.invoke('recent:list') })
      }),

    renameProject: (name) =>
      run(async () => {
        if (!get().project || name.trim() === get().project?.name) return
        set({ project: await window.api.invoke('project:rename', name) })
      }),

    removeRecent: (path) =>
      run(async () => {
        set({ recent: await window.api.invoke('recent:remove', path) })
      }),

    openNewWindow: () => run(() => window.api.invoke('window:openNew')),

    clearError: () => set({ error: null })
  }
})

// Keep this window in sync when another window changes the same project (§2).
window.api.on('project:changed', (project) => {
  if (useProjectStore.getState().project?.path === project.path) {
    useProjectStore.setState({ project })
  }
})
