import { shouldCommitDragUpdate } from './drag.utils';

describe('drag.utils', () => {
  it('should commit drag update only once when moved', () => {
    expect(shouldCommitDragUpdate(true, false)).toBe(true);
    expect(shouldCommitDragUpdate(true, true)).toBe(false);
    expect(shouldCommitDragUpdate(false, false)).toBe(false);
  });
});
