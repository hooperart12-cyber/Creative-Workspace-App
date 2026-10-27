import type { CanvasObject } from '@shared/types'

/** Width ÷ height an object must keep (images are never distorted, §7), or null if it can be any shape. */
export function lockedAspectRatio(o: CanvasObject): number | null {
  if (o.type !== 'image') return null
  const width = o.asset?.width
  const height = o.asset?.height
  return width && height ? width / height : o.width / o.height
}

/** Images and notes rotate freely; board cards don't. */
export const canRotate = (o: CanvasObject): boolean => o.type === 'image' || o.type === 'text'

/** Objects that open in the full-size viewer. */
export const isViewable = (o: CanvasObject): boolean => o.type === 'image' && !!o.asset
