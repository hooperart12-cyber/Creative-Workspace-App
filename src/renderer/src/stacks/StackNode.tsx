import { memo } from 'react'
import { Group, Rect, Shape, Text } from 'react-konva'
import { assetUrl, pickVariant } from '@shared/assets'
import { containRect, cropFraction, cropPixels } from '@shared/crop'
import { stackSettings } from '@shared/stacks'
import type { CanvasObject, StackSlide } from '@shared/types'
import { useCanvasStore } from '../store/canvasStore'
import { useProjectStore } from '../store/projectStore'
import { COLORS } from '../canvas/BoardCardNode'
import { useImage } from '../canvas/imageCache'

interface Props {
  object: CanvasObject
  x: number
  y: number
  faded: boolean
  zoom: number
  active: boolean
}

export const StackNode = memo(function StackNode({ object, x, y, faded, zoom, active }: Props) {
  const projectId = useProjectStore((s) => s.project?.id)
  const preview = useCanvasStore((s) =>
    s.stackPreview?.objectId === object.id ? s.stackPreview : null
  )
  const settings = stackSettings(object.data)
  const slides = object.slides ?? []
  const slide =
    slides.find((item) => item.id === (preview?.slideId ?? settings.displayedSlideId)) ?? slides[0]
  const { width, height } = object
  const showNav = active && zoom >= 0.35 && slides.length > 1

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
        fill="#ebe6dc"
        stroke={preview ? '#c4a35a' : '#d9d3c7'}
        strokeWidth={preview ? 3 : 1}
        cornerRadius={4}
      />
      {slide?.asset ? (
        <CroppedImage
          projectId={projectId}
          slide={slide}
          width={width}
          height={height}
          zoom={zoom}
        />
      ) : (
        <Text
          text={settings.name ? `${settings.name}\nDrop images here` : 'Drop images here'}
          width={width - 16}
          x={8}
          y={height / 2 - 16}
          align="center"
          fontSize={13}
          fill={COLORS.muted}
          listening={false}
        />
      )}
      {showNav && (
        <Group name="stack-nav">
          <NavArrow name="stack-prev" x={8} y={height / 2 - 14} label="‹" />
          <NavArrow name="stack-next" x={width - 36} y={height / 2 - 14} label="›" />
          <Text
            text={`${Math.max(1, slides.findIndex((item) => item.id === slide?.id) + 1)} / ${slides.length}`}
            width={width}
            y={height - 22}
            align="center"
            fontSize={12}
            fill={COLORS.muted}
            listening={false}
          />
        </Group>
      )}
      {object.locked && <Text text="🔒" x={width - 24} y={8} fontSize={13} listening={false} />}
    </Group>
  )
})

function CroppedImage({
  projectId,
  slide,
  width,
  height,
  zoom
}: {
  projectId: string | undefined
  slide: StackSlide
  width: number
  height: number
  zoom: number
}) {
  const asset = slide.asset!
  const fraction = cropFraction(slide.crop, asset.width ?? 1, asset.height ?? 1)
  const displayedPx = Math.max(width, height) * zoom * window.devicePixelRatio
  const url =
    projectId && asset.width && asset.height
      ? assetUrl(
          projectId,
          asset.sha256,
          pickVariant(Math.max(asset.width, asset.height), displayedPx, fraction)
        )
      : undefined
  const wanted = useImage(url)
  const image = wanted.status === 'ready' ? wanted.image : undefined
  const pixels =
    asset.width && asset.height
      ? cropPixels(slide.crop, asset.width, asset.height)
      : { x: 0, y: 0, width: 1, height: 1 }
  const fitted = containRect(width, height, pixels.width / pixels.height)
  if (!image) return null
  return (
    <Shape
      x={fitted.x}
      y={fitted.y}
      width={fitted.width}
      height={fitted.height}
      fill="transparent"
      perfectDrawEnabled={false}
      listening={false}
      sceneFunc={(context) => {
        const ctx = context._context
        const scaleX = asset.width ? image.naturalWidth / asset.width : 1
        const scaleY = asset.height ? image.naturalHeight / asset.height : 1
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(
          image,
          pixels.x * scaleX,
          pixels.y * scaleY,
          pixels.width * scaleX,
          pixels.height * scaleY,
          0,
          0,
          fitted.width,
          fitted.height
        )
      }}
    />
  )
}

function NavArrow({ name, x, y, label }: { name: string; x: number; y: number; label: string }) {
  return (
    <Group name={name} x={x} y={y}>
      <Rect width={28} height={28} fill="white" cornerRadius={14} opacity={0.92} />
      <Text
        text={label}
        width={28}
        height={28}
        align="center"
        verticalAlign="middle"
        fontSize={18}
      />
    </Group>
  )
}
