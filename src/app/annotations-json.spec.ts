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
            lineCap: 'butt',
            lineJoin: 'bevel',
            dash: [6, 3],
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
    expect(parsed.payload.waypoints.length).toBe(0);
    expect(parsed.skippedObjects).toBe(0);
    expect(parsed.payload.shapes.length).toBe(3);

    // Line: points y-flipped with canvasHeight=800
    const line = parsed.payload.shapes[0];
    expect(line.type).toBe('dashed-line');
    if (line.type === 'dashed-line') {
      expect(line.points).toEqual([{ x: 10, y: 780 }, { x: 30, y: 760 }]);
      expect(line.strokeLineCap).toBe('butt');
      expect(line.strokeLineJoin).toBe('bevel');
      expect(line.dashPattern).toEqual([6, 3]);
    }

    // Arrow: converted to arrow shape, start/end taken from first/last point, y-flipped
    const arrow = parsed.payload.shapes[1];
    expect(arrow.type).toBe('arrow');
    if (arrow.type === 'arrow') {
      expect(arrow.startPoint).toEqual({ x: 100, y: 600 });
      expect(arrow.endPoint).toEqual({ x: 160, y: 540 });
    }

    // Rect: converted to rectangle, y-flipped (appY = canvasH - (konvaTop + height))
    const rect = parsed.payload.shapes[2];
    expect(rect.type).toBe('rectangle');
    if (rect.type === 'rectangle') {
      expect(rect.x).toBe(12);
      expect(rect.y).toBe(736); // 800 - (24 + 40)
      expect(rect.width).toBe(60);
      expect(rect.height).toBe(40);
    }
  });

  it('imports Konva ellipse using center coordinates and node scale', () => {
    const pictureId = 'pic-1';
    const konvaPayload = {
      width: 1000,
      height: 500,
      objects: [
        {
          className: 'Ellipse',
          attrs: {
            x: 100,
            y: 50,
            radiusX: 10,
            radiusY: 20,
            scaleX: 1.5,
            scaleY: 0.5,
            stroke: '#a16207',
            strokeWidth: 3,
            strokeScaleEnabled: false,
            rotation: 15,
          },
        },
        {
          className: 'Circle',
          attrs: {
            x: 200,
            y: 60,
            radius: 10,
            scaleX: 1.2,
            scaleY: 0.8,
            stroke: '#a16207',
            strokeWidth: 2,
            strokeScaleEnabled: false,
          },
        },
      ],
      version: 'konva_2.4.8',
    };

    const parsed = parsePictureAnnotationsJson(
      JSON.stringify(konvaPayload),
      pictureId,
      { width: 2000, height: 1000 },
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    expect(parsed.skippedObjects).toBe(0);
    expect(parsed.payload.shapes.length).toBe(2);
    const oval = parsed.payload.shapes[0];
    expect(oval.type).toBe('oval');
    if (oval.type === 'oval') {
      // Effective konva size is 2*radius scaled by node scale.
      expect(oval.x).toBeCloseTo(170, 6);
      expect(oval.y).toBeCloseTo(880, 6);
      expect(oval.width).toBeCloseTo(60, 6);
      expect(oval.height).toBeCloseTo(40, 6);
      // Y-axis conversion in importer flips rotation orientation.
      expect(oval.rotationDeg).toBe(-15);
      // strokeWidth scales with image/canvas ratio (2x in this test).
      expect(oval.strokeWidth).toBeCloseTo(6, 6);
    }

    const circle = parsed.payload.shapes[1];
    expect(circle.type).toBe('circle');
    if (circle.type === 'circle') {
      // Konva circle x/y are center coordinates.
      expect(circle.cx).toBeCloseTo(400, 6);
      expect(circle.cy).toBeCloseTo(880, 6);
      expect(circle.radius).toBeCloseTo(20, 6);
      // strokeWidth scales with image/canvas ratio (2x in this test).
      expect(circle.strokeWidth).toBeCloseTo(4, 6);
    }
  });

  it('imports Konva ellipse without scale attributes as unscaled radii', () => {
    const pictureId = 'pic-1';
    const konvaPayload = {
      width: 100,
      height: 100,
      objects: [
        {
          className: 'Ellipse',
          attrs: {
            x: 40,
            y: 30,
            radiusX: 10,
            radiusY: 5,
            stroke: '#111111',
            strokeWidth: 2,
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

    const oval = parsed.payload.shapes[0];
    expect(oval.type).toBe('oval');
    if (oval.type === 'oval') {
      expect(oval.x).toBe(30);
      expect(oval.y).toBe(65);
      expect(oval.width).toBe(20);
      expect(oval.height).toBe(10);
      expect(oval.rotationDeg).toBe(0);
      expect(oval.strokeWidth).toBe(2);
    }
  });

  it('imports Konva triangle (RegularPolygon sides=3) with non-uniform scale and rotation', () => {
    const pictureId = 'pic-1';
    const konvaPayload = {
      width: 100,
      height: 100,
      objects: [
        {
          className: 'RegularPolygon',
          attrs: {
            sides: 3,
            x: 50,
            y: 60,
            radius: 20,
            scaleX: 2,
            scaleY: 0.5,
            rotation: 90,
            stroke: '#9333ea',
            strokeWidth: 4,
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

    expect(parsed.skippedObjects).toBe(0);
    expect(parsed.payload.shapes.length).toBe(1);
    const triangle = parsed.payload.shapes[0];
    expect(triangle.type).toBe('triangle');
    if (triangle.type === 'triangle') {
      // After scale->rotate transform and y-axis conversion, apex is the highest-lat vertex.
      expect(triangle.points[0].x).toBeCloseTo(58.660254, 6);
      expect(triangle.points[0].y).toBeCloseTo(120, 6);
      expect(triangle.points[1].x).toBeCloseTo(60, 6);
      expect(triangle.points[1].y).toBeCloseTo(65.3589838, 6);
      expect(triangle.points[2].x).toBeCloseTo(40, 6);
      expect(triangle.points[2].y).toBeCloseTo(74.0192379, 6);
    }
  });
});
