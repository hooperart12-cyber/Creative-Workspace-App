/** Comment anchors (M8). The anchor follows the artwork. The card position does not. */
import type { ImageCrop } from './crop'
import { worldToLocal, type Point } from './connections'
import type { Box } from './geometry'

export type CommentScope = 'free' | 'object' | 'stack' | 'slide'
export type CommentPresentation = 'card' | 'pin'
export type CommentStatus = 'open' | 'resolved'
export type CommentView = 'open' | 'all' | 'resolved' | 'hidden'

export interface CommentAnchor {
  scope: CommentScope
  targetId: string | null
  slideId: string | null
  /** 0..1 across the full image when the target is an image or slide. Otherwise across the card. */
  u: number
  v: number
  /** Last drawn anchor, kept when the target is missing. */
  x: number
  y: number
  /** `missing` can reattach. `user` is a deliberate detach and must not be overwritten. */
  detached: 'none' | 'missing' | 'user'
}

export interface CommentData {
  version: 1
  presentation: CommentPresentation
  status: CommentStatus
  anchor: CommentAnchor
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function defaultComment(at: Point): CommentData {
  return {
    version: 1,
    presentation: 'card',
    status: 'open',
    anchor: {
      scope: 'free',
      targetId: null,
      slideId: null,
      u: 0,
      v: 0,
      x: at.x,
      y: at.y,
      detached: 'none'
    }
  }
}

export function parseComment(value: unknown): CommentData | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (raw.version !== 1) return null
  const anchor =
    raw.anchor && typeof raw.anchor === 'object' ? (raw.anchor as Record<string, unknown>) : {}
  const scope: CommentScope =
    anchor.scope === 'object' || anchor.scope === 'stack' || anchor.scope === 'slide'
      ? anchor.scope
      : 'free'
  const num = (name: string, fallback: number) =>
    typeof anchor[name] === 'number' && Number.isFinite(anchor[name] as number)
      ? clamp(
          anchor[name] as number,
          name === 'u' || name === 'v' ? 0 : -1e7,
          name === 'u' || name === 'v' ? 1 : 1e7
        )
      : fallback
  return {
    version: 1,
    presentation: raw.presentation === 'pin' ? 'pin' : 'card',
    status: raw.status === 'resolved' ? 'resolved' : 'open',
    anchor: {
      scope,
      targetId: typeof anchor.targetId === 'string' ? anchor.targetId.slice(0, 80) : null,
      slideId: typeof anchor.slideId === 'string' ? anchor.slideId.slice(0, 80) : null,
      u: num('u', 0),
      v: num('v', 0),
      x: num('x', 0),
      y: num('y', 0),
      detached:
        anchor.detached === 'missing' || anchor.detached === 'user' ? anchor.detached : 'none'
    }
  }
}

export function anchorOnImage(
  box: Box & { rotation?: number },
  world: Point,
  asset: { width: number; height: number },
  crop: ImageCrop | null
): { u: number; v: number } {
  const local = worldToLocal(box, world)
  const u = clamp(local.x / Math.max(box.width, 1), 0, 1)
  const v = clamp(local.y / Math.max(box.height, 1), 0, 1)
  if (!crop) return { u, v }
  return {
    u: clamp((crop.x + u * crop.width) / Math.max(asset.width, 1), 0, 1),
    v: clamp((crop.y + v * crop.height) / Math.max(asset.height, 1), 0, 1)
  }
}

/** Card-local 0..1 for an anchor stored against the full image. */
export function imageAnchorToCard(
  anchor: { u: number; v: number },
  asset: { width: number; height: number },
  crop: ImageCrop | null
): { u: number; v: number } {
  if (!crop) return { u: anchor.u, v: anchor.v }
  const px = anchor.u * asset.width
  const py = anchor.v * asset.height
  return {
    u: clamp((px - crop.x) / Math.max(crop.width, 1), 0, 1),
    v: clamp((py - crop.y) / Math.max(crop.height, 1), 0, 1)
  }
}

export function cardPoint(
  box: Box & { rotation?: number },
  local: { u: number; v: number }
): Point {
  const lx = local.u * box.width
  const ly = local.v * box.height
  const rad = ((box.rotation ?? 0) * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return { x: box.x + lx * cos - ly * sin, y: box.y + lx * sin + ly * cos }
}

export function visibleInView(status: CommentStatus, view: CommentView, forced: boolean): boolean {
  if (forced) return true
  if (view === 'hidden') return false
  if (view === 'all') return true
  if (view === 'resolved') return status === 'resolved'
  return status === 'open'
}
