import { useEffect, useState } from 'react'
import { assetUrl } from '@shared/assets'
import { cropInset, zoomAt } from '@shared/reader'
import { reportError, useProjectStore } from '../store/projectStore'
import { useWorkspaceStore } from '../store/workspaceStore'

type Version = {
  id: string
  name: string
  fileName: string
  sha256: string | null
  width: number | null
  height: number | null
  missing: boolean
  crop: { x: number; y: number; w: number; h: number } | null
}

type Camera = { zoom: number; x: number; y: number }

export function ReviewView() {
  const collectionId = useWorkspaceStore((s) => s.reviewCollectionId)
  const pageId = useWorkspaceStore((s) => s.reviewPageId)
  const projectId = useProjectStore((s) => s.project?.id)
  const openPlanner = useWorkspaceStore((s) => s.openPlanner)
  const openReader = useWorkspaceStore((s) => s.openReader)
  const [versions, setVersions] = useState<Version[]>([])
  const [revision, setRevision] = useState(0)
  const [left, setLeft] = useState<string | null>(null)
  const [right, setRight] = useState<string | null>(null)
  const [mode, setMode] = useState<'single' | 'side' | 'ab'>('single')
  const [show, setShow] = useState<'left' | 'right'>('left')
  const [sync, setSync] = useState(true)
  const [leftCamera, setLeftCamera] = useState<Camera>({ zoom: 1, x: 0, y: 0 })
  const [rightCamera, setRightCamera] = useState<Camera>({ zoom: 1, x: 0, y: 0 })
  const [comments, setComments] = useState<{ id: string; body: string }[] | null>(null)

  useEffect(() => {
    if (!pageId) return
    let cancel = false
    void window.api.invoke('collections:versions', pageId).then((rows) => {
      if (cancel) return
      setVersions(rows)
      setLeft((current) => current ?? rows[0]?.id ?? null)
      setRight((current) => current ?? rows[1]?.id ?? rows[0]?.id ?? null)
    })
    if (collectionId) {
      void window.api.invoke('collections:detail', collectionId).then((doc) => {
        const page = doc.pages.find((item) => item.id === pageId)
        if (!cancel && page) setRevision(page.revision)
      })
    }
    return () => {
      cancel = true
    }
  }, [pageId, collectionId])

  const zoom = (side: 'left' | 'right', factor: number) => {
    const apply = (camera: Camera) => zoomAt(camera, factor, 0, 0, 0, 0)
    if (sync || mode === 'ab') {
      setLeftCamera(apply)
      setRightCamera(apply)
      return
    }
    if (side === 'left') setLeftCamera(apply)
    else setRightCamera(apply)
  }

  const displayed = async (versionId: string) => {
    if (!pageId) return
    try {
      const saved = await window.api.invoke('collections:setDisplayed', pageId, versionId, revision)
      setRevision(saved.revision)
    } catch (error) {
      reportError(error)
    }
  }

  if (!collectionId || !pageId) return null
  const leftVersion = versions.find((version) => version.id === left) ?? null
  const rightVersion = versions.find((version) => version.id === right) ?? null
  const shown = mode === 'ab' ? (show === 'left' ? leftVersion : rightVersion) : leftVersion

  return (
    <div id="artwork-review" className="flex min-h-0 flex-1 flex-col bg-neutral-950 text-white">
      <header className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2 text-xs">
        <button type="button" className={chip} onClick={() => openReader(collectionId, pageId)}>
          Reader
        </button>
        <button type="button" className={chip} onClick={() => openPlanner(collectionId, pageId)}>
          Planner
        </button>
        <span className="flex-1">Artwork review</span>
        {(['single', 'side', 'ab'] as const).map((item) => (
          <button
            key={item}
            type="button"
            className={chip}
            aria-pressed={mode === item}
            onClick={() => setMode(item)}
          >
            {item === 'single' ? 'Single' : item === 'side' ? 'Side by side' : 'A/B'}
          </button>
        ))}
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={sync}
            onChange={(event) => setSync(event.target.checked)}
          />
          Sync
        </label>
        <button
          type="button"
          className={chip}
          onClick={() => setComments((current) => (current ? null : []))}
        >
          Comments
        </button>
      </header>
      <div className={`grid min-h-0 flex-1 ${mode === 'side' ? 'grid-cols-2' : 'grid-cols-1'}`}>
        <Pane
          version={shown}
          projectId={projectId}
          camera={mode === 'ab' && show === 'right' ? rightCamera : leftCamera}
          versions={versions}
          onPick={(id) => {
            if (mode === 'ab' && show === 'right') setRight(id)
            else setLeft(id)
          }}
          onZoom={(factor) => zoom('left', factor)}
          onDisplay={() => shown && void displayed(shown.id)}
        />
        {mode === 'side' && (
          <Pane
            version={rightVersion}
            projectId={projectId}
            camera={rightCamera}
            versions={versions}
            onPick={setRight}
            onZoom={(factor) => zoom('right', factor)}
            onDisplay={() => rightVersion && void displayed(rightVersion.id)}
          />
        )}
      </div>
      {mode === 'ab' && (
        <div className="flex justify-center gap-2 py-2 text-xs">
          <button
            type="button"
            className={chip}
            aria-pressed={show === 'left'}
            onClick={() => setShow('left')}
          >
            A
          </button>
          <button
            type="button"
            className={chip}
            aria-pressed={show === 'right'}
            onClick={() => setShow('right')}
          >
            B
          </button>
        </div>
      )}
      {comments && <CommentList pageId={pageId} />}
    </div>
  )
}

