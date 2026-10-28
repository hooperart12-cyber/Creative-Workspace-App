/** A non-destructive crop, in source pixels of the original file. */
export interface ImageCrop {
  x: number
  y: number
  width: number
  height: number
}

export function cropOf(data: Record<string, unknown> | null | undefined): ImageCrop | null {
  const value = data?.crop
  if (!value || typeof value !== 'object') return null
  const crop = value as Record<string, unknown>
  const x = numberOrNull(crop.x)
  const y = numberOrNull(crop.y)
  const width = numberOrNull(crop.width)
  const height = numberOrNull(crop.height)
  if (x == null || y == null || width == null || height == null) return null
  if (width <= 0 || height <= 0) return null
  return { x, y, width, height }
}

/** Rejects a crop that leaves the bitmap. A crop of the whole image is stored as no crop. */
export function normalizeCrop(
  crop: ImageCrop | null,
  assetWidth: number,
  assetHeight: number
): ImageCrop | null {
  if (!crop) return null
  const x = Math.round(crop.x)
  const y = Math.round(crop.y)
  const width = Math.round(crop.width)
  const height = Math.round(crop.height)
  if (width < 1 || height < 1) throw new Error('The crop has to cover at least one pixel.')
  if (x < 0 || y < 0 || x + width > assetWidth || y + height > assetHeight) {
    throw new Error('The crop has to stay inside the image.')
  }
  if (x === 0 && y === 0 && width === assetWidth && height === assetHeight) return null
  return { x, y, width, height }
}

export function cropPixels(
  crop: ImageCrop | null,
  assetWidth: number,
  assetHeight: number
): ImageCrop {
  return crop ?? { x: 0, y: 0, width: assetWidth, height: assetHeight }
}

export function cropAspect(
  crop: ImageCrop | null,
  assetWidth: number,
  assetHeight: number
): number {
  const pixels = cropPixels(crop, assetWidth, assetHeight)
  return pixels.width / pixels.height
}

/** Letterboxed rectangle that fits `aspect` (width ÷ height) inside a box. */
export function containRect(
  boxWidth: number,
  boxHeight: number,
  aspect: number
): { x: number; y: number; width: number; height: number } {
  const safe = aspect > 0 ? aspect : 1
  if (boxWidth / boxHeight > safe) {
    const height = boxHeight
    const width = height * safe
    return { x: (boxWidth - width) / 2, y: 0, width, height }
  }
  const width = boxWidth
  const height = width / safe
  return { x: 0, y: (boxHeight - height) / 2, width, height }
}

/** How much of the source's long side the crop uses. 1 means the whole image. */
export function cropFraction(
  crop: ImageCrop | null,
  assetWidth: number,
  assetHeight: number
): number {
  if (!crop || assetWidth < 1 || assetHeight < 1) return 1
  const source = Math.max(assetWidth, assetHeight)
  const used = Math.max(crop.width, crop.height)
  return Math.min(1, Math.max(0.05, used / source))
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
