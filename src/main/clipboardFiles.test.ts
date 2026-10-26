import { describe, expect, it } from 'vitest'
import { isNetworkPath, localPathsFromUriList } from './clipboardFiles'

describe('isNetworkPath', () => {
  it('spots UNC and device paths', () => {
    expect(isNetworkPath('\\\\server\\share\\a.png')).toBe(true)
    expect(isNetworkPath('\\\\?\\UNC\\server\\share\\a.png')).toBe(true)
    expect(isNetworkPath('\\\\.\\pipe\\x')).toBe(true)
    expect(isNetworkPath('//server/share/a.png')).toBe(true)
  })

  it('allows local paths', () => {
    expect(isNetworkPath('C:\\Users\\me\\a.png')).toBe(false)
    expect(isNetworkPath('/Users/me/a.png')).toBe(false)
  })
})

describe('localPathsFromUriList', () => {
  it('keeps local file links and skips comments and other schemes', () => {
    const local =
      process.platform === 'win32' ? 'file:///C:/pics/a%20b.png' : 'file:///pics/a%20b.png'
    const result = localPathsFromUriList(
      `# copied\r\n${local}\r\nhttps://example.com/x.png\r\n\r\nfile://localhost/pics/c.png`
    )
    expect(result.remote).toEqual([])
    expect(result.paths).toHaveLength(2)
    expect(result.paths[0]).toMatch(/a b\.png$/)
  })

  it('never turns a link to another computer into a path', () => {
    const result = localPathsFromUriList(
      'file://attacker.example/share/a.png\nfile:////attacker.example/share/b.png'
    )
    expect(result.paths).toEqual([])
    expect(result.remote).toEqual(['a.png', 'b.png'])
  })
})
