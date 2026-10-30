/**
 * Connection geometry (M8). Endpoints, paths, labels, and crossings are pure functions
 * so the canvas and the database agree on the same shape.
 */
import { rotatedBounds, type Box } from './geometry'
import { parseDestination, remapDestination, type Destination } from './destinations'

export const MARKERS = ['none', 'arrow', 'circle', 'diamond', 'bar'] as const
export type Marker = (typeof MARKERS)[number]
export type PathStyle = 'straight' | 'curved' | 'elbow'
export type StrokePattern = 'solid' | 'dashed' | 'dotted'
export type CrossingChoice = 'inherit' | 'plain' | 'bridge' | 'gap'
export type ConnectionDisplay = 'full' | 'adaptive' | 'minimal' | 'hidden'
export type CrossingStyle = 'plain' | 'bridge' | 'gap'

/** Detail starts dropping out around these zoom levels. Kept in one place so tests can move them. */
export const CONNECTION_ZOOM = { labels: 0.6, markers: 0.35 }

export interface Point {
  x: number
  y: number
}

export interface EdgePin {
  edge: 'top' | 'right' | 'bottom' | 'left'
  /** 0 at the clockwise start of the edge, 1 at its end. */
  along: number
}

export interface Attachment {
  kind: 'object' | 'group'
  id: string
  placement: 'auto' | 'pinned'
  pin: EdgePin | null
  /** The target is gone. x/y is the last place the endpoint was drawn. */
  missing: boolean
  /** The user moved this endpoint after the target left, so a restore must not grab it back. */
  userHeld: boolean
}

export interface Endpoint {
  x: number
  y: number
  attachment: Attachment | null
}

export interface ConnectionStyle {
  color: string
  width: number
  pattern: StrokePattern
  opacity: number
  startMarker: Marker
  endMarker: Marker
}

export interface ConnectionLabel {
  text: string
  /** 0 at the start of the path, 1 at the end. */
  t: number
  /** Pixels to the left of the path direction. */
  offset: number
}

export interface CurveHandles {
  t1: number
  t2: number
  offset1: number
  offset2: number
}

export interface ElbowRoute {
  first: 'h' | 'v'
  split: number
}

export interface ConnectionData {
  version: 1
  start: Endpoint
  end: Endpoint
  path: PathStyle
  curve: CurveHandles
  elbow: ElbowRoute
  routing: 'manual' | 'avoid'
  style: ConnectionStyle
  label: ConnectionLabel | null
  labelLink: Destination | null
  crossing: CrossingChoice
}

export interface TargetBox extends Box {
  id: string
  rotation?: number
}

const EDGES = ['top', 'right', 'bottom', 'left'] as const
const HEX = /^#[0-9a-f]{6}$/i

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export const defaultStyle = (): ConnectionStyle => ({
  color: '#2c2a26',
  width: 2,
  pattern: 'solid',
  opacity: 1,
  startMarker: 'none',
  endMarker: 'arrow'
})

export function defaultConnection(start: Point, end: Point): ConnectionData {
  return {
    version: 1,
    start: { ...start, attachment: null },
    end: { ...end, attachment: null },
    path: 'straight',
    curve: { t1: 0.33, t2: 0.66, offset1: 0, offset2: 0 },
    elbow: {
      first: Math.abs(end.x - start.x) >= Math.abs(end.y - start.y) ? 'h' : 'v',
      split: 0.5
    },
    routing: 'manual',
    style: defaultStyle(),
    label: null,
    labelLink: null,
    crossing: 'inherit'
  }
}

function finite(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? clamp(value, min, max) : fallback
}

function endpoint(value: unknown, fallback: Point): Endpoint {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const point = {
    x: finite(raw.x, fallback.x, -1e7, 1e7),
    y: finite(raw.y, fallback.y, -1e7, 1e7)
  }
  const attachment = raw.attachment
  if (!attachment || typeof attachment !== 'object') return { ...point, attachment: null }
  const source = attachment as Record<string, unknown>
  if ((source.kind !== 'object' && source.kind !== 'group') || typeof source.id !== 'string')
    return { ...point, attachment: null }
  const pinRaw =
    source.pin && typeof source.pin === 'object' ? (source.pin as Record<string, unknown>) : null
  const edge =
    pinRaw && EDGES.includes(pinRaw.edge as EdgePin['edge'])
      ? (pinRaw.edge as EdgePin['edge'])
      : null
  const pin = edge ? { edge, along: finite(pinRaw?.along, 0.5, 0, 1) } : null
  return {
    ...point,
    attachment: {
      kind: source.kind,
      id: source.id.slice(0, 80),
      placement: source.placement === 'pinned' ? 'pinned' : 'auto',
      pin,
      missing: source.missing === true,
      userHeld: source.userHeld === true
    }
  }
}

