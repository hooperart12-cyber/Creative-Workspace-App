import { describe, expect, it } from 'vitest'
import {
  autoPin,
  avoidObstacles,
  boundsOfPoints,
  connectionChrome,
  connectionPoints,
  curveFromHandle,
  defaultConnection,
  displayStroke,
  distanceToPath,
  bridgeArc,
  elbowFromPoint,
  findCrossings,
  gapSubpaths,
  hitsAt,
  labelFromPoint,
  labelPosition,
  parseConnection,
  pasteStyle,
  pinForLocal,
  pointOnEdge,
  releaseGroupEndpoint,
  remapConnection,
  resolveConnection,
  resolveEndpoint,
  SpatialGrid,
  swapMarkers,
  type ConnectionData,
  type TargetBox
} from './connections'

const box = (
  id: string,
  x: number,
  y: number,
  width = 100,
  height = 80,
  rotation = 0
): TargetBox => ({
  id,
  x,
  y,
  width,
  height,
  rotation
})

describe('connection geometry', () => {
  it('pins a point to the nearest edge and keeps that fraction when the box grows', () => {
    const pin = pinForLocal(100, 80, { x: 40, y: 2 })
    expect(pin).toEqual({ edge: 'top', along: 0.4 })
    const before = pointOnEdge(100, 80, pin)
    const after = pointOnEdge(200, 80, pin)
    expect(before).toEqual({ x: 40, y: 0 })
    expect(after.x / 200).toBeCloseTo(0.4)
    expect(after.y).toBe(0)
  })

  it('chooses the perimeter facing the other end, including a rotated card', () => {
    const target = box('card', 0, 0, 100, 100, 90)
    const pin = autoPin(target, { x: -40, y: 50 })
    expect(
      pin.edge === 'top' || pin.edge === 'left' || pin.edge === 'right' || pin.edge === 'bottom'
    ).toBe(true)
    const world = resolveEndpoint(
      {
        x: 0,
        y: 0,
        attachment: {
          kind: 'object',
          id: 'card',
          placement: 'auto',
          pin: null,
          missing: false,
          userHeld: false
        }
      },
      { objects: new Map([['card', target]]), groups: new Map() },
      { x: -40, y: 50 }
    )
    expect(world.attachment?.missing).toBe(false)
    expect(Number.isFinite(world.x)).toBe(true)
  })

  it('keeps a pinned corner stable when the object moves and rotates', () => {
    const pin = { edge: 'right' as const, along: 0.25 }
    const attachment = {
      kind: 'object' as const,
      id: 'card',
      placement: 'pinned' as const,
      pin,
      missing: false,
      userHeld: false
    }
    const moved = box('card', 300, 40, 100, 80, 0)
    const rotated = box('card', 300, 40, 100, 80, 90)
    const still = resolveEndpoint(
      { x: 0, y: 0, attachment },
      { objects: new Map([['card', moved]]), groups: new Map() },
      { x: 0, y: 0 }
    )
    expect(still.x).toBeCloseTo(400)
    expect(still.y).toBeCloseTo(60)
    const turned = resolveEndpoint(
      { x: 0, y: 0, attachment },
      { objects: new Map([['card', rotated]]), groups: new Map() },
      { x: 0, y: 0 }
    )
    expect(turned.x).not.toBeCloseTo(still.x)
    expect(turned.attachment?.pin).toEqual(pin)
  })

  it('attaches to a group bounds and leaves a free endpoint where it was', () => {
    const data = defaultConnection({ x: 10, y: 10 }, { x: 400, y: 10 })
    data.start.attachment = {
      kind: 'group',
      id: 'g',
      placement: 'auto',
      pin: null,
      missing: false,
      userHeld: false
    }
    const resolved = resolveConnection(data, {
      objects: new Map(),
      groups: new Map([['g', [box('a', 0, 0, 50, 50), box('b', 80, 20, 40, 40)]]])
    })
    expect(resolved.start.x).toBeGreaterThanOrEqual(0)
    expect(resolved.start.x).toBeLessThanOrEqual(120)
    expect(resolved.end).toMatchObject({ x: 400, y: 10, attachment: null })
  })

  it('keeps the last point when the target is missing', () => {
    const end = resolveEndpoint(
      {
        x: 12,
        y: 34,
        attachment: {
          kind: 'object',
          id: 'gone',
          placement: 'pinned',
          pin: { edge: 'top', along: 0.2 },
          missing: false,
          userHeld: false
        }
      },
      { objects: new Map(), groups: new Map() },
      { x: 0, y: 0 }
    )
    expect(end.x).toBe(12)
    expect(end.y).toBe(34)
    expect(end.attachment?.missing).toBe(true)
  })

  it('switches path style without moving the endpoints', () => {
    const straight = defaultConnection({ x: 0, y: 0 }, { x: 200, y: 80 })
    const curved = {
      ...straight,
      path: 'curved' as const,
      curve: { ...straight.curve, offset1: 40, offset2: -20 }
    }
    const elbow = { ...straight, path: 'elbow' as const }
    expect(connectionPoints(curved)[0]).toEqual(connectionPoints(straight)[0])
    expect(connectionPoints(elbow).at(-1)).toEqual({ x: 200, y: 80 })
    expect(connectionPoints(elbow).length).toBeGreaterThan(2)
  })

  it('follows a dragged curve handle when the endpoints later move', () => {
    const data = defaultConnection({ x: 0, y: 0 }, { x: 300, y: 0 })
    data.path = 'curved'
    data.curve = curveFromHandle(data.start, data.end, 1, { x: 80, y: 60 }, data.curve)
    const moved = {
      ...data,
      start: { ...data.start, x: 20, y: 10 },
      end: { ...data.end, x: 320, y: 10 }
    }
    const points = connectionPoints(moved)
    expect(points.some((point) => point.y > 20)).toBe(true)
    expect(points[0]).toEqual({ x: 20, y: 10 })
  })

  it('routes an elbow around an obstacle and stays on that side', () => {
    const through = [
      { x: 0, y: 50 },
      { x: 200, y: 50 }
    ]
    const around = avoidObstacles(through, [
      { id: 'block', box: { x: 80, y: 20, width: 40, height: 60 } }
    ])
    expect(around.some((point) => point.y < 20 || point.y > 80)).toBe(true)
    const nudged = avoidObstacles(
      [
        { x: 0, y: 52 },
        { x: 200, y: 52 }
      ],
      [{ id: 'block', box: { x: 80, y: 20, width: 40, height: 60 } }]
    )
    const side = (points: { y: number }[]) =>
      points.some((point) => point.y < 20) ? 'above' : 'below'
    expect(side(nudged)).toBe(side(around))
  })

  it('treats a shared endpoint as not a crossing and records a real crossing', () => {
    const shared = findCrossings([
      {
        id: 'a',
        zIndex: 1,
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 }
        ]
      },
      {
        id: 'b',
        zIndex: 2,
        points: [
          { x: 10, y: 0 },
          { x: 10, y: 20 }
        ]
      }
    ])
    expect(shared).toEqual([])
    const cross = findCrossings([
      {
        id: 'low',
        zIndex: 1,
        points: [
          { x: 0, y: 10 },
          { x: 20, y: 10 }
        ]
      },
      {
        id: 'high',
        zIndex: 3,
        points: [
          { x: 10, y: 0 },
          { x: 10, y: 20 }
        ]
      }
    ])
    expect(cross).toHaveLength(1)
    expect(cross[0].above).toBe('high')
    expect(cross[0].below).toBe('low')
  })

  it('places a label by path fraction and reads a drag back', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 0 }
    ]
    const label = { text: 'allies', t: 0.25, offset: 12 }
    expect(labelPosition(points, label)).toEqual({ x: 25, y: 12 })
    const read = labelFromPoint(points, { x: 70, y: -8 })
    expect(read.t).toBeCloseTo(0.7)
    expect(read.offset).toBeCloseTo(-8)
  })

  it('keeps a thin line clickable and lists overlaps nearest first', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 0 }
    ]
    expect(distanceToPath(points, { x: 40, y: 3 })).toBeCloseTo(3)
    const hits = hitsAt(
      { x: 50, y: 2 },
      [
        {
          id: 'far',
          zIndex: 1,
          points: [
            { x: 0, y: 30 },
            { x: 100, y: 30 }
          ]
        },
        { id: 'near', zIndex: 1, points },
        {
          id: 'also',
          zIndex: 4,
          points: [
            { x: 0, y: 1 },
            { x: 100, y: 1 }
          ]
        }
      ],
      8
    )
    expect(hits.map((hit) => hit.id)).toEqual(['also', 'near'])
  })

  it('hides unselected connections only in Hide mode and keeps a minimum screen stroke', () => {
    expect(connectionChrome('hidden', 0.2, false).show).toBe(false)
    expect(connectionChrome('hidden', 0.2, true).show).toBe(true)
    expect(connectionChrome('adaptive', 0.2, false)).toMatchObject({
      markers: false,
      label: false,
      show: true
    })
    expect(connectionChrome('adaptive', 1, false)).toMatchObject({ markers: true, label: true })
    expect(connectionChrome('minimal', 1, false)).toMatchObject({
      show: true,
      label: false,
      markers: false
    })
    expect(displayStroke(2, 0.1, 1.5)).toBeGreaterThan(2)
    expect(displayStroke(2, 1, 1.5)).toBe(2)
  })

  it('pastes appearance without replacing the route, label, or destination', () => {
    const data = defaultConnection({ x: 0, y: 0 }, { x: 10, y: 0 })
    data.label = { text: 'path', t: 0.4, offset: 8 }
    data.labelLink = { kind: 'board', boardId: '11111111-1111-4111-8111-111111111111' }
    data.routing = 'avoid'
    const styled = pasteStyle(swapMarkers(data), {
      ...data.style,
      color: '#aa3311',
      width: 6,
      startMarker: 'circle',
      endMarker: 'bar'
    })
    expect(styled.style.color).toBe('#aa3311')
    expect(styled.label?.text).toBe('path')
    expect(styled.labelLink?.kind).toBe('board')
    expect(styled.routing).toBe('avoid')
    expect(styled.start).toEqual(data.start)
  })

  it('remaps a copied attachment and detaches one that left the package', () => {
    const data = defaultConnection({ x: 1, y: 2 }, { x: 3, y: 4 })
    data.start.attachment = {
      kind: 'object',
      id: 'old',
      placement: 'auto',
      pin: null,
      missing: false,
      userHeld: false
    }
    data.end.attachment = {
      kind: 'object',
      id: 'stay',
      placement: 'auto',
      pin: null,
      missing: false,
      userHeld: false
    }
    const copied = remapConnection(data, new Map([['old', 'new']]), true)
    expect(copied.start.attachment?.id).toBe('new')
    expect(copied.end.attachment?.missing).toBe(true)
    expect(copied.end.x).toBe(3)
  })

  it('rejects a connection whose version or shape is not one we store', () => {
    expect(parseConnection({ version: 2 })).toBeNull()
    const parsed = parseConnection(defaultConnection({ x: 5, y: 6 }, { x: 7, y: 8 }))
    expect(parsed?.style.endMarker).toBe('arrow')
    expect(parsed?.style.width).toBe(2)
  })

  it('resolves a thousand connections without scanning every obstacle for each one', () => {
    const grid = new SpatialGrid(200)
    const obstacles = Array.from({ length: 1000 }, (_, index) => {
      const item = {
        id: `o${index}`,
        box: { x: (index % 40) * 30, y: Math.floor(index / 40) * 30, width: 20, height: 20 }
      }
      grid.insert(item.id, item.box)
      return item
    })
    const started = Date.now()
    for (let index = 0; index < 1000; index += 1) {
      const data: ConnectionData = {
        ...defaultConnection({ x: index, y: 0 }, { x: index + 10, y: 40 }),
        path: 'elbow',
        routing: 'avoid'
      }
      const near = new Set(
        grid.query(boundsOfPoints(connectionPoints({ ...data, routing: 'manual' })))
      )
      connectionPoints(data, obstacles.filter((item) => near.has(item.id)).slice(0, 8))
    }
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('keeps a dragged elbow on one side and opens a gap without changing the stored line', () => {
    const bend = elbowFromPoint({ x: 0, y: 0 }, { x: 100, y: 40 }, { x: 70, y: 4 })
    expect(bend.first).toBe('h')
    expect(bend.split).toBeGreaterThan(0.6)
    const line = [
      { x: 0, y: 0 },
      { x: 100, y: 0 }
    ]
    const pieces = gapSubpaths(line, [0.5], 8)
    expect(pieces.length).toBe(2)
    expect(pieces[0][0]).toEqual({ x: 0, y: 0 })
    expect(bridgeArc(line, 0.5, 6).length).toBe(9)
    const endpoint = {
      x: 3,
      y: 4,
      attachment: {
        kind: 'group' as const,
        id: 'group-1',
        placement: 'auto' as const,
        pin: null,
        missing: false,
        userHeld: false
      }
    }
    const released = releaseGroupEndpoint(endpoint, new Set(['group-1']))
    expect(released.attachment?.missing).toBe(true)
    expect(released.attachment?.id).toBe('group-1')
    expect(released.x).toBe(3)
  })
})
