export function shouldCommitDragUpdate(moved: boolean, committed: boolean): boolean {
  return moved && !committed;
}
