import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useEditorState, type Editor } from '@tiptap/react'
import { readNote, type NoteAppearance } from '@shared/notes'
import type { CanvasObject } from '@shared/types'
import { BUNDLED_FONTS, DEFAULT_NOTE_FONT, listSystemFonts, type NoteFont } from './fonts'
import { fitNotesToContent, resetNoteAppearance, updateNoteStyle } from './noteActions'
import { useNoteStore } from './noteStore'
import { HIGHLIGHTS, ToolButton } from './NoteToolbar'

const keepFocus = (e: React.MouseEvent) => e.preventDefault()

const TEXT_COLORS = [
  '#1f1f1f',
  '#6b6b6b',
  '#b4441c',
  '#c2410c',
  '#a16207',
  '#15803d',
  '#1d4ed8',
  '#7e22ce'
]
const BACKGROUNDS = [
  '#ffffff',
  '#fdf6e3',
  '#fff1a8',
  '#e7f5e4',
  '#e3f0ff',
  '#fbe7f1',
  '#f1efe9',
  '#1f1f1f'
]
const SIZES = [10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64, 72, 96]
const LINE_HEIGHTS: [string, number | null][] = [
  ['Single', 1],
  ['1.15', 1.15],
  ['Default (1.4)', null],
  ['1.6', 1.6],
  ['Double', 2]
]
const SPACE_AFTER: [string, number | null][] = [
  ['None', 0],
  ['Small', 4],
  ['Default', null],
  ['Large', 16],
  ['Extra large', 24]
]

/**
 * The advanced panel (§7): "Selected text" changes the characters or paragraphs the cursor is
 * in; "Whole note" changes the note's box. Each change is its own undo step.
 */
export function NoteFormatPanel({ editor, object }: { editor: Editor; object: CanvasObject }) {
  const read = readNote(object.data)
  const readOnly = useNoteStore((s) => s.editing?.readOnly ?? false)
  return (
    <aside
      aria-label="Formatting"
      data-testid="note-format-panel"
      className="flex w-64 flex-col overflow-y-auto rounded-xl border border-line bg-surface text-sm shadow-sm"
    >
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <h2 className="font-medium">Formatting</h2>
        <button
          type="button"
          onMouseDown={keepFocus}
          onClick={() => useNoteStore.getState().setPanelOpen(false)}
          aria-label="Close formatting"
          className="rounded px-1.5 text-muted hover:bg-canvas hover:text-ink"
        >
          ✕
        </button>
      </div>
      <fieldset disabled={readOnly} className="contents">
        <SelectedText editor={editor} />
        {read.ok && (
          <WholeNote object={object} appearance={read.note.appearance} sizing={read.note.sizing} />
        )}
      </fieldset>
    </aside>
  )
}

