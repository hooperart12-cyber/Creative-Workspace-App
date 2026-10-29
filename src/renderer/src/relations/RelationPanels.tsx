/** Properties and the board comment list. Neither opens just because something is selected. */
import { useState } from 'react'
import { parseComment } from '@shared/comments'
import { parseConnection, swapMarkers } from '@shared/connections'
import type { Destination } from '@shared/destinations'
import { visibleInView } from '@shared/comments'
import { useCanvasStore } from '../store/canvasStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import {
  createComment,
  replyToComment,
  saveComment,
  setBoardView,
  updateConnection
} from './relationActions'
import { navigateTo } from './navigate'
import { fitViewport, objectBounds } from '../canvas/geometry'

export function RelationPanels() {
  const showProperties = useCanvasStore((s) => s.showProperties)
  const showComments = useCanvasStore((s) => s.showComments)
  return (
    <>
      {showProperties && <PropertiesPanel />}
      {showComments && <CommentsPanel />}
      <CommentComposer />
    </>
  )
}

function PropertiesPanel() {
  const board = useWorkspaceStore((s) => s.board)
  const selection = useCanvasStore((s) => s.selection)
  const object = board?.objects.find((item) => selection.has(item.id) && selection.size === 1)
  const connection = object?.type === 'connection' ? parseConnection(object.data) : null
  return (
    <aside className="absolute top-3 right-3 z-20 w-72 rounded-xl border border-line bg-surface p-3 text-sm shadow-sm">
      <h2 className="font-medium">Properties</h2>
      {connection && object && (
        <div className="mt-2 space-y-2">
          <label className="block">
            Path
            <select
              className="mt-1 w-full rounded border border-line bg-canvas px-2 py-1"
              value={connection.path}
              onChange={(event) =>
                void updateConnection(
                  object,
                  { ...connection, path: event.target.value as typeof connection.path },
                  'Path style'
                )
              }
            >
              <option value="straight">Straight</option>
              <option value="curved">Curved</option>
              <option value="elbow">Elbow</option>
            </select>
          </label>
          <label className="block">
            Color
            <input
              aria-label="Stroke color"
              className="mt-1 w-full"
              type="color"
              value={connection.style.color}
              onChange={(event) =>
                void updateConnection(
                  object,
                  { ...connection, style: { ...connection.style, color: event.target.value } },
                  'Connection color'
                )
              }
            />
          </label>
          <label className="block">
            Width
            <input
              aria-label="Stroke width"
              className="mt-1 w-full"
              type="number"
              min={1}
              max={12}
              value={connection.style.width}
              onChange={(event) =>
                void updateConnection(
                  object,
                  {
                    ...connection,
                    style: { ...connection.style, width: Number(event.target.value) }
                  },
                  'Connection width'
                )
              }
            />
          </label>
          <button
            className="rounded border border-line px-2 py-1"
            onClick={() => void updateConnection(object, swapMarkers(connection), 'Swap markers')}
          >
            Swap markers
          </button>
          {connection.path === 'elbow' && (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={connection.routing === 'avoid'}
                onChange={(event) =>
                  void updateConnection(
                    object,
                    { ...connection, routing: event.target.checked ? 'avoid' : 'manual' },
                    'Routing'
                  )
                }
              />
              Avoid objects
            </label>
          )}
        </div>
      )}
      {board && (
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          <label className="block">
            Connections
            <select
              aria-label="Connection display"
              className="mt-1 w-full rounded border border-line bg-canvas px-2 py-1"
              value={board.connectionDisplay}
              onChange={(event) => void setBoardView({ connectionDisplay: event.target.value })}
            >
              <option value="full">Full detail</option>
              <option value="adaptive">Adaptive</option>
              <option value="minimal">Minimal</option>
              <option value="hidden">Hide connections</option>
            </select>
          </label>
          <label className="block">
            Crossings
            <select
              aria-label="Crossing style"
              className="mt-1 w-full rounded border border-line bg-canvas px-2 py-1"
              value={board.crossingStyle}
              onChange={(event) => void setBoardView({ crossingStyle: event.target.value })}
            >
              <option value="plain">Plain</option>
              <option value="bridge">Bridge</option>
              <option value="gap">Gap</option>
            </select>
          </label>
        </div>
      )}
    </aside>
  )
}

