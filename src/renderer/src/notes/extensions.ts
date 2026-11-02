/**
 * The note editor's schema (ADR-014): one list of Tiptap extensions used by the inline
 * editor, the expanded editor and the hidden copy that measures text for the canvas, so all
 * three lay text out identically. It matches the stored format checked in @shared/notes.
 */
import { Extension, getSchema, type Extensions } from '@tiptap/core'
import Highlight from '@tiptap/extension-highlight'
import TextAlign from '@tiptap/extension-text-align'
import { Color, FontFamily, FontSize, TextStyle } from '@tiptap/extension-text-style'
import StarterKit from '@tiptap/starter-kit'
import { isSafeLink } from '@shared/notes'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    blockSpacing: {
      /** Line height of the current paragraphs (a multiple of the font size), or null for the default. */
      setBlockLineHeight: (lineHeight: number | null) => ReturnType
      /** Space below the current paragraphs, in px, or null for the default. */
      setBlockSpaceAfter: (spaceAfter: number | null) => ReturnType
    }
  }
}

const parseNumber = (value: string, unit = ''): number | null => {
  if (!value) return null
  const match = new RegExp(`^(\\d+(?:\\.\\d+)?)${unit}$`).exec(value.trim())
  return match ? Number(match[1]) : null
}

/** Line spacing and paragraph spacing on paragraphs and headings. */
const BlockSpacing = Extension.create({
  name: 'blockSpacing',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: (el) => parseNumber(el.style.lineHeight),
            renderHTML: (attrs) =>
              attrs.lineHeight ? { style: `line-height: ${attrs.lineHeight}` } : {}
          },
          spaceAfter: {
            default: null,
            parseHTML: (el) => parseNumber(el.style.marginBottom, 'px'),
            renderHTML: (attrs) =>
              attrs.spaceAfter !== null && attrs.spaceAfter !== undefined
                ? { style: `margin-bottom: ${attrs.spaceAfter}px` }
                : {}
          }
        }
      }
    ]
  },
  addCommands() {
    const set =
      (key: 'lineHeight' | 'spaceAfter') =>
      (value: number | null) =>
      ({ commands }: { commands: { updateAttributes: (t: string, a: object) => boolean } }) => {
        const a = commands.updateAttributes('paragraph', { [key]: value })
        const b = commands.updateAttributes('heading', { [key]: value })
        return a || b
      }
    return { setBlockLineHeight: set('lineHeight'), setBlockSpaceAfter: set('spaceAfter') }
  }
})

/** Everything a note can contain. No images, tables, code blocks or quotes (§10, §11). */
export const noteExtensions: Extensions = [
  StarterKit.configure({
    blockquote: false,
    code: false,
    codeBlock: false,
    horizontalRule: false,
    dropcursor: false,
    gapcursor: false,
    trailingNode: false,
    heading: { levels: [1, 2, 3] },
    link: {
      openOnClick: false,
      enableClickSelection: false,
      autolink: true,
      linkOnPaste: true,
      defaultProtocol: 'https',
      protocols: ['http', 'https', 'mailto', 'cw'],
      isAllowedUri: (url) => isSafeLink(url),
      shouldAutoLink: (url) => isSafeLink(url) || isSafeLink(`https://${url}`),
      HTMLAttributes: { target: null, rel: 'noopener noreferrer nofollow', class: null }
    }
  }),
  TextStyle,
  Color,
  FontFamily,
  FontSize,
  Highlight.configure({ multicolor: true }),
  TextAlign.configure({ types: ['heading', 'paragraph'], alignments: ['left', 'center', 'right'] }),
  BlockSpacing
]

export const noteSchema = getSchema(noteExtensions)
