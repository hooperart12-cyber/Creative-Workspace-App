import { memo } from 'react'
import { Group, Rect, Text } from 'react-konva'
import { collectionCard } from '@shared/collections'
import type { CanvasObject } from '@shared/types'
import { COLORS, TITLE_FONT_SIZE, TITLE_GAP } from '../canvas/BoardCardNode'

interface Props {
  object: CanvasObject
  x: number
  y: number
  faded: boolean
  zoom: number
}

/** One canvas appearance of a collection. Compact and cover are chosen per card. */
export const CollectionNode = memo(function CollectionNode({ object, x, y, faded, zoom }: Props) {
  const card = collectionCard(object.data)
  const cover = card?.display === 'cover'
  const { width, height } = object
  const hairline = 1 / zoom
  const title = object.collection?.title ?? 'Collection'
  const count = object.collection?.pageCount ?? 0
  const missing = object.collection?.missing === true
  const countLabel = count === 1 ? '1 page' : `${count} pages`
  const direction = object.collection?.direction === 'rtl' ? 'RTL' : 'LTR'

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
          cornerRadius={12}
          fill={COLORS.surface}
          stroke={missing ? '#b45309' : COLORS.line}
          strokeWidth={hairline}
          shadowColor="black"
          shadowOpacity={0.06}
          shadowBlur={8}
          shadowOffsetY={2}
          perfectDrawEnabled={false}
        />
        {cover ? (
          <>
            <Rect
              x={10}
              y={10}
              width={Math.max(0, width - 20)}
              height={Math.max(0, height - 54)}
              cornerRadius={8}
              fill={missing ? '#f8efe4' : COLORS.accentSoft}
              listening={false}
            />
            <Text
              text={missing ? 'Missing' : 'Cover'}
              x={18}
              y={18}
              fontSize={11}
              fill={COLORS.muted}
              listening={false}
            />
            <Text
              text={title}
              x={18}
              y={36}
              width={Math.max(0, width - 36)}
              height={Math.max(0, height - 110)}
              fontSize={18}
              fontStyle="600"
              fill={COLORS.ink}
              wrap="word"
              ellipsis
              listening={false}
            />
            <Text
              text={`${countLabel} · ${direction}`}
              x={12}
              y={height - 28}
              width={Math.max(0, width - 24)}
              fontSize={12}
              fill={COLORS.muted}
              listening={false}
            />
          </>
        ) : (
          <>
            <Rect
              x={width / 2 - 16}
              y={height / 2 - 28}
              width={22}
              height={28}
              cornerRadius={3}
              stroke={COLORS.accent}
              strokeWidth={Math.max(1.25, 1.5 / zoom)}
              listening={false}
            />
            <Rect
              x={width / 2 - 8}
              y={height / 2 - 24}
              width={22}
              height={28}
              cornerRadius={3}
              fill={COLORS.surface}
              stroke={COLORS.accent}
              strokeWidth={Math.max(1.25, 1.5 / zoom)}
              listening={false}
            />
            <Text
              text={missing ? 'Missing collection' : countLabel}
              width={width}
              y={height / 2 + 16}
              align="center"
              fontSize={12}
              fill={COLORS.muted}
              listening={false}
            />
          </>
        )}
        {object.locked && <Text text="🔒" x={width - 24} y={8} fontSize={13} listening={false} />}
      </Group>
      <Text
        name="object-title"
        objectId={object.id}
        text={title}
        x={x}
        y={y + height + TITLE_GAP}
        width={width}
        fontSize={TITLE_FONT_SIZE}
        fontStyle="500"
        fill={COLORS.ink}
        opacity={faded ? 0.4 : 1}
        ellipsis
        wrap="none"
      />
    </>
  )
})
