import { memo, useEffect, useState } from 'react'
import { Group, Rect, Shape, Text } from 'react-konva'
import { assetUrl, pickVariant } from '@shared/assets'
import type { CanvasObject } from '@shared/types'
import { useProjectStore } from '../store/projectStore'
import { COLORS } from './BoardCardNode'
import { useImage } from './imageCache'

interface Props {
  object: CanvasObject
  x: number
  y: number
  faded: boolean
  zoom: number
}

/**
 * An image on the canvas (§5, §7). Draws the smallest stored version that is sharp at the
 * current zoom (256 px or 1024 px thumbnail, or the original), always at the object's
 * proportional size and with its transparency. While a sharper version loads, the
 * previous one stays on screen.
 */
export const ImageNode = memo(function ImageNode({ object, x, y, faded, zoom }: Props) {
  const projectId = useProjectStore((s) => s.project?.id)
  const { width, height, asset } = object
  const naturalLongSide = Math.max(asset?.width ?? 0, asset?.height ?? 0)
  const displayedPx = Math.max(width, height) * zoom * window.devicePixelRatio
  const url =
    projectId && asset
      ? assetUrl(projectId, asset.sha256, pickVariant(naturalLongSide, displayedPx))
      : undefined

  const wanted = useImage(url)
  const [shownUrl, setShownUrl] = useState<string>()
  useEffect(() => {
    if (wanted.status === 'ready') setShownUrl(url)
  }, [wanted.status, url])
  const previous = useImage(shownUrl !== url ? shownUrl : undefined)
  const image =
    wanted.status === 'ready'
      ? wanted.image
      : previous.status === 'ready'
        ? previous.image
        : undefined

  return (
    <Group
      id={object.id}
      name="object"
      x={x}
      y={y}
      width={width}
      height={height}
      rotation={object.rotation}
      opacity={faded ? 0.4 : 1}
    >
      {image ? (
        <Shape
          width={width}
          height={height}
          // Only used for hit detection (Konva needs a fill to make a shape clickable).
          fill="transparent"
          perfectDrawEnabled={false}
          sceneFunc={(context) => {
            const ctx = context._context
            // Scaling a large image down needs high-quality filtering to stay crisp.
            ctx.imageSmoothingEnabled = true
            ctx.imageSmoothingQuality = 'high'
            ctx.drawImage(image, 0, 0, width, height)
          }}
          // Transparent areas still select the image.
          hitFunc={(context, shape) => {
            context.beginPath()
            context.rect(0, 0, width, height)
            context.closePath()
            context.fillStrokeShape(shape)
          }}
        />
      ) : (
        <>
          <Rect width={width} height={height} fill="#ebe8e2" perfectDrawEnabled={false} />
          {wanted.status === 'failed' && (
            <Text
              text="Image file missing"
              width={width}
              y={height / 2 - 7}
              align="center"
              fontSize={12}
              fill={COLORS.muted}
              listening={false}
            />
          )}
        </>
      )}
      {object.locked && <Text text="🔒" x={width - 24} y={8} fontSize={13} listening={false} />}
    </Group>
  )
})