/** Rejects unknown fields and clamps numbers so a bad save cannot invent a path. */
export function parseConnection(value: unknown): ConnectionData | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (raw.version !== 1) return null
  const base = defaultConnection({ x: 0, y: 0 }, { x: 160, y: 0 })
  const styleRaw =
    raw.style && typeof raw.style === 'object' ? (raw.style as Record<string, unknown>) : {}
  const curveRaw =
    raw.curve && typeof raw.curve === 'object' ? (raw.curve as Record<string, unknown>) : {}
  const elbowRaw =
    raw.elbow && typeof raw.elbow === 'object' ? (raw.elbow as Record<string, unknown>) : {}
  const labelRaw =
    raw.label && typeof raw.label === 'object' ? (raw.label as Record<string, unknown>) : null
  const color =
    typeof styleRaw.color === 'string' && HEX.test(styleRaw.color)
      ? styleRaw.color
      : base.style.color
  const pattern =
    styleRaw.pattern === 'dashed' || styleRaw.pattern === 'dotted' ? styleRaw.pattern : 'solid'
  const marker = (name: unknown, fallback: Marker): Marker =>
    MARKERS.includes(name as Marker) ? (name as Marker) : fallback
  const path: PathStyle = raw.path === 'curved' || raw.path === 'elbow' ? raw.path : 'straight'
  const label =
    labelRaw && typeof labelRaw.text === 'string'
      ? {
          text: labelRaw.text.slice(0, 500),
          t: finite(labelRaw.t, 0.5, 0, 1),
          offset: finite(labelRaw.offset, 16, -400, 400)
        }
      : null
  return {
    version: 1,
    start: endpoint(raw.start, base.start),
    end: endpoint(raw.end, base.end),
    path,
    curve: {
      t1: finite(curveRaw.t1, 0.33, 0.05, 0.95),
      t2: finite(curveRaw.t2, 0.66, 0.05, 0.95),
      offset1: finite(curveRaw.offset1, 0, -4000, 4000),
      offset2: finite(curveRaw.offset2, 0, -4000, 4000)
    },
    elbow: {
      first: elbowRaw.first === 'v' ? 'v' : 'h',
      split: finite(elbowRaw.split, 0.5, 0.05, 0.95)
    },
    routing: raw.routing === 'avoid' ? 'avoid' : 'manual',
    style: {
      color,
      width: finite(styleRaw.width, 2, 1, 12),
      pattern,
      opacity: finite(styleRaw.opacity, 1, 0, 1),
      startMarker: marker(styleRaw.startMarker, 'none'),
      endMarker: marker(styleRaw.endMarker, 'arrow')
    },
    label: label && label.text.trim() ? label : null,
    labelLink: parseDestination(raw.labelLink),
    crossing:
      raw.crossing === 'plain' || raw.crossing === 'bridge' || raw.crossing === 'gap'
        ? raw.crossing
        : 'inherit'
  }
}

export function swapMarkers(data: ConnectionData): ConnectionData {
  return {
    ...data,
    style: { ...data.style, startMarker: data.style.endMarker, endMarker: data.style.startMarker }
  }
}

/** Copies colour, width, pattern, opacity, and markers. Endpoints, route, and links stay. */
export function pasteStyle(target: ConnectionData, style: ConnectionStyle): ConnectionData {
  return { ...target, style: { ...style } }
}

