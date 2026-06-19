export interface UndoRedoEntry<T> {
  readonly past: T[];
  readonly future: T[];
}

export class UndoRedoManager<T> {
  private readonly historyByKey = new Map<string, UndoRedoEntry<T>>();

  constructor(private readonly maxDepth: number = 100) {}

  canUndo(key: string): boolean {
    return (this.historyByKey.get(key)?.past.length ?? 0) > 0;
  }

  canRedo(key: string): boolean {
    return (this.historyByKey.get(key)?.future.length ?? 0) > 0;
  }

  push(key: string, snapshot: T): void {
    const current = this.historyByKey.get(key) ?? { past: [], future: [] };
    const nextPast = [...current.past, snapshot];

    this.historyByKey.set(key, {
      past: nextPast.slice(-this.maxDepth),
      future: [],
    });
  }

  undo(key: string, currentSnapshot: T): T | null {
    const current = this.historyByKey.get(key);
    if (!current || current.past.length === 0) {
      return null;
    }

    const previous = current.past[current.past.length - 1];
    this.historyByKey.set(key, {
      past: current.past.slice(0, -1),
      future: [currentSnapshot, ...current.future].slice(0, this.maxDepth),
    });

    return previous;
  }

  redo(key: string, currentSnapshot: T): T | null {
    const current = this.historyByKey.get(key);
    if (!current || current.future.length === 0) {
      return null;
    }

    const [next, ...remainingFuture] = current.future;
    this.historyByKey.set(key, {
      past: [...current.past, currentSnapshot].slice(-this.maxDepth),
      future: remainingFuture,
    });

    return next;
  }

  clear(key: string): void {
    this.historyByKey.delete(key);
  }
}