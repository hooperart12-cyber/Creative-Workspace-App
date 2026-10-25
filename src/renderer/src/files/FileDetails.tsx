import { fileAppearance, formatBytes, isDangerousExtension } from '@shared/files'
import type { CanvasObject } from '@shared/types'
import { saveOriginal } from '../canvas/actions'
import { useCanvasStore } from '../store/canvasStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import { attachPreview, openWorkingCopy, setFileAppearance, setFilePreview } from './fileActions'

/** Details for a generic file card: appearance, preview, save, and opening a copy. */
export function FileDetails() {
  const id = useCanvasStore((s) => s.fileDetailsId)
  const setFileDetailsId = useCanvasStore((s) => s.setFileDetailsId)
  const object = useWorkspaceStore((s) => s.board?.objects.find((o) => o.id === id))
  if (!id || !object?.asset || object.type !== 'file') return null
  return <Panel object={object} onClose={() => setFileDetailsId(null)} />
}

function Panel({ object, onClose }: { object: CanvasObject; onClose: () => void }) {
  const asset = object.asset!
  const appearance = fileAppearance(object.data)
  const dangerous = isDangerousExtension(asset.ext)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="File details"
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/20"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onClose()
        }
      }}
    >
      <div className="w-[28rem] max-w-[calc(100%-2rem)] rounded-xl border border-line bg-surface p-5 shadow-lg">
        <h2 className="truncate text-base font-medium">{asset.originalName}</h2>
        <p className="mt-1 text-sm text-muted">
          {asset.ext.toUpperCase()} · {formatBytes(asset.bytes)}
        </p>
        <p className="mt-3 text-sm text-muted">
          The original is stored with the project and is never changed. Opening a copy uses a
          separate file — edits in another app do not come back.
        </p>

        <fieldset className="mt-4">
          <legend className="text-sm font-medium">Appearance</legend>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className={choice}
              aria-pressed={appearance === 'compact'}
              onClick={() => void setFileAppearance(object, 'compact')}
            >
              Compact
            </button>
            <button
              type="button"
              className={choice}
              aria-pressed={appearance === 'preview'}
              onClick={() => void setFileAppearance(object, 'preview')}
            >
              Preview
            </button>
          </div>
        </fieldset>

        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className={choice} onClick={() => void attachPreview(object)}>
            {asset.preview ? 'Change preview' : 'Attach preview'}
          </button>
          {asset.preview && (
            <button
              type="button"
              className={choice}
              onClick={() => void setFilePreview(asset.id, null, asset.previewAssetId)}
            >
              Remove preview
            </button>
          )}
          <button type="button" className={choice} onClick={() => void saveOriginal(object)}>
            Save original as
          </button>
          <button
            type="button"
            className={choice}
            disabled={dangerous}
            title={dangerous ? 'This file type can’t be opened from the app' : undefined}
            onClick={() => void openWorkingCopy(object)}
          >
            Open a copy
          </button>
        </div>
        {dangerous && (
          <p className="mt-2 text-sm text-muted">
            Programs and scripts stay in the project. They are never launched.
          </p>
        )}

        <div className="mt-5 flex justify-end">
          <button type="button" className={choice} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

const choice =
  'rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-canvas disabled:opacity-40'
