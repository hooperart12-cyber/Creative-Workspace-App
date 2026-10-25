/**
 * Fonts for notes (§5). A few open-licence fonts ship with the app so notes look the same on
 * every computer; installed system fonts can be used too. The bundled fonts get their own
 * family names ("CW …") so they never change the app's interface font.
 */
import { useSyncExternalStore } from 'react'
import caveat400 from '@fontsource/caveat/files/caveat-latin-400-normal.woff2?url'
import caveat700 from '@fontsource/caveat/files/caveat-latin-700-normal.woff2?url'
import caveatExt400 from '@fontsource/caveat/files/caveat-latin-ext-400-normal.woff2?url'
import caveatExt700 from '@fontsource/caveat/files/caveat-latin-ext-700-normal.woff2?url'
import inter400 from '@fontsource/inter/files/inter-latin-400-normal.woff2?url'
import inter400i from '@fontsource/inter/files/inter-latin-400-italic.woff2?url'
import inter700 from '@fontsource/inter/files/inter-latin-700-normal.woff2?url'
import inter700i from '@fontsource/inter/files/inter-latin-700-italic.woff2?url'
import interExt400 from '@fontsource/inter/files/inter-latin-ext-400-normal.woff2?url'
import interExt400i from '@fontsource/inter/files/inter-latin-ext-400-italic.woff2?url'
import interExt700 from '@fontsource/inter/files/inter-latin-ext-700-normal.woff2?url'
import interExt700i from '@fontsource/inter/files/inter-latin-ext-700-italic.woff2?url'
import mono400 from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2?url'
import mono400i from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-italic.woff2?url'
import mono700 from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff2?url'
import mono700i from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-700-italic.woff2?url'
import monoExt400 from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-ext-400-normal.woff2?url'
import monoExt400i from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-ext-400-italic.woff2?url'
import monoExt700 from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-ext-700-normal.woff2?url'
import monoExt700i from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-ext-700-italic.woff2?url'
import lora400 from '@fontsource/lora/files/lora-latin-400-normal.woff2?url'
import lora400i from '@fontsource/lora/files/lora-latin-400-italic.woff2?url'
import lora700 from '@fontsource/lora/files/lora-latin-700-normal.woff2?url'
import lora700i from '@fontsource/lora/files/lora-latin-700-italic.woff2?url'
import loraExt400 from '@fontsource/lora/files/lora-latin-ext-400-normal.woff2?url'
import loraExt400i from '@fontsource/lora/files/lora-latin-ext-400-italic.woff2?url'
import loraExt700 from '@fontsource/lora/files/lora-latin-ext-700-normal.woff2?url'
import loraExt700i from '@fontsource/lora/files/lora-latin-ext-700-italic.woff2?url'

export interface NoteFont {
  label: string
  /** CSS font-family value stored in the note. */
  value: string
}

/** Fonts that ship with the app (SIL Open Font License). The first is the default. */
export const BUNDLED_FONTS: NoteFont[] = [
  { label: 'Inter', value: "'CW Inter', sans-serif" },
  { label: 'Lora', value: "'CW Lora', serif" },
  { label: 'JetBrains Mono', value: "'CW JetBrains Mono', monospace" },
  { label: 'Caveat', value: "'CW Caveat', cursive" }
]

export const DEFAULT_NOTE_FONT = BUNDLED_FONTS[0].value

const LATIN =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'
const LATIN_EXT =
  'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF'

type Face = [family: string, url: string, weight: string, style: string, range: string]

