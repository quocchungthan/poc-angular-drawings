import { createPictureAnnotationsJson, parsePictureAnnotationsJson, serializePictureAnnotations } from './annotations-json';
import { PersistedPictureState } from './poc-types';

describe('annotations-json', () => {
  it('serializes and parses a current picture payload round-trip', () => {
    const pictureId = 'pic-1';
    const state: PersistedPictureState = {
      shapes: [
        {
          id: 'shape-1',
          type: 'line',
          color: '#111111',
          strokeWidth: 3,
          points: [
            { x: 12, y: 34 },
            { x: 56, y: 78 },
          ],
        },
        {
          id: 'shape-circle-1',
          type: 'circle',
          color: '#047857',
          strokeWidth: 3,
          cx: 300,
          cy: 240,
          radius: 96,
        },
        {
          id: 'shape-oval-1',
          type: 'oval',
          color: '#7c3aed',
          strokeWidth: 3,
          x: 410,
          y: 180,
          width: 200,
          height: 120,
          rotationDeg: 18,
        },
      ],
      waypoints: [
        {
          id: 'wp-1',
          pictureId,
          name: 'Sample waypoint',
          x: 91,
          y: 42,
          waypointTypeDescription: 'Corner',
        },
      ],
    };

    const now = new Date('2026-06-18T10:11:12.000Z');
    const json = serializePictureAnnotations(pictureId, state, now);
    const parsed = parsePictureAnnotationsJson(json, pictureId);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const expected = createPictureAnnotationsJson(pictureId, state, now);
    expect(parsed.payload).toEqual(expected);
    expect(parsed.skippedObjects).toBe(0);
  });

  it('parses app-native circle and oval shape payloads', () => {
    const pictureId = 'pic-1';
    const rawPayload = JSON.stringify({
      schemaVersion: 1,
      pictureId,
      exportedAt: '2026-06-18T10:11:12.000Z',
      shapes: [
        {
          id: 'shape-circle-import',
          type: 'circle',
          color: '#0f766e',
          strokeWidth: 2,
          cx: 120,
          cy: 80,
          radius: 40,
        },
        {
          id: 'shape-oval-import',
          type: 'oval',
          color: '#6d28d9',
          strokeWidth: 4,
          x: 300,
          y: 220,
          width: 140,
          height: 70,
          rotationDeg: 32,
        },
      ],
      waypoints: [],
    });

    const parsed = parsePictureAnnotationsJson(rawPayload, pictureId);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    expect(parsed.payload.shapes).toEqual([
      {
        id: 'shape-circle-import',
        type: 'circle',
        color: '#0f766e',
        strokeWidth: 2,
        cx: 120,
        cy: 80,
        radius: 40,
      },
      {
        id: 'shape-oval-import',
        type: 'oval',
        color: '#6d28d9',
        strokeWidth: 4,
        x: 300,
        y: 220,
        width: 140,
        height: 70,
        rotationDeg: 32,
      },
    ]);
  });

  it('imports Konva line-like objects and skips unknown objects', () => {
    const pictureId = 'pic-1';
    const konvaPayload = {
      width: 1200,
      height: 800,
      objects: [
        JSON.stringify({
          className: 'Line',
          attrs: {
            stroke: '#00aa00',
            strokeWidth: 2,
            points: [10, 20, 30, 40],
          },
        }),
        {
          className: 'Arrow',
          attrs: {
            stroke: '#ff0000',
            strokeWidth: 4,
            points: [100, 200, 150, 250, 160, 260],
          },
        },
        {
          className: 'Rect',
          attrs: {
            x: 12,
            y: 24,
            width: 60,
            height: 40,
          },
        },
      ],
      version: 'konva_2.4.8',
    };

    const parsed = parsePictureAnnotationsJson(JSON.stringify(konvaPayload), pictureId);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    expect(parsed.payload.pictureId).toBe(pictureId);
    expect(parsed.payload.shapes.length).toBe(2);
    expect(parsed.payload.waypoints.length).toBe(0);
    expect(parsed.skippedObjects).toBe(1);
  });
});