function SelectedText({ editor }: { editor: Editor }) {
  const [systemFonts, setSystemFonts] = useState<NoteFont[] | null>(null)
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const style = e.getAttributes('textStyle')
      const block = e.isActive('heading')
        ? e.getAttributes('heading')
        : e.getAttributes('paragraph')
      return {
        font: (style.fontFamily as string | undefined) ?? '',
        size: (style.fontSize as string | undefined) ?? '',
        color: (style.color as string | undefined) ?? '',
        highlight: (e.getAttributes('highlight').color as string | undefined) ?? '',
        align: (block.textAlign as string | undefined) ?? 'left',
        lineHeight: (block.lineHeight as number | null | undefined) ?? null,
        spaceAfter: (block.spaceAfter as number | null | undefined) ?? null
      }
    }
  })
  const chain = () => editor.chain().focus()
  const fonts = [...BUNDLED_FONTS, ...(systemFonts ?? [])]
  const knownFont = !state.font || fonts.some((f) => f.value === state.font)

  return (
    <Section title="Selected text">
      <Row label="Font">
        <select
          aria-label="Font"
          value={state.font || DEFAULT_NOTE_FONT}
          onFocus={() => {
            if (!systemFonts) void listSystemFonts().then(setSystemFonts)
          }}
          onChange={(e) =>
            e.target.value === DEFAULT_NOTE_FONT
              ? chain().unsetFontFamily().run()
              : chain().setFontFamily(e.target.value).run()
          }
          className={selectClass}
        >
          <optgroup label="Included with the app">
            {BUNDLED_FONTS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </optgroup>
          {!knownFont && (
            <option value={state.font}>{state.font.replace(/["']/g, '').split(',')[0]}</option>
          )}
          {systemFonts && (
            <optgroup label="On this computer (may look different elsewhere)">
              {systemFonts.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </Row>
      <Row label="Size">
        <select
          aria-label="Font size"
          value={state.size}
          onChange={(e) =>
            e.target.value
              ? chain().setFontSize(e.target.value).run()
              : chain().unsetFontSize().run()
          }
          className={selectClass}
        >
          <option value="">Default</option>
          {state.size && !SIZES.includes(parseFloat(state.size)) && (
            <option value={state.size}>{parseFloat(state.size)}</option>
          )}
          {SIZES.map((s) => (
            <option key={s} value={`${s}px`}>
              {s}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Colour">
        <Swatches
          label="Text colour"
          colors={TEXT_COLORS}
          value={state.color}
          onPick={(c) => (c ? chain().setColor(c).run() : chain().unsetColor().run())}
          custom
        />
      </Row>
      <Row label="Highlight">
        <Swatches
          label="Highlight"
          colors={HIGHLIGHTS}
          value={state.highlight}
          onPick={(c) =>
            c ? chain().setHighlight({ color: c }).run() : chain().unsetHighlight().run()
          }
        />
      </Row>
      <button
        type="button"
        onMouseDown={keepFocus}
        onClick={() =>
          chain()
            .unsetBold()
            .unsetItalic()
            .unsetUnderline()
            .unsetStrike()
            .unsetHighlight()
            .unsetColor()
            .unsetFontFamily()
            .unsetFontSize()
            .run()
        }
        className={`${buttonClass} self-start`}
        title="Removes bold, colours, fonts and sizes from the selected text (links stay)"
      >
        Clear formatting
      </button>

      <h4 className="mt-2 text-xs font-medium text-muted">Paragraph</h4>
      <Row label="Align">
        <div className="flex gap-0.5">
          {(['left', 'center', 'right'] as const).map((a) => (
            <ToolButton
              key={a}
              label={`Align ${a === 'center' ? 'centre' : a}`}
              active={state.align === a}
              onClick={() =>
                a === 'left' ? chain().unsetTextAlign().run() : chain().setTextAlign(a).run()
              }
            >
              <AlignIcon align={a} />
            </ToolButton>
          ))}
        </div>
      </Row>
      <Row label="Line spacing">
        <select
          aria-label="Line spacing"
          value={String(state.lineHeight ?? '')}
          onChange={(e) =>
            chain()
              .setBlockLineHeight(e.target.value ? Number(e.target.value) : null)
              .run()
          }
          className={selectClass}
        >
          {LINE_HEIGHTS.map(([label, v]) => (
            <option key={label} value={v === null ? '' : String(v)}>
              {label}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Space after">
        <select
          aria-label="Paragraph spacing"
          value={String(state.spaceAfter ?? '')}
          onChange={(e) =>
            chain()
              .setBlockSpaceAfter(e.target.value ? Number(e.target.value) : null)
              .run()
          }
          className={selectClass}
        >
          {SPACE_AFTER.map(([label, v]) => (
            <option key={label} value={v === null ? '' : String(v)}>
              {label}
            </option>
          ))}
        </select>
      </Row>
    </Section>
  )
}

function WholeNote({
  object,
  appearance,
  sizing
}: {
  object: CanvasObject
  appearance: NoteAppearance
  sizing: 'auto' | 'fixed'
}) {
  const ids = [object.id]
  const set = (patch: Partial<NoteAppearance>, label: string) =>
    void updateNoteStyle(ids, { appearance: patch }, label)
  const card = appearance.mode === 'card'

  return (
    <Section title="Whole note">
      <Row label="Style">
        <Segmented
          label="Note style"
          value={appearance.mode}
          options={[
            ['card', 'Card'],
            ['floating', 'Floating text']
          ]}
          onChange={(mode) =>
            set({ mode }, mode === 'card' ? 'Show as card' : 'Show as floating text')
          }
        />
      </Row>
      {card && (
        <>
          <Row label="Background">
            <Swatches
              label="Background colour"
              colors={BACKGROUNDS}
              value={appearance.background}
              onPick={(c) => c && set({ background: c }, 'Note background')}
              custom
              noDefault
            />
          </Row>
          <Row label="Opacity">
            <NumberSelect
              label="Background opacity"
              value={appearance.backgroundOpacity}
              options={[1, 0.9, 0.75, 0.5, 0.25, 0]}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(v) => set({ backgroundOpacity: v }, 'Note opacity')}
            />
          </Row>
          <Row label="Border">
            <NumberSelect
              label="Border width"
              value={appearance.borderWidth}
              options={[0, 1, 2, 3, 4]}
              format={(v) => (v ? `${v} px` : 'None')}
              onChange={(v) => set({ borderWidth: v }, 'Note border')}
            />
          </Row>
          {appearance.borderWidth > 0 && (
            <Row label="Border colour">
              <Swatches
                label="Border colour"
                colors={['#e3e1dc', '#c9c6bf', '#8a877f', '#1f1f1f', '#2f5bd3', '#b4441c']}
                value={appearance.borderColor}
                onPick={(c) => c && set({ borderColor: c }, 'Note border')}
                custom
                noDefault
              />
            </Row>
          )}
          <Row label="Corners">
            <NumberSelect
              label="Corner radius"
              value={appearance.radius}
              options={[0, 4, 10, 16, 24]}
              format={(v) => (v ? `${v} px` : 'Square')}
              onChange={(v) => set({ radius: v }, 'Note corners')}
            />
          </Row>
          <Row label="Shadow">
            <input
              type="checkbox"
              aria-label="Shadow"
              checked={appearance.shadow}
              onChange={(e) => set({ shadow: e.target.checked }, 'Note shadow')}
            />
          </Row>
        </>
      )}
      <Row label="Padding">
        <NumberSelect
          label="Padding"
          value={appearance.padding}
          options={[0, 8, 12, 16, 24, 32]}
          format={(v) => `${v} px`}
          onChange={(v) => set({ padding: v }, 'Note padding')}
        />
      </Row>
      <Row label="Height">
        <Segmented
          label="Height"
          value={sizing}
          options={[
            ['auto', 'Fit text'],
            ['fixed', 'Fixed']
          ]}
          onChange={(s) =>
            void updateNoteStyle(
              ids,
              { sizing: s },
              s === 'auto' ? 'Height fits text' : 'Fixed height'
            )
          }
        />
      </Row>
      {sizing === 'fixed' && (
        <button
          type="button"
          onMouseDown={keepFocus}
          onClick={() => void fitNotesToContent(ids)}
          className={`${buttonClass} self-start`}
        >
          Fit to content
        </button>
      )}
      <button
        type="button"
        onMouseDown={keepFocus}
        onClick={() => void resetNoteAppearance(ids)}
        className={`${buttonClass} self-start`}
        title="Puts the default card look back. The text and its formatting stay."
      >
        Reset appearance
      </button>
    </Section>
  )
}

const selectClass = 'h-7 min-w-0 flex-1 rounded-md border border-line bg-surface px-1 text-sm'
const buttonClass = 'rounded-md border border-line px-2 py-1 text-xs hover:bg-canvas'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-b border-line px-3 py-3 last:border-b-0">
      <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">{title}</h3>
      {children}
    </section>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 text-xs text-muted">{label}</span>
      {children}
    </div>
  )
}

function Swatches({
  label,
  colors,
  value,
  onPick,
  custom,
  noDefault
}: {
  label: string
  colors: string[]
  value: string
  onPick: (color: string | null) => void
  custom?: boolean
  noDefault?: boolean
}) {
  const current = value.toLowerCase()
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1">
      {!noDefault && (
        <button
          type="button"
          onMouseDown={keepFocus}
          onClick={() => onPick(null)}
          aria-label={`${label}: default`}
          aria-pressed={!current}
          title="Default"
          className="h-5 w-5 rounded border border-line bg-surface text-[10px] leading-none text-muted aria-pressed:ring-2 aria-pressed:ring-accent"
        >
          ∅
        </button>
      )}
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          onMouseDown={keepFocus}
          onClick={() => onPick(c)}
          aria-label={`${label}: ${c}`}
          aria-pressed={current === c}
          title={c}
          className="h-5 w-5 rounded border border-line aria-pressed:ring-2 aria-pressed:ring-accent"
          style={{ background: c }}
        />
      ))}
      {custom && <CustomColor label={label} value={current} onPick={onPick} />}
    </div>
  )
}

/** The system colour picker. Applies the colour once it's chosen, not at every step of a drag. */
function CustomColor({
  label,
  value,
  onPick
}: {
  label: string
  value: string
  onPick: (color: string) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const input = ref.current
    if (!input) return
    const onChange = () => onPick(input.value)
    input.addEventListener('change', onChange)
    return () => input.removeEventListener('change', onChange)
  }, [onPick])
  return (
    <input
      ref={ref}
      type="color"
      aria-label={`${label}: custom`}
      title="Custom colour"
      defaultValue={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'}
      key={value}
      className="h-5 w-6 cursor-pointer border-0 bg-transparent p-0"
    />
  )
}

function NumberSelect({
  label,
  value,
  options,
  format,
  onChange
}: {
  label: string
  value: number
  options: number[]
  format: (v: number) => string
  onChange: (v: number) => void
}) {
  const all = options.includes(value) ? options : [...options, value].sort((a, b) => a - b)
  return (
    <select
      aria-label={label}
      value={String(value)}
      onChange={(e) => onChange(Number(e.target.value))}
      className={selectClass}
    >
      {all.map((v) => (
        <option key={v} value={String(v)}>
          {format(v)}
        </option>
      ))}
    </select>
  )
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange
}: {
  label: string
  value: T
  options: [T, string][]
  onChange: (v: T) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex flex-1 rounded-md border border-line p-0.5"
    >
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onMouseDown={keepFocus}
          onClick={() => value !== v && onChange(v)}
          className="flex-1 rounded px-1.5 py-0.5 text-xs aria-checked:bg-accent/10 aria-checked:text-accent"
        >
          {text}
        </button>
      ))}
    </div>
  )
}

function AlignIcon({ align }: { align: 'left' | 'center' | 'right' }) {
  const lines = {
    left: 'M4 6h16M4 10h10M4 14h16M4 18h10',
    center: 'M4 6h16M7 10h10M4 14h16M7 18h10',
    right: 'M4 6h16M10 10h10M4 14h16M10 18h10'
  }[align]
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden
    >
      <path d={lines} />
    </svg>
  )
}