function rotateLocal(origin: Point, local: Point, rotation: number): Point {
  const rad = (rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return {
    x: origin.x + local.x * cos - local.y * sin,
    y: origin.y + local.x * sin + local.y * cos
  }
}

export function worldToLocal(box: Box & { rotation?: number }, world: Point): Point {
  const rad = (-(box.rotation ?? 0) * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = world.x - box.x
  const dy = world.y - box.y
  return { x: dx * cos - dy * sin, y: dx * sin + dy * cos }
}

export function pointOnEdge(width: number, height: number, pin: EdgePin): Point {
  const along = clamp(pin.along, 0, 1)
  if (pin.edge === 'top') return { x: width * along, y: 0 }
  if (pin.edge === 'right') return { x: width, y: height * along }
  if (pin.edge === 'bottom') return { x: width * (1 - along), y: height }
  return { x: 0, y: height * (1 - along) }
}

/** Nearest point on the rectangle perimeter, as a stable edge fraction. */
export function pinForLocal(width: number, height: number, local: Point): EdgePin {
  const w = Math.max(width, 1)
  const h = Math.max(height, 1)
  const x = clamp(local.x, 0, w)
  const y = clamp(local.y, 0, h)
  const distances = [
    { edge: 'top' as const, distance: y, along: x / w },
    { edge: 'right' as const, distance: w - x, along: y / h },
    { edge: 'bottom' as const, distance: h - y, along: (w - x) / w },
    { edge: 'left' as const, distance: x, along: (h - y) / h }
  ]
  distances.sort((a, b) => a.distance - b.distance)
  return { edge: distances[0].edge, along: clamp(distances[0].along, 0, 1) }
}

/** Where a line from the centre toward `toward` meets the perimeter. */
export function autoPin(box: Box & { rotation?: number }, toward: Point): EdgePin {
  const local = worldToLocal(box, toward)
  const cx = box.width / 2
  const cy = box.height / 2
  let dx = local.x - cx
  let dy = local.y - cy
  if (Math.hypot(dx, dy) < 0.001) {
    dx = 1
    dy = 0
  }
  const ts: number[] = []
  if (dx !== 0) ts.push((dx > 0 ? box.width - cx : 0 - cx) / dx)
  if (dy !== 0) ts.push((dy > 0 ? box.height - cy : 0 - cy) / dy)
  const t = ts.filter((value) => value > 0).sort((a, b) => a - b)[0] ?? 1
  return pinForLocal(box.width, box.height, { x: cx + dx * t, y: cy + dy * t })
}

export function anchorPoint(box: Box & { rotation?: number }, pin: EdgePin): Point {
  return rotateLocal(
    { x: box.x, y: box.y },
    pointOnEdge(box.width, box.height, pin),
    box.rotation ?? 0
  )
}

export function groupBounds(members: Array<Box & { rotation?: number }>): Box | null {
  if (members.length === 0) return null
  const boxes = members.map((member) => rotatedBounds(member))
  const left = Math.min(...boxes.map((box) => box.x))
  const top = Math.min(...boxes.map((box) => box.y))
  const right = Math.max(...boxes.map((box) => box.x + box.width))
  const bottom = Math.max(...boxes.map((box) => box.y + box.height))
  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) }
}

export interface ResolvedWorld {
  objects: Map<string, TargetBox>
  groups: Map<string, Array<Box & { rotation?: number }>>
}

/** World position of an endpoint. A missing target keeps the last stored point. */
export function resolveEndpoint(endpoint: Endpoint, world: ResolvedWorld, toward: Point): Endpoint {
  const attachment = endpoint.attachment
  if (!attachment || attachment.missing) return endpoint
  const box =
    attachment.kind === 'object'
      ? world.objects.get(attachment.id)
      : groupBounds(world.groups.get(attachment.id) ?? [])
  if (!box) return { ...endpoint, attachment: { ...attachment, missing: true } }
  const pin =
    attachment.placement === 'pinned' && attachment.pin ? attachment.pin : autoPin(box, toward)
  const point = anchorPoint(box, pin)
  return { ...endpoint, x: point.x, y: point.y, attachment: { ...attachment, pin, missing: false } }
}

function sampleCurve(start: Point, c1: Point, c2: Point, end: Point, steps = 24): Point[] {
  const points: Point[] = []
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps
    const u = 1 - t
    points.push({
      x: u ** 3 * start.x + 3 * u ** 2 * t * c1.x + 3 * u * t ** 2 * c2.x + t ** 3 * end.x,
      y: u ** 3 * start.y + 3 * u ** 2 * t * c1.y + 3 * u * t ** 2 * c2.y + t ** 3 * end.y
    })
  }
  return points
}

export function curveControls(start: Point, end: Point, curve: CurveHandles): [Point, Point] {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy) || 1
  const px = -dy / length
  const py = dx / length
  const at = (t: number, offset: number): Point => ({
    x: start.x + dx * t + px * offset,
    y: start.y + dy * t + py * offset
  })
  return [at(curve.t1, curve.offset1), at(curve.t2, curve.offset2)]
}

