import type { CanvasObject } from '@shared/types'

/** Width ÷ height an object must keep, or null if it can be any shape. PDFs keep the page's proportions. */
export function lockedAspectRatio(o: CanvasObject): number | null {
  if (o.type !== 'image' && o.type !== 'document') return null
  const width = o.asset?.width
  const height = o.asset?.height
  return width && height ? width / height : o.type === 'image' ? o.width / o.height : null
}

/** Images and notes rotate. PDF and file cards do not. */
export const canRotate = (o: CanvasObject): boolean => o.type === 'image' || o.type === 'text'

/** Objects that open in the full-size viewer. */
export const isViewable = (o: CanvasObject): boolean => o.type === 'image' && !!o.asset