function CommentsPanel() {
  const board = useWorkspaceStore((s) => s.board)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'new' | 'old' | 'updated'>('new')
  const view = board?.commentView ?? 'open'
  const comments = (board?.objects ?? [])
    .filter((object) => object.type === 'comment')
    .filter((object) => {
      const data = parseComment(object.data)
      if (!data) return false
      if (
        query &&
        !(object.messages ?? []).some((message) =>
          message.body.toLowerCase().includes(query.toLowerCase())
        )
      )
        return false
      return (
        visibleInView(data.status, view === 'hidden' ? 'all' : view, false) || view === 'hidden'
      )
    })
    .sort((a, b) => {
      const stamp = (object: typeof a) => {
        const messages = object.messages ?? []
        if (sort === 'updated') {
          return messages.reduce(
            (latest, message) => Math.max(latest, message.editedAt ?? message.createdAt),
            0
          )
        }
        return messages[0]?.createdAt ?? 0
      }
      const delta = stamp(a) - stamp(b)
      return sort === 'old' ? delta : -delta
    })
  return (
    <aside
      aria-label="Comments"
      className="absolute right-3 bottom-3 z-20 flex max-h-[70%] w-80 flex-col rounded-xl border border-line bg-surface p-3 shadow-sm"
    >
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Comments</h2>
        <select
          aria-label="Comment filter"
          value={view}
          onChange={(event) => void setBoardView({ commentView: event.target.value })}
        >
          <option value="open">Open</option>
          <option value="all">All</option>
          <option value="resolved">Resolved</option>
          <option value="hidden">Hidden</option>
        </select>
      </div>
      <input
        aria-label="Search comments"
        className="mt-2 rounded border border-line bg-canvas px-2 py-1"
        placeholder="Search comments"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <select
        aria-label="Comment sort"
        className="mt-2"
        value={sort}
        onChange={(event) => setSort(event.target.value as typeof sort)}
      >
        <option value="new">Newest</option>
        <option value="old">Oldest</option>
        <option value="updated">Recently updated</option>
      </select>
      <ul className="mt-2 space-y-2 overflow-auto">
        {comments.map((object) => {
          const data = parseComment(object.data)
          const message = object.messages?.[0]
          return (
            <li key={object.id} className="rounded border border-line p-2">
              <button
                className="text-left"
                onClick={() => {
                  const canvas = useCanvasStore.getState()
                  canvas.setSelection([object.id])
                  canvas.setViewport(fitViewport(objectBounds(object), canvas.viewSize))
                  if (data?.anchor.slideId)
                    canvas.setStackPreview({
                      objectId: data.anchor.targetId ?? object.id,
                      slideId: data.anchor.slideId
                    })
                }}
              >
                <span className="block">{message?.body ?? 'Comment'}</span>
                <span className="text-xs text-muted">
                  {(object.messages?.length ?? 1) - 1} replies · {data?.status}
                </span>
              </button>
              <ReplyBox objectId={object.id} />
            </li>
          )
        })}
      </ul>
    </aside>
  )
}

function ReplyBox({ objectId }: { objectId: string }) {
  const [text, setText] = useState('')
  const object = useWorkspaceStore((s) => s.board?.objects.find((item) => item.id === objectId))
  if (!object) return null
  return (
    <form
      className="mt-2 flex gap-1"
      onSubmit={(event) => {
        event.preventDefault()
        if (!text.trim()) return
        void replyToComment(object, text).then(() => setText(''))
      }}
    >
      <input
        aria-label="Reply"
        className="min-w-0 flex-1 rounded border border-line px-2 py-1"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <button className="rounded border border-line px-2">Reply</button>
    </form>
  )
}

function CommentComposer() {
  const draft = useCanvasStore((s) => s.commentDraft)
  const target = useWorkspaceStore((s) =>
    draft?.targetId ? s.board?.objects.find((object) => object.id === draft.targetId) : null
  )
  const [text, setText] = useState('')
  if (!draft) return null
  const cancel = () => {
    if (text.trim() && !window.confirm('Discard this comment?')) return
    useCanvasStore.getState().setCommentDraft(null)
    setText('')
  }
  return (
    <form
      aria-label="New comment"
      className="absolute bottom-16 left-1/2 z-20 w-80 -translate-x-1/2 rounded-xl border border-line bg-surface p-3 shadow-sm"
      onSubmit={(event) => {
        event.preventDefault()
        void createComment(text).then(() => setText(''))
      }}
    >
      {target?.type === 'stack' && (
        <label className="mb-2 block text-xs">
          Comment on
          <select
            aria-label="Comment scope"
            className="mt-1 w-full rounded border border-line bg-canvas px-2 py-1"
            value={draft.scope === 'stack' ? 'stack' : 'slide'}
            onChange={(event) =>
              useCanvasStore.getState().setCommentDraft({
                ...draft,
                scope: event.target.value === 'stack' ? 'stack' : 'slide',
                slideId:
                  event.target.value === 'stack'
                    ? null
                    : (typeof target.data.displayedSlideId === 'string' &&
                        target.data.displayedSlideId) ||
                      target.slides?.[0]?.id ||
                      null
              })
            }
          >
            <option value="slide">This slide</option>
            <option value="stack">The whole stack</option>
          </select>
        </label>
      )}
      <textarea
        autoFocus
        aria-label="Comment"
        className="h-20 w-full rounded border border-line bg-canvas p-2"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault()
            void createComment(text).then(() => setText(''))
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            cancel()
          }
        }}
      />
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" onClick={cancel}>
          Cancel
        </button>
        <button className="rounded bg-ink px-2 py-1 text-surface">Post</button>
      </div>
    </form>
  )
}

export function destinationLabel(destination: Destination | null): string {
  if (!destination) return 'Destination missing'
  return destination.title || destination.kind
}

export { navigateTo, saveComment }