/** Writes a dragged curve handle back as a chord fraction and a perpendicular offset. */
export function curveFromHandle(
  start: Point,
  end: Point,
  which: 1 | 2,
  handle: Point,
  curve: CurveHandles
): CurveHandles {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSq = dx * dx + dy * dy || 1
  const t = clamp(((handle.x - start.x) * dx + (handle.y - start.y) * dy) / lengthSq, 0.05, 0.95)
  const length = Math.sqrt(lengthSq)
  const px = -dy / length
  const py = dx / length
  const ox = handle.x - (start.x + dx * t)
  const oy = handle.y - (start.y + dy * t)
  const offset = ox * px + oy * py
  return which === 1 ? { ...curve, t1: t, offset1: offset } : { ...curve, t2: t, offset2: offset }
}

function elbowPoints(start: Point, end: Point, elbow: ElbowRoute): Point[] {
  if (elbow.first === 'h') {
    const x = start.x + (end.x - start.x) * elbow.split
    return [start, { x, y: start.y }, { x, y: end.y }, end]
  }
  const y = start.y + (end.y - start.y) * elbow.split
  return [start, { x: start.x, y }, { x: end.x, y }, end]
}

function dedupe(points: Point[]): Point[] {
  const out: Point[] = []
  for (const point of points) {
    const last = out[out.length - 1]
    if (!last || Math.hypot(point.x - last.x, point.y - last.y) > 0.5) out.push(point)
  }
  return out.length >= 2 ? out : points.slice(0, 2)
}

export interface Obstacle {
  id: string
  box: Box
}

function intersectsSegment(a: Point, b: Point, box: Box, pad = 8): boolean {
  const left = box.x - pad
  const right = box.x + box.width + pad
  const top = box.y - pad
  const bottom = box.y + box.height + pad
  const steps = 8
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps
    const x = a.x + (b.x - a.x) * t
    const y = a.y + (b.y - a.y) * t
    if (x >= left && x <= right && y >= top && y <= bottom) return true
  }
  return false
}

/**
 * Pushes an elbow segment outside the first obstacle it crosses.
 * The side is chosen by which edge is closer, with a tie toward the smaller coordinate,
 * so a small move does not flip the route.
 */
export function avoidObstacles(points: Point[], obstacles: Obstacle[]): Point[] {
  let route = points
  for (const obstacle of obstacles) {
    const next: Point[] = [route[0]]
    for (let i = 1; i < route.length; i += 1) {
      const a = next[next.length - 1]
      const b = route[i]
      if (!intersectsSegment(a, b, obstacle.box)) {
        next.push(b)
        continue
      }
      const horizontal = Math.abs(a.y - b.y) <= Math.abs(a.x - b.x)
      if (horizontal) {
        const above = obstacle.box.y - 16
        const below = obstacle.box.y + obstacle.box.height + 16
        const center = obstacle.box.y + obstacle.box.height / 2
        // A band around the middle keeps the same side when the line is nudged a few pixels.
        const y = a.y <= center + 12 ? above : below
        next.push({ x: a.x, y }, { x: b.x, y }, b)
      } else {
        const left = obstacle.box.x - 16
        const right = obstacle.box.x + obstacle.box.width + 16
        const center = obstacle.box.x + obstacle.box.width / 2
        const x = a.x <= center + 12 ? left : right
        next.push({ x, y: a.y }, { x, y: b.y }, b)
      }
    }
    route = dedupe(next)
  }
  return route
}

export function resolveConnection(data: ConnectionData, world: ResolvedWorld): ConnectionData {
  const start = resolveEndpoint(data.start, world, data.end)
  const end = resolveEndpoint(data.end, world, start)
  const startAgain = resolveEndpoint(start, world, end)
  return { ...data, start: startAgain, end }
}

export function connectionPoints(data: ConnectionData, obstacles: Obstacle[] = []): Point[] {
  const start = data.start
  const end = data.end
  if (data.path === 'curved') {
    const [c1, c2] = curveControls(start, end, data.curve)
    return sampleCurve(start, c1, c2, end)
  }
  if (data.path === 'elbow') {
    const manual = dedupe(elbowPoints(start, end, data.elbow)).map((point) => ({
      x: point.x,
      y: point.y
    }))
    if (data.routing !== 'avoid') return manual
    const ignore = new Set(
      [data.start.attachment?.id, data.end.attachment?.id].filter((id): id is string => !!id)
    )
    return avoidObstacles(
      manual,
      obstacles.filter((obstacle) => !ignore.has(obstacle.id))
    )
  }
  return [
    { x: start.x, y: start.y },
    { x: end.x, y: end.y }
  ]
}

