import { memo } from 'react'
import { Group, Line, Rect, Text } from 'react-konva'
import type { CanvasObject } from '@shared/types'

export const COLORS = {
  surface: '#ffffff',
  line: '#e3e1dc',
  ink: '#1f1f1f',
  muted: '#6b6b6b',
  accent: '#3d6df2',
  accentSoft: 'rgba(61, 109, 242, 0.12)'
}

/** Gap between a card and its title underneath (Milanote-style). */
export const TITLE_GAP = 8
export const TITLE_FONT_SIZE = 14

interface Props {
  object: CanvasObject
  x: number
  y: number
  /** Shown while dragged cards hover over this card: dropping nests them inside. */
  dropTarget: boolean
  faded: boolean
  hideTitle: boolean
  zoom: number
}

/** A nested-board card drawn on the canvas: a cover tile with an icon, and its title below. */
export const BoardCardNode = memo(function BoardCardNode({
  object,
  x,
  y,
  dropTarget,
  faded,
  hideTitle,
  zoom
}: Props) {
  const { width, height } = object
  const count = object.board?.childBoardCount ?? 0
  const iconSize = Math.min(32, width / 4, height / 4)
  const iconX = width / 2 - iconSize / 2
  const iconY = height / 2 - iconSize / 2 - 10
  // Keep outlines about 1px on screen at any zoom.
  const hairline = 1 / zoom

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
          fill={dropTarget ? '#eef2fe' : COLORS.surface}
          stroke={dropTarget ? COLORS.accent : COLORS.line}
          strokeWidth={dropTarget ? 2 * hairline : hairline}
          shadowColor="black"
          shadowOpacity={0.06}
          shadowBlur={8}
          shadowOffsetY={2}
          perfectDrawEnabled={false}
        />
        {/* Board icon */}
        <Rect
          x={iconX}
          y={iconY}
          width={iconSize}
          height={iconSize}
          cornerRadius={iconSize / 8}
          stroke={COLORS.accent}
          opacity={0.7}
          strokeWidth={Math.max(1.5, iconSize / 14)}
          listening={false}
        />
        <Line
          points={[iconX, iconY + iconSize / 3, iconX + iconSize, iconY + iconSize / 3]}
          stroke={COLORS.accent}
          opacity={0.7}
          strokeWidth={Math.max(1.5, iconSize / 14)}
          listening={false}
        />
        <Line
          points={[
            iconX + iconSize / 3,
            iconY + iconSize / 3,
            iconX + iconSize / 3,
            iconY + iconSize
          ]}
          stroke={COLORS.accent}
          opacity={0.7}
          strokeWidth={Math.max(1.5, iconSize / 14)}
          listening={false}
        />
        <Text
          text={
            dropTarget
              ? 'Drop to move inside'
              : count === 0
                ? 'Empty'
                : `${count} board${count === 1 ? '' : 's'}`
          }
          width={width}
          y={iconY + iconSize + 10}
          align="center"
          fontSize={12}
          fill={dropTarget ? COLORS.accent : COLORS.muted}
          listening={false}
        />
        {object.locked && <Text text="🔒" x={width - 24} y={8} fontSize={13} listening={false} />}
      </Group>
      {/* The title sits below the card and isn't part of the resizable body. Clicking it
        still selects the card (see objectIdOf in CanvasView). */}
      {!hideTitle && (
        <Text
          name="object-title"
          objectId={object.id}
          text={object.board?.title ?? ''}
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
      )}
    </>
  )
})
