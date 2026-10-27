import { describe, expect, it } from 'vitest'
import { History, type Command } from './history'

function counter() {
  let value = 0
  const command = (delta: number): Command => ({
    label: `add ${delta}`,
    undo: async () => {
      value -= delta
    },
    redo: async () => {
      value += delta
    }
  })
  return { get: () => value, apply: (delta: number) => ((value += delta), command(delta)) }
}

describe('History', () => {
  it('undoes and redoes in order', async () => {
    const c = counter()
    const history = new History()
    history.push(c.apply(1))
    history.push(c.apply(10))
    expect(c.get()).toBe(11)
    await history.undo()
    expect(c.get()).toBe(1)
    await history.undo()
    expect(c.get()).toBe(0)
    expect(history.canUndo).toBe(false)
    await history.redo()
    expect(c.get()).toBe(1)
  })

  it('clears redo after a new action', async () => {
    const c = counter()
    const history = new History()
    history.push(c.apply(1))
    await history.undo()
    history.push(c.apply(5))
    expect(history.canRedo).toBe(false)
  })

  it('keeps at most `limit` steps', async () => {
    const c = counter()
    const history = new History(2)
    for (const d of [1, 2, 3]) history.push(c.apply(d))
    await history.undo()
    await history.undo()
    expect(await history.undo()).toBeUndefined()
    expect(c.get()).toBe(1)
  })

  it('runs every step when undo/redo are pressed again before the last one finished', async () => {
    let value = 0
    const order: string[] = []
    const slow = (delta: number): Command => ({
      label: `add ${delta}`,
      undo: async () => {
        order.push(`undo ${delta} start`)
        await new Promise((resolve) => setTimeout(resolve, 20))
        value -= delta
        order.push(`undo ${delta} end`)
      },
      redo: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
        value += delta
      }
    })
    const history = new History()
    for (const d of [1, 10, 100]) {
      value += d
      history.push(slow(d))
    }
    await Promise.all([history.undo(), history.undo(), history.undo()])
    expect(value).toBe(0)
    expect(order).toEqual([
      'undo 100 start',
      'undo 100 end',
      'undo 10 start',
      'undo 10 end',
      'undo 1 start',
      'undo 1 end'
    ])
    await Promise.all([history.redo(), history.redo()])
    expect(value).toBe(11)
    expect(history.canRedo).toBe(true)
  })

  it('keeps going after a failed step', async () => {
    let value = 0
    const history = new History()
    history.push({ label: 'a', undo: async () => void (value -= 1), redo: async () => {} })
    history.push({
      label: 'b',
      undo: () => Promise.reject(new Error('gone')),
      redo: async () => {}
    })
    const [first, second] = await Promise.allSettled([history.undo(), history.undo()])
    expect(first.status).toBe('rejected')
    expect(second.status).toBe('fulfilled')
    expect(value).toBe(-1)
  })

  it('drops a command whose undo fails, so the stack does not get stuck', async () => {
    const history = new History()
    history.push({
      label: 'x',
      undo: () => Promise.reject(new Error('gone')),
      redo: async () => {}
    })
    await expect(history.undo()).rejects.toThrow('gone')
    expect(history.canUndo).toBe(false)
    expect(history.canRedo).toBe(false)
  })
})
