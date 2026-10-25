import { memo, useEffect, useMemo, useState } from 'react'
import { Group, Rect, Shape, Text } from 'react-konva'
import type Konva from 'konva'
import { readNote, type NoteAppearance } from '@shared/notes'
import type { CanvasObject } from '@shared/types'
import { COLORS } from '../canvas/BoardCardNode'
import { useFontsVersion } from './fonts'
import { cachedLayout, type NoteLayout } from './layout'

interface Props {
  object: CanvasObject
  x: number
  y: number
  /** Size while being resized (the text reflows live; it's never stretched). */
  width: number
  height: number
  faded: boolean
  zoom: number
  selected: boolean
  /** Being edited here: the editor overlay draws the note instead. */
  editing: boolean
  /** Being edited in another window. */
  editedElsewhere: boolean
  /** How far a fixed-height note's text is scrolled. */
  scrollTop: number
  onMeasured?: (id: string, height: number) => void
}

/** Below this on-screen text size, text is drawn as grey bars (unreadable anyway, and faster). */
const GREEK_BELOW_PX = 3.5

/** A note on the canvas (§5): its card or floating text, drawn from the measured layout. */
export const NoteNode = memo(function NoteNode({
  object,
  x,
  y,
  width,
  height,
  faded,
  zoom,
  selected,
  editing,
  editedElsewhere,
  scrollTop,
  onMeasured
}: Props) {
  const fonts = useFontsVersion()
  const [hovered, setHovered] = useState(false)
  const read = useMemo(() => readNote(object.data), [object.data])
  const appearance = read.ok ? read.note.appearance : null
  const doc = read.ok ? read.note.content.doc : null

  const layout = useMemo((): NoteLayout | null => {
    if (!doc || !appearance) return null
    try {
      return cachedLayout(object.id, doc, width, appearance)
    } catch {
      return null
    }
    // fonts: re-measure once more fonts have loaded.
  }, [object.id, doc, width, appearance, fonts]) // eslint-disable-line react-hooks/exhaustive-deps

  const auto = !read.ok || read.note.sizing === 'auto'
  const measured = layout?.height
  // Auto-height notes are as tall as their text. Tell the canvas if the stored height is off
  // (e.g. fonts finished loading), so selection and arranging use the real size.
  useEffect(() => {
    if (auto && measured !== undefined && !editing && Math.abs(measured - object.height) > 0.5) {
      onMeasured?.(object.id, measured)
    }
  }, [auto, measured, editing, object.height, object.id, onMeasured])

  const boxHeight = auto && measured !== undefined ? measured : height
  const hairline = 1 / zoom

  if (!read.ok || !layout || !appearance) {
    return (
      <Group
        id={object.id}
        name="object"
        x={x}
        y={y}
        width={width}
        height={boxHeight}
        rotation={object.rotation}
        opacity={faded ? 0.4 : 1}
      >
        <Rect
          width={width}
          height={boxHeight}
          fill="#fbf4f2"
          stroke="#d9a8a0"
          strokeWidth={hairline}
          cornerRadius={8}
        />
        <Text
          text={`This note couldn’t be displayed.\n${read.ok ? '' : read.plainText}`}
          width={width}
          height={boxHeight}
          padding={12}
          fontSize={13}
          fill={COLORS.muted}
          ellipsis
          listening={false}
        />
      </Group>
    )
  }

  const card = appearance.mode === 'card'
  const greek = zoom * 16 < GREEK_BELOW_PX
  const empty = layout.runs.every((r) => !r.text.trim())
  const maxScroll = Math.max(0, layout.height - boxHeight)
  const scroll = auto ? 0 : Math.min(scrollTop, maxScroll)

  return (
    <Group
      id={object.id}
      name="object"
      x={x}
      y={y}
      width={width}
      height={boxHeight}
      rotation={object.rotation}
      opacity={faded ? 0.4 : 1}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Rect
        width={width}
        height={boxHeight}
        cornerRadius={appearance.radius}
        {...(card && !editing ? cardFill(appearance) : { fill: 'transparent' })}
        perfectDrawEnabled={false}
      />
      {card && !editing && appearance.borderWidth > 0 && (
        <Rect
          {...cardBorder(appearance, width, boxHeight)}
          listening={false}
          perfectDrawEnabled={false}
        />
      )}
      {!editing && (
        <Shape
          listening={false}
          perfectDrawEnabled={false}
          sceneFunc={(context) => {
            const ctx = context._context
            ctx.save()
            if (!auto) {
              ctx.beginPath()
              roundedRect(ctx, 0, 0, width, boxHeight, appearance.radius)
              ctx.clip()
              ctx.translate(0, -scroll)
            }
            if (greek) drawGreeked(ctx, layout)
            else drawText(ctx, layout, zoom)
            ctx.restore()
            if (!auto && maxScroll > 0)
              drawOverflowHint(
                ctx,
                width,
                boxHeight,
                scroll,
                maxScroll,
                layout.height,
                zoom,
                appearance,
                card
              )
          }}
        />
      )}
      {!editing && empty && (
        <Text
          text="Empty note"
          x={appearance.borderWidth + appearance.padding}
          y={appearance.borderWidth + appearance.padding}
          fontSize={16}
          fontStyle="italic"
          fill="#9a9893"
          listening={false}
        />
      )}
      {!card && !editing && (hovered || selected || empty) && (
        <Rect
          width={width}
          height={boxHeight}
          stroke={COLORS.accent}
          opacity={selected ? 0 : 0.5}
          strokeWidth={hairline}
          dash={[4 * hairline, 3 * hairline]}
          listening={false}
        />
      )}
      {editedElsewhere && (
        <Text
          text="✎ Editing in another window"
          y={-18 / zoom}
          fontSize={12 / zoom}
          fill={COLORS.accent}
          listening={false}
        />
      )}
      {object.locked && <Text text="🔒" x={width - 24} y={8} fontSize={13} listening={false} />}
    </Group>
  )
})