export function boundsOfPoints(points: Point[], pad = 12): Box {
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const left = Math.min(...xs) - pad
  const top = Math.min(...ys) - pad
  const right = Math.max(...xs) + pad
  const bottom = Math.max(...ys) + pad
  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) }
}

export function pathLength(points: Point[]): number {
  let total = 0
  for (let i = 1; i < points.length; i += 1)
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
  return total
}

export function pointAlong(
  points: Point[],
  t: number
): { point: Point; tangent: Point; normal: Point } {
  const target = clamp(t, 0, 1) * pathLength(points)
  let walked = 0
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]
    const b = points[i]
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    if (walked + length >= target || i === points.length - 1) {
      const local = length === 0 ? 0 : (target - walked) / length
      const tangent = { x: length ? (b.x - a.x) / length : 1, y: length ? (b.y - a.y) / length : 0 }
      return {
        point: { x: a.x + (b.x - a.x) * local, y: a.y + (b.y - a.y) * local },
        tangent,
        normal: { x: -tangent.y, y: tangent.x }
      }
    }
    walked += length
  }
  const last = points[points.length - 1] ?? { x: 0, y: 0 }
  return { point: last, tangent: { x: 1, y: 0 }, normal: { x: 0, y: 1 } }
}

export function labelPosition(points: Point[], label: ConnectionLabel): Point {
  const at = pointAlong(points, label.t)
  return { x: at.point.x + at.normal.x * label.offset, y: at.point.y + at.normal.y * label.offset }
}

/** Parameter along the path closest to a dragged label, plus the signed perpendicular offset. */
/** Turns a dragged elbow handle into a horizontal or vertical bend. The path style stays elbow. */
export function elbowFromPoint(start: Point, end: Point, point: Point): ElbowRoute {
  const dx = Math.abs(end.x - start.x) || 1
  const dy = Math.abs(end.y - start.y) || 1
  const horizontal = Math.abs(point.x - start.x) / dx >= Math.abs(point.y - start.y) / dy
  if (horizontal) {
    const span = end.x - start.x || 1
    return { first: 'h', split: clamp((point.x - start.x) / span, 0.05, 0.95) }
  }
  const span = end.y - start.y || 1
  return { first: 'v', split: clamp((point.y - start.y) / span, 0.05, 0.95) }
}

/** The corner a person drags. Avoid-routing is visual and is not the handle. */
export function elbowHandle(start: Point, end: Point, elbow: ElbowRoute): Point {
  return elbowPoints(start, end, elbow)[1]
}

/** Semicircle that hops over a crossing. It is not stored. */
export function bridgeArc(points: Point[], t: number, radius: number): Point[] {
  const at = pointAlong(points, t)
  const arc: Point[] = []
  for (let i = 0; i <= 8; i += 1) {
    const u = -radius + (2 * radius * i) / 8
    const v = Math.sin(Math.PI * (i / 8)) * radius
    arc.push({
      x: at.point.x + at.tangent.x * u + at.normal.x * v,
      y: at.point.y + at.tangent.y * u + at.normal.y * v
    })
  }
  return arc
}

/** Pieces of a path with a hole around each crossing. The stored points stay intact. */
export function gapSubpaths(points: Point[], crossings: number[], gap: number): Point[][] {
  if (points.length < 2 || crossings.length === 0) return [points]
  const total = pathLength(points) || 1
  const cuts = gapIntervals(total, crossings, gap)
  const inside = (distance: number) => cuts.some(([from, to]) => distance >= from && distance <= to)
  const steps = Math.max(12, Math.ceil(total / 6))
  const runs: Point[][] = []
  let run: Point[] = []
  for (let i = 0; i <= steps; i += 1) {
    const distance = (i / steps) * total
    const point = pointAlong(points, distance / total).point
    if (inside(distance)) {
      if (run.length > 1) runs.push(run)
      run = []
    } else run.push(point)
  }
  if (run.length > 1) runs.push(run)
  return runs.length > 0 ? runs : [points]
}

