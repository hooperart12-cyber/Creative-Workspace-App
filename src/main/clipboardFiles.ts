import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Why a pasted file on another computer is skipped. */
export const REMOTE_FILE_REASON =
  'Files on network locations can’t be pasted. Drag the file onto the board instead.'

/**
 * True for a path that points at another computer: `\\server\share\…` (UNC), including the
 * `\\?\UNC\…` and `\\.\…` device forms, or `//server/…`. Opening such a path on Windows makes
 * the OS connect to that host and offer the user's login (NTLM) to it.
 */
export function isNetworkPath(path: string): boolean {
  return /^[\\/]{2}/.test(path)
}

/**
 * Turns a clipboard `text/uri-list` into local file paths. Clipboard text can come from
 * anywhere (a web page, a document), so `file:` links naming a host, and anything that would
 * resolve to a network path, are returned in `remote` without ever being touched on disk.
 */
export function localPathsFromUriList(list: string): { paths: string[]; remote: string[] } {
  const paths: string[] = []
  const remote: string[] = []
  for (const line of list.split(/\r?\n/)) {
    const entry = line.trim()
    if (!entry.startsWith('file:')) continue // blank lines, `#` comments, http links
    let url: URL
    try {
      url = new URL(entry)
    } catch {
      continue
    }
    const pathname = safeDecode(url.pathname)
    const name = basename(pathname.replace(/\\/g, '/')) || entry
    // `file:////server/share` (empty host, path starting with two slashes) also names a server.
    if ((url.hostname !== '' && url.hostname !== 'localhost') || isNetworkPath(pathname)) {
      remote.push(name)
      continue
    }
    let path: string
    try {
      path = fileURLToPath(url)
    } catch {
      continue
    }
    if (isNetworkPath(path)) remote.push(name)
    else paths.push(path)
  }
  return { paths, remote }
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}
