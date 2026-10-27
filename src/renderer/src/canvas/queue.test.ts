import { describe, expect, it } from 'vitest'
import { serialQueue } from './queue'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('serialQueue', () => {
  it('runs tasks one at a time, in order, even when a later one is quicker', async () => {
    const enqueue = serialQueue()
    const log: string[] = []
    const task = (name: string, ms: number) => async () => {
      log.push(`${name} start`)
      await sleep(ms)
      log.push(`${name} end`)
      return name
    }
    const results = await Promise.all([enqueue(task('a', 30)), enqueue(task('b', 1))])
    expect(results).toEqual(['a', 'b'])
    expect(log).toEqual(['a start', 'a end', 'b start', 'b end'])
  })

  it('keeps going after a failure and reports it to the caller', async () => {
    const enqueue = serialQueue()
    const failed = enqueue(() => Promise.reject(new Error('nope')))
    const next = enqueue(async () => 'ok')
    await expect(failed).rejects.toThrow('nope')
    await expect(next).resolves.toBe('ok')
  })
})