/** After a group is emptied, a group endpoint stays where it was and remembers the group id. */
export function releaseGroupEndpoint(endpoint: Endpoint, emptied: ReadonlySet<string>): Endpoint {
  const attachment = endpoint.attachment
  if (
    !attachment ||
    attachment.kind !== 'group' ||
    !emptied.has(attachment.id) ||
    attachment.userHeld
  ) {
    return endpoint
  }
  return { ...endpoint, attachment: { ...attachment, missing: true, userHeld: false } }
}

export function labelFromPoint(points: Point[], point: Point): { t: number; offset: number } {
  const length = pathLength(points) || 1
  let best = { distance: Infinity, walked: 0, offset: 0 }
  let walked = 0
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]
    const b = points[i]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const segment = Math.hypot(dx, dy) || 1
    const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / (segment * segment), 0, 1)
    const on = { x: a.x + dx * t, y: a.y + dy * t }
    const normal = { x: -dy / segment, y: dx / segment }
    const offset = (point.x - on.x) * normal.x + (point.y - on.y) * normal.y
    const distance = Math.hypot(point.x - on.x, point.y - on.y)
    if (distance < best.distance) best = { distance, walked: walked + segment * t, offset }
    walked += segment
  }
  return { t: clamp(best.walked / length, 0, 1), offset: clamp(best.offset, -400, 400) }
}

export function distanceToPath(points: Point[], point: Point): number {
  let best = Infinity
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]
    const b = points[i]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const lengthSq = dx * dx + dy * dy || 1
    const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq, 0, 1)
    best = Math.min(best, Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t)))
  }
  return best
}

export interface PathHit {
  id: string
  distance: number
  zIndex: number
}

/** Every connection close enough to click, nearest first, then the higher layer. */
export function hitsAt(
  point: Point,
  items: { id: string; points: Point[]; zIndex: number }[],
  threshold: number
): PathHit[] {
  return items
    .map((item) => ({
      id: item.id,
      zIndex: item.zIndex,
      distance: distanceToPath(item.points, point)
    }))
    .filter((hit) => hit.distance <= threshold)
    .sort((a, b) => a.distance - b.distance || b.zIndex - a.zIndex)
}

function segmentCross(
  a1: Point,
  a2: Point,
  b1: Point,
  b2: Point
): { t: number; u: number; point: Point } | null {
  const dax = a2.x - a1.x
  const day = a2.y - a1.y
  const dbx = b2.x - b1.x
  const dby = b2.y - b1.y
  const denom = dax * dby - day * dbx
  if (Math.abs(denom) < 1e-6) return null
  const t = ((b1.x - a1.x) * dby - (b1.y - a1.y) * dbx) / denom
  const u = ((b1.x - a1.x) * day - (b1.y - a1.y) * dax) / denom
  if (t <= 0.02 || t >= 0.98 || u <= 0.02 || u >= 0.98) return null
  return { t, u, point: { x: a1.x + dax * t, y: a1.y + day * t } }
}

function sharesEnd(a: Point[], b: Point[]): boolean {
  const ends = [a[0], a[a.length - 1]]
  const other = [b[0], b[b.length - 1]]
  return ends.some((end) => other.some((point) => Math.hypot(end.x - point.x, end.y - point.y) < 1))
}

export interface Crossing {
  above: string
  below: string
  /** Parameter along the lower path. */
  t: number
  point: Point
}

/** Visual crossings only. Shared endpoints are not crossings, and nothing here changes the stored path. */
export function findCrossings(
  items: { id: string; points: Point[]; zIndex: number }[]
): Crossing[] {
  const found: Crossing[] = []
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const a = items[i]
      const b = items[j]
      if (sharesEnd(a.points, b.points)) continue
      const above = a.zIndex >= b.zIndex ? a : b
      const below = above === a ? b : a
      for (let s = 1; s < a.points.length; s += 1) {
        for (let r = 1; r < b.points.length; r += 1) {
          const hit = segmentCross(a.points[s - 1], a.points[s], b.points[r - 1], b.points[r])
          if (!hit) continue
          const onBelow = above === a ? hit.u : hit.t
          const lowerSegmentStart = pathLength(below.points.slice(0, above === a ? r : s))
          const lowerSegment = Math.hypot(
            above === a ? b.points[r].x - b.points[r - 1].x : a.points[s].x - a.points[s - 1].x,
            above === a ? b.points[r].y - b.points[r - 1].y : a.points[s].y - a.points[s - 1].y
          )
          const total = pathLength(below.points) || 1
          found.push({
            above: above.id,
            below: below.id,
            t: (lowerSegmentStart + lowerSegment * onBelow) / total,
            point: hit.point
          })
        }
      }
    }
  }
  return found
}

