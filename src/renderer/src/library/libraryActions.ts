import type { DuplicatePolicy } from '@shared/types'
import { record } from '../canvas/actions'
import { showNotice } from '../store/projectStore'
import { useWorkspaceStore } from '../store/workspaceStore'

const api = () => window.api

function changedElsewhere(): Error {
  return new Error('This can’t be undone because it changed in another window.')
}

export async function renameEntry(id: string, name: string): Promise<void> {
  const previous = await api().invoke('library:rename', id, name)
  record({
    label: 'Rename',
    undo: async () => {
      await api().invoke('library:rename', id, previous)
    },
    redo: async () => {
      await api().invoke('library:rename', id, name)
    }
  })
}

export async function moveEntries(ids: string[], folderId: string | null): Promise<void> {
  if (ids.length === 0) return
  const previous = await api().invoke('library:move', ids, folderId)
  record({
    label: ids.length === 1 ? 'Move' : 'Move files',
    undo: async () => {
      for (const item of previous) await api().invoke('library:move', [item.id], item.folderId)
    },
    redo: async () => {
      await api().invoke('library:move', ids, folderId)
    }
  })
}

/** Trashes entries. Board appearances stay. Returns how many boards still show them. */
export async function trashEntries(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0
  const result = await api().invoke('library:trash', ids)
  record({
    label: ids.length === 1 ? 'Move to trash' : 'Move files to trash',
    undo: async () => {
      const restored = await api().invoke('library:restore', ids)
      if (restored.restored.length === 0) throw changedElsewhere()
    },
    redo: async () => {
      await api().invoke('library:trash', ids)
    }
  })
  if (result.boardCount > 0) {
    showNotice(
      `Still on ${result.boardCount} board${result.boardCount === 1 ? '' : 's'}. Those appearances stay.`,
      8000
    )
  }
  return result.boardCount
}

export async function restoreEntries(
  ids: string[],
  destinationFolderId?: string | null
): Promise<{ restored: string[]; needsDestination: string[] }> {
  const result = await api().invoke('library:restore', ids, destinationFolderId)
  if (result.restored.length > 0) {
    const restored = result.restored
    record({
      label: 'Restore',
      undo: async () => {
        await api().invoke('library:trash', restored)
      },
      redo: async () => {
        await api().invoke('library:restore', restored, destinationFolderId)
      }
    })
  }
  return result
}

export async function trashFolder(id: string): Promise<void> {
  await api().invoke('folder:delete', id, 'tree')
  record({
    label: 'Move folder to trash',
    undo: async () => {
      const result = await api().invoke('trash:restoreFolders', [id])
      if (result.restoredFolderIds.length === 0) throw changedElsewhere()
    },
    redo: async () => {
      await api().invoke('folder:delete', id, 'tree')
    }
  })
}

export async function dissolveFolder(id: string, renameConflicts: boolean): Promise<void> {
  const result = await api().invoke('folder:delete', id, 'dissolve', renameConflicts)
  if (result.renamed.length) showNotice(`Renamed ${result.renamed.join(', ')}`)
}

export async function restoreFolders(
  ids: string[],
  destinationParentId?: string | null
): Promise<{ needsDestination: string[] }> {
  const result = await api().invoke('trash:restoreFolders', ids, destinationParentId)
  if (result.restoredFolderIds.length > 0) {
    record({
      label: 'Restore folder',
      undo: async () => {
        for (const id of result.restoredFolderIds) await api().invoke('folder:delete', id, 'tree')
      },
      redo: async () => {
        await api().invoke('trash:restoreFolders', ids, destinationParentId)
      }
    })
  }
  return { needsDestination: result.needsDestination }
}

export async function showInLibrary(assetId: string): Promise<void> {
  const entries = await api().invoke('library:entriesForAsset', assetId)
  const entry = entries[0]
  if (!entry) {
    showNotice('This file’s library entry is in Trash.')
    useWorkspaceStore.getState().openTrash()
    return
  }
  useWorkspaceStore.getState().openLibrary(entry.folderId, entry.id)
}

export async function importLibraryFiles(
  paths: string[],
  options: {
    folderId: string | null
    duplicates: DuplicatePolicy
    structure?: 'preserve' | 'flatten'
  }
): Promise<void> {
  useWorkspaceStore.getState().setImportProgress({
    found: paths.length,
    processed: 0,
    imported: 0,
    skipped: 0,
    failed: 0,
    bytes: 0
  })
  try {
    const result = await api().invoke('library:importFiles', paths, options)
    reportImport(result)
  } finally {
    useWorkspaceStore.getState().setImportProgress(null)
  }
}

export async function importLibraryTree(
  root: string,
  options: {
    folderId: string | null
    duplicates: DuplicatePolicy
    structure: 'preserve' | 'flatten'
  }
): Promise<void> {
  useWorkspaceStore.getState().setImportProgress({
    found: 0,
    processed: 0,
    imported: 0,
    skipped: 0,
    failed: 0,
    bytes: 0
  })
  try {
    const result = await api().invoke('library:importTree', root, options)
    reportImport(result)
  } finally {
    useWorkspaceStore.getState().setImportProgress(null)
  }
}

function reportImport(result: {
  imported: { originalName: string }[]
  skipped: { name: string; reason: string }[]
  warnings: { message: string }[]
}): void {
  const lines = [
    ...result.warnings.map((warning) => warning.message),
    ...result.skipped.slice(0, 5).map((item) => `${item.name}: ${item.reason}`)
  ]
  if (result.skipped.length > 5) lines.push(`…and ${result.skipped.length - 5} more`)
  const head = `Imported ${result.imported.length}. Skipped ${result.skipped.length}.`
  showNotice(lines.length ? [head, ...lines].join('\n') : head, 12000)
}
