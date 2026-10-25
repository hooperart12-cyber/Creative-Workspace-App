import { memo } from 'react'
import { Group, Rect, Shape, Text } from 'react-konva'
import { assetUrl, pickVariant } from '@shared/assets'
import { fileAppearance, formatBytes } from '@shared/files'
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

/** A stored file that isn't shown as an image or a PDF. Compact, or with an attached preview. */
export const FileNode = memo(function FileNode({ object, x, y, faded, zoom }: Props) {
  const projectId = useProjectStore((s) => s.project?.id)
  const { width, height, asset } = object
  const appearance = fileAppearance(object.data)
  const preview = appearance === 'preview' ? asset?.preview : null
  const displayed = Math.max(width, height) * zoom * window.devicePixelRatio
  const url =
    projectId && preview
      ? assetUrl(
          projectId,
          preview.sha256,
          pickVariant(Math.max(preview.width, preview.height), displayed)
        )
      : undefined
  const image = useImage(url)
  const hairline = 1 / zoom
  const name = asset?.originalName ?? 'File'
  const ext = (asset?.ext ?? 'file').toUpperCase()
  const caption = 36
  const frameH = Math.max(24, height - caption - 12)
  const fitted =
    preview && image.status === 'ready'
      ? contain(width - 16, frameH, image.image.naturalWidth, image.image.naturalHeight)
      : null

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
      <Rect
        width={width}
        height={height}
        cornerRadius={10}
        fill={COLORS.surface}
        stroke={COLORS.line}
        strokeWidth={hairline}
        perfectDrawEnabled={false}
      />
      {appearance === 'preview' ? (
        <>
          {image.status === 'ready' && fitted ? (
            <Shape
              x={8 + fitted.x}
              y={8 + fitted.y}
              width={fitted.width}
              height={fitted.height}
              fill="transparent"
              listening={false}
              perfectDrawEnabled={false}
              sceneFunc={(context) => {
                const ctx = context._context
                ctx.imageSmoothingEnabled = true
                ctx.imageSmoothingQuality = 'high'
                ctx.drawImage(image.image, 0, 0, fitted.width, fitted.height)
              }}
            />
          ) : (
            <Text
              text={preview ? 'Preview' : 'No preview'}
              x={8}
              y={frameH / 2}
              width={width - 16}
              align="center"
              fontSize={12}
              fill={COLORS.muted}
              listening={false}
            />
          )}
          <Text
            text={name}
            x={10}
            y={height - 26}
            width={width - 20}
            fontSize={12}
            fill={COLORS.ink}
            ellipsis
            wrap="none"
            listening={false}
          />
        </>
      ) : (
        <>
          <Rect
            x={12}
            y={height / 2 - 18}
            width={40}
            height={32}
            cornerRadius={6}
            fill={COLORS.accentSoft}
            listening={false}
          />
          <Text
            text={ext.slice(0, 4)}
            x={12}
            y={height / 2 - 6}
            width={40}
            align="center"
            fontSize={10}
            fontStyle="bold"
            fill={COLORS.accent}
            listening={false}
          />
          <Text
            text={name}
            x={62}
            y={height / 2 - 16}
            width={Math.max(24, width - 74)}
            fontSize={13}
            fill={COLORS.ink}
            ellipsis
            wrap="none"
            listening={false}
          />
          <Text
            text={`${ext} · ${formatBytes(asset?.bytes ?? 0)}`}
            x={62}
            y={height / 2 + 2}
            width={Math.max(24, width - 74)}
            fontSize={11}
            fill={COLORS.muted}
            ellipsis
            wrap="none"
            listening={false}
          />
        </>
      )}
      {object.locked && <Text text="🔒" x={width - 22} y={6} fontSize={12} listening={false} />}
    </Group>
  )
})

function contain(boxW: number, boxH: number, imgW: number, imgH: number) {
  const scale = Math.min(boxW / Math.max(1, imgW), boxH / Math.max(1, imgH))
  const width = imgW * scale
  const height = imgH * scale
  return { x: (boxW - width) / 2, y: (boxH - height) / 2, width, height }
}
