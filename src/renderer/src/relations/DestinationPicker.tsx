/** Shared chooser for link cards, attached links, and connection labels. */
import { useEffect, useState } from 'react'
import { parseConnection } from '@shared/connections'
import { normalizePublicUrl, type Destination } from '@shared/destinations'
import type { SearchHit } from '@shared/types'
import { useCanvasStore } from '../store/canvasStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import {
  applyNoteDestination,
  attachObjectLink,
  createLink,
  updateConnection,
  updateLinkCard
} from './relationActions'

function destinationFromHit(hit: SearchHit): Destination | null {
  const boardId = hit.boardId
  if (!boardId) return null
  if (hit.kind === 'board') return { kind: 'board', boardId, title: hit.title }
  if (hit.kind === 'pdf-page' && hit.objectId && hit.page)
    return { kind: 'pdf', boardId, objectId: hit.objectId, page: hit.page, title: hit.title }
  if (hit.kind === 'slide' && hit.slideId && (hit.stackId || hit.objectId))
    return {
      kind: 'slide',
      boardId,
      objectId: hit.stackId || hit.objectId || '',
      slideId: hit.slideId,
      title: hit.title
    }
  if (hit.kind === 'stack' && (hit.stackId || hit.objectId))
    return { kind: 'stack', boardId, objectId: hit.stackId || hit.objectId || '', title: hit.title }
  if (hit.objectId) return { kind: 'object', boardId, objectId: hit.objectId, title: hit.title }
  return null
}

export function DestinationPicker() {
  const open = useCanvasStore((s) => s.destinationPicker)
  const [text, setText] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    const handle = window.setTimeout(() => {
      void window.api
        .invoke('search:query', { text, limit: 20 })
        .then((page) => setHits(page.hits))
        .catch(() => setHits([]))
    }, 200)
    return () => window.clearTimeout(handle)
  }, [open, text])

  if (!open) return null

  const close = () => useCanvasStore.getState().setDestinationPicker(false)

  const place = (destination: Destination) => {
    const canvas = useCanvasStore.getState()
    const target = canvas.linkTarget
    const objects = useWorkspaceStore.getState().board?.objects ?? []
    close()
    if (target?.kind === 'note') {
      applyNoteDestination(destination)
      return
    }
    if (target?.kind === 'object') {
      const object = objects.find((item) => item.id === target.id)
      if (object) void attachObjectLink(object, destination)
      return
    }
    if (target?.kind === 'label') {
      const object = objects.find((item) => item.id === target.id)
      const data = object ? parseConnection(object.data) : null
      if (object && data)
        void updateConnection(object, { ...data, labelLink: destination }, 'Label link')
      return
    }
    if (target?.kind === 'link') {
      const object = objects.find((item) => item.id === target.id)
      if (object) {
        void updateLinkCard(object, { ...object.data, destination }, 'Change destination')
      }
      return
    }
    const zoom = canvas.viewport.zoom || 1
    void createLink(
      {
        x: (canvas.viewSize.width / 2 - canvas.viewport.x) / zoom,
        y: (canvas.viewSize.height / 2 - canvas.viewport.y) / zoom
      },
      destination,
      ''
    )
  }

  return (
    <div
      role="dialog"
      aria-label="Choose destination"
      className="absolute top-16 left-1/2 z-30 w-96 -translate-x-1/2 rounded-xl border border-line bg-surface p-3 shadow-md"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          close()
        }
      }}
    >
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Choose destination</h2>
        <button type="button" onClick={close} aria-label="Close destination picker">
          Close
        </button>
      </div>
      <input
        autoFocus
        aria-label="Search destinations"
        className="mt-2 w-full rounded border border-line bg-canvas px-2 py-1"
        placeholder="Search boards, objects, pages, slides"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <ul className="mt-2 max-h-64 space-y-1 overflow-auto">
        {hits.map((hit) => {
          const destination = destinationFromHit(hit)
          if (!destination) return null
          return (
            <li key={`${hit.kind}-${hit.sourceId}-${hit.page ?? ''}-${hit.slideId ?? ''}`}>
              <button
                type="button"
                className="w-full rounded px-2 py-1 text-left hover:bg-canvas"
                onClick={() => place(destination)}
              >
                <span className="block">{hit.title || hit.kind}</span>
                <span className="text-xs text-muted">
                  {hit.kind}
                  {hit.location ? ` · ${hit.location}` : ''}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      <form
        className="mt-3 space-y-2 border-t border-line pt-3"
        onSubmit={(event) => {
          event.preventDefault()
          const href = normalizePublicUrl(url.trim())
          if (!href) {
            setError('Use an http or https address. Local and private addresses are blocked.')
            return
          }
          place({ kind: 'url', href })
        }}
      >
        <label className="block text-xs">
          Website
          <input
            aria-label="Website address"
            className="mt-1 w-full rounded border border-line bg-canvas px-2 py-1"
            value={url}
            placeholder="https://"
            onChange={(event) => {
              setUrl(event.target.value)
              setError('')
            }}
          />
        </label>
        {error && <p className="text-xs text-muted">{error}</p>}
        <div className="flex justify-between gap-2">
          <button
            type="button"
            className="rounded border border-line px-2 py-1"
            onClick={() => {
              const canvas = useCanvasStore.getState()
              const boardId = useWorkspaceStore.getState().board?.id
              if (!boardId) return
              place({
                kind: 'camera',
                boardId,
                x: canvas.viewport.x,
                y: canvas.viewport.y,
                zoom: canvas.viewport.zoom,
                title: 'Saved view'
              })
            }}
          >
            Save this view
          </button>
          <button className="rounded bg-ink px-2 py-1 text-surface" type="submit">
            Add website
          </button>
        </div>
      </form>
    </div>
  )
}
