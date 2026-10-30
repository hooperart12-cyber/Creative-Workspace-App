/** Canvas edits for connections, links, and comments. One edit is one undo step. */
import { anchorOnImage, defaultComment, parseComment, type CommentData } from '@shared/comments'
import { cropOf } from '@shared/crop'
import {
  parseConnection,
  pasteStyle,
  worldToLocal,
  type ConnectionData,
  type ConnectionStyle,
  type Endpoint
} from '@shared/connections'
import type { Destination } from '@shared/destinations'
import type { CanvasObject, Point } from '@shared/types'
import { record, run } from '../canvas/actions'
import { useCanvasStore } from '../store/canvasStore'
import { useWorkspaceStore } from '../store/workspaceStore'

const api = () => window.api

function boardId(): string {
  const id = useWorkspaceStore.getState().board?.id
  if (!id) throw new Error('Open a board first.')
  return id
}

function finishTool(): void {
  const canvas = useCanvasStore.getState()
  if (!canvas.toolPinned) canvas.setTool('select', false)
}

export function createConnection(data: ConnectionData): Promise<void> {
  return run(async () => {
    const created = await api().invoke('relations:createConnection', boardId(), data)
    record({
      label: 'Add connection',
      undo: async () => void (await api().invoke('objects:delete', [created.id])),
      redo: async () => void (await api().invoke('objects:restore', [created.id]))
    })
    useCanvasStore.getState().setSelection([created.id])
    finishTool()
  })
}

export function updateConnection(
  object: CanvasObject,
  next: ConnectionData,
  label: string
): Promise<void> {
  const before = parseConnection(object.data)
  if (!before) return Promise.resolve()
  return run(async () => {
    const saved = await api().invoke('relations:updateConnection', object.id, object.revision, next)
    const after = { ...next }
    record({
      label,
      undo: async () =>
        void (await api().invoke('relations:updateConnection', object.id, saved.revision, before)),
      redo: async () => {
        const current = useWorkspaceStore
          .getState()
          .board?.objects.find((item) => item.id === object.id)
        if (!current) return
        await api().invoke('relations:updateConnection', object.id, current.revision, after)
      }
    })
  })
}

/** Moves free endpoints, and attached endpoints only when their target moved too. */
export function moveConnections(ids: string[], dx: number, dy: number): Promise<void> {
  const objects = useWorkspaceStore.getState().board?.objects ?? []
  const moving = new Set(ids)
  const changes = ids.flatMap((id) => {
    const object = objects.find((item) => item.id === id && item.type === 'connection')
    const data = object ? parseConnection(object.data) : null
    if (!object || !data) return []
    const shift = (endpoint: Endpoint): Endpoint => {
      const target = endpoint.attachment?.id
      if (endpoint.attachment && !endpoint.attachment.missing && target && !moving.has(target))
        return endpoint
      return {
        ...endpoint,
        x: endpoint.x + dx,
        y: endpoint.y + dy,
        attachment: endpoint.attachment ? { ...endpoint.attachment, userHeld: true } : null
      }
    }
    return [{ object, next: { ...data, start: shift(data.start), end: shift(data.end) } }]
  })
  if (changes.length === 0) return Promise.resolve()
  return run(async () => {
    for (const change of changes) {
      await api().invoke(
        'relations:updateConnection',
        change.object.id,
        change.object.revision,
        change.next
      )
    }
    record({
      label: 'Move connection',
      undo: async () => {
        for (const change of changes) {
          const current = useWorkspaceStore
            .getState()
            .board?.objects.find((item) => item.id === change.object.id)
          const before = parseConnection(change.object.data)
          if (!current || !before) continue
          await api().invoke('relations:updateConnection', current.id, current.revision, before)
        }
      },
      redo: async () => {
        for (const change of changes) {
          const current = useWorkspaceStore
            .getState()
            .board?.objects.find((item) => item.id === change.object.id)
          if (!current) continue
          await api().invoke(
            'relations:updateConnection',
            current.id,
            current.revision,
            change.next
          )
        }
      }
    })
  })
}

export function createLink(at: Point, destination: Destination, title: string): Promise<void> {
  return run(async () => {
    const created = await api().invoke('relations:createLink', boardId(), at, {
      version: 1,
      title,
      description: '',
      layout: 'compact',
      destination
    })
    record({
      label: 'Add link',
      undo: async () => void (await api().invoke('objects:delete', [created.id])),
      redo: async () => void (await api().invoke('objects:restore', [created.id]))
    })
    useCanvasStore.getState().setSelection([created.id])
    finishTool()
  })
}

export function createComment(body: string): Promise<void> {
  const draft = useCanvasStore.getState().commentDraft
  if (!draft) return Promise.resolve()
  const data = defaultComment(draft)
  const target = useWorkspaceStore
    .getState()
    .board?.objects.find((item) => item.id === draft.targetId)
  const point = { x: draft.x, y: draft.y }
  let u = data.anchor.u
  let v = data.anchor.v
  if (target?.asset?.width && target.asset.height) {
    const crop = cropOf(target.data)
    const placed = anchorOnImage(
      target,
      point,
      { width: target.asset.width, height: target.asset.height },
      crop
    )
    u = placed.u
    v = placed.v
  } else if (target) {
    const local = worldToLocal(target, point)
    u = Math.min(1, Math.max(0, local.x / Math.max(target.width, 1)))
    v = Math.min(1, Math.max(0, local.y / Math.max(target.height, 1)))
  }
  data.anchor = {
    ...data.anchor,
    scope: draft.scope,
    targetId: draft.targetId,
    slideId: draft.slideId,
    x: draft.x,
    y: draft.y,
    u,
    v
  }
  return run(async () => {
    const created = await api().invoke('relations:createComment', boardId(), draft, data, body)
    useCanvasStore.getState().setCommentDraft(null)
    record({
      label: 'Add comment',
      undo: async () => void (await api().invoke('objects:delete', [created.id])),
      redo: async () => void (await api().invoke('objects:restore', [created.id]))
    })
    useCanvasStore.getState().setSelection([created.id])
    finishTool()
  })
}

