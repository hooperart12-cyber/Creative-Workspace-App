import { useState } from 'react'
import {
  planCollectionExport,
  type ExportFormat,
  type ExportSpread
} from '@shared/collectionExport'
import type { CollectionPageView } from '@shared/collections'
import { reportError, showNotice } from '../store/projectStore'
import { useWorkspaceStore } from '../store/workspaceStore'

export function ExportDialog({
  collectionId,
  pages,
  onClose
}: {
  collectionId: string
  pages: CollectionPageView[]
  onClose: () => void
}) {
  const [format, setFormat] = useState<ExportFormat | 'package'>('pdf')
  const [spread, setSpread] = useState<ExportSpread>('page')
  const [omitUnavailable, setOmitUnavailable] = useState(false)
  const [includeComments, setIncludeComments] = useState(false)
  const [busy, setBusy] = useState(false)
  const plan = planCollectionExport(pages, {
    format: format === 'package' ? 'png' : format,
    spread,
    omitUnavailable: format === 'package' ? false : omitUnavailable
  })
  const exportFiles = async () => {
    setBusy(true)
    try {
      if (format === 'package') {
        const destination = await window.api.invoke('dialog:pickSaveCollection', 'zip')
        if (!destination) return
        await window.api.invoke(
          'collections:exportPackage',
          collectionId,
          destination,
          includeComments
        )
        showNotice(
          plan.warnings.length
            ? `Package saved. ${plan.warnings.length} pages have no artwork.`
            : 'Package saved.'
        )
      } else if (format === 'pdf') {
        const destination = await window.api.invoke('dialog:pickSaveCollection', 'pdf')
        if (!destination) return
        const result = await window.api.invoke(
          'collections:exportSequence',
          collectionId,
          destination,
          format,
          spread,
          omitUnavailable
        )
        showNotice(summary(result.files.length, result.warnings.length))
      } else {
        const destination = await window.api.invoke('dialog:pickFolder')
        if (!destination) return
        const result = await window.api.invoke(
          'collections:exportSequence',
          collectionId,
          destination,
          format,
          spread,
          omitUnavailable
        )
        showNotice(summary(result.files.length, result.warnings.length))
      }
      onClose()
    } catch (error) {
      reportError(error)
    } finally {
      setBusy(false)
    }
  }
  const importPackage = async () => {
    setBusy(true)
    try {
      const path = await window.api.invoke('dialog:pickCollectionPackage')
      if (!path) return
      const imported = await window.api.invoke('collections:importPackage', path)
      const extra = imported.unresolved.slice(0, 3).join(' ')
      showNotice(extra ? `Imported a new collection. ${extra}` : 'Imported a new collection.')
      useWorkspaceStore.getState().openPlanner(imported.collectionId, null)
      onClose()
    } catch (error) {
      reportError(error)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-6">
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl bg-surface p-4 shadow-xl">
        <h2 className="text-sm font-medium">Export</h2>
        <p className="mt-1 text-xs text-muted">
          Original artwork is not changed. A package import creates a new collection.
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {(['pdf', 'png', 'jpeg', 'webp', 'package'] as const).map((item) => (
            <button
              key={item}
              type="button"
              className={choice}
              aria-pressed={format === item}
              onClick={() => setFormat(item)}
            >
              {item === 'package' ? 'Package' : item.toUpperCase()}
            </button>
          ))}
        </div>
        {format !== 'package' && (
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <button
              type="button"
              className={choice}
              aria-pressed={spread === 'page'}
              onClick={() => setSpread('page')}
            >
              One file per page
            </button>
            <button
              type="button"
              className={choice}
              aria-pressed={spread === 'spread'}
              onClick={() => setSpread('spread')}
            >
              One file per spread
            </button>
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={omitUnavailable}
                onChange={(event) => setOmitUnavailable(event.target.checked)}
              />
              Omit pages without artwork
            </label>
          </div>
        )}
        {format === 'package' && (
          <label className="mt-3 flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={includeComments}
              onChange={(event) => setIncludeComments(event.target.checked)}
            />
            Include comments
          </label>
        )}
        <ul className="mt-3 min-h-0 flex-1 space-y-1 overflow-auto text-xs">
          {plan.warnings.length === 0 && <li className="text-muted">No missing artwork.</li>}
          {plan.warnings.map((warning) => (
            <li key={warning.pageId}>
              {pages.find((page) => page.id === warning.pageId)?.title || 'Page'}: {warning.message}
            </li>
          ))}
        </ul>
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            className={choice}
            onClick={() => void importPackage()}
            disabled={busy}
          >
            Import package
          </button>
          <button type="button" className={choice} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={choice}
            onClick={() => void exportFiles()}
            disabled={busy}
          >
            Export
          </button>
        </div>
      </div>
    </div>
  )
}

function summary(files: number, warnings: number): string {
  if (files === 0) return 'Nothing was written. Every selected page has no artwork.'
  return warnings ? `Exported ${files} files. ${warnings} warnings.` : `Exported ${files} files.`
}

const choice = 'rounded border border-line px-2 py-1 text-xs disabled:opacity-40'
