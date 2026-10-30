/** Endpoint, bend, and label handles for the selected connection. */
import { useState } from 'react'
import { Circle, Rect } from 'react-konva'
import {
  connectionPoints,
  curveControls,
  curveFromHandle,
  elbowFromPoint,
  elbowHandle,
  groupBounds,
  labelFromPoint,
  labelPosition,
  parseConnection,
  pinForLocal,
  resolveConnection,
  worldToLocal,
  type ConnectionData,
  type Endpoint,
  type ResolvedWorld,
  type TargetBox
} from '@shared/connections'
import type { CanvasObject, Point } from '@shared/types'
import { COLORS } from '../canvas/BoardCardNode'
import { containsPoint, objectBounds, screenToWorld } from '../canvas/geometry'
import { useCanvasStore } from '../store/canvasStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import { updateConnection } from './relationActions'

function targetAt(world: Point, objects: CanvasObject[]): CanvasObject | null {
  let best: CanvasObject | null = null
  for (const object of objects) {
    if (object.type === 'connection' || object.locked) continue
    if (!containsPoint(objectBounds(object), world)) continue
    if (!best || object.zIndex >= best.zIndex) best = object
  }
  return best
}

function worldOf(objects: CanvasObject[]): ResolvedWorld {
  const boxes = new Map<string, TargetBox>()
  const groups = new Map<string, TargetBox[]>()
  for (const object of objects) {
    if (object.type === 'connection') continue
    const box: TargetBox = {
      id: object.id,
      x: object.x,
      y: object.y,
      width: object.width,
      height: object.height,
      rotation: object.rotation
    }
    boxes.set(object.id, box)
    if (object.groupId) {
      const list = groups.get(object.groupId) ?? []
      list.push(box)
      groups.set(object.groupId, list)
    }
  }
  return { objects: boxes, groups }
}

function placeEndpoint(
  point: Point,
  objects: CanvasObject[],
  pin: boolean,
  asGroup: boolean
): Endpoint {
  const target = targetAt(point, objects)
  if (!target) return { ...point, attachment: null }
  if (asGroup && target.groupId) {
    const members = objects.filter((object) => object.groupId === target.groupId)
    const box = groupBounds(members)
    const edge = pin && box ? pinForLocal(box.width, box.height, worldToLocal(box, point)) : null
    return {
      ...point,
      attachment: {
        kind: 'group',
        id: target.groupId,
        placement: edge ? 'pinned' : 'auto',
        pin: edge,
        missing: false,
        userHeld: false
      }
    }
  }
  const box = {
    x: target.x,
    y: target.y,
    width: target.width,
    height: target.height,
    rotation: target.rotation
  }
  const edge = pin ? pinForLocal(target.width, target.height, worldToLocal(box, point)) : null
  return {
    ...point,
    attachment: {
      kind: 'object',
      id: target.id,
      placement: edge ? 'pinned' : 'auto',
      pin: edge,
      missing: false,
      userHeld: false
    }
  }
}

/** Pointer position in board space. The stage scale makes a Konva drag report screen pixels. */
function clientToWorld(event: MouseEvent): Point {
  const canvas = document.querySelector('[data-testid="canvas"]')
  const rect = canvas?.getBoundingClientRect()
  const screen = rect
    ? { x: event.clientX - rect.left, y: event.clientY - rect.top }
    : { x: event.clientX, y: event.clientY }
  return screenToWorld(screen, useCanvasStore.getState().viewport)
}

function Handle({
  at,
  zoom,
  onDrag,
  onDrop
}: {
  at: Point
  zoom: number
  onDrag: (point: Point, event: MouseEvent) => void
  onDrop: (point: Point, event: MouseEvent) => void
}) {
  return (
    <Circle
      name="relation-handle"
      x={at.x}
      y={at.y}
      radius={Math.max(8, 12 / zoom)}
      fill="#fff"
      stroke={COLORS.accent}
      strokeWidth={1.5 / Math.max(zoom, 0.05)}
      onMouseDown={(event) => {
        event.cancelBubble = true
        event.evt.preventDefault()
        const move = (evt: MouseEvent) => onDrag(clientToWorld(evt), evt)
        const up = (evt: MouseEvent) => {
          window.removeEventListener('mousemove', move)
          window.removeEventListener('mouseup', up)
          onDrop(clientToWorld(evt), evt)
        }
        window.addEventListener('mousemove', move)
        window.addEventListener('mouseup', up)
      }}
    />
  )
}

