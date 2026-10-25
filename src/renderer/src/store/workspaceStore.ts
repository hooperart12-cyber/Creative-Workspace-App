import { create } from 'zustand'
import type { BoardDetail, CanvasObject, ObjectPatch, ProjectTree } from '@shared/types'
import { reportError } from './projectStore'

export type ItemRef = { type: 'board' | 'folder'; id: string }

/** Where an item is shown; an item can appear in the sidebar and as a card at the same time. */
export type ItemSource = 'sidebar' | 'board'

export type RenameTarget = ItemRef & { source: ItemSource }

export type WorkspaceDialog =
  { kind: 'move'; target: ItemRef } | { kind: 'delete'; target: ItemRef }

interface WorkspaceState {
  tree: ProjectTree | null
  board: BoardDetail | null
  /** Per-window navigation history (§2: each window navigates independently). */
  back: string[]
  forward: string[]
  /** Item currently being renamed inline, and where (sidebar row or board card). */
  renaming: RenameTarget | null
  selectedFolderId: string | null
  dialog: WorkspaceDialog | null
  sidebarCollapsed: boolean

  load: (initialBoardId?: string) => Promise<void>
  refresh: () => Promise<void>
  openBoard: (id: string) => Promise<void>
  goBack: () => Promise<void>
  goForward: () => Promise<void>
  goUp: () => Promise<void>
  /** Applies changes to the open board's objects immediately, before the save round-trip. */
  patchObjects: (patches: ObjectPatch[]) => void
  /** Merges into objects' `data` immediately (note text and look). */
  patchObjectData: (patches: { id: string; data: Record<string, unknown>; revision?: number }[]) => void
  /** Shows a just-created object straight away (the full refresh follows). */
  addObject: (object: CanvasObject) => void
  /** Swaps in fresh copies of objects (another window changed them). */
  replaceObjects: (objects: CanvasObject[]) => void

  createFolder: (parentId: string | null) => Promise<void>
  renameFolder: (id: string, name: string) => Promise<void>
  moveFolder: (id: string, newParentId: string | null) => Promise<void>
  deleteFolder: (id: string) => Promise<void>

  setRenaming: (item: RenameTarget | null) => void
  selectFolder: (folderId: string | null) => void
  setDialog: (dialog: WorkspaceDialog | null) => void
  toggleSidebar: () => void
}

const SIDEBAR_KEY = 'cw.sidebarCollapsed'

function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === '1'
  } catch {
    return false
  }
}

/** Keeps the current board in the URL hash so a reload stays on the same board. */
function rememberBoard(id: string): void {
  history.replaceState(null, '', `#board=${encodeURIComponent(id)}`)
}

/** The board requested in the URL hash (set when a board is opened in a new window). */
export function boardFromHash(): string | undefined {
  const match = /board=([^&]+)/.exec(location.hash)
  return match ? decodeURIComponent(match[1]) : undefined
}

/**
 * Asked before this window shows a different board; false keeps the current board (a note
 * being edited couldn't be saved, and leaving would hide what the user wrote). `force` is set
 * when the current board is gone, so staying isn't possible.
 */
type LeaveGuard = (targetBoardId: string | null, force: boolean) => Promise<boolean>
let leaveGuard: LeaveGuard = async () => true
export function setLeaveGuard(fn: LeaveGuard): void {
  leaveGuard = fn
}

/** Before closing or switching the project: false if a note's text couldn't be saved. */
export const readyToLeaveProject = (): Promise<boolean> => leaveGuard(null, false)

