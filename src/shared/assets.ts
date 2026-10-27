import type { AssetVariant } from './types'

/** Custom protocol that serves a project's stored files to the UI (see src/main/assetProtocol.ts). */
export const ASSET_SCHEME = 'cw-asset'

/** Longest side, in pixels, of the generated thumbnails (ADR-005). */
export const THUMBNAIL_SIZES = [256, 1024] as const

/** Image formats that can be placed on boards in v1 (ADR-007, ADR-013). */
export const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'] as const

export const SUPPORTED_IMAGES_LABEL = 'JPG, PNG or WebP'

/** URL of one stored file of an asset: `cw-asset://<projectId>/<sha256>/<variant>`. */
export function assetUrl(projectId: string, sha256: string, variant: AssetVariant): string {
  return `${ASSET_SCHEME}://${projectId}/${sha256}/${variant}`
}

/**
 * The smallest stored file that still looks sharp when the image is drawn
 * `displayedPx` device pixels along its longest side.
 */
export function pickVariant(
  naturalLongSide: number,
  displayedPx: number,
  visibleFraction = 1
): AssetVariant {
  const needed = displayedPx / Math.min(1, Math.max(0.05, visibleFraction))
  for (const size of THUMBNAIL_SIZES) {
    // A thumbnail only exists when it's smaller than the original.
    if (naturalLongSide > size && needed <= size) return size
  }
  return 'original'
}
