import { AppMode, DrawingTool, EditSubMode } from './poc-types';

export interface KeyboardShortcutContext {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  mode: AppMode;
  editSubMode: EditSubMode;
  drawingTool: DrawingTool;
  hasSelectedShape: boolean;
  hasSelectedWaypoint: boolean;
  focusInEditable: boolean;
}

export type KeyboardShortcutAction =
  | { type: 'none' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset-to-select' }
  | { type: 'delete-selected-shape' }
  | { type: 'delete-selected-waypoint' }
  | { type: 'nudge-selected-shape'; dx: number; dy: number }
  | { type: 'nudge-selected-waypoint'; dx: number; dy: number };

export function resolveKeyboardShortcutAction(context: KeyboardShortcutContext): KeyboardShortcutAction {
  if (context.focusInEditable) {
    return { type: 'none' };
  }

  const keyLower = context.key.toLowerCase();
  const commandPressed = context.ctrlKey || context.metaKey;

  if (commandPressed && !context.shiftKey && keyLower === 'z') {
    return { type: 'undo' };
  }

  if (commandPressed && ((context.shiftKey && keyLower === 'z') || keyLower === 'y')) {
    return { type: 'redo' };
  }

  if (context.key === 'Escape') {
    return { type: 'reset-to-select' };
  }

  if (context.key === 'Delete' || context.key === 'Backspace') {
    if (context.mode !== 'edit') {
      return { type: 'none' };
    }

    if (
      context.editSubMode === 'drawing-edit' &&
      context.drawingTool === 'select' &&
      context.hasSelectedShape
    ) {
      return { type: 'delete-selected-shape' };
    }

    if (context.editSubMode === 'waypoint-edit' && context.hasSelectedWaypoint) {
      return { type: 'delete-selected-waypoint' };
    }

    return { type: 'none' };
  }

  const delta = getArrowDelta(context.key, context.shiftKey ? 10 : 1);
  if (!delta || context.mode !== 'edit') {
    return { type: 'none' };
  }

  if (
    context.editSubMode === 'drawing-edit' &&
    context.drawingTool === 'select' &&
    context.hasSelectedShape
  ) {
    return { type: 'nudge-selected-shape', ...delta };
  }

  if (context.editSubMode === 'waypoint-edit' && context.hasSelectedWaypoint) {
    return { type: 'nudge-selected-waypoint', ...delta };
  }

  return { type: 'none' };
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select';
}

function getArrowDelta(key: string, step: number): { dx: number; dy: number } | null {
  switch (key) {
    case 'ArrowLeft':
      return { dx: -step, dy: 0 };
    case 'ArrowRight':
      return { dx: step, dy: 0 };
    case 'ArrowUp':
      return { dx: 0, dy: -step };
    case 'ArrowDown':
      return { dx: 0, dy: step };
    default:
      return null;
  }
}
