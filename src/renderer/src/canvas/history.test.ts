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
