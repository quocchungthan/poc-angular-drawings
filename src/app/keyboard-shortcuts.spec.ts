import { resolveKeyboardShortcutAction } from './keyboard-shortcuts';

describe('keyboard-shortcuts', () => {
  it('resets to select tool on Escape', () => {
    const action = resolveKeyboardShortcutAction({
      key: 'Escape',
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      mode: 'edit',
      editSubMode: 'drawing-edit',
      drawingTool: 'triangle',
      hasSelectedShape: true,
      hasSelectedWaypoint: false,
      focusInEditable: false,
    });

    expect(action).toEqual({ type: 'reset-to-select' });
  });

  it('deletes selected shape in drawing select mode', () => {
    const action = resolveKeyboardShortcutAction({
      key: 'Delete',
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      mode: 'edit',
      editSubMode: 'drawing-edit',
      drawingTool: 'select',
      hasSelectedShape: true,
      hasSelectedWaypoint: false,
      focusInEditable: false,
    });

    expect(action).toEqual({ type: 'delete-selected-shape' });
  });

  it('resolves Ctrl+Z to undo', () => {
    const action = resolveKeyboardShortcutAction({
      key: 'z',
      shiftKey: false,
      ctrlKey: true,
      metaKey: false,
      mode: 'edit',
      editSubMode: 'drawing-edit',
      drawingTool: 'select',
      hasSelectedShape: false,
      hasSelectedWaypoint: false,
      focusInEditable: false,
    });

    expect(action).toEqual({ type: 'undo' });
  });

  it('resolves Ctrl+Shift+Z and Ctrl+Y to redo', () => {
    const redoWithShiftZ = resolveKeyboardShortcutAction({
      key: 'Z',
      shiftKey: true,
      ctrlKey: true,
      metaKey: false,
      mode: 'edit',
      editSubMode: 'drawing-edit',
      drawingTool: 'select',
      hasSelectedShape: false,
      hasSelectedWaypoint: false,
      focusInEditable: false,
    });

    const redoWithY = resolveKeyboardShortcutAction({
      key: 'y',
      shiftKey: false,
      ctrlKey: true,
      metaKey: false,
      mode: 'edit',
      editSubMode: 'drawing-edit',
      drawingTool: 'select',
      hasSelectedShape: false,
      hasSelectedWaypoint: false,
      focusInEditable: false,
    });

    expect(redoWithShiftZ).toEqual({ type: 'redo' });
    expect(redoWithY).toEqual({ type: 'redo' });
  });
});
