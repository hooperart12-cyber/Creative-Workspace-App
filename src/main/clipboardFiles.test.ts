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
    const dir = process.platform === 'win32' ? '/C:/pics' : '/pics'
    const result = localPathsFromUriList(
      `# copied\r\nfile://${dir}/a%20b.png\r\nhttps://example.com/x.png\r\n\r\nfile://localhost${dir}/c.png`
    )
    expect(result.remote).toEqual([])
    expect(result.paths).toHaveLength(2)
    expect(result.paths[0]).toMatch(/a b\.png$/)
  })

  it('never turns a link to another computer into a path', () => {
    const result = localPathsFromUriList(
      'file://attacker.example/share/a.png\nfile:////attacker.example/share/b.png\n' +
        'file:///%5C%5Cattacker.example%5Cshare%5Cc.png'
    )
    expect(result.paths).toEqual([])
    expect(result.remote).toEqual(['a.png', 'b.png', 'c.png'])
  })
})
