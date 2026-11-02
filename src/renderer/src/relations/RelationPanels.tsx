/** Properties and the board comment list. Neither opens just because something is selected. */
import { useState } from 'react'
import { parseComment } from '@shared/comments'
import { connectionPoints, labelPosition, parseConnection, swapMarkers } from '@shared/connections'
import { parseDestination, type Destination } from '@shared/destinations'
import { visibleInView } from '@shared/comments'
import { useCanvasStore } from '../store/canvasStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import {
  copyConnectionStyle,
  createComment,
  pasteConnectionStyle,
  replyToComment,
  saveComment,
  setBoardView,
  updateConnection,
  updateLinkCard,
  attachObjectLink,
  createLink
} from './relationActions'
import { IntegrityPanel } from './IntegrityPanel'
import { navigateTo } from './navigate'
import { fitViewport, objectBounds, worldToScreen } from '../canvas/geometry'
import { exportPackage, exportPicture, importPackage } from '../canvas/exportBoard'
import type { ExportVisibility } from '@shared/boardExport'
import type { CanvasObject } from '@shared/types'
import { reportError } from '../store/projectStore'

export function RelationPanels() {
  const showProperties = useCanvasStore((s) => s.showProperties)
  const showComments = useCanvasStore((s) => s.showComments)
  return (
    <>
      {showProperties && <PropertiesPanel />}
      {showComments && <CommentsPanel />}
      <IntegrityPanel />
      <CommentComposer />
      <BoardShareDialog />
      <UrlDropDialog />
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
          <label className="block">
            Pattern
            <select
              aria-label="Stroke pattern"
              className="mt-1 w-full rounded border border-line bg-canvas px-2 py-1"
              value={connection.style.pattern}
              onChange={(event) =>
                void updateConnection(
                  object,
                  {
                    ...connection,
                    style: {
                      ...connection.style,
                      pattern: event.target.value as typeof connection.style.pattern
                    }
                  },
                  'Connection pattern'
                )
              }
            >
              <option value="solid">Solid</option>
              <option value="dashed">Dashed</option>
              <option value="dotted">Dotted</option>
            </select>
          </label>
          <label className="block">
            Opacity
            <input
              aria-label="Stroke opacity"
              className="mt-1 w-full"
              type="number"
              min={0}
              max={100}
              value={Math.round(connection.style.opacity * 100)}
              onChange={(event) =>
                void updateConnection(
                  object,
                  {
                    ...connection,
                    style: {
                      ...connection.style,
                      opacity: Math.min(100, Math.max(0, Number(event.target.value))) / 100
                    }
                  },
                  'Connection opacity'
                )
              }
            />
          </label>
          <label className="block">
            Start marker
            <select
              aria-label="Start marker"
              className="mt-1 w-full rounded border border-line bg-canvas px-2 py-1"
              value={connection.style.startMarker}
              onChange={(event) =>
                void updateConnection(
                  object,
                  {
                    ...connection,
                    style: {
                      ...connection.style,
                      startMarker: event.target.value as typeof connection.style.startMarker
                    }
                  },
                  'Start marker'
                )
              }
            >
              <option value="none">None</option>
              <option value="arrow">Arrow</option>
              <option value="circle">Circle</option>
              <option value="diamond">Diamond</option>
              <option value="bar">Bar</option>
            </select>
          </label>
          <label className="block">
            End marker
            <select
              aria-label="End marker"
              className="mt-1 w-full rounded border border-line bg-canvas px-2 py-1"
              value={connection.style.endMarker}
              onChange={(event) =>
                void updateConnection(
                  object,
                  {
                    ...connection,
                    style: {
                      ...connection.style,
                      endMarker: event.target.value as typeof connection.style.endMarker
                    }
                  },
                  'End marker'
                )
              }
            >
              <option value="none">None</option>
              <option value="arrow">Arrow</option>
              <option value="circle">Circle</option>
              <option value="diamond">Diamond</option>
              <option value="bar">Bar</option>
            </select>
          </label>
          <label className="block">
            Crossing
            <select
              aria-label="Crossing override"
              className="mt-1 w-full rounded border border-line bg-canvas px-2 py-1"
              value={connection.crossing}
              onChange={(event) =>
                void updateConnection(
                  object,
                  { ...connection, crossing: event.target.value as typeof connection.crossing },
                  'Crossing'
                )
              }
            >
              <option value="inherit">Use board setting</option>
              <option value="plain">Plain</option>
              <option value="bridge">Bridge</option>
              <option value="gap">Gap</option>
            </select>
          </label>
          <label className="block">
            Label
            <input
              key={`${object.id}:${connection.label?.text ?? ''}`}
              aria-label="Connection label"
              className="mt-1 w-full rounded border border-line bg-canvas px-2 py-1"
              defaultValue={connection.label?.text ?? ''}
              placeholder="No label"
              onBlur={(event) => {
                const text = event.target.value
                if (text === (connection.label?.text ?? '')) return
                void updateConnection(
                  object,
                  {
                    ...connection,
                    label: text.trim()
                      ? {
                          text,
                          t: connection.label?.t ?? 0.5,
                          offset: connection.label?.offset ?? -18
                        }
                      : null
                  },
                  'Connection label'
                )
              }}
            />
          </label>
          <button
            className="rounded border border-line px-2 py-1"
            onClick={() => {
              const clear = (endpoint: typeof connection.start) =>
                endpoint.attachment
                  ? {
                      ...endpoint,
                      attachment: {
                        ...endpoint.attachment,
                        placement: 'auto' as const,
                        pin: null,
                        userHeld: false
                      }
                    }
                  : endpoint
              void updateConnection(
                object,
                { ...connection, start: clear(connection.start), end: clear(connection.end) },
                'Automatic ends'
              )
            }}
          >
            Reset ends to automatic
          </button>
          <button
            className="rounded border border-line px-2 py-1"
            onClick={() => copyConnectionStyle(object)}
          >
            Copy style
          </button>
          <button
            className="rounded border border-line px-2 py-1"
            onClick={() => void pasteConnectionStyle([object])}
          >
            Paste style
          </button>
          <button
            className="rounded border border-line px-2 py-1"
            onClick={() =>
              useCanvasStore.getState().setLinkTarget({ kind: 'label', id: object.id })
            }
          >
            {connection.labelLink ? 'Change label link' : 'Add label link'}
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
      {object?.type === 'link' && <LinkProperties object={object} />}
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

export function LabelEditor() {
  const id = useCanvasStore((s) => s.labelEdit)
  if (!id) return null
  return <LabelField key={id} id={id} />
}

function LabelField({ id }: { id: string }) {
  const object = useWorkspaceStore((s) => s.board?.objects.find((item) => item.id === id))
  const viewport = useCanvasStore((s) => s.viewport)
  const data = object ? parseConnection(object.data) : null
  const [text, setText] = useState(data?.label?.text ?? '')
  if (!object || !data) return null
  const at = data.label
    ? labelPosition(connectionPoints(data), data.label)
    : { x: data.start.x, y: data.start.y }
  const screen = worldToScreen(at, viewport)
  const close = () => useCanvasStore.getState().setLabelEdit(null)
  const save = () => {
    const trimmed = text.trim()
    void updateConnection(
      object,
      {
        ...data,
        label: trimmed
          ? { text: trimmed, t: data.label?.t ?? 0.5, offset: data.label?.offset ?? -18 }
          : null
      },
      trimmed ? 'Edit label' : 'Remove label'
    )
    close()
  }
  return (
    <form
      className="absolute z-30"
      style={{ left: screen.x, top: screen.y }}
      onSubmit={(event) => {
        event.preventDefault()
        save()
      }}
    >
      <input
        autoFocus
        aria-label="Edit connection label"
        className="rounded border border-line bg-surface px-2 py-1 text-sm shadow-sm"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Escape') {
            event.preventDefault()
            close()
          }
        }}
      />
    </form>
  )
}

