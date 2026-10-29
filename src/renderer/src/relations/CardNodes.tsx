/** Link cards and comment cards. They stay visually separate from the artwork they refer to. */
import { Group, Rect, Text } from 'react-konva'
import { parseComment } from '@shared/comments'
import { parseDestination } from '@shared/destinations'
import type { CanvasObject } from '@shared/types'
import { COLORS } from '../canvas/BoardCardNode'

export function LinkCardNode({ object, faded }: { object: CanvasObject; faded: boolean }) {
  const data = object.data as {
    title?: string
    description?: string
    destination?: unknown
    layout?: string
  }
  const destination = parseDestination(data.destination)
  const title = data.title?.trim() || destination?.title || 'Link'
  const kind = destination?.kind ?? 'missing'
  return (
    <Group
      id={object.id}
      name="object"
      x={object.x}
      y={object.y}
      opacity={faded ? 0.45 : 1}
      rotation={object.rotation}
    >
      <Rect
        width={object.width}
        height={object.height}
        cornerRadius={10}
        fill={COLORS.surface}
        stroke={COLORS.line}
      />
      <Text
        x={12}
        y={10}
        width={object.width - 24}
        text={title}
        fontSize={14}
        fontStyle="bold"
        fill={COLORS.ink}
      />
      <Text
        x={12}
        y={32}
        width={object.width - 24}
        text={kind === 'url' ? 'Website' : kind}
        fontSize={11}
        fill={COLORS.muted}
      />
      {data.description ? (
        <Text
          x={12}
          y={50}
          width={object.width - 24}
          text={data.description}
          fontSize={12}
          fill={COLORS.ink}
        />
      ) : null}
    </Group>
  )
}

export function CommentNode({
  object,
  faded,
  subdued
}: {
  object: CanvasObject
  faded: boolean
  subdued: boolean
}) {
  const data = parseComment(object.data)
  const message = object.messages?.[0]?.body ?? 'Comment'
  const replies = Math.max(0, (object.messages?.length ?? 1) - 1)
  if (data?.presentation === 'pin') {
    return (
      <Group
        id={object.id}
        name="object"
        x={object.x}
        y={object.y}
        opacity={faded || subdued ? 0.55 : 1}
      >
        <Rect width={28} height={28} cornerRadius={14} fill="#f4c36a" stroke={COLORS.ink} />
        <Text
          x={0}
          y={6}
          width={28}
          align="center"
          text={String(object.messages?.length ?? 1)}
          fontSize={12}
        />
      </Group>
    )
  }
  return (
    <Group
      id={object.id}
      name="object"
      x={object.x}
      y={object.y}
      rotation={object.rotation}
      opacity={faded || subdued ? 0.55 : 1}
    >
      <Rect
        width={object.width}
        height={object.height}
        cornerRadius={10}
        fill="#fff8e8"
        stroke="#e2c98a"
      />
      <Text
        x={10}
        y={10}
        width={object.width - 20}
        height={object.height - 28}
        text={message}
        fontSize={13}
        fill={COLORS.ink}
      />
      <Text
        x={10}
        y={object.height - 22}
        text={replies ? `${replies} replies` : 'Comment'}
        fontSize={11}
        fill={COLORS.muted}
      />
    </Group>
  )
}
