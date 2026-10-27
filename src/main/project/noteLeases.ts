/**
 * Which window is editing which note (ADR-014). Only one window edits a note at a time;
 * others show it read-only with "Take over". Kept in memory: a lease ends when its window
 * closes or the app quits. Saves are still checked by revision, so a lease is a courtesy
 * that prevents most conflicts, not the only protection.
 */
export class NoteLeases {
  /** project path → note id → owner (webContents id) */
  private readonly leases = new Map<string, Map<string, number>>()

  /** Starts editing. Fails if another window is already editing the note. */
  acquire(projectPath: string, noteId: string, owner: number): { ok: boolean } {
    const notes = this.notes(projectPath)
    const holder = notes.get(noteId)
    if (holder !== undefined && holder !== owner) return { ok: false }
    notes.set(noteId, owner)
    return { ok: true }
  }

  /** Takes the note from whoever is editing it. Returns the window that lost it, if any. */
  takeOver(projectPath: string, noteId: string, owner: number): number | undefined {
    const notes = this.notes(projectPath)
    const previous = notes.get(noteId)
    notes.set(noteId, owner)
    return previous !== undefined && previous !== owner ? previous : undefined
  }

  release(projectPath: string, noteId: string, owner: number): void {
    const notes = this.leases.get(projectPath)
    if (notes?.get(noteId) === owner) notes.delete(noteId)
  }

  /** Ends every lease a window holds (it closed or switched project). True if it held any. */
  releaseOwner(owner: number): boolean {
    let released = false
    for (const notes of this.leases.values()) {
      for (const [noteId, holder] of notes) {
        if (holder === owner) {
          notes.delete(noteId)
          released = true
        }
      }
    }
    return released
  }

  holds(owner: number): boolean {
    for (const notes of this.leases.values()) {
      for (const holder of notes.values()) if (holder === owner) return true
    }
    return false
  }

  /** Notes in a project that windows other than `owner` are editing. */
  editedElsewhere(projectPath: string, owner: number): string[] {
    const notes = this.leases.get(projectPath)
    if (!notes) return []
    return [...notes].filter(([, holder]) => holder !== owner).map(([noteId]) => noteId)
  }

  private notes(projectPath: string): Map<string, number> {
    let notes = this.leases.get(projectPath)
    if (!notes) {
      notes = new Map()
      this.leases.set(projectPath, notes)
    }
    return notes
  }
}
