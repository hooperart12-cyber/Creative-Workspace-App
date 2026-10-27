/** Extensions that must never be launched from the app (ADR-015). */
const DANGEROUS_EXTENSIONS = new Set([
  'app',
  'appimage',
  'bat',
  'cmd',
  'com',
  'command',
  'cpl',
  'dll',
  'exe',
  'jar',
  'js',
  'jse',
  'lnk',
  'msi',
  'ps1',
  'scr',
  'scpt',
  'sh',
  'vbs',
  'wsf',
  'wsh'
])

const MIME_BY_EXT: Record<string, string> = {
  clip: 'application/octet-stream',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  json: 'application/json',
  md: 'text/markdown',
  pdf: 'application/pdf',
  procreate: 'application/octet-stream',
  psd: 'image/vnd.adobe.photoshop',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  txt: 'text/plain',
  zip: 'application/zip'
}

/** How a generic file card is drawn. The file itself does not change. */
export type FileAppearance = 'compact' | 'preview'

export function fileAppearance(data: Record<string, unknown> | null | undefined): FileAppearance {
  return data?.appearance === 'preview' ? 'preview' : 'compact'
}

/** True for executables and scripts. They can be stored, but not opened from the app. */
export function isDangerousExtension(ext: string): boolean {
  return DANGEROUS_EXTENSIONS.has(ext.toLowerCase().replace(/^\./, ''))
}

/** A short, safe extension from a file name, or `bin` when there isn't one. */
export function safeExtension(name: string): string {
  const base = name.trim().toLowerCase()
  const dot = base.lastIndexOf('.')
  const raw = dot > 0 ? base.slice(dot + 1) : ''
  return /^[a-z0-9]{1,12}$/.test(raw) ? raw : 'bin'
}

export function mimeForExtension(ext: string): string {
  return MIME_BY_EXT[ext.toLowerCase()] ?? 'application/octet-stream'
}

/** Imports at least this large are reported. They are still stored. */
export const LARGE_FILE_BYTES = 100 * 1024 * 1024

export function largeFileWarning(name: string): string {
  return `${name} is over 100 MB. It was imported.`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10
  return `${rounded} ${units[unit]}`
}
