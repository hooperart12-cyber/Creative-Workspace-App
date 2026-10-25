import { create } from 'zustand'
import type { NoteContent } from '@shared/notes'

export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'error'

/** The note being edited in this window (one at a time). */
export interface NoteEditing {
  objectId: string
  boardId: string
  mode: 'inline' | 'expanded'
  /** Created for this edit: removed again if left empty. */
  isNew: boolean
  status: SaveStatus
  error: string | null
  /** Another window saved first; the user chooses what to keep. */
  conflict: { revision: number; content: NoteContent | null } | null
  /** The note was moved to the trash while being edited. */
  deleted: boolean
  /** Another window took over editing; this copy can't be changed any more. */
  readOnly: boolean
}

interface NoteState {
  editing: NoteEditing | null
  /** Notes other windows are editing right now. */
  editedElsewhere: Set<string>
  /** A note the user tried to edit while another window was editing it. */
  blocked: string | null
  /** Advanced formatting panel. */
  panelOpen: boolean
  /** How far fixed-height notes are scrolled (this window only). */
  scroll: Record<string, number>
  /** Sizes of notes while they're being resized (text reflows live). */
  liveSizes: Record<string, { width: number; height: number }>
  /** Link editor open for the current selection. */
  linkEditorOpen: boolean

  updateEditing: (patch: Partial<NoteEditing>) => void
  setScroll: (id: string, top: number) => void
  setPanelOpen: (open: boolean) => void
}

export const useNoteStore = create<NoteState>((set, get) => ({
  editing: null,
  editedElsewhere: new Set(),
  blocked: null,
  panelOpen: false,
  scroll: {},
  liveSizes: {},
  linkEditorOpen: false,

  updateEditing: (patch) => {
    const editing = get().editing
    if (editing) set({ editing: { ...editing, ...patch } })
  },
  setScroll: (id, top) => set({ scroll: { ...get().scroll, [id]: top } }),
  setPanelOpen: (panelOpen) => set({ panelOpen })
}))

export const isEditingNote = (): boolean => useNoteStore.getState().editing !== null