function Pane({
  version,
  projectId,
  camera,
  versions,
  onPick,
  onZoom,
  onDisplay
}: {
  version: Version | null
  projectId: string | undefined
  camera: Camera
  versions: Version[]
  onPick: (id: string) => void
  onZoom: (factor: number) => void
  onDisplay: () => void
}) {
  const clip = version ? cropInset(version.crop, version.width, version.height) : null
  return (
    <div className="flex min-h-0 flex-col border-white/10">
      <div className="flex items-center gap-2 p-2 text-xs">
        <select
          aria-label="Artwork version"
          value={version?.id ?? ''}
          onChange={(event) => onPick(event.target.value)}
          className="rounded bg-white/10 px-1 py-1"
        >
          {versions.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name || item.fileName || 'Version'}
              {item.missing ? ' (missing)' : ''}
            </option>
          ))}
        </select>
        <button type="button" className={chip} onClick={() => onZoom(1.1)}>
          Zoom in
        </button>
        <button type="button" className={chip} onClick={() => onZoom(0.9)}>
          Zoom out
        </button>
        <button type="button" className={chip} onClick={onDisplay} disabled={!version}>
          Set as displayed
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        {version?.sha256 && projectId && !version.missing ? (
          <img
            alt={version.name || 'Artwork'}
            src={assetUrl(projectId, version.sha256, 'original')}
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
              transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
              clipPath: clip ?? undefined
            }}
          />
        ) : (
          <p className="text-sm text-white/70">{version ? 'Missing artwork' : 'No version'}</p>
        )}
      </div>
    </div>
  )
}

function CommentList({ pageId }: { pageId: string }) {
  const [items, setItems] = useState<{ id: string; body: string }[]>([])
  useEffect(() => {
    let cancel = false
    void window.api.invoke('collections:comments', pageId).then((rows) => {
      if (!cancel) setItems(rows)
    })
    return () => {
      cancel = true
    }
  }, [pageId])
  return (
    <ul className="max-h-28 overflow-auto border-t border-white/10 px-3 py-2 text-xs">
      {items.length === 0 && <li>No comments</li>}
      {items.map((item) => (
        <li key={item.id}>{item.body}</li>
      ))}
    </ul>
  )
}

const chip = 'rounded border border-white/30 px-2 py-1 hover:bg-white/10 disabled:opacity-40'