/** Konva style of a card's background and shadow. */
function cardFill(appearance: NoteAppearance): Partial<Konva.RectConfig> {
  return {
    fill: withOpacity(appearance.background, appearance.backgroundOpacity),
    ...(appearance.shadow
      ? { shadowColor: 'black', shadowOpacity: 0.08, shadowBlur: 10, shadowOffsetY: 2 }
      : {})
  }
}

/** The border sits inside the box, like the editor's CSS border, so text lines up exactly. */
function cardBorder(appearance: NoteAppearance, width: number, height: number): Konva.RectConfig {
  const bw = appearance.borderWidth
  return {
    x: bw / 2,
    y: bw / 2,
    width: Math.max(0, width - bw),
    height: Math.max(0, height - bw),
    cornerRadius: Math.max(0, appearance.radius - bw / 2),
    stroke: appearance.borderColor,
    strokeWidth: bw
  }
}

/** The editor's CSS for a note box: the same look as the canvas draws. */
export function noteBoxCss(appearance: NoteAppearance): React.CSSProperties {
  const card = appearance.mode === 'card'
  return {
    padding: appearance.padding,
    borderWidth: appearance.borderWidth,
    borderStyle: 'solid',
    borderColor: card ? appearance.borderColor : 'transparent',
    borderRadius: appearance.radius,
    background: card
      ? withOpacity(appearance.background, appearance.backgroundOpacity)
      : 'transparent',
    boxShadow: card && appearance.shadow ? '0 2px 10px rgba(0, 0, 0, 0.08)' : undefined
  }
}

/** A hex or rgb() colour with an opacity applied. */
export function withOpacity(color: string, opacity: number): string {
  if (opacity >= 1) return color
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color)
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1]
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
    return `rgba(${r}, ${g}, ${b}, ${opacity})`
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(color)
  if (rgb) {
    const [r, g, b] = rgb[1].split(',').map((s) => s.trim())
    return `rgba(${r}, ${g}, ${b}, ${opacity})`
  }
  return color
}

function drawText(ctx: CanvasRenderingContext2D, layout: NoteLayout, zoom: number): void {
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  // Like the editor, put baselines on whole screen pixels (crisper, and the text doesn't
  // shift by a pixel when editing starts). Only when upright: rotated text can't snap.
  const m = ctx.getTransform()
  const upright = m.b === 0 && m.c === 0 && m.d > 0
  const snap = (y: number) => (upright ? (Math.round(m.f) + Math.round(m.d * y) - m.f) / m.d : y)
  for (const run of layout.runs) {
    if (run.highlight) {
      ctx.fillStyle = run.highlight
      ctx.fillRect(run.x, run.top, run.width, run.height)
    }
  }
  for (const run of layout.runs) {
    const baseline = snap(run.baseline)
    ctx.font = run.font
    ctx.fillStyle = run.color
    ctx.fillText(run.text, run.x, baseline)
    if (run.underline || run.strike) {
      // Lines are whole screen pixels thick and sit on whole pixels, like the browser's.
      const thickness = upright
        ? Math.max(1, Math.round(run.fontSize * 0.07 * m.d)) / m.d
        : Math.max(run.fontSize * 0.07, 1 / zoom)
      // Underline: the editor's text-underline-offset (rounded down the page, as the browser
      // does). Strike-through: through the middle of the lower-case letters.
      const underline = upright
        ? snap(baseline + run.fontSize * 0.15 + 0.5 / m.d)
        : baseline + run.fontSize * 0.15
      if (run.underline) ctx.fillRect(run.x, underline, run.width, thickness)
      if (run.strike) ctx.fillRect(run.x, snap(baseline - run.fontSize * 0.2), run.width, thickness)
    }
  }
  ctx.textAlign = 'right'
  for (const marker of layout.markers) {
    ctx.font = marker.font
    ctx.fillStyle = marker.color
    ctx.fillText(marker.text, marker.right, snap(marker.baseline))
  }
}

function drawGreeked(ctx: CanvasRenderingContext2D, layout: NoteLayout): void {
  for (const run of layout.runs) {
    if (!run.text.trim()) continue
    ctx.fillStyle = withOpacity(run.color, 0.35)
    ctx.fillRect(run.x, run.top + run.height * 0.25, run.width, run.height * 0.5)
  }
}

function drawOverflowHint(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  scroll: number,
  maxScroll: number,
  contentHeight: number,
  zoom: number,
  appearance: NoteAppearance,
  card: boolean
): void {
  // Fade at the bottom while there's more below, and a thin scroll bar.
  if (scroll < maxScroll - 0.5 && card) {
    const fade = Math.min(28, height / 3)
    const gradient = ctx.createLinearGradient(0, height - fade, 0, height)
    gradient.addColorStop(0, withOpacity(appearance.background, 0))
    gradient.addColorStop(1, withOpacity(appearance.background, appearance.backgroundOpacity))
    ctx.fillStyle = gradient
    ctx.fillRect(
      appearance.borderWidth,
      height - fade,
      width - appearance.borderWidth * 2,
      fade - appearance.borderWidth
    )
  }
  const barWidth = 3 / zoom
  const track = height - 8 / zoom
  const barHeight = Math.max(16 / zoom, (track * height) / contentHeight)
  const barY = 4 / zoom + ((track - barHeight) * scroll) / maxScroll
  ctx.fillStyle = 'rgba(0, 0, 0, 0.25)'
  ctx.beginPath()
  roundedRect(ctx, width - barWidth - 3 / zoom, barY, barWidth, barHeight, barWidth / 2)
  ctx.fill()
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}
