import { Circle, Group, Rect, Text } from 'react-konva'
import type { TagPill } from '@shared/types'

/** Drawn beside an object, not inside it, so bounds, hit testing, and the transformer stay put. */
export function TagMarks({
  tags,
  x,
  y,
  zoom,
  compact
}: {
  tags: TagPill[]
  x: number
  y: number
  zoom: number
  compact: boolean
}) {
  if (tags.length === 0) return null
  const scale = 1 / zoom
  if (compact) {
    const shown = tags.slice(0, 8)
    return (
      <Group x={x} y={y - 8 * scale} scaleX={scale} scaleY={scale} listening={false}>
        {shown.map((tag, index) => (
          <Circle
            key={tag.id}
            x={6 + index * 8}
            y={0}
            radius={3}
            fill={tag.color ?? '#8a8680'}
            listening={false}
          />
        ))}
      </Group>
    )
  }
  const shown = tags.slice(0, 4)
  return (
    <Group x={x} y={y - 22 * scale} scaleX={scale} scaleY={scale} listening={false}>
      {shown.map((tag, index) => {
        const label = tag.name.length > 18 ? `${tag.name.slice(0, 17)}…` : tag.name
        const width = Math.max(28, label.length * 7 + 12)
        const left = shown.slice(0, index).reduce((sum, item) => {
          const text = item.name.length > 18 ? `${item.name.slice(0, 17)}…` : item.name
          return sum + Math.max(28, text.length * 7 + 12) + 4
        }, 0)
        return (
          <Group key={tag.id} x={left} listening={false}>
            <Rect
              width={width}
              height={18}
              cornerRadius={9}
              fill={tag.color ? `${tag.color}33` : '#f4f2ee'}
              stroke={tag.source === 'asset' ? '#3d6df2' : '#d9d6d0'}
              strokeWidth={1}
              listening={false}
            />
            <Text
              text={label}
              x={6}
              y={3}
              width={width - 12}
              fontSize={11}
              fill="#1f1f1f"
              listening={false}
            />
          </Group>
        )
      })}
    </Group>
  )
}