const FACES: Face[] = [
  ['CW Inter', inter400, '400', 'normal', LATIN],
  ['CW Inter', inter400i, '400', 'italic', LATIN],
  ['CW Inter', inter700, '700', 'normal', LATIN],
  ['CW Inter', inter700i, '700', 'italic', LATIN],
  ['CW Inter', interExt400, '400', 'normal', LATIN_EXT],
  ['CW Inter', interExt400i, '400', 'italic', LATIN_EXT],
  ['CW Inter', interExt700, '700', 'normal', LATIN_EXT],
  ['CW Inter', interExt700i, '700', 'italic', LATIN_EXT],
  ['CW Lora', lora400, '400', 'normal', LATIN],
  ['CW Lora', lora400i, '400', 'italic', LATIN],
  ['CW Lora', lora700, '700', 'normal', LATIN],
  ['CW Lora', lora700i, '700', 'italic', LATIN],
  ['CW Lora', loraExt400, '400', 'normal', LATIN_EXT],
  ['CW Lora', loraExt400i, '400', 'italic', LATIN_EXT],
  ['CW Lora', loraExt700, '700', 'normal', LATIN_EXT],
  ['CW Lora', loraExt700i, '700', 'italic', LATIN_EXT],
  ['CW JetBrains Mono', mono400, '400', 'normal', LATIN],
  ['CW JetBrains Mono', mono400i, '400', 'italic', LATIN],
  ['CW JetBrains Mono', mono700, '700', 'normal', LATIN],
  ['CW JetBrains Mono', mono700i, '700', 'italic', LATIN],
  ['CW JetBrains Mono', monoExt400, '400', 'normal', LATIN_EXT],
  ['CW JetBrains Mono', monoExt400i, '400', 'italic', LATIN_EXT],
  ['CW JetBrains Mono', monoExt700, '700', 'normal', LATIN_EXT],
  ['CW JetBrains Mono', monoExt700i, '700', 'italic', LATIN_EXT],
  ['CW Caveat', caveat400, '400', 'normal', LATIN],
  ['CW Caveat', caveat700, '700', 'normal', LATIN],
  ['CW Caveat', caveatExt400, '400', 'normal', LATIN_EXT],
  ['CW Caveat', caveatExt700, '700', 'normal', LATIN_EXT]
]

let registered = false
let version = 0
const listeners = new Set<() => void>()

/**
 * Registers the bundled fonts. Each file downloads the first time text needs it; when fonts
 * finish loading, notes measured with a fallback font are measured again.
 */
export function registerNoteFonts(): void {
  if (registered) return
  registered = true
  for (const [family, url, weight, style, unicodeRange] of FACES) {
    document.fonts.add(
      new FontFace(family, `url(${url}) format('woff2')`, { weight, style, unicodeRange })
    )
  }
  document.fonts.addEventListener('loadingdone', () => {
    version++
    for (const listener of listeners) listener()
  })
}

/** Changes whenever more fonts have loaded (notes re-measure their text). */
export function useFontsVersion(): number {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => version
  )
}

export const fontsVersion = (): number => version

/** Loads the bundled fonts' regular faces up front, so the first notes don't jump. */
export function preloadNoteFonts(): Promise<unknown> {
  registerNoteFonts()
  return Promise.all(
    BUNDLED_FONTS.flatMap((f) => [
      document.fonts.load(`400 16px ${f.value}`),
      document.fonts.load(`700 16px ${f.value}`)
    ])
  ).catch(() => undefined)
}

// ── System fonts ─────────────────────────────────────────────────────────────

/** Used when the system can't list its fonts. Common on Windows and macOS. */
const COMMON_SYSTEM_FONTS = [
  'Arial',
  'Calibri',
  'Cambria',
  'Consolas',
  'Courier New',
  'Georgia',
  'Segoe UI',
  'Tahoma',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana'
]

let systemFonts: Promise<NoteFont[]> | null = null

const familyValue = (family: string): string => `"${family.replace(/["\\]/g, '')}"`

/**
 * Fonts installed on this computer. Notes using them may look different on another computer
 * that doesn't have them. Must be called from a click or key press (browser rule).
 */
export function listSystemFonts(): Promise<NoteFont[]> {
  if (!systemFonts) {
    const query = (window as Window & { queryLocalFonts?: () => Promise<{ family: string }[]> })
      .queryLocalFonts
    systemFonts = (query ? query.call(window) : Promise.reject(new Error('unsupported')))
      .then((fonts) => [...new Set(fonts.map((f) => f.family))])
      .catch(() => COMMON_SYSTEM_FONTS)
      .then((families) =>
        families
          .filter((family) => !family.startsWith('CW ') && /^[\p{L}\p{N}\s'._-]+$/u.test(family))
          .sort((a, b) => a.localeCompare(b))
          .map((family) => ({ label: family, value: familyValue(family) }))
      )
  }
  return systemFonts
}

/** Readable name of a stored font-family value. */
export function fontLabel(value: string | null | undefined): string {
  if (!value) return BUNDLED_FONTS[0].label
  const bundled = BUNDLED_FONTS.find((f) => f.value === value)
  if (bundled) return bundled.label
  return value.split(',')[0].replace(/["']/g, '').trim()
}
