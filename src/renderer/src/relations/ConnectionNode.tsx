/** One connection. The line is drawn from its resolved endpoints, not from a stored bitmap. */
import { Group, Line, Circle, RegularPolygon, Rect, Text } from 'react-konva'
import {
  connectionChrome,
  connectionPoints,
  displayStroke,
  labelPosition,
  parseConnection,
  pointAlong,
  tangentAt,
  type ConnectionData,
  type CrossingStyle,
  type Marker,
  type Point
} from '@shared/connections'
import type { CanvasObject } from '@shared/types'
import { COLORS } from '../canvas/BoardCardNode'

interface Props {
  object: CanvasObject
  zoom: number
  selected: boolean
  display: 'full' | 'adaptive' | 'minimal' | 'hidden'
  crossing: CrossingStyle
  faded: boolean
}

function markerShape(
  marker: Marker,
  at: Point,
  tangent: Point,
  color: string,
  width: number,
  zoom: number
) {
  if (marker === 'none') return null
  const size = Math.max(8, width * 3.5)
  const angle = (Math.atan2(tangent.y, tangent.x) * 180) / Math.PI
  if (marker === 'circle')
    return <Circle x={at.x} y={at.y} radius={size / 2} fill={color} listening={false} />
  if (marker === 'diamond')
    return (
      <Rect
        x={at.x}
        y={at.y}
        width={size}
        height={size}
        offsetX={size / 2}
        offsetY={size / 2}
        rotation={angle + 45}
        fill={color}
        listening={false}
      />
    )
  if (marker === 'bar')
    return (
      <Line
        points={[-size / 2, 0, size / 2, 0]}
        x={at.x}
        y={at.y}
        rotation={angle + 90}
        stroke={color}
        strokeWidth={Math.max(width, 1.5 / zoom)}
        listening={false}
      />
    )
  return (
    <RegularPolygon
      x={at.x}
      y={at.y}
      sides={3}
      radius={size / 1.6}
      rotation={angle - 90}
      fill={color}
      listening={false}
    />
  )
}

export function ConnectionNode({ object, zoom, selected, display, crossing, faded }: Props) {
  const data = parseConnection(object.data)
  if (!data) return null
  const chrome = connectionChrome(display, zoom, selected)
  if (!chrome.show) return null
  const points = connectionPoints(data)
  const flat = points.flatMap((point) => [point.x - object.x, point.y - object.y])
  const stroke = displayStroke(data.style.width, zoom, chrome.minScreenStroke)
  const chosen: CrossingStyle = data.crossing === 'inherit' ? crossing : data.crossing
  const pattern = chosen === 'gap' && !selected ? 'dashed' : data.style.pattern
  const dash = pattern === 'dashed' ? [10, 8] : pattern === 'dotted' ? [1.5, 7] : undefined
  const start = pointAlong(points, 0)
  const end = pointAlong(points, 1)
  const label = data.label && chrome.label ? labelPosition(points, data.label) : null
  return (
    <Group
      id={object.id}
      name="object"
      x={object.x}
      y={object.y}
      opacity={faded ? 0.4 : data.style.opacity}
    >
      <Line
        points={flat}
        stroke={selected ? COLORS.accent : data.style.color}
        strokeWidth={stroke}
        dash={dash}
        lineCap="round"
        lineJoin="round"
        hitStrokeWidth={Math.max(14, 14 / zoom)}
        tension={data.path === 'curved' ? 0 : 0}
      />
      {chrome.markers &&
        markerShape(
          data.style.startMarker,
          { x: start.point.x - object.x, y: start.point.y - object.y },
          tangentAt(points, false),
          data.style.color,
          data.style.width,
          zoom
        )}
      {chrome.markers &&
        markerShape(
          data.style.endMarker,
          { x: end.point.x - object.x, y: end.point.y - object.y },
          tangentAt(points, true),
          data.style.color,
          data.style.width,
          zoom
        )}
      {label && data.label && (
        <Text
          x={label.x - object.x}
          y={label.y - object.y}
          text={data.label.text}
          fontSize={13}
          fill={data.style.color}
          listening={false}
        />
      )}
    </Group>
  )
}

export type { ConnectionData }
