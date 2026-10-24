/** An undoable action. `redo` re-applies it after an undo. */
export interface Command {
  label: string
  undo: () => Promise<void>
  redo: () => Promise<void>
}

/** Undo/redo stacks (§20). One per window; commands carry ids, so they work across boards. */
export class History {
  private undoStack: Command[] = []
  private redoStack: Command[] = []
  private busy = false

  constructor(private readonly limit = 200) {}

  /** Records a command that has already been performed. */
  push(command: Command): void {
    this.undoStack.push(command)
    if (this.undoStack.length > this.limit) this.undoStack.shift()
    this.redoStack = []
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  /** Undoes the last command. If it fails (e.g. the item changed elsewhere), it's dropped. */
  async undo(): Promise<Command | undefined> {
    return this.step(this.undoStack, this.redoStack, (c) => c.undo())
  }

  async redo(): Promise<Command | undefined> {
    return this.step(this.redoStack, this.undoStack, (c) => c.redo())
  }

  clear(): void {
    this.undoStack = []
    this.redoStack = []
  }

  private async step(
    from: Command[],
    to: Command[],
    run: (c: Command) => Promise<void>
  ): Promise<Command | undefined> {
    if (this.busy) return undefined
    const command = from.pop()
    if (!command) return undefined
    this.busy = true
    try {
      await run(command)
      to.push(command)
      return command
    } finally {
      this.busy = false
    }
  }
}
