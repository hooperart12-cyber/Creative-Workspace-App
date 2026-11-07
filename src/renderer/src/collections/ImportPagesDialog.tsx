import { useState } from 'react'
import { planStagedImport, stageKnownAssets, type StagedSource } from '@shared/collectionImport'
import type { CollectionPageView } from '@shared/collections'
import { reportError } from '../store/projectStore'
import { useWorkspaceStore } from '../store/workspaceStore'

export function ImportPagesDialog({
  collectionId,
  beforeId,
  pages,
  onClose,
  onImported
}: {
  collectionId: string
  beforeId: string | null
  pages: CollectionPageView[]
  onClose: () => void
  onImported: (record: {
    created: string[]
    filled: {
      pageId: string
      versionIds: string[]
      previousDisplayed: string | null
      revision: number
    }[]
  }) => void
}) {
  const [files, setFiles] = useState<StagedSource[]>([])
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'append' | 'insert' | 'fill'>('append')
  const [groupVersions, setGroupVersions] = useState(false)
  const [busy, setBusy] = useState(false)
  const plan = planStagedImport({
    entries: files,
    placeholders: pages.map((page) => ({ id: page.id, hasArtwork: page.artwork !== 'blank' })),
    mode,
    applyVersionGroups: groupVersions
  })
  const stage = async (paths: string[]) => {
    if (paths.length === 0) return
    try {
      const staged = await window.api.invoke('collections:stagePaths', paths)
      setFiles(staged.files)
      setError(staged.error)
    } catch (caught) {
      reportError(caught)
    }
  }
  const commit = async () => {
    if (plan.actions.length === 0) return
    setBusy(true)
    try {
      const record = await window.api.invoke(
        'collections:commitImport',
        collectionId,
        mode === 'insert' ? beforeId : null,
        files,
        plan.actions
      )
      onImported(record)
    } catch (caught) {
      reportError(caught)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-6">
      <div
        role="dialog"
        aria-label="Import pages"
        className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl bg-surface p-4 shadow-xl"
      >
        <h2 className="text-sm font-medium">Import pages</h2>
        <p className="mt-1 text-xs text-muted">
          Nothing is added until you import. Version grouping stays off until you turn it on.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={choice} onClick={() => void pick('dialog:pickFiles')}>
            Files
          </button>
          <button type="button" className={choice} onClick={() => void pickFolder()}>
            Folder
          </button>
          <button type="button" className={choice} onClick={() => void pick('dialog:pickZip')}>
            CBZ or ZIP
          </button>
          <button type="button" className={choice} onClick={() => void fromLibrary()}>
            Asset library
          </button>
          <button type="button" className={choice} onClick={() => void fromBoard()}>
            This board
          </button>
          <button type="button" className={choice} onClick={() => void fromClipboard()}>
            Clipboard
          </button>
        </div>
        <label className="mt-3 block text-xs text-muted">
          Place
          <select
            aria-label="Import placement"
            className="mt-1 w-full rounded border border-line bg-canvas px-2 py-1 text-sm"
            value={mode}
            onChange={(event) => setMode(event.target.value as 'append' | 'insert' | 'fill')}
          >
            <option value="append">Add at the end</option>
            <option value="insert">Insert before the focused page</option>
            <option value="fill">Fill blank pages</option>
          </select>
        </label>
        <label className="mt-3 flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={groupVersions}
            onChange={(event) => setGroupVersions(event.target.checked)}
          />
          Group sketch, inks, and final files as versions of one page
        </label>
        {error && <p className="mt-3 text-xs text-red-700">{error}</p>}
        <ul className="mt-3 min-h-0 flex-1 space-y-1 overflow-auto text-xs">
          {files.map((file) => (
            <li key={`${file.name}-${file.reason ?? 'ok'}`} className="flex justify-between gap-2">
              <span className="truncate">{file.name || 'Files'}</span>
              <span className="text-muted">
                {file.accepted
                  ? file.suggestion === 'version'
                    ? 'Version suggestion'
                    : 'Ready'
                  : file.reason}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted">
          {plan.actions.length} pages ready
          {plan.leftover.length > 0
            ? `. ${plan.leftover.length} files do not fit a blank page and will be left out.`
            : ''}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="rounded border border-line px-3 py-1 text-sm"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || plan.actions.length === 0}
            className="rounded bg-accent px-3 py-1 text-sm text-white disabled:opacity-40"
            onClick={() => void commit()}
          >
            Import
          </button>
        </div>
      </div>
    </div>
  )

  async function pick(channel: 'dialog:pickFiles' | 'dialog:pickZip') {
    const path = await window.api.invoke(channel)
    const paths = Array.isArray(path) ? path : path ? [path] : []
    await stage(paths)
  }

  async function pickFolder() {
    const path = await window.api.invoke('dialog:pickFolder')
    if (path) await stage([path])
  }

  async function fromLibrary() {
    const page = await window.api.invoke('library:list', {
      folderId: null,
      scope: 'folder',
      query: '',
      type: 'image',
      sort: 'name',
      direction: 'asc',
      offset: 0,
      limit: 80
    })
    const staged = stageKnownAssets(
      page.entries
        .filter((entry) => entry.asset.mime.startsWith('image/'))
        .map((entry) => ({ name: entry.asset.originalName, assetId: entry.assetId }))
    )
    setFiles(staged)
    setError(staged.length === 0 ? 'The library has no images.' : null)
  }

  async function fromBoard() {
    const boardId = useWorkspaceStore.getState().board?.id
    if (!boardId) return
    const staged = await window.api.invoke('collections:stageBoard', boardId)
    setFiles(staged)
    setError(staged.length === 0 ? 'This board has no images or slides.' : null)
  }

  async function fromClipboard() {
    const staged = await window.api.invoke('collections:stageClipboard')
    setFiles(staged.files)
    setError(staged.error)
  }
}

const choice = 'rounded border border-line px-2 py-1 text-xs'
