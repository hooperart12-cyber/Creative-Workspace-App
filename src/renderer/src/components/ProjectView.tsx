import { useRef, useState } from 'react'
import type { ProjectSummary } from '@shared/types'
import { useProjectStore } from '../store/projectStore'

export function ProjectView({ project }: { project: ProjectSummary }) {
  const renameProject = useProjectStore((s) => s.renameProject)
  const closeProject = useProjectStore((s) => s.closeProject)
  const openNewWindow = useProjectStore((s) => s.openNewWindow)
  // Draft name while editing; otherwise show the saved name (which other windows may change).
  const [draft, setDraft] = useState<string | null>(null)
  const cancelled = useRef(false)

  const commitName = () => {
    if (!cancelled.current && draft?.trim()) void renameProject(draft)
    cancelled.current = false
    setDraft(null)
  }

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-line bg-surface px-4 py-2">
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
          onClick={() => void openNewWindow()}
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

      <main className="flex flex-1 items-center justify-center p-8">
        <div className="max-w-md text-center">
          <h2 className="text-xl font-medium">Main board</h2>
          <p className="mt-2 text-muted">
            The canvas arrives in milestone M2. This project is set up and saved on disk.
          </p>
          <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-2 text-left text-sm">
            <dt className="text-muted">Boards</dt>
            <dd>{project.boardCount}</dd>
            <dt className="text-muted">Assets</dt>
            <dd>{project.assetCount}</dd>
            <dt className="text-muted">Location</dt>
            <dd className="break-all">{project.path}</dd>
          </dl>
        </div>
      </main>
    </div>
  )
}
