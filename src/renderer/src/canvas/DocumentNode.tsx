import { memo, useEffect, useState } from 'react'
import { Group, Rect, Shape, Text } from 'react-konva'
import { assetUrl } from '@shared/assets'
import type { CanvasObject } from '@shared/types'
import { useCanvasStore } from '../store/canvasStore'
import { useProjectStore } from '../store/projectStore'
import { COLORS, TITLE_FONT_SIZE, TITLE_GAP } from './BoardCardNode'
import { useImage } from './imageCache'

interface Props {
  object: CanvasObject
  x: number
  y: number
  faded: boolean
  zoom: number
}

/** A PDF on the canvas: the first page at its own proportions, with the file name underneath. */
export const DocumentNode = memo(function DocumentNode({ object, x, y, faded, zoom }: Props) {
  const projectId = useProjectStore((s) => s.project?.id)
  const coverEpoch = useCanvasStore((s) => s.coverEpoch)
  const { width, height, asset } = object
  const url =
    projectId && asset ? `${assetUrl(projectId, asset.sha256, 1024)}?v=${coverEpoch}` : undefined
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
  const hairline = 1 / zoom
  const fitted = image ? contain(width, height, image.naturalWidth, image.naturalHeight) : null

  return (
    <>
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
        <Rect
          width={width}
          height={height}
          fill="#f3f1ec"
          stroke={COLORS.line}
          strokeWidth={hairline}
          perfectDrawEnabled={false}
        />
        {image && fitted ? (
          <Shape
            x={fitted.x}
            y={fitted.y}
            width={fitted.width}
            height={fitted.height}
            fill="transparent"
            listening={false}
            perfectDrawEnabled={false}
            sceneFunc={(context) => {
              const ctx = context._context
              ctx.imageSmoothingEnabled = true
              ctx.imageSmoothingQuality = 'high'
              ctx.drawImage(image, 0, 0, fitted.width, fitted.height)
            }}
          />
        ) : (
          <Text
            text="PDF"
            width={width}
            y={height / 2 - 8}
            align="center"
            fontSize={14}
            fontStyle="bold"
            fill={COLORS.muted}
            listening={false}
          />
        )}
        {object.locked && <Text text="🔒" x={width - 24} y={8} fontSize={13} listening={false} />}
      </Group>
      <Text
        name="object-title"
        objectId={object.id}
        text={asset?.originalName ?? 'PDF'}
        x={x}
        y={y + height + TITLE_GAP}
        width={width}
        fontSize={TITLE_FONT_SIZE}
        fill={COLORS.ink}
        opacity={faded ? 0.4 : 1}
        ellipsis
        wrap="none"
      />
    </>
  )
})

function contain(boxW: number, boxH: number, imgW: number, imgH: number) {
  const scale = Math.min(boxW / Math.max(1, imgW), boxH / Math.max(1, imgH))
  const width = imgW * scale
  const height = imgH * scale
  return { x: (boxW - width) / 2, y: (boxH - height) / 2, width, height }
}
