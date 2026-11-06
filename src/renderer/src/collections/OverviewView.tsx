import { useEffect, useState } from 'react'
import { assetUrl } from '@shared/assets'
import { collectionCounts, stageProgress, type CollectionDetail } from '@shared/collections'
import { reportError, useProjectStore } from '../store/projectStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import { ExportDialog } from './ExportDialog'

const button = 'rounded-lg border border-line bg-surface px-2 py-1 text-xs hover:bg-canvas'

/** Optional collection summary. Opening a collection still goes to the Planner. */
export function OverviewView() {
  const collectionId = useWorkspaceStore((s) => s.overviewCollectionId)
  const projectId = useProjectStore((s) => s.project?.id ?? null)
  const [detail, setDetail] = useState<CollectionDetail | null>(null)
  const [folderName, setFolderName] = useState('Collections')
  const [nav, setNav] = useState<
    { id: string; pageId: string; kind: string; title: string; available: boolean }[]
  >([])
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    if (!collectionId) return
    let cancel = false
    void Promise.all([
      window.api.invoke('collections:detail', collectionId),
      window.api.invoke('collections:outline'),
      window.api.invoke('collections:nav', collectionId)
    ])
      .then(([next, outline, items]) => {
        if (cancel) return
        setDetail(next)
        setNav(items)
        const folder = outline.folders.find((item) => item.id === next.folderId)
        setFolderName(folder?.name ?? 'Collections')
      })
      .catch((error) => reportError(error))
    return () => {
      cancel = true
    }
  }, [collectionId])

  if (!detail) {
    return (
      <div id="collection-overview" className="flex flex-1 items-center justify-center text-sm">
        Loading overview
      </div>
    )
  }
  const counts = collectionCounts(
    detail.pages.map((page) => ({ span: page.span, hasArtwork: page.artwork === 'ready' }))
  )
  const stages = stageProgress(detail.stages, detail.stageStates, detail.pages.length)
  const cover = detail.pages.find((page) => page.role === 'cover' && page.sha256)
  const openPlanner = () => useWorkspaceStore.getState().openPlanner(detail.id, null)
  const openReader = () => useWorkspaceStore.getState().openReader(detail.id, null)
  const first = detail.pages[0]
  return (
    <div id="collection-overview" className="min-h-0 flex-1 overflow-y-auto bg-canvas p-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <header className="flex gap-4">
          <div className="flex h-40 w-28 items-center justify-center overflow-hidden rounded-lg border border-line bg-surface">
            {projectId && cover?.sha256 ? (
              <img
                src={assetUrl(projectId, cover.sha256, 256)}
                alt=""
                className="h-full w-full object-contain"
              />
            ) : (
              <span className="px-2 text-center text-xs text-muted">No cover</span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted">{folderName}</p>
            <h1 className="truncate text-xl font-medium">{detail.title}</h1>
            {detail.description && <p className="mt-1 text-sm">{detail.description}</p>}
            <p className="mt-2 text-xs text-muted">
              Updated {new Date(detail.updatedAt).toLocaleString()}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className={button} onClick={openPlanner}>
                Planner
              </button>
              <button type="button" className={button} onClick={openReader}>
                Reader
              </button>
              <button
                type="button"
                className={button}
                disabled={!first}
                onClick={() =>
                  first && useWorkspaceStore.getState().openReview(detail.id, first.id)
                }
              >
                Artwork review
              </button>
              <button type="button" className={button} onClick={openPlanner}>
                Search
              </button>
              <button type="button" className={button} onClick={openPlanner}>
                Settings
              </button>
              <button type="button" className={button} onClick={() => setExporting(true)}>
                Export
              </button>
            </div>
          </div>
        </header>
        <section className="rounded-lg border border-line bg-surface p-3">
          <h2 className="text-sm font-medium">Pages</h2>
          <p className="mt-1 text-sm">
            {counts.entries} entries · {counts.readingPositions} reading positions ·{' '}
            {counts.withArtwork} with artwork · {counts.placeholders} placeholders
          </p>
        </section>
        <details open className="rounded-lg border border-line bg-surface p-3">
          <summary className="cursor-pointer text-sm font-medium">Production</summary>
          <ul className="mt-2 space-y-1 text-sm">
            {stages.length === 0 && <li className="text-muted">No production stages.</li>}
            {stages.map((stage) => (
              <li key={stage.name}>
                {stage.name}: {stage.done} of {stage.total} done
              </li>
            ))}
          </ul>
        </details>
        <details open className="rounded-lg border border-line bg-surface p-3">
          <summary className="cursor-pointer text-sm font-medium">Contents and bookmarks</summary>
          <ul className="mt-2 space-y-1 text-sm">
            {nav.length === 0 && <li className="text-muted">No contents or bookmarks yet.</li>}
            {nav.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="text-left hover:underline"
                  disabled={!item.available}
                  onClick={() => useWorkspaceStore.getState().openReader(detail.id, item.pageId)}
                >
                  {item.kind === 'bookmark' ? 'Bookmark' : 'Contents'}: {item.title}
                  {item.available ? '' : ' (unavailable)'}
                </button>
              </li>
            ))}
          </ul>
        </details>
      </div>
      {exporting && (
        <ExportDialog
          collectionId={detail.id}
          pages={detail.pages}
          onClose={() => setExporting(false)}
        />
      )}
    </div>
  )
}
