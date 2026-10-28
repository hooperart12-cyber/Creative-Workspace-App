import { cropAspect, cropOf } from '@shared/crop'
import { stackSettings } from '@shared/stacks'
import type { CanvasObject } from '@shared/types'

/** Width ÷ height an object must keep, or null if it can be any shape. PDFs keep the page's proportions. */
export function lockedAspectRatio(o: CanvasObject): number | null {
  if (o.type === 'stack') {
    if (stackSettings(o.data).sizing !== 'adaptive') return null
    const settings = stackSettings(o.data)
    const slide = o.slides?.find((item) => item.id === settings.displayedSlideId) ?? o.slides?.[0]
    if (!slide?.asset?.width || !slide.asset.height) return o.width / o.height
    return cropAspect(slide.crop, slide.asset.width, slide.asset.height)
  }
  if (o.type !== 'image' && o.type !== 'document') return null
  const width = o.asset?.width
  const height = o.asset?.height
  if (o.type === 'image' && width && height) return cropAspect(cropOf(o.data), width, height)
  return width && height ? width / height : o.type === 'image' ? o.width / o.height : null
}

/** Images, stacks, and notes rotate. PDF and file cards do not. */
export const canRotate = (o: CanvasObject): boolean =>
  o.type === 'image' || o.type === 'text' || o.type === 'stack'

/** Objects that open in the full-size viewer. */
export const isViewable = (o: CanvasObject): boolean => o.type === 'image' && !!o.asset
