/** Project integrity. Broken references stay until someone chooses what to do with them. */
import { locateIssue, openIntegrity, repairIssue } from './relationActions'
import { useCanvasStore } from '../store/canvasStore'

export function IntegrityPanel() {
  const open = useCanvasStore((s) => s.showIntegrity)
  const issues = useCanvasStore((s) => s.integrityIssues)
  if (!open) return null
  return (
    <aside
      className="absolute top-3 left-3 z-20 w-80 rounded-xl border border-line bg-surface p-3 text-sm shadow-sm"
      aria-label="Project integrity"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-medium">Project integrity</h2>
        <button type="button" onClick={() => useCanvasStore.getState().setShowIntegrity(false)}>
          Close
        </button>
      </div>
      <p className="mt-1 text-xs text-muted">
        Missing references are kept. Nothing here deletes a connection, comment, or link.
      </p>
      <button type="button" className="mt-2 text-xs underline" onClick={() => void openIntegrity()}>
        Check again
      </button>
      {issues.length === 0 ? (
        <p className="mt-3 text-muted">No broken references.</p>
      ) : (
        <ul className="mt-3 max-h-80 space-y-3 overflow-auto">
          {issues.map((issue) => (
            <li key={`${issue.id}-${issue.detail}`} className="rounded border border-line p-2">
              <p>
                {issue.kind}: {issue.detail}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" onClick={() => void locateIssue(issue.boardId, issue.id)}>
                  Locate
                </button>
                <button type="button" onClick={() => void repairIssue(issue.id, 'reattach')}>
                  Reattach
                </button>
                <button type="button" onClick={() => void repairIssue(issue.id, 'keep')}>
                  Keep detached
                </button>
                <button type="button" onClick={() => void repairIssue(issue.id, 'clear')}>
                  Remove reference
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
