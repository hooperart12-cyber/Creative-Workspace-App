import { positionForCenter, rotatedCenter } from './geometry'

export type StackSizing = 'fixed' | 'adaptive'

export interface StackSettings {
  sizing: StackSizing
  rememberLast: boolean
  coverSlideId: string | null
  displayedSlideId: string | null
  name: string | null
  layoutCaptured: boolean
}

export const EMPTY_STACK_SIZE = { width: 320, height: 240 }

export function stackSettings(data: Record<string, unknown> | null | undefined): StackSettings {
  const name = typeof data?.name === 'string' ? data.name.trim() : ''
  return {
    sizing: data?.sizing === 'adaptive' ? 'adaptive' : 'fixed',
    rememberLast: data?.rememberLast === true,
    coverSlideId: typeof data?.coverSlideId === 'string' ? data.coverSlideId : null,
    displayedSlideId: typeof data?.displayedSlideId === 'string' ? data.displayedSlideId : null,
    name: name ? name.slice(0, 80) : null,
    layoutCaptured: data?.layoutCaptured === true
  }
}

export function settingsData(settings: StackSettings): Record<string, unknown> {
  return {
    sizing: settings.sizing,
    rememberLast: settings.rememberLast,
    coverSlideId: settings.coverSlideId,
    displayedSlideId: settings.displayedSlideId,
    name: settings.name,
    layoutCaptured: settings.layoutCaptured
  }
}

/**
 * New card box for an adaptive stack. The center stays put, and the scale (canvas units per
 * source pixel of the crop) stays the scale of the image that was just showing.
 */
export function adaptiveFrame(
  object: { x: number; y: number; width: number; height: number; rotation: number },
  previousSourceWidth: number,
  nextSourceWidth: number,
  nextSourceHeight: number,
  minSize: number
): { x: number; y: number; width: number; height: number } {
  const scale =
    previousSourceWidth > 0 ? object.width / previousSourceWidth : object.width / nextSourceWidth
  let width = Math.max(minSize, nextSourceWidth * (scale > 0 ? scale : 1))
  let height = width * (nextSourceHeight / nextSourceWidth)
  if (height < minSize) {
    height = minSize
    width = height * (nextSourceWidth / nextSourceHeight)
  }
  const center = rotatedCenter(object)
  const position = positionForCenter(center, width, height, object.rotation)
  return {
    x: Math.round(position.x * 100) / 100,
    y: Math.round(position.y * 100) / 100,
    width: Math.round(width * 100) / 100,
    height: Math.round(height * 100) / 100
  }
}
