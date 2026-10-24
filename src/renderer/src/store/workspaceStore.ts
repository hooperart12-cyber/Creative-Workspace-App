import { create } from 'zustand'
import type { BoardDetail, ProjectTree } from '@shared/types'
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
  selectedCardId: string | null
  selectedFolderId: string | null
  dialog: WorkspaceDialog | null
  sidebarCollapsed: boolean

  load: (initialBoardId?: string) => Promise<void>
  refresh: () => Promise<void>
  openBoard: (id: string) => Promise<void>
  goBack: () => Promise<void>
  goForward: () => Promise<void>
  goUp: () => Promise<void>

  createBoard: (parentId: string) => Promise<void>
  renameBoard: (id: string, title: string) => Promise<void>
  moveBoard: (id: string, newParentId: string) => Promise<void>
  deleteBoard: (id: string) => Promise<void>

  createFolder: (parentId: string | null) => Promise<void>
  renameFolder: (id: string, name: string) => Promise<void>
  moveFolder: (id: string, newParentId: string | null) => Promise<void>
  deleteFolder: (id: string) => Promise<void>

  setRenaming: (item: RenameTarget | null) => void
  selectCard: (boardId: string | null) => void
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

const guard = async (action: () => Promise<void>): Promise<void> => {
  try {
    await action()
  } catch (error) {
    reportError(error)
  }
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => {
  /** Shows a board without touching history. */
  const show = async (id: string): Promise<void> => {
    const board = await window.api.invoke('board:get', id)
    set({ board, selectedCardId: null })
    rememberBoard(board.id)
  }

  return {
    tree: null,
    board: null,
    back: [],
    forward: [],
    renaming: null,
    selectedCardId: null,
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
        await show(target)
      }),

    openBoard: (id) =>
      guard(async () => {
        const current = get().board?.id
        if (current === id) return
        await show(id)
        if (current) set({ back: [...get().back, current], forward: [] })
      }),

    goBack: () =>
      guard(async () => {
        const { back, board } = get()
        const target = back.at(-1)
        if (!target || !board) return
        await show(target)
        set({ back: back.slice(0, -1), forward: [board.id, ...get().forward] })
      }),

    goForward: () =>
      guard(async () => {
        const { forward, board } = get()
        const target = forward[0]
        if (!target || !board) return
        await show(target)
        set({ forward: forward.slice(1), back: [...get().back, board.id] })
      }),

    goUp: async () => {
      const parent = get().board?.parentBoardId
      if (parent) await get().openBoard(parent)
    },

    createBoard: (parentId) =>
      guard(async () => {
        const board = await window.api.invoke('board:create', { parentId })
        // New boards appear as a card on their parent; rename the card if it's the open board,
        // otherwise rename the row in the sidebar.
        const source: ItemSource = get().board?.id === parentId ? 'board' : 'sidebar'
        set({ renaming: { type: 'board', id: board.id, source }, selectedCardId: board.id })
      }),

    renameBoard: (id, title) =>
      guard(async () => {
        set({ renaming: null })
        const current = get().tree?.boards.find((b) => b.id === id)?.title
        if (title.trim() && title.trim() !== current) {
          await window.api.invoke('board:rename', id, title)
        }
      }),

    moveBoard: (id, newParentId) =>
      guard(async () => {
        set({ dialog: null })
        await window.api.invoke('board:move', id, newParentId)
      }),

    deleteBoard: (id) =>
      guard(async () => {
        set({ dialog: null })
        await window.api.invoke('board:delete', id)
      }),

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
    selectCard: (selectedCardId) => set({ selectedCardId }),
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
