import { useState } from 'react'
import type { TrashKind } from '@shared/types'
import { useWorkspaceStore } from '../store/workspaceStore'
import { restoreEntries, restoreFolders } from './libraryActions'
import { showNotice } from '../store/projectStore'
import { TagTrash } from '../tags/TagManager'

const filters: { id: 'all' | TrashKind; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'entry', label: 'Library files' },
  { id: 'folder', label: 'Library folders' },
  { id: 'object', label: 'Board objects' }
]

export function TrashView() {
  const items = useWorkspaceStore((s) => s.trashItems)
  const kind = useWorkspaceStore((s) => s.trashKind)
  const tree = useWorkspaceStore((s) => s.tree)
  const setTrashKind = useWorkspaceStore((s) => s.setTrashKind)
  const showCanvas = useWorkspaceStore((s) => s.showCanvas)
  const [selected, setSelected] = useState<string[]>([])
  const [dest, setDest] = useState<string | null>(null)
  const [needs, setNeeds] = useState<{ kind: 'entry' | 'folder' | 'object'; ids: string[] } | null>(
    null
  )
  const [section, setSection] = useState<'files' | 'tags'>('files')

  const chosen = items.filter((item) => selected.includes(`${item.kind}:${item.id}`))

  const restore = async () => {
    const entries = chosen.filter((item) => item.kind === 'entry').map((item) => item.id)
    const folders = chosen.filter((item) => item.kind === 'folder').map((item) => item.id)
    const objects = chosen.filter((item) => item.kind === 'object').map((item) => item.id)
    if (entries.length) {
      const result = await restoreEntries(entries)
      if (result.needsDestination.length) {
        setNeeds({ kind: 'entry', ids: result.needsDestination })
        setDest(null)
      }
    }
    if (folders.length) {
      const result = await restoreFolders(folders)
      if (result.needsDestination.length) {
        setNeeds({ kind: 'folder', ids: result.needsDestination })
        setDest(null)
      }
    }
    if (objects.length) {
      try {
        await window.api.invoke('objects:restore', objects)
      } catch (error) {
        if (error instanceof Error && error.message.includes('Board not found')) {
          setNeeds({ kind: 'object', ids: objects })
          setDest(tree?.boards[0]?.id ?? null)
          return
        }
        throw error
      }
    }
    setSelected([])
  }

  const confirmDest = async () => {
    if (!needs) return
    if (needs.kind === 'entry') await restoreEntries(needs.ids, dest)
    else if (needs.kind === 'folder') await restoreFolders(needs.ids, dest)
    else if (dest) await window.api.invoke('objects:restore', needs.ids, dest)
    setNeeds(null)
    setSelected([])
  }

  const purge = async () => {
    const result = await window.api.invoke('trash:purge', {
      entries: chosen.filter((item) => item.kind === 'entry').map((item) => item.id),
      folders: chosen.filter((item) => item.kind === 'folder').map((item) => item.id),
      objects: chosen.filter((item) => item.kind === 'object').map((item) => item.id)
    })
    setSelected([])
    reportPurge(result)
  }

  const empty = async () => {
    const result = await window.api.invoke('trash:empty')
    setSelected([])
    reportPurge(result)
  }

  return (
    <div data-testid="trash" className="flex min-h-0 flex-1 flex-col bg-canvas">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-2">
        <button className="text-sm text-muted hover:text-ink" onClick={showCanvas}>
          Canvas
        </button>
        <h1 className="text-sm font-medium">Trash</h1>
        <button
          aria-pressed={section === 'files'}
          className="rounded-lg border border-line px-2 py-1 text-sm"
          onClick={() => setSection('files')}
        >
          Files
        </button>
        <button
          aria-pressed={section === 'tags'}
          className="rounded-lg border border-line px-2 py-1 text-sm"
          onClick={() => setSection('tags')}
        >
          Tags
        </button>
        <span className="flex-1" />
        <button
          className="rounded-lg border border-line px-3 py-1.5 text-sm"
          onClick={() => useWorkspaceStore.getState().openLibrary(null)}
        >
          Library
        </button>
      </div>
      {section === 'tags' ? (
        <TagTrash />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2 text-sm">
            {filters.map((filter) => (
              <button
                key={filter.id}
                aria-pressed={kind === filter.id}
                onClick={() => setTrashKind(filter.id)}
                className={`rounded-lg border px-2 py-1 ${kind === filter.id ? 'border-accent text-accent' : 'border-line'}`}
              >
                {filter.label}
              </button>
            ))}
            <button
              className="rounded-lg border border-line px-2 py-1 disabled:opacity-40"
              disabled={chosen.length === 0}
              onClick={() => void restore().catch((error: unknown) => showNotice(String(error)))}
            >
              Restore
            </button>
            <button
              className="rounded-lg border border-red-200 px-2 py-1 text-red-700 disabled:opacity-40"
              disabled={chosen.length === 0}
              onClick={() => {
                if (
                  window.confirm('Delete the selected trash permanently? This cannot be undone.')
                ) {
                  void purge()
                }
              }}
            >
              Delete permanently
            </button>
            <button
              className="rounded-lg border border-red-200 px-2 py-1 text-red-700"
              onClick={() => {
                if (
                  window.confirm(
                    'Empty trash? Files that boards still use are kept. This cannot be undone.'
                  )
                ) {
                  void empty()
                }
              }}
            >
              Empty trash
            </button>
          </div>
          {needs && (
            <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-2 text-sm">
              <span>The original place is gone. Choose where to restore.</span>
              <select
                aria-label="Restore destination"
                value={dest ?? ''}
                onChange={(e) => setDest(e.target.value || null)}
                className="rounded border border-line bg-surface px-2 py-1"
              >
                {needs.kind === 'object' ? (
                  (tree?.boards ?? []).map((board) => (
                    <option key={board.id} value={board.id}>
                      {board.title}
                    </option>
                  ))
                ) : (
                  <>
                    <option value="">Library</option>
                    {(tree?.folders ?? []).map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folder.name}
                      </option>
                    ))}
                  </>
                )}
              </select>
              <button
                className="rounded-lg bg-accent px-2 py-1 text-white"
                onClick={() => void confirmDest()}
              >
                Restore here
              </button>
            </div>
          )}
          <ul className="min-h-0 flex-1 overflow-auto">
            {items.length === 0 && (
              <li className="px-4 py-8 text-sm text-muted">Trash is empty.</li>
            )}
            {items.map((item) => {
              const key = `${item.kind}:${item.id}`
              return (
                <li key={key} className="border-b border-line">
                  <label className="flex items-center gap-3 px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selected.includes(key)}
                      onChange={() =>
                        setSelected((current) =>
                          current.includes(key)
                            ? current.filter((id) => id !== key)
                            : [...current, key]
                        )
                      }
                      aria-label={item.name}
                    />
                    <span className="w-28 shrink-0 text-xs text-muted">
                      {item.kind === 'entry'
                        ? 'File'
                        : item.kind === 'folder'
                          ? 'Folder'
                          : 'Board object'}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{item.name}</span>
                    <span className="truncate text-xs text-muted">{item.location}</span>
                    <span className="shrink-0 text-xs text-muted">
                      {new Date(item.deletedAt).toLocaleString()}
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

function reportPurge(result: {
  filesDeleted: number
  filesKept: { name: string; reason: string }[]
  unlinkErrors: string[]
}): void {
  const kept = result.filesKept.slice(0, 3).map((file) => `${file.name}: ${file.reason}`)
  const lines = [
    `Removed ${result.filesDeleted} stored file${result.filesDeleted === 1 ? '' : 's'}.`,
    ...kept,
    ...result.unlinkErrors
  ]
  showNotice(lines.join('\n'), 12000)
}
