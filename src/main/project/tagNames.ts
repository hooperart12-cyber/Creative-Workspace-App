// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/

/** Display name plus the folded key used for uniqueness. SQLite `lower()` is not used. */
export function tagNameParts(input: string): { name: string; normalized: string } {
  if (CONTROL.test(input))
    throw new Error('Tag names cannot contain line breaks or control characters.')
  const name = input.normalize('NFC').replace(/\s+/g, ' ').trim()
  if (!name) throw new Error('Enter a tag name.')
  if (name.length > 80) throw new Error('Tag names can be at most 80 characters.')
  return { name, normalized: name.toLocaleLowerCase('en') }
}

export function tagColor(input: string | null | undefined): string | null {
  if (input == null || input === '') return null
  if (!/^#[0-9A-Fa-f]{6}$/.test(input))
    throw new Error('Tag color must be a hex color like #3D6DF2.')
  return input.toUpperCase()
}
