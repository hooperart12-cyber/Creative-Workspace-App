import { useState } from 'react'
import { reportError } from '../store/projectStore'

export function FolderMatchDialog({
  matches,
  onClose,
  onApplied
}: {
  matches: { versionId: string; filePath: string; fileName: string }[]
  onClose: () => void
  onApplied: () => void
}) {
  const [busy, setBusy] = useState(false)
  const confirm = async () => {
    setBusy(true)
    try {
      await window.api.invoke('collections:applyFolderMatch', matches)
      onApplied()
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
        aria-label="Match folder"
        className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl bg-surface p-4 shadow-xl"
      >
        <h2 className="text-sm font-medium">Match folder</h2>
        <p className="mt-1 text-xs text-muted">
          Matching uses the file name of each version. Nothing changes until you confirm.
        </p>
        {matches.length === 0 ? (
          <p className="mt-3 text-sm">No file in that folder matches a version name.</p>
        ) : (
          <ul className="mt-3 min-h-0 flex-1 space-y-1 overflow-auto text-xs">
            {matches.map((match) => (
              <li key={match.versionId} className="truncate">
                {match.fileName}
              </li>
            ))}
          </ul>
        )}
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
            disabled={busy || matches.length === 0}
            className="rounded bg-accent px-3 py-1 text-sm text-white disabled:opacity-40"
            onClick={() => void confirm()}
          >
            Confirm match
          </button>
        </div>
      </div>
    </div>
  )
}
