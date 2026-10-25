import { useEffect, useRef, useState } from 'react'
import type { ProjectSummary } from '@shared/types'
import { useProjectStore } from '../store/projectStore'
import { boardFromHash, useWorkspaceStore } from '../store/workspaceStore'
import { ArrangeBar, CanvasToolbar, ZoomControl } from '../canvas/CanvasChrome'
import { CanvasMenu } from '../canvas/CanvasMenu'
import { CanvasView } from '../canvas/CanvasView'
import { ImageViewer } from '../canvas/ImageViewer'
import { useCanvasStore } from '../store/canvasStore'
import { isEditingNote, useNoteStore } from '../notes/noteStore'
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-line bg-surface px-3 py-2">
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
          <Breadcrumb />
          <div className="relative min-h-0 flex-1">
            <CanvasMenu>
              <div className="h-full w-full">
                <CanvasView />
              </div>
            </CanvasMenu>
            <CanvasToolbar />
            <ArrangeBar />
            <ZoomControl />
          </div>
        </main>
      </div>
      <WorkspaceDialogs />
      <ImageViewer />
    </div>
  )
}
