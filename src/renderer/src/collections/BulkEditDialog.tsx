import { useState } from 'react'
import { preflightBulk, type BulkOperation } from '@shared/collectionBulk'
import {
  PAGE_ROLES,
  PAGE_STATUSES,
  type CollectionPageView,
  type PagePatch
} from '@shared/collections'
import { reportError } from '../store/projectStore'

export function BulkEditDialog({
  pages,
  selected,
  hidden,
  onClose,
  onApplied
}: {
  pages: CollectionPageView[]
  selected: string[]
  hidden: number
  onClose: () => void
  onApplied: (undo: { id: string; revision: number; previous: PagePatch }[]) => void
}) {
  const [kind, setKind] = useState<BulkOperation['kind']>('status')
  const [status, setStatus] = useState<(typeof PAGE_STATUSES)[number]>('done')
  const [role, setRole] = useState<(typeof PAGE_ROLES)[number]>('story')
  const [text, setText] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const operation: BulkOperation =
    kind === 'status' ? { kind, status } : kind === 'role' ? { kind, role } : { kind, text }
  const preview = preflightBulk(
    pages.map((page) => ({
      id: page.id,
      notes: page.notes,
      overallStatus: page.overallStatus,
      role: page.role
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
