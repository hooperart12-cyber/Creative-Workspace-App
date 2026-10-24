import { Fragment } from 'react'
import { useCanvasStore } from '../store/canvasStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import { ArrowLeft, ArrowRight, ArrowUp, ChevronRight } from './icons'

const navButton =
  'rounded p-1 text-muted hover:bg-canvas hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent'

export function Breadcrumb() {
  const board = useWorkspaceStore((s) => s.board)
  const canBack = useWorkspaceStore((s) => s.back.length > 0)
  const canForward = useWorkspaceStore((s) => s.forward.length > 0)
  // Canvas cards dragged over a crumb move into that board on drop.
  const dropBoardId = useCanvasStore((s) => s.drag?.dropBoardId)
  const { goBack, goForward, goUp, openBoard } = useWorkspaceStore.getState()

  if (!board) return null
  const crumbs = board.breadcrumb

  return (
    <div className="flex items-center gap-1 border-b border-line bg-surface px-3 py-1.5 text-sm">
      <button
        className={navButton}
        disabled={!canBack}
        onClick={() => void goBack()}
        title="Back (Alt+←)"
        aria-label="Back"
      >
        <ArrowLeft />
      </button>
      <button
        className={navButton}
        disabled={!canForward}
        onClick={() => void goForward()}
        title="Forward (Alt+→)"
        aria-label="Forward"
      >
        <ArrowRight />
      </button>
      <button
        className={navButton}
        disabled={!board.parentBoardId}
        onClick={() => void goUp()}
        title="Up to parent board (Alt+↑)"
        aria-label="Up to parent board"
      >
        <ArrowUp />
      </button>

      <ol aria-label="Breadcrumb" className="ml-2 flex min-w-0 items-center gap-1">
        {crumbs.map((crumb, i) => {
          const last = i === crumbs.length - 1
          return (
            <Fragment key={crumb.id}>
              {i > 0 && <ChevronRight width={12} height={12} className="shrink-0 text-muted" />}
              <li className="min-w-0">
                {last ? (
                  <span aria-current="page" className="block truncate font-medium">
                    {crumb.title}
                  </span>
                ) : (
                  <button
                    onClick={() => void openBoard(crumb.id)}
                    data-drop-board-id={crumb.id}
                    title={`Open ${crumb.title} (drop cards here to move them into it)`}
                    className={`block max-w-48 truncate rounded px-1 ${
                      dropBoardId === crumb.id
                        ? 'bg-accent/15 text-accent ring-2 ring-accent'
                        : 'text-muted hover:bg-canvas hover:text-ink'
                    }`}
                  >
                    {crumb.title}
                  </button>
                )}
              </li>
            </Fragment>
          )
        })}
      </ol>
    </div>
  )
}
