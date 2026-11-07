import { useEffect, useState } from 'react'
import { preflightBulk, type BulkOperation, type BulkUndoEntry } from '@shared/collectionBulk'
import {
  PAGE_ROLES,
  PAGE_STATUSES,
  type CollectionDetail,
  type CollectionPageView,
  type PageStatus
} from '@shared/collections'
import { reportError } from '../store/projectStore'

export function BulkEditDialog({
  pages,
  stages,
  stageStates,
  selected,
  hidden,
  onClose,
  onApplied
}: {
  pages: CollectionPageView[]
  stages: CollectionDetail['stages']
  stageStates: CollectionDetail['stageStates']
  selected: string[]
  hidden: number
  onClose: () => void
  onApplied: (undo: BulkUndoEntry[]) => void
}) {
  const [kind, setKind] = useState<BulkOperation['kind']>('status')
  const [status, setStatus] = useState<(typeof PAGE_STATUSES)[number]>('done')
  const [role, setRole] = useState<(typeof PAGE_ROLES)[number]>('story')
  const [text, setText] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [tagId, setTagId] = useState('')
  const [tagChoices, setTagChoices] = useState<{ id: string; name: string }[]>([])
  const [ownedTags, setOwnedTags] = useState<{ pageId: string; tagId: string }[]>([])
  const [stageId, setStageId] = useState(stages[0]?.id ?? '')
  const [stageState, setStageState] = useState<PageStatus>('done')
  useEffect(() => {
    let cancel = false
    void Promise.all([
      window.api.invoke('tags:list'),
      window.api.invoke('collections:pageTags', selected)
    ])
      .then(([library, assigned]) => {
        if (cancel) return
        setTagChoices(library.map((tag) => ({ id: tag.id, name: tag.name })))
        setOwnedTags(assigned)
        setTagId((current) => current || library[0]?.id || '')
      })
      .catch((error) => reportError(error))
    return () => {
      cancel = true
    }
  }, [selected])
  const operation: BulkOperation =
    kind === 'status'
      ? { kind, status }
      : kind === 'role'
        ? { kind, role }
        : kind === 'add-tag' || kind === 'remove-tag'
          ? { kind, tagId }
          : kind === 'set-stage'
            ? { kind, stageId, state: stageState }
            : { kind, text }
  const preview = preflightBulk(
    pages.map((page) => ({
      id: page.id,
      notes: page.notes,
      overallStatus: page.overallStatus,
      role: page.role,
      tagIds: ownedTags.filter((tag) => tag.pageId === page.id).map((tag) => tag.tagId),
      stages: stageStates
        .filter((stage) => stage.pageId === page.id)
        .map((stage) => ({ stageId: stage.stageId, state: stage.state }))
    })),
    selected,
    operation
  )
  const apply = async () => {
    try {
      const result = await window.api.invoke(
        'collections:applyBulk',
        selected,
        operation,
        preview.dangerous ? confirmed : false
      )
      onApplied(result.undo)
    } catch (error) {
      reportError(error)
    }
  }
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-6">
      <form
        role="dialog"
        aria-label="Edit selected pages"
        className="w-full max-w-md rounded-xl bg-surface p-4 shadow-xl"
        onSubmit={(event) => {
          event.preventDefault()
          void apply()
        }}
      >
        <h2 className="text-sm font-medium">Edit selected pages</h2>
        <p className="mt-1 text-xs text-muted">
          {preview.targeted} selected
          {hidden > 0 ? `, ${hidden} hidden by the filter` : ''}. This writes{' '}
          {preview.fields.join(', ')} only.
        </p>
        <label className="mt-3 block text-xs text-muted">
          Change
          <select
            aria-label="Bulk change"
            className="mt-1 w-full rounded border border-line bg-canvas px-2 py-1 text-sm"
            value={kind}
            onChange={(event) => setKind(event.target.value as BulkOperation['kind'])}
          >
            <option value="status">Overall status</option>
            <option value="append-notes">Append to notes</option>
            <option value="replace-notes">Replace notes</option>
            <option value="role">Role</option>
            <option value="add-tag">Add tag</option>
            <option value="remove-tag">Remove tag</option>
            <option value="set-stage">Production stage</option>
          </select>
        </label>
        {kind === 'status' && (
          <select
            aria-label="Bulk status"
            className="mt-2 w-full rounded border border-line bg-canvas px-2 py-1 text-sm"
            value={status}
            onChange={(event) => setStatus(event.target.value as (typeof PAGE_STATUSES)[number])}
          >
            {PAGE_STATUSES.map((item) => (
              <option key={item} value={item}>
                {item.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        )}
        {kind === 'role' && (
          <select
            aria-label="Bulk role"
            className="mt-2 w-full rounded border border-line bg-canvas px-2 py-1 text-sm"
            value={role}
            onChange={(event) => setRole(event.target.value as (typeof PAGE_ROLES)[number])}
          >
            {PAGE_ROLES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        )}
        {(kind === 'add-tag' || kind === 'remove-tag') && (
          <select
            aria-label="Bulk tag"
            className="mt-2 w-full rounded border border-line bg-canvas px-2 py-1 text-sm"
            value={tagId}
            onChange={(event) => setTagId(event.target.value)}
          >
            {tagChoices.length === 0 && <option value="">No tags yet</option>}
            {tagChoices.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </select>
        )}
        {kind === 'set-stage' && (
          <div className="mt-2 flex gap-2">
            <select
              aria-label="Bulk stage"
              className="w-full rounded border border-line bg-canvas px-2 py-1 text-sm"
              value={stageId}
              onChange={(event) => setStageId(event.target.value)}
            >
              {stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Bulk stage status"
              className="w-full rounded border border-line bg-canvas px-2 py-1 text-sm"
              value={stageState}
              onChange={(event) => setStageState(event.target.value as PageStatus)}
            >
              {PAGE_STATUSES.map((item) => (
                <option key={item} value={item}>
                  {item.replaceAll('_', ' ')}
                </option>
              ))}
            </select>
          </div>
        )}
        {(kind === 'append-notes' || kind === 'replace-notes') && (
          <textarea
            aria-label="Bulk notes"
            className="mt-2 w-full rounded border border-line bg-canvas px-2 py-1 text-sm"
            rows={3}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        )}
        <ul className="mt-3 space-y-1 text-xs text-muted">
          <li>{preview.changed.length} will change</li>
          <li>{preview.alreadyMatching.length} already match</li>
          <li>{preview.incompatible.length} cannot change</li>
        </ul>
        {preview.dangerous && (
          <label className="mt-3 flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            Replace the existing notes on the pages that will change
          </label>
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
            type="submit"
            disabled={preview.changed.length === 0 || (preview.dangerous && !confirmed)}
            className="rounded bg-accent px-3 py-1 text-sm text-white disabled:opacity-40"
          >
            Apply
          </button>
        </div>
      </form>
    </div>
  )
}