/** Dash gaps around crossings for the lower line. The stored path is unchanged. */
export function gapIntervals(
  total: number,
  crossings: number[],
  gap: number
): Array<[number, number]> {
  return crossings
    .map((t) => {
      const at = t * total
      return [Math.max(0, at - gap), Math.min(total, at + gap)] as [number, number]
    })
    .sort((a, b) => a[0] - b[0])
}

export interface ConnectionChrome {
  show: boolean
  markers: boolean
  label: boolean
  handles: boolean
  /** Smallest stroke, in screen pixels. The stored width is not changed. */
  minScreenStroke: number
}

export function connectionChrome(
  mode: ConnectionDisplay,
  zoom: number,
  selected: boolean
): ConnectionChrome {
  if (mode === 'hidden' && !selected)
    return { show: false, markers: false, label: false, handles: false, minScreenStroke: 1 }
  if (selected)
    return { show: true, markers: true, label: true, handles: true, minScreenStroke: 1.25 }
  if (mode === 'full')
    return { show: true, markers: true, label: true, handles: false, minScreenStroke: 1 }
  if (mode === 'minimal')
    return { show: true, markers: false, label: false, handles: false, minScreenStroke: 1.5 }
  return {
    show: true,
    markers: zoom >= CONNECTION_ZOOM.markers,
    label: zoom >= CONNECTION_ZOOM.labels,
    handles: false,
    minScreenStroke: zoom < CONNECTION_ZOOM.markers ? 1.5 : 1
  }
}

/** Rendered stroke width. Persisted style.width is left alone. */
export function displayStroke(width: number, zoom: number, minScreenStroke: number): number {
  return Math.max(width, minScreenStroke / Math.max(zoom, 0.05))
}

export function remapConnection(
  data: ConnectionData,
  ids: Map<string, string>,
  detachOutside: boolean
): ConnectionData {
  const endpointOf = (endpoint: Endpoint): Endpoint => {
    const attachment = endpoint.attachment
    if (!attachment) return endpoint
    const next = ids.get(attachment.id)
    if (next) return { ...endpoint, attachment: { ...attachment, id: next, missing: false } }
    if (!detachOutside) return endpoint
    return { ...endpoint, attachment: { ...attachment, missing: true } }
  }
  const labelLink = data.labelLink ? remapDestination(data.labelLink, ids, detachOutside) : null
  return { ...data, start: endpointOf(data.start), end: endpointOf(data.end), labelLink }
}

/** Grid used to avoid testing every connection against every obstacle. */
export class SpatialGrid {
  private readonly cells = new Map<string, string[]>()

  constructor(private readonly size = 512) {}

  insert(id: string, box: Box): void {
    const x0 = Math.floor(box.x / this.size)
    const y0 = Math.floor(box.y / this.size)
    const x1 = Math.floor((box.x + box.width) / this.size)
    const y1 = Math.floor((box.y + box.height) / this.size)
    for (let x = x0; x <= x1; x += 1) {
      for (let y = y0; y <= y1; y += 1) {
        const key = `${x}:${y}`
        const list = this.cells.get(key)
        if (list) list.push(id)
        else this.cells.set(key, [id])
      }
    }
  }

  query(box: Box): string[] {
    const found = new Set<string>()
    const x0 = Math.floor(box.x / this.size)
    const y0 = Math.floor(box.y / this.size)
    const x1 = Math.floor((box.x + box.width) / this.size)
    const y1 = Math.floor((box.y + box.height) / this.size)
    for (let x = x0; x <= x1; x += 1) {
      for (let y = y0; y <= y1; y += 1) {
        for (const id of this.cells.get(`${x}:${y}`) ?? []) found.add(id)
      }
    }
    return [...found]
  }
}

export function tangentAt(points: Point[], atEnd: boolean): Point {
  const placed = pointAlong(points, atEnd ? 1 : 0)
  return atEnd ? placed.tangent : { x: -placed.tangent.x, y: -placed.tangent.y }
}
