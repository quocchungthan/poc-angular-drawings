import { PersistedPictureState } from './poc-types';
import { UndoRedoManager } from './undo-redo-manager';

function cloneState(state: PersistedPictureState): PersistedPictureState {
  return JSON.parse(JSON.stringify(state)) as PersistedPictureState;
}

describe('UndoRedoManager', () => {
  it('undoes and redoes a shape change', () => {
    const manager = new UndoRedoManager<PersistedPictureState>();
    const key = 'pic-1';
    const before: PersistedPictureState = {
      shapes: [],
      waypoints: [],
    };

    const after = cloneState(before);
    after.shapes.push({
      id: 'shape-1',
      type: 'line',
      color: '#111111',
      strokeWidth: 3,
      points: [
        { x: 10, y: 10 },
        { x: 20, y: 20 },
      ],
    });

    manager.push(key, cloneState(before));
    const undoState = manager.undo(key, cloneState(after));

    expect(undoState).not.toBeNull();
    expect(undoState?.shapes.length).toBe(0);

    const redoState = manager.redo(key, cloneState(before));
    expect(redoState).not.toBeNull();
    expect(redoState?.shapes.length).toBe(1);
  });

  it('undoes and redoes a waypoint move', () => {
    const manager = new UndoRedoManager<PersistedPictureState>();
    const key = 'pic-2';
    const before: PersistedPictureState = {
      shapes: [],
      waypoints: [
        {
          id: 'wp-1',
          pictureId: key,
          name: 'W1',
          x: 100,
          y: 200,
          waypointTypeDescription: 'Custom',
        },
      ],
    };

    const after = cloneState(before);
    after.waypoints[0] = { ...after.waypoints[0], x: 140, y: 240 };

    manager.push(key, cloneState(before));
    const undoState = manager.undo(key, cloneState(after));

    expect(undoState).not.toBeNull();
    expect(undoState?.waypoints[0].x).toBe(100);
    expect(undoState?.waypoints[0].y).toBe(200);

    const redoState = manager.redo(key, cloneState(before));
    expect(redoState).not.toBeNull();
    expect(redoState?.waypoints[0].x).toBe(140);
    expect(redoState?.waypoints[0].y).toBe(240);
  });
});