import type { ArtworkState } from './collections'

/**
 * Stored facts decide blank, missing, unsupported, and damaged.
 * A failed image load is transient and is not the same as a missing file.
 * Changed-external is only set when the caller already tracks an external file.
 */
export function classifyArtwork(input: {
  hasVersion: boolean
  assetPresent: boolean
  mime: string | null
  width: number | null
  height: number | null
  externalChanged?: boolean
  loadFailed?: boolean
}): ArtworkState {
  if (!input.hasVersion) return 'blank'
  if (input.loadFailed && input.assetPresent) return 'transient'
  if (!input.assetPresent) return 'missing'
  if (input.externalChanged) return 'changed-external'
  if (!input.mime?.startsWith('image/')) return 'unsupported'
  if (input.width === 0 || input.height === 0) return 'damaged'
  return 'ready'
}

/** A dragged rectangle, in fractions of the image, becomes whole pixels inside the file. */
export function cropFromFractions(
  image: { width: number; height: number },
  box: { x: number; y: number; w: number; h: number }
): { x: number; y: number; w: number; h: number } {
  const width = Math.max(1, Math.floor(image.width))
  const height = Math.max(1, Math.floor(image.height))
  const x = clamp(Math.floor(box.x * width), 0, width - 1)
  const y = clamp(Math.floor(box.y * height), 0, height - 1)
  const w = clamp(Math.round(box.w * width), 1, width - x)
  const h = clamp(Math.round(box.h * height), 1, height - y)
  return { x, y, w, h }
}

/** Pairs a version's file name with one unused file of the same name. Nothing is written. */
export function planFolderMatch(
  versions: readonly { versionId: string; fileName: string }[],
  files: readonly { name: string; filePath: string }[]
): { versionId: string; filePath: string; fileName: string }[] {
  const unused = new Set(files.map((file) => file.filePath))
  const matches: { versionId: string; filePath: string; fileName: string }[] = []
  for (const version of versions) {
    const wanted = version.fileName.trim().toLowerCase()
    if (!wanted) continue
    const file = files.find(
      (item) => unused.has(item.filePath) && item.name.trim().toLowerCase() === wanted
    )
    if (!file) continue
    unused.delete(file.filePath)
    matches.push({ versionId: version.versionId, filePath: file.filePath, fileName: file.name })
  }
  return matches
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
