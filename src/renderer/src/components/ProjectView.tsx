import { useEffect, useRef, useState } from 'react'
import type { ProjectSummary } from '@shared/types'
import { useProjectStore } from '../store/projectStore'
import { FileDetails } from '../files/FileDetails'
import { PdfReader } from '../pdf/PdfReader'
import { boardFromHash, pdfFromHash, useWorkspaceStore } from '../store/workspaceStore'
import { ArrangeBar, CanvasToolbar, ZoomControl } from '../canvas/CanvasChrome'
import { CanvasMenu } from '../canvas/CanvasMenu'
import { CanvasView } from '../canvas/CanvasView'
import { ImageViewer } from '../canvas/ImageViewer'
import { ExpandedNoteEditor } from '../notes/ExpandedNoteEditor'
import { useCanvasStore } from '../store/canvasStore'
import { isEditingNote, useNoteStore } from '../notes/noteStore'
import { saveNoteNow } from '../notes/session'
import { LibraryView } from '../library/LibraryView'
import { TrashView } from '../library/TrashView'
import { BackupDialog } from '../backup/BackupDialog'
import { CommandPalette } from '../commands/CommandPalette'
import { TagDialogs } from '../tags/TagManager'
import { ShortcutSheet } from '../commands/ShortcutSheet'
import { DraftDialog } from '../recovery/DraftDialog'
import { useSaveStatus } from '../saveStatus'
import { PdfIndexer } from '../search/PdfIndexer'
import { SearchView } from '../search/SearchView'
import { Breadcrumb } from './Breadcrumb'
import { SidebarIcon } from './icons'
import { Sidebar } from './Sidebar'
import { WorkspaceDialogs } from './WorkspaceDialogs'

