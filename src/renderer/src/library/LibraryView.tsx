import { useEffect, useRef, useState } from 'react'
import { assetUrl } from '@shared/assets'
import { formatBytes } from '@shared/files'
import type { LibraryEntry } from '@shared/types'
import { placeExistingAssets, viewCenter } from '../canvas/actions'
import { useCanvasStore } from '../store/canvasStore'
import { useProjectStore } from '../store/projectStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import { importLibraryFiles, moveEntries, renameEntry, trashEntries } from './libraryActions'
import { TagEditor } from '../tags/TagEditor'
import { openTagEditor } from '../tags/TagManager'

const ENTRY_MIME = 'application/x-cw-entries'
const CELL = 168
const GAP = 12

export function LibraryView() {
  const projectId = useProjectStore((s) => s.project?.id)
  const page = useWorkspaceStore((s) => s.libraryPage)
  const folderId = useWorkspaceStore((s) => s.libraryFolderId)
  const query = useWorkspaceStore((s) => s.libraryQuery)
  const scope = useWorkspaceStore((s) => s.libraryScope)
  const type = useWorkspaceStore((s) => s.libraryType)
  const sort = useWorkspaceStore((s) => s.librarySort)
  const direction = useWorkspaceStore((s) => s.libraryDirection)
  const unfiled = useWorkspaceStore((s) => s.libraryUnfiled)
  const view = useWorkspaceStore((s) => s.libraryView)
  const storage = useWorkspaceStore((s) => s.storage)
  const progress = useWorkspaceStore((s) => s.importProgress)
  const focusId = useWorkspaceStore((s) => s.libraryFocusId)
  const tree = useWorkspaceStore((s) => s.tree)
  const setLibraryQuery = useWorkspaceStore((s) => s.setLibraryQuery)
  const showCanvas = useWorkspaceStore((s) => s.showCanvas)
  const openBoard = useWorkspaceStore((s) => s.openBoard)
  const [selected, setSelected] = useState<string[]>(() => (focusId ? [focusId] : []))
  const anchor = useRef<string | null>(focusId)
  const frame = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ width: 800, height: 600, scrollTop: 0 })

  useEffect(() => {
    const el = frame.current
    if (!el) return
    const update = () =>
      setBox({ width: el.clientWidth, height: el.clientHeight, scrollTop: el.scrollTop })
    const frameId = requestAnimationFrame(update)
    const observer = new ResizeObserver(update)
    observer.observe(el)
    el.addEventListener('scroll', update)
    return () => {
      cancelAnimationFrame(frameId)
      observer.disconnect()
      el.removeEventListener('scroll', update)
    }
  }, [view])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useWorkspaceStore.getState().surface !== 'library') return
      const target = e.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [role="dialog"], [role="alertdialog"]')) return
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        const ids = useWorkspaceStore.getState().libraryPage?.ids ?? []
        setSelected(ids)
        anchor.current = ids.at(-1) ?? null
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        void trashEntries(selected).then(() => setSelected([]))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected])

  const entries = page?.entries ?? []
  const total = page?.total ?? 0
  const crumbs = folderCrumbs(tree?.folders ?? [], folderId)
  const selectedEntries = entries.filter((entry) => selected.includes(entry.id))
  const one = selectedEntries.length === 1 ? selectedEntries[0] : null

  const onScroll = () => {
    const el = frame.current
    const current = useWorkspaceStore.getState().libraryPage
    if (!el || !current || current.entries.length >= current.total) return
    if (el.scrollTop + el.clientHeight > el.scrollHeight - 240) {
      void useWorkspaceStore.getState().reloadLibrary(true)
    }
  }

  const choose = (id: string, event: React.MouseEvent) => {
    const order = useWorkspaceStore.getState().libraryPage?.ids ?? []
    if (event.shiftKey && anchor.current) {
      const a = order.indexOf(anchor.current)
      const b = order.indexOf(id)
      if (a >= 0 && b >= 0) {
        const [start, end] = a < b ? [a, b] : [b, a]
        setSelected(order.slice(start, end + 1))
        return
      }
    }
    if (event.ctrlKey || event.metaKey) {
      setSelected((current) =>
        current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
      )
    } else setSelected([id])
    anchor.current = id
  }

  const assetIdsFor = (ids: string[]): string[] => {
    const current = useWorkspaceStore.getState().libraryPage
    if (!current) return []
    const byId = new Map(current.ids.map((id, index) => [id, current.assetIds[index]]))
    return ids.flatMap((id) => {
      const assetId = byId.get(id)
      return assetId ? [assetId] : []
    })
  }

  const dragStart = (event: React.DragEvent, entry: LibraryEntry) => {
    const ids = selected.includes(entry.id) ? selected : [entry.id]
    const byId = new Map(entries.map((item) => [item.id, item.assetId]))
    const payload = ids.flatMap((id) => {
      const assetId = byId.get(id) ?? assetIdsFor([id])[0]
      return assetId ? [{ id, assetId }] : []
    })
    event.dataTransfer.setData(ENTRY_MIME, JSON.stringify(payload))
    event.dataTransfer.effectAllowed = 'copy'
  }

  return (
    <div
      data-testid="library"
      className="flex min-h-0 flex-1 flex-col bg-canvas"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
        }
      }}
      onDrop={(event) => {
        const paths = [...event.dataTransfer.files]
          .map((file) => window.api.pathForFile(file))
          .filter((path) => path.length > 0)
        if (paths.length === 0) return
        event.preventDefault()
        const duplicates = rememberedChoice('cw-import-duplicates', 'skip', [
          'skip',
          'entry'
        ] as const)
        const structure = rememberedChoice('cw-import-structure', 'preserve', [
          'preserve',
          'flatten'
        ] as const)
        void importLibraryFiles(paths, { folderId, duplicates, structure })
      }}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-2">
        <button className="text-sm text-muted hover:text-ink" onClick={showCanvas}>
          Canvas
        </button>
        <nav
          aria-label="Library folders"
          className="flex min-w-0 flex-1 items-center gap-1 text-sm"
        >
          <button
            className="truncate hover:underline"
            onClick={() => setLibraryQuery({ folderId: null, unfiled: false })}
          >
            Library
          </button>
          {crumbs.map((crumb) => (
            <span key={crumb.id} className="flex min-w-0 items-center gap-1">
              <span className="text-muted">/</span>
              <button
                className="truncate hover:underline"
                onClick={() => setLibraryQuery({ folderId: crumb.id, unfiled: false })}
              >
                {crumb.name}
              </button>
            </span>
          ))}
        </nav>
        <button
          className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-canvas"
          onClick={() => useWorkspaceStore.getState().setDialog({ kind: 'import' })}
        >
          Import
        </button>
        <button
          className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-canvas"
          onClick={() => useWorkspaceStore.getState().openTrash()}
        >
          Trash
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2 text-sm">
        <input
          value={query}
          onChange={(e) => setLibraryQuery({ query: e.target.value })}
          placeholder="Search"
          aria-label="Library search"
          className="w-48 rounded-lg border border-line bg-surface px-2 py-1"
        />
        <select
          aria-label="Search scope"
          value={scope}
          onChange={(e) =>
            setLibraryQuery({ scope: e.target.value === 'project' ? 'project' : 'folder' })
          }
          className="rounded-lg border border-line bg-surface px-2 py-1"
        >
          <option value="folder">This folder</option>
          <option value="project">Whole library</option>
        </select>
        {(['all', 'image', 'pdf', 'other'] as const).map((item) => (
          <button
            key={item}
            aria-pressed={type === item}
            onClick={() => setLibraryQuery({ type: item })}
            className={`rounded-lg border px-2 py-1 ${type === item ? 'border-accent text-accent' : 'border-line'}`}
          >
            {item === 'all'
              ? 'All types'
              : item === 'image'
                ? 'Images'
                : item === 'pdf'
                  ? 'PDFs'
                  : 'Other'}
          </button>
        ))}
        <button
          aria-pressed={unfiled}
          onClick={() => setLibraryQuery({ unfiled: !unfiled })}
          className={`rounded-lg border px-2 py-1 ${unfiled ? 'border-accent text-accent' : 'border-line'}`}
        >
          Unfiled
        </button>
        <select
          aria-label="Sort"
          value={`${sort}:${direction}`}
          onChange={(e) => {
            const [nextSort, nextDir] = e.target.value.split(':')
            setLibraryQuery({
              sort: nextSort as 'name' | 'imported' | 'size' | 'type',
              direction: nextDir === 'desc' ? 'desc' : 'asc'
            })
          }}
          className="rounded-lg border border-line bg-surface px-2 py-1"
        >
          <option value="name:asc">Name A–Z</option>
          <option value="name:desc">Name Z–A</option>
          <option value="imported:desc">Newest</option>
          <option value="imported:asc">Oldest</option>
          <option value="size:desc">Largest</option>
          <option value="size:asc">Smallest</option>
          <option value="type:asc">Type</option>
        </select>
        <button
          aria-pressed={view === 'grid'}
          onClick={() => setLibraryQuery({ view: 'grid' })}
          className="rounded-lg border border-line px-2 py-1"
        >
          Grid
        </button>
        <button
          aria-pressed={view === 'list'}
          onClick={() => setLibraryQuery({ view: 'list' })}
          className="rounded-lg border border-line px-2 py-1"
        >
          List
        </button>
        <span className="text-muted">
          {total} {total === 1 ? 'file' : 'files'}
          {storage ? ` · ${formatBytes(storage.originalBytes)} stored` : ''}
        </span>
      </div>
      {selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2 text-sm">
          <span>{selected.length} selected</span>
          <button
            className="rounded-lg border border-line px-2 py-1"
            onClick={() => {
              const ids = useWorkspaceStore.getState().libraryPage?.ids ?? []
              setSelected(ids)
            }}
          >
            Select all
          </button>
          <button
            className="rounded-lg border border-line px-2 py-1"
            onClick={() => void placeExistingAssets(assetIdsFor(selected), viewCenter())}
          >
            Add to board
          </button>
          <button
            className="rounded-lg border border-line px-2 py-1"
            onClick={() =>
              void import('../stacks/stackActions').then(({ placeAsStack }) =>
                placeAsStack(assetIdsFor(selected), viewCenter())
              )
            }
          >
            Place as stack
          </button>
          <button
            className="rounded-lg border border-line px-2 py-1"
            onClick={() =>
              openTagEditor({
                title: 'Tag these entries',
                targets: selected.map((id) => ({ type: 'entry', id }))
              })
            }
          >
            Tag entries
          </button>
          <button
            className="rounded-lg border border-line px-2 py-1"
            onClick={() =>
              openTagEditor({
                title: `On the original (${selected.length} entries)`,
                targets: [...new Set(assetIdsFor(selected))].map((id) => ({
                  type: 'asset' as const,
                  id
                }))
              })
            }
          >
            On the original
          </button>
          <label className="flex items-center gap-1">
            Move to
            <select
              aria-label="Move to folder"
              defaultValue=""
              onChange={(e) => {
                const value = e.target.value
                if (!value) return
                void moveEntries(selected, value === 'root' ? null : value).then(() =>
                  setSelected([])
                )
                e.target.value = ''
              }}
              className="rounded border border-line bg-surface px-1 py-1"
            >
              <option value="" disabled>
                Choose
              </option>
              <option value="root">Library</option>
              {(tree?.folders ?? []).map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="rounded-lg border border-red-200 px-2 py-1 text-red-700"
            onClick={() => void trashEntries(selected).then(() => setSelected([]))}
          >
            Move to trash
          </button>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <div ref={frame} onScroll={onScroll} className="min-w-0 flex-1 overflow-auto p-3">
          {entries.length === 0 ? (
            <p className="px-2 py-8 text-sm text-muted">Nothing in this view.</p>
          ) : view === 'grid' ? (
            <Grid
              entries={entries}
              width={box.width}
              height={box.height}
              scrollTop={box.scrollTop}
              selected={selected}
              projectId={projectId}
              onChoose={choose}
              onDragStart={dragStart}
            />
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
              {entries.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    draggable
                    onDragStart={(event) => dragStart(event, entry)}
                    onClick={(event) => choose(entry.id, event)}
                    aria-label={entry.name}
                    aria-pressed={selected.includes(entry.id)}
                    className={`flex w-full items-center gap-3 px-3 py-2 text-left ${
                      selected.includes(entry.id) ? 'bg-accent/10' : 'hover:bg-canvas'
                    }`}
                  >
                    <Thumb entry={entry} projectId={projectId} />
                    <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                    <span className="text-xs text-muted">{entry.asset.ext}</span>
                    <span className="w-20 text-right text-xs text-muted">
                      {formatBytes(entry.asset.bytes)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {one && projectId && (
          <Details
            key={one.id}
            entry={one}
            projectId={projectId}
            onOpenBoard={(boardId, objectId, kind) => {
              void openBoard(boardId).then(() => {
                useCanvasStore.getState().setSelection([objectId])
                if (kind === 'image') useCanvasStore.getState().setViewerObjectId(objectId)
                if (kind === 'pdf') useCanvasStore.getState().setPdfReaderId(objectId)
              })
            }}
          />
        )}
      </div>
      {progress && (
        <div
          role="status"
          className="flex items-center justify-between border-t border-line bg-surface px-3 py-2 text-sm"
        >
          <span>
            {progress.processed} of {progress.found} · imported {progress.imported} · skipped{' '}
            {progress.skipped} · failed {progress.failed} · {formatBytes(progress.bytes)}
          </span>
          <button
            className="rounded-lg border border-line px-2 py-1"
            onClick={() => void window.api.invoke('library:cancelImport')}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}

function Grid({
  entries,
  width,
  height,
  scrollTop,
  selected,
  projectId,
  onChoose,
  onDragStart
}: {
  entries: LibraryEntry[]
  width: number
  height: number
  scrollTop: number
  selected: string[]
  projectId: string | undefined
  onChoose: (id: string, event: React.MouseEvent) => void
  onDragStart: (event: React.DragEvent, entry: LibraryEntry) => void
}) {
  const cols = Math.max(1, Math.floor((width + GAP) / (CELL + GAP)))
  const rows = Math.ceil(entries.length / cols)
  const rowHeight = CELL + GAP
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - 1)
  const end = Math.min(rows, Math.ceil((scrollTop + height) / rowHeight) + 2)
  const visible: LibraryEntry[] = []
  for (let row = start; row < end; row++) {
    for (let col = 0; col < cols; col++) {
      const entry = entries[row * cols + col]
      if (entry) visible.push(entry)
    }
  }
  return (
    <div className="relative" style={{ height: rows * rowHeight }}>
      {visible.map((entry) => {
        const index = entries.indexOf(entry)
        const row = Math.floor(index / cols)
        const col = index % cols
        return (
          <button
            key={entry.id}
            type="button"
            draggable
            onDragStart={(event) => onDragStart(event, entry)}
            onClick={(event) => onChoose(entry.id, event)}
            aria-pressed={selected.includes(entry.id)}
            aria-label={entry.name}
            className={`absolute flex flex-col overflow-hidden rounded-lg border bg-surface text-left ${
              selected.includes(entry.id) ? 'border-accent' : 'border-line'
            }`}
            style={{ width: CELL, height: CELL, left: col * (CELL + GAP), top: row * rowHeight }}
          >
            <span className="flex min-h-0 flex-1 items-center justify-center bg-canvas p-2">
              <Thumb entry={entry} projectId={projectId} large />
            </span>
            <span className="truncate px-2 py-1 text-xs">{entry.name}</span>
          </button>
        )
      })}
    </div>
  )
}

function Thumb({
  entry,
  projectId,
  large
}: {
  entry: LibraryEntry
  projectId: string | undefined
  large?: boolean
}) {
  const [failed, setFailed] = useState(false)
  const src = !projectId || failed ? null : thumbUrl(entry, projectId)
  if (!src) {
    return (
      <span className={`text-xs text-muted uppercase ${large ? '' : 'w-8'}`}>
        {entry.asset.ext}
      </span>
    )
  }
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      onError={() => setFailed(true)}
      className={large ? 'max-h-full max-w-full object-contain' : 'h-8 w-8 object-contain'}
    />
  )
}

function thumbUrl(entry: LibraryEntry, projectId: string): string | null {
  const asset = entry.asset
  if (asset.mime.startsWith('image/')) return assetUrl(projectId, asset.sha256, 256)
  if (asset.preview) return assetUrl(projectId, asset.preview.sha256, 256)
  if (asset.mime === 'application/pdf') return assetUrl(projectId, asset.sha256, 1024)
  return null
}

function Details({
  entry,
  projectId,
  onOpenBoard
}: {
  entry: LibraryEntry
  projectId: string
  onOpenBoard: (boardId: string, objectId: string, kind: 'image' | 'pdf' | 'other') => void
}) {
  const [name, setName] = useState(entry.name)
  const [info, setInfo] = useState<Awaited<ReturnType<typeof loadDetails>> | null>(null)
  useEffect(() => {
    let cancel = false
    void loadDetails(entry.id).then((next) => {
      if (!cancel) setInfo(next)
    })
    return () => {
      cancel = true
    }
  }, [entry.id])

  const asset = entry.asset
  const kind = asset.mime.startsWith('image/')
    ? 'image'
    : asset.mime === 'application/pdf'
      ? 'pdf'
      : 'other'
  return (
    <aside
      aria-label="Details"
      className="w-72 shrink-0 overflow-auto border-l border-line bg-surface p-3 text-sm"
    >
      <div className="mb-3 flex h-36 items-center justify-center rounded-lg bg-canvas">
        <Thumb entry={entry} projectId={projectId} large />
      </div>
      <label className="block text-xs text-muted">
        Name
        <input
          aria-label="Display name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (name.trim() && name.trim() !== entry.name) void renameEntry(entry.id, name)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
          className="mt-1 w-full rounded border border-line px-2 py-1"
        />
      </label>
      <dl className="mt-3 space-y-1 text-xs">
        <Row label="Original file" value={asset.originalName} />
        <Row label="Type" value={asset.mime} />
        <Row label="Extension" value={asset.ext} />
        <Row label="Size" value={formatBytes(asset.bytes)} />
        <Row
          label="Pixels"
          value={asset.width && asset.height ? `${asset.width} × ${asset.height}` : '—'}
        />
        <Row label="Pages" value={asset.pageCount == null ? '—' : String(asset.pageCount)} />
        <Row label="Imported" value={new Date(entry.createdAt).toLocaleString()} />
        <Row label="Folder" value={entry.folderPath || 'Library'} />
      </dl>
      <div className="mt-3 flex flex-col gap-1">
        {info?.appearances[0] && (
          <button
            className="rounded border border-line px-2 py-1 text-left"
            onClick={() =>
              onOpenBoard(info.appearances[0].boardId, info.appearances[0].objectId, kind)
            }
          >
            Open
          </button>
        )}
        <button
          className="rounded border border-line px-2 py-1 text-left"
          onClick={() => void window.api.invoke('assets:saveOriginal', asset.id)}
        >
          Save original as…
        </button>
        <button
          className="rounded border border-line px-2 py-1 text-left"
          onClick={() =>
            void placeExistingAssets([asset.id], viewCenter()).then(() =>
              useWorkspaceStore.getState().showCanvas()
            )
          }
        >
          Add to current board
        </button>
      </div>
      <h3 className="mt-4 text-xs font-medium text-muted">Used on boards</h3>
      <ul className="mt-1">
        {(info?.appearances ?? []).map((item) => (
          <li key={item.objectId}>
            <button
              className="w-full truncate py-0.5 text-left hover:underline"
              onClick={() => onOpenBoard(item.boardId, item.objectId, kind)}
            >
              {item.boardTitle}
            </button>
          </li>
        ))}
        {info && info.appearances.length === 0 && (
          <li className="text-xs text-muted">Not on a board</li>
        )}
      </ul>
      {(info?.sameOriginal.length ?? 0) > 1 && (
        <>
          <h3 className="mt-4 text-xs font-medium text-muted">Same original</h3>
          <ul className="mt-1 text-xs">
            {info?.sameOriginal.map((item) => (
              <li key={item.id} className="truncate py-0.5">
                {item.name}
                {item.folderPath ? ` · ${item.folderPath}` : ''}
              </li>
            ))}
          </ul>
        </>
      )}
      <TagEditor
        targets={[{ type: 'entry', id: entry.id }]}
        title="Tags on this entry"
        inherited={(info?.tags ?? []).filter((tag) => tag.source === 'asset')}
      />
      <TagEditor targets={[{ type: 'asset', id: entry.assetId }]} title="On the original" />
    </aside>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="truncate text-right">{value}</dd>
    </div>
  )
}

async function loadDetails(id: string) {
  return window.api.invoke('library:details', id)
}

function rememberedChoice<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  try {
    const value = localStorage.getItem(key)
    return allowed.includes(value as T) ? (value as T) : fallback
  } catch {
    return fallback
  }
}

function folderCrumbs(
  folders: { id: string; name: string; parentId: string | null }[],
  folderId: string | null
): { id: string; name: string }[] {
  if (!folderId) return []
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const crumbs: { id: string; name: string }[] = []
  let cursor: string | null = folderId
  const seen = new Set<string>()
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor)
    const folder = byId.get(cursor)
    if (!folder) break
    crumbs.push({ id: folder.id, name: folder.name })
    cursor = folder.parentId
  }
  return crumbs.reverse()
}