export function LineChooser() {
  const choices = useCanvasStore((s) => s.lineChoices)
  const objects = useWorkspaceStore((s) => s.board?.objects ?? [])
  if (!choices) return null
  return (
    <div
      role="menu"
      aria-label="Overlapping connections"
      className="fixed z-40 min-w-40 rounded-lg border border-line bg-surface p-1 shadow-lg"
      style={{ left: choices.x, top: choices.y }}
    >
      {choices.ids.map((id) => {
        const data = parseConnection(objects.find((item) => item.id === id)?.data)
        return (
          <button
            key={id}
            type="button"
            className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-canvas"
            onClick={() => {
              useCanvasStore.getState().setSelection([id])
              useCanvasStore.getState().setLineChoices(null)
            }}
          >
            {data?.label?.text || 'Connection'}
          </button>
        )
      })}
    </div>
  )
}

function LinkProperties({ object }: { object: CanvasObject }) {
  const data = object.data
  const destination = parseDestination(data.destination)
  const layout = data.layout === 'preview' ? 'preview' : 'compact'
  return (
    <div className="mt-3 space-y-2 border-t border-line pt-3">
      <label className="block">
        Card
        <select
          aria-label="Link card layout"
          className="mt-1 w-full rounded border border-line bg-canvas px-2 py-1"
          value={layout}
          onChange={(event) =>
            void updateLinkCard(object, { ...data, layout: event.target.value }, 'Link layout')
          }
        >
          <option value="compact">Compact</option>
          <option value="preview">Preview</option>
        </select>
      </label>
      {destination?.kind === 'url' && (
        <button
          type="button"
          className="rounded border border-line px-2 py-1"
          onClick={() =>
            void window.api
              .invoke('relations:fetchPreview', object.id, object.revision)
              .catch(reportError)
          }
        >
          Generate preview
        </button>
      )}
    </div>
  )
}