export function ConnectionHandles({ object, zoom }: { object: CanvasObject; zoom: number }) {
  const objects = useWorkspaceStore((s) => s.board?.objects ?? [])
  const draft = useCanvasStore((s) =>
    s.connectionDraft?.id === object.id ? s.connectionDraft.data : null
  )
  const [snap, setSnap] = useState<string | null>(null)
  const data = draft ?? parseConnection(object.data)
  if (!data || object.locked) return null
  const points = connectionPoints(data)
  const show = (next: ConnectionData) =>
    useCanvasStore.getState().setConnectionDraft({ id: object.id, data: next })
  const commit = (next: ConnectionData, label: string) => {
    setSnap(null)
    useCanvasStore.getState().setConnectionDraft(null)
    void updateConnection(object, next, label)
  }
  const curves = data.path === 'curved' ? curveControls(data.start, data.end, data.curve) : null
  const bend = data.path === 'elbow' ? elbowHandle(data.start, data.end, data.elbow) : null
  const labelAt = data.label ? labelPosition(points, data.label) : null
  const snapObject = snap ? objects.find((item) => item.id === snap) : null
  const snapBox = snapObject
    ? objectBounds(snapObject)
    : snap
      ? groupBounds(objects.filter((item) => item.groupId === snap))
      : null

  return (
    <>
      {snapBox && (
        <Rect
          x={snapBox.x}
          y={snapBox.y}
          width={snapBox.width}
          height={snapBox.height}
          stroke={COLORS.accent}
          strokeWidth={1.5 / Math.max(zoom, 0.05)}
          listening={false}
          dash={[4 / zoom, 3 / zoom]}
        />
      )}
      <Handle
        at={data.start}
        zoom={zoom}
        onDrag={(point, event) => {
          const endpoint = placeEndpoint(point, objects, event.altKey, event.shiftKey)
          setSnap(
            endpoint.attachment && !endpoint.attachment.missing ? endpoint.attachment.id : null
          )
          show(resolveConnection({ ...data, start: endpoint }, worldOf(objects)))
        }}
        onDrop={(point, event) => {
          const endpoint = placeEndpoint(point, objects, event.altKey, event.shiftKey)
          commit(resolveConnection({ ...data, start: endpoint }, worldOf(objects)), 'Move start')
        }}
      />
      <Handle
        at={data.end}
        zoom={zoom}
        onDrag={(point, event) => {
          const endpoint = placeEndpoint(point, objects, event.altKey, event.shiftKey)
          setSnap(
            endpoint.attachment && !endpoint.attachment.missing ? endpoint.attachment.id : null
          )
          show(resolveConnection({ ...data, end: endpoint }, worldOf(objects)))
        }}
        onDrop={(point, event) => {
          const endpoint = placeEndpoint(point, objects, event.altKey, event.shiftKey)
          commit(resolveConnection({ ...data, end: endpoint }, worldOf(objects)), 'Move end')
        }}
      />
      {curves && (
        <>
          <Handle
            at={curves[0]}
            zoom={zoom}
            onDrag={(point) =>
              show({
                ...data,
                curve: curveFromHandle(data.start, data.end, 1, point, data.curve)
              })
            }
            onDrop={(point) =>
              commit(
                { ...data, curve: curveFromHandle(data.start, data.end, 1, point, data.curve) },
                'Bend curve'
              )
            }
          />
          <Handle
            at={curves[1]}
            zoom={zoom}
            onDrag={(point) =>
              show({
                ...data,
                curve: curveFromHandle(data.start, data.end, 2, point, data.curve)
              })
            }
            onDrop={(point) =>
              commit(
                { ...data, curve: curveFromHandle(data.start, data.end, 2, point, data.curve) },
                'Bend curve'
              )
            }
          />
        </>
      )}
      {bend && (
        <Handle
          at={bend}
          zoom={zoom}
          onDrag={(point) =>
            show({
              ...data,
              routing: 'manual',
              elbow: elbowFromPoint(data.start, data.end, point)
            })
          }
          onDrop={(point) =>
            commit(
              {
                ...data,
                routing: 'manual',
                elbow: elbowFromPoint(data.start, data.end, point)
              },
              'Move bend'
            )
          }
        />
      )}
      {labelAt && data.label && (
        <Handle
          at={labelAt}
          zoom={zoom}
          onDrag={(point) => {
            const next = labelFromPoint(points, point)
            show({ ...data, label: { ...data.label!, ...next } })
          }}
          onDrop={(point) => {
            const next = labelFromPoint(connectionPoints(data), point)
            commit({ ...data, label: { ...data.label!, ...next } }, 'Move label')
          }}
        />
      )}
    </>
  )
}