const guard = async (action: () => Promise<void>): Promise<void> => {
  try {
    await action()
  } catch (error) {
    reportError(error)
  }
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => {
  /** Shows a board without touching history. */
  const show = async (id: string, force = false): Promise<boolean> => {
    const current = get().board
    if (current && current.id !== id) {
      // Forced moves don't wait: they can happen inside the edit queue the note saves use.
      if (force) void leaveGuard(id, true)
      else if (!(await leaveGuard(id, false))) return false
    }
    const board = await window.api.invoke('board:get', id)
    set({ board })
    rememberBoard(board.id)
    return true
  }

  return {
    tree: null,
    board: null,
    back: [],
    forward: [],
    renaming: null,
    selectedFolderId: null,
    dialog: null,
    sidebarCollapsed: readSidebarCollapsed(),

    load: (initialBoardId) =>
      guard(async () => {
        const tree = await window.api.invoke('tree:get')
        set({ tree, back: [], forward: [], renaming: null, dialog: null })
        const exists = tree.boards.some((b) => b.id === initialBoardId)
        await show(exists && initialBoardId ? initialBoardId : tree.mainBoardId)
      }),

    refresh: () =>
      guard(async () => {
        const tree = await window.api.invoke('tree:get')
        const alive = new Set(tree.boards.map((b) => b.id))
        const { board, back, forward } = get()
        set({
          tree,
          back: back.filter((id) => alive.has(id)),
          forward: forward.filter((id) => alive.has(id))
        })
        if (!board) return
        // If the current board was deleted (maybe in another window), go to its nearest surviving ancestor.
        const target =
          [...board.breadcrumb].reverse().find((crumb) => alive.has(crumb.id))?.id ??
          tree.mainBoardId
        await show(target, target !== board.id)
      }),

    openBoard: (id) =>
      guard(async () => {
        const current = get().board?.id
        if (current === id) return
        if (!(await show(id))) return
        if (current) set({ back: [...get().back, current], forward: [] })
      }),

    goBack: () =>
      guard(async () => {
        const { back, board } = get()
        const target = back.at(-1)
        if (!target || !board) return
        if (!(await show(target))) return
        set({ back: back.slice(0, -1), forward: [board.id, ...get().forward] })
      }),

    goForward: () =>
      guard(async () => {
        const { forward, board } = get()
        const target = forward[0]
        if (!target || !board) return
        if (!(await show(target))) return
        set({ forward: forward.slice(1), back: [...get().back, board.id] })
      }),

    goUp: async () => {
      const parent = get().board?.parentBoardId
      if (parent) await get().openBoard(parent)
    },

    patchObjects: (patches) => {
      const board = get().board
      if (!board || patches.length === 0) return
      const byId = new Map(patches.map((p) => [p.id, p]))
      set({
        board: {
          ...board,
          objects: board.objects.map((o) => (byId.has(o.id) ? { ...o, ...byId.get(o.id) } : o))
        }
      })
    },

    patchObjectData: (patches) => {
      const board = get().board
      if (!board || patches.length === 0) return
      const byId = new Map(patches.map((p) => [p.id, p]))
      set({
        board: {
          ...board,
          objects: board.objects.map((o) => {
            const patch = byId.get(o.id)
            if (!patch) return o
            return {
              ...o,
              data: { ...o.data, ...patch.data },
              revision: patch.revision ?? o.revision
            }
          })
        }
      })
    },

    addObject: (object) => {
      const board = get().board
      if (!board || board.id !== object.boardId || board.objects.some((o) => o.id === object.id))
        return
      set({ board: { ...board, objects: [...board.objects, object] } })
    },

    replaceObjects: (fresh) => {
      const board = get().board
      if (!board || fresh.length === 0) return
      const byId = new Map(fresh.filter((o) => o.boardId === board.id).map((o) => [o.id, o]))
      set({
        board: { ...board, objects: board.objects.map((o) => byId.get(o.id) ?? o) }
      })
    },

    createFolder: (parentId) =>
      guard(async () => {
        const folder = await window.api.invoke('folder:create', { parentId })
        set({
          renaming: { type: 'folder', id: folder.id, source: 'sidebar' },
          selectedFolderId: folder.id
        })
      }),

    renameFolder: (id, name) =>
      guard(async () => {
        set({ renaming: null })
        const current = get().tree?.folders.find((f) => f.id === id)?.name
        if (name.trim() && name.trim() !== current) {
          await window.api.invoke('folder:rename', id, name)
        }
      }),

    moveFolder: (id, newParentId) =>
      guard(async () => {
        set({ dialog: null })
        await window.api.invoke('folder:move', id, newParentId)
      }),

    deleteFolder: (id) =>
      guard(async () => {
        set({ dialog: null, selectedFolderId: null })
        await window.api.invoke('folder:delete', id)
      }),

    setRenaming: (renaming) => set({ renaming }),
    selectFolder: (selectedFolderId) => set({ selectedFolderId }),
    setDialog: (dialog) => set({ dialog }),
    toggleSidebar: () => {
      const sidebarCollapsed = !get().sidebarCollapsed
      set({ sidebarCollapsed })
      try {
        localStorage.setItem(SIDEBAR_KEY, sidebarCollapsed ? '1' : '0')
      } catch {
        // Storage unavailable: the preference just isn't remembered.
      }
    }
  }
})

// Another window (or this one) changed boards or folders: refetch.
window.api.on('project:contentChanged', () => {
  if (useWorkspaceStore.getState().tree) void useWorkspaceStore.getState().refresh()
})

// A note's text was saved (here or in another window): refetch just that note.
window.api.on('objects:changed', ({ boardId, objectIds }) => {
  if (useWorkspaceStore.getState().board?.id !== boardId) return
  void window.api
    .invoke('notes:get', objectIds)
    .then((fresh) => useWorkspaceStore.getState().replaceObjects(fresh))
    .catch(() => {})
})