export function ProjectView({ project }: { project: ProjectSummary }) {
  const renameProject = useProjectStore((s) => s.renameProject)
  const closeProject = useProjectStore((s) => s.closeProject)
  const openNewWindow = useProjectStore((s) => s.openNewWindow)
  const currentBoardId = useWorkspaceStore((s) => s.board?.id)
  // Draft name while editing; otherwise show the saved name (which other windows may change).
  const [draft, setDraft] = useState<string | null>(null)
  const cancelled = useRef(false)
  const sidebarCollapsed = useWorkspaceStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useWorkspaceStore((s) => s.toggleSidebar)
  const surface = useWorkspaceStore((s) => s.surface)
  const libraryFocusId = useWorkspaceStore((s) => s.libraryFocusId)
  const save = useSaveStatus()
  const editing = useNoteStore((s) => s.editing)
  const [saveOpen, setSaveOpen] = useState(false)
  const phase =
    editing && editing.status !== 'saved'
      ? editing.status === 'error'
        ? 'failed'
        : editing.status
      : save.phase
  const saveLabel =
    phase === 'failed'
      ? 'Save failed'
      : phase === 'saving' || phase === 'unsaved'
        ? 'Saving…'
        : 'Saved'
  const pdfAsset = useCanvasStore((s) => s.pdfAsset)

  useEffect(() => {
    void useWorkspaceStore.getState().load(boardFromHash())
    void window.api
      .invoke('notes:editedElsewhere')
      .then((ids) => useNoteStore.setState({ editedElsewhere: new Set(ids) }))
      .catch(() => {})
  }, [project.path])

  // Navigation shortcuts: Alt+←/→/↑, mouse back/forward buttons, Ctrl/Cmd+\ toggles the sidebar.
  useEffect(() => {
    const { goBack, goForward, goUp, toggleSidebar } = useWorkspaceStore.getState()
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      if (useCanvasStore.getState().viewerObjectId) return
      if (useCanvasStore.getState().pdfReaderId || pdfFromHash()) return
      if (useCanvasStore.getState().fileDetailsId) return
      if (isEditingNote()) return
      if (e.altKey && e.key === 'ArrowLeft') void goBack()
      else if (e.altKey && e.key === 'ArrowRight') void goForward()
      else if (e.altKey && e.key === 'ArrowUp') void goUp()
      else if ((e.ctrlKey || e.metaKey) && e.key === '\\') toggleSidebar()
      else return
      e.preventDefault()
    }
    const onMouse = (e: MouseEvent) => {
      if (e.button === 3) void goBack()
      if (e.button === 4) void goForward()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mouseup', onMouse)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mouseup', onMouse)
    }
  }, [])

  const commitName = () => {
    if (!cancelled.current && draft?.trim()) void renameProject(draft)
    cancelled.current = false
    setDraft(null)
  }

  // Captured once: loading the board must not replace this window with the canvas.
  const [popoutPdf] = useState(pdfFromHash)
  const pdfReaderId = useCanvasStore((s) => s.pdfReaderId)
  if (popoutPdf) {
    return (
      <div className="relative flex min-h-0 flex-1 flex-col">
        <PdfReader objectId={popoutPdf} onClose={() => window.close()} />
      </div>
    )
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <header className="relative flex items-center gap-3 border-b border-line bg-surface px-3 py-2">
        <button
          onClick={toggleSidebar}
          title="Toggle sidebar (Ctrl+\)"
          aria-label="Toggle sidebar"
          aria-pressed={!sidebarCollapsed}
          className="rounded p-1 text-muted hover:bg-canvas hover:text-ink"
        >
          <SidebarIcon />
        </button>
        <input
          value={draft ?? project.name}
          onFocus={() => setDraft(project.name)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') {
              cancelled.current = true
              e.currentTarget.blur()
            }
          }}
          aria-label="Project name"
          className="min-w-0 flex-1 rounded px-2 py-1 text-base font-medium outline-none hover:bg-canvas focus:bg-canvas"
        />
        <button
          className="rounded-lg border border-line px-3 py-1.5 text-sm"
          aria-label="Save status"
          onClick={() => setSaveOpen((open) => !open)}
        >
          {saveLabel}
        </button>
        {saveOpen && (
          <div className="absolute top-12 right-3 z-20 w-72 rounded-xl border border-line bg-surface p-3 text-sm shadow-lg">
            <p>
              Last save:{' '}
              {save.lastSavedAt
                ? new Date(save.lastSavedAt).toLocaleString()
                : 'Not yet this session'}
            </p>
            {save.error && <p className="mt-1 text-red-700">{save.error}</p>}
            {phase === 'failed' && (
              <button className="mt-2 text-sm" onClick={() => void saveNoteNow()}>
                Retry save
              </button>
            )}
            <button
              className="mt-2 block text-sm"
              onClick={() => document.dispatchEvent(new CustomEvent('cw-backup'))}
            >
              Backup and recovery
            </button>
          </div>
        )}
        <button
          onClick={() => document.dispatchEvent(new CustomEvent('cw-backup'))}
          className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-canvas"
        >
          Backup
        </button>
        <button
          onClick={() => useWorkspaceStore.getState().openSearch()}
          className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-canvas"
        >
          Search
        </button>
        <button
          onClick={() => void openNewWindow(currentBoardId)}
          className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-canvas"
        >
          Open in new window
        </button>
        <button
          onClick={() => void closeProject()}
          className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-canvas"
        >
          Close project
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {!sidebarCollapsed && <Sidebar />}
        <main className="flex min-w-0 flex-1 flex-col">
          {surface === 'canvas' && <Breadcrumb />}
          <div className="relative flex min-h-0 flex-1 flex-col">
            <div className={surface === 'canvas' ? 'relative min-h-0 flex-1' : 'hidden'}>
              <CanvasMenu>
                <div className="h-full w-full">
                  <CanvasView />
                </div>
              </CanvasMenu>
              <CanvasToolbar />
              <ArrangeBar />
              <ZoomControl />
            </div>
            {surface === 'library' && <LibraryView key={libraryFocusId ?? 'library'} />}
            {surface === 'trash' && <TrashView />}
            {surface === 'search' && <SearchView />}
          </div>
        </main>
      </div>
      <WorkspaceDialogs />
      <CommandPalette />
      <TagDialogs />
      <ShortcutSheet />
      <BackupDialog />
      <DraftDialog />
      <PdfIndexer />
      <FileAssetDialog />
      <ImageViewer />
      <ExpandedNoteEditor />
      <FileDetails />
      {pdfReaderId && (
        <PdfReader
          objectId={pdfReaderId}
          onClose={() => useCanvasStore.getState().setPdfReaderId(null)}
        />
      )}
      {pdfAsset && (
        <PdfReader
          assetId={pdfAsset.assetId}
          initialPage={pdfAsset.page}
          initialQuery={pdfAsset.query}
          onClose={() => useCanvasStore.getState().setPdfAsset(null)}
        />
      )}
    </div>
  )
}

function FileAssetDialog() {
  const id = useCanvasStore((s) => s.fileAssetId)
  const [name, setName] = useState<string | null>(null)
  useEffect(() => {
    if (!id) return
    void window.api.invoke('assets:get', id).then((asset) => setName(asset.originalName))
  }, [id])
  if (!id) return null
  return (
    <div
      role="dialog"
      aria-label="File details"
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/20"
    >
      <div className="w-96 rounded-xl border border-line bg-surface p-5 shadow-lg">
        <h2 className="truncate text-base font-medium">{name ?? 'File'}</h2>
        <p className="mt-2 text-sm text-muted">
          This file stays in the library. It is not opened outside the app.
        </p>
        <div className="mt-4 flex gap-2">
          <button
            className="rounded-lg border border-line px-3 py-1.5 text-sm"
            onClick={() => void window.api.invoke('assets:saveOriginal', id)}
          >
            Save original as
          </button>
          <button
            className="rounded-lg border border-line px-3 py-1.5 text-sm"
            onClick={() => useCanvasStore.getState().setFileAssetId(null)}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