export function saveComment(object: CanvasObject, data: CommentData): Promise<void> {
  const before = parseComment(object.data)
  if (!before) return Promise.resolve()
  return run(async () => {
    const saved = await api().invoke('relations:updateComment', object.id, object.revision, data)
    record({
      label: 'Edit comment',
      undo: async () => {
        const current = useWorkspaceStore
          .getState()
          .board?.objects.find((item) => item.id === object.id)
        if (current)
          await api().invoke('relations:updateComment', object.id, current.revision, before)
      },
      redo: async () => {
        const current = useWorkspaceStore
          .getState()
          .board?.objects.find((item) => item.id === object.id)
        if (current)
          await api().invoke('relations:updateComment', object.id, current.revision, data)
      }
    })
    void saved
  })
}

export function replyToComment(object: CanvasObject, body: string): Promise<void> {
  return run(async () => {
    const saved = await api().invoke('relations:addReply', object.id, object.revision, body)
    record({
      label: 'Reply',
      undo: async () => {
        const current = useWorkspaceStore
          .getState()
          .board?.objects.find((item) => item.id === object.id)
        if (current)
          await api().invoke('relations:deleteReply', object.id, saved.messageId, current.revision)
      },
      redo: async () => {
        const current = useWorkspaceStore
          .getState()
          .board?.objects.find((item) => item.id === object.id)
        if (current) await api().invoke('relations:addReply', object.id, current.revision, body)
      }
    })
  })
}

export function setBoardView(patch: {
  connectionDisplay?: string
  crossingStyle?: string
  commentView?: string
}): Promise<void> {
  return run(async () => {
    await api().invoke('relations:setBoardView', boardId(), patch)
  })
}

let copiedStyle: ConnectionStyle | null = null

export function copyConnectionStyle(object: CanvasObject): void {
  const data = parseConnection(object.data)
  if (data) copiedStyle = { ...data.style }
}

export function pasteConnectionStyle(objects: CanvasObject[]): Promise<void> {
  const style = copiedStyle
  if (!style) return Promise.resolve()
  const changes = objects.flatMap((object) => {
    const before = parseConnection(object.data)
    return before ? [{ object, before, next: pasteStyle(before, style) }] : []
  })
  if (changes.length === 0) return Promise.resolve()
  return run(async () => {
    for (const change of changes) {
      await api().invoke(
        'relations:updateConnection',
        change.object.id,
        change.object.revision,
        change.next
      )
    }
    record({
      label: 'Paste style',
      undo: async () => {
        for (const change of changes) {
          const current = useWorkspaceStore
            .getState()
            .board?.objects.find((item) => item.id === change.object.id)
          if (!current) continue
          await api().invoke(
            'relations:updateConnection',
            current.id,
            current.revision,
            change.before
          )
        }
      },
      redo: async () => {
        for (const change of changes) {
          const current = useWorkspaceStore
            .getState()
            .board?.objects.find((item) => item.id === change.object.id)
          if (!current) continue
          await api().invoke(
            'relations:updateConnection',
            current.id,
            current.revision,
            change.next
          )
        }
      }
    })
  })
}

export function updateLinkCard(
  object: CanvasObject,
  data: Record<string, unknown>,
  label: string
): Promise<void> {
  const before = { ...object.data }
  return run(async () => {
    await api().invoke('relations:updateLink', object.id, object.revision, data)
    record({
      label,
      undo: async () => {
        const current = useWorkspaceStore
          .getState()
          .board?.objects.find((item) => item.id === object.id)
        if (current) await api().invoke('relations:updateLink', object.id, current.revision, before)
      },
      redo: async () => {
        const current = useWorkspaceStore
          .getState()
          .board?.objects.find((item) => item.id === object.id)
        if (current) await api().invoke('relations:updateLink', object.id, current.revision, data)
      }
    })
  })
}

export function attachObjectLink(
  object: CanvasObject,
  destination: Destination | null
): Promise<void> {
  const before =
    object.data.navLink && typeof object.data.navLink === 'object'
      ? (object.data.navLink as Destination)
      : null
  return run(async () => {
    const saved = await api().invoke(
      'relations:setObjectLink',
      object.id,
      object.revision,
      destination
    )
    record({
      label: destination ? 'Attach link' : 'Remove link',
      undo: async () => {
        const current = useWorkspaceStore
          .getState()
          .board?.objects.find((item) => item.id === object.id)
        if (current)
          await api().invoke('relations:setObjectLink', object.id, current.revision, before)
      },
      redo: async () => {
        const current = useWorkspaceStore
          .getState()
          .board?.objects.find((item) => item.id === object.id)
        if (current)
          await api().invoke('relations:setObjectLink', object.id, current.revision, destination)
      }
    })
    void saved
  })
}

let noteLinkHandler: ((destination: Destination) => void) | null = null

export function setNoteLinkHandler(handler: ((destination: Destination) => void) | null): void {
  noteLinkHandler = handler
}

export function applyNoteDestination(destination: Destination): void {
  noteLinkHandler?.(destination)
}