function BoardShareDialog() {
  const open = useCanvasStore((s) => s.shareDialog)
  const [connections, setConnections] = useState<ExportVisibility>('current')
  const [comments, setComments] = useState<ExportVisibility>('current')
  const [includeComments, setIncludeComments] = useState(false)
  if (!open) return null
  const close = () => useCanvasStore.getState().setShareDialog(false)
  return (
    <div className="absolute inset-0 z-30 flex items-start justify-center bg-black/20 pt-16">
      <form
        aria-label="Export board"
        className="w-96 rounded-xl border border-line bg-surface p-4 text-sm shadow-lg"
        onSubmit={(event) => event.preventDefault()}
      >
        <h2 className="font-medium">Export this board</h2>
        <p className="mt-1 text-xs text-muted">
          A picture uses the choices below. A package keeps the board editable. Comments are left
          out of a package unless you include them.
        </p>
        <label className="mt-3 block">
          Connections in the picture
          <select
            aria-label="Picture connections"
            className="mt-1 w-full rounded border border-line bg-canvas px-2 py-1"
            value={connections}
            onChange={(event) => setConnections(event.target.value as ExportVisibility)}
          >
            <option value="current">As shown</option>
            <option value="show">Show</option>
            <option value="hide">Hide</option>
          </select>
        </label>
        <label className="mt-2 block">
          Comments in the picture
          <select
            aria-label="Picture comments"
            className="mt-1 w-full rounded border border-line bg-canvas px-2 py-1"
            value={comments}
            onChange={(event) => setComments(event.target.value as ExportVisibility)}
          >
            <option value="current">As shown</option>
            <option value="show">Show</option>
            <option value="hide">Hide</option>
          </select>
        </label>
        <label className="mt-3 flex items-center gap-2">
          <input
            type="checkbox"
            checked={includeComments}
            onChange={(event) => setIncludeComments(event.target.checked)}
          />
          Include comments and replies
        </label>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded border border-line px-2 py-1"
            onClick={() => {
              close()
              void exportPicture('png', { connections, comments })
            }}
          >
            PNG
          </button>
          <button
            type="button"
            className="rounded border border-line px-2 py-1"
            onClick={() => {
              close()
              void exportPicture('pdf', { connections, comments })
            }}
          >
            PDF
          </button>
          <button
            type="button"
            className="rounded border border-line px-2 py-1"
            onClick={() => {
              close()
              void exportPackage(includeComments)
            }}
          >
            Board package
          </button>
          <button
            type="button"
            className="rounded border border-line px-2 py-1"
            onClick={() => {
              close()
              void importPackage()
            }}
          >
            Import package
          </button>
          <button type="button" className="px-2 py-1 text-muted" onClick={close}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}

function UrlDropDialog() {
  const drop = useCanvasStore((s) => s.urlDrop)
  const board = useWorkspaceStore((s) => s.board)
  if (!drop) return null
  const target = board?.objects.find((object) => object.id === drop.targetId)
  const close = () => useCanvasStore.getState().setUrlDrop(null)
  return (
    <div className="absolute top-16 left-1/2 z-30 w-80 -translate-x-1/2 rounded-xl border border-line bg-surface p-3 text-sm shadow-lg">
      <p className="font-medium">This link was dropped on a card</p>
      <p className="mt-1 truncate text-xs text-muted">{drop.href}</p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className="rounded border border-line px-2 py-1"
          disabled={!target}
          onClick={() => {
            if (target) void attachObjectLink(target, { kind: 'url', href: drop.href })
            close()
          }}
        >
          Attach
        </button>
        <button
          type="button"
          className="rounded border border-line px-2 py-1"
          onClick={() => {
            void createLink(drop.at, { kind: 'url', href: drop.href }, '')
            close()
          }}
        >
          Create card
        </button>
        <button type="button" className="px-2 py-1 text-muted" onClick={close}>
          Cancel
        </button>
      </div>
    </div>
  )
}

export function destinationLabel(destination: Destination | null): string {
  if (!destination) return 'Destination missing'
  return destination.title || destination.kind
}

export { navigateTo, saveComment }
