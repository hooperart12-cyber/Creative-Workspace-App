/** Electron wraps errors from the main process; keep only the original message. */
export function messageOf(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
