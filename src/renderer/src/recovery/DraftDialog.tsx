import { useEffect, useState } from 'react'
import { NOTE_SCHEMA_VERSION, type NoteContent } from '@shared/notes'
import type { NoteDraftInfo } from '@shared/types'
import { useProjectStore } from '../store/projectStore'
import { useWorkspaceStore } from '../store/workspaceStore'

export function DraftDialog() {
  const projectPath = useProjectStore((s) => s.project?.path)
  const [drafts, setDrafts] = useState<NoteDraftInfo[]>([])
  useEffect(() => {
    if (!projectPath) return
    void window.api
      .invoke('recovery:list')
      .then(setDrafts)
      .catch(() => {})
  }, [projectPath])
  const current = drafts[0]
  if (!current) return null
  const content = JSON.parse(current.contentJson) as NoteContent
  const dismiss = () => setDrafts((items) => items.slice(1))
  const clear = async () => {
    await window.api.invoke('recovery:clearDraft', current.objectId)
    dismiss()
  }
  return (
    <div
      role="dialog"
      aria-label="Recover unsaved note"
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/20"
    >
      <div className="w-[28rem] rounded-xl border border-line bg-surface p-5 shadow-lg">
        <h2 className="text-base font-medium">
          {current.assessment === 'conflict'
            ? 'A newer version of this note was saved'
            : current.assessment === 'missing'
              ? 'This note is no longer on the board'
              : 'An unsaved note was recovered'}
        </h2>
        <p className="mt-2 line-clamp-4 text-sm text-muted">{current.plainText || 'Empty note'}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {current.assessment === 'restore' && (
            <button
              className="rounded-lg border border-line px-3 py-1.5 text-sm"
              onClick={() =>
                void window.api
                  .invoke('notes:saveContent', {
                    id: current.objectId,
                    baseRevision: current.baseRevision,
                    content
                  })
                  .then(async (result) => {
                    if (result.ok) await clear()
                    else
                      setDrafts((items) => [
                        { ...items[0], assessment: 'conflict' },
                        ...items.slice(1)
                      ])
                  })
              }
            >
              Restore this draft
            </button>
          )}
          <button
            className="rounded-lg border border-line px-3 py-1.5 text-sm"
            onClick={() => {
              const boardId = current.boardId ?? useWorkspaceStore.getState().tree?.mainBoardId
              if (!boardId) return
              void window.api
                .invoke('notes:create', {
                  boardId,
                  at: { x: 80, y: 80 },
                  content: { schemaVersion: NOTE_SCHEMA_VERSION, doc: content.doc }
                })
                .then(() => clear())
            }}
          >
            Recover as a copy
          </button>
          <button
            className="rounded-lg border border-line px-3 py-1.5 text-sm"
            onClick={() => void clear()}
          >
            Keep the saved note
          </button>
        </div>
      </div>
    </div>
  )
}
