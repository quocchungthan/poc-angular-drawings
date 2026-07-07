import { DrawingShape, PersistedPictureState, Point, Waypoint } from './poc-types';

export interface PictureAnnotationsJson {
  schemaVersion: 1;
  pictureId: string;
  exportedAt: string;
  shapes: DrawingShape[];
  waypoints: Waypoint[];
}

export type ParseAnnotationsResult =
  | { ok: true; payload: PictureAnnotationsJson; skippedObjects: number }
  | { ok: false; error: string };

export function createPictureAnnotationsJson(
  pictureId: string,
  state: PersistedPictureState,
  now: Date = new Date(),
): PictureAnnotationsJson {
  return {
    schemaVersion: 1,
    pictureId,
    exportedAt: now.toISOString(),
    shapes: state.shapes.map((shape) => cloneShape(shape)),
    waypoints: state.waypoints.map((waypoint) => ({ ...waypoint })),
  };
}

export function serializePictureAnnotations(
  pictureId: string,
  state: PersistedPictureState,
  now: Date = new Date(),
): string {
  return JSON.stringify(createPictureAnnotationsJson(pictureId, state, now), null, 2);
}

export function parsePictureAnnotationsJson(raw: string, expectedPictureId: string): ParseAnnotationsResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { ok: false, error: 'Invalid JSON format. Please choose a valid exported file.' };
  }

  if (isPictureAnnotationsJson(parsed)) {
    if (parsed.pictureId !== expectedPictureId) {
      return {
        ok: false,
        error: `This file is for ${parsed.pictureId}. Please switch to picture ${parsed.pictureId} before importing.`,
      };
    }

    return { ok: true, payload: parsed, skippedObjects: 0 };
  }

  const konvaResult = parseKonvaLineLikeImport(parsed, expectedPictureId);
  if (konvaResult) {
    return konvaResult;
  }

  return {
    ok: false,
    error: 'Unsupported annotation format. Expected schemaVersion, pictureId, shapes and waypoints.',
  };
}

export function buildAnnotationsExportFileName(pictureId: string, now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return `annotations-${pictureId}-${stamp}.json`;
}

function isPictureAnnotationsJson(value: unknown): value is PictureAnnotationsJson {
  if (!isRecord(value)) {
    return false;
  }

  if (value['schemaVersion'] !== 1) {
    return false;
  }

  if (typeof value['pictureId'] !== 'string' || typeof value['exportedAt'] !== 'string') {
    return false;
  }

  if (!Array.isArray(value['shapes']) || !Array.isArray(value['waypoints'])) {
    return false;
  }

  return value['shapes'].every(isDrawingShape) && value['waypoints'].every(isWaypoint);
}

function parseKonvaLineLikeImport(
  value: unknown,
  pictureId: string,
): Extract<ParseAnnotationsResult, { ok: true }> | null {
  if (!isRecord(value) || !Array.isArray(value['objects'])) {
    return null;
  }

  const canvasHeight = typeof value['height'] === 'number' ? value['height'] : 0;
  const flipY = (y: number): number => (canvasHeight > 0 ? canvasHeight - y : y);

  const objects = value['objects'];
  const shapes: DrawingShape[] = [];
  let skippedObjects = 0;

  for (const rawObject of objects) {
    const parsedObject = parseMaybeJsonObject(rawObject);
    if (!parsedObject) {
      skippedObjects += 1;
      continue;
    }

    const className = typeof parsedObject['className'] === 'string' ? parsedObject['className'] : '';
    const attrs = isRecord(parsedObject['attrs']) ? parsedObject['attrs'] : null;
    const stroke = attrs && typeof attrs['stroke'] === 'string' ? attrs['stroke'] : '#111111';
    const strokeWidth = attrs && typeof attrs['strokeWidth'] === 'number' ? attrs['strokeWidth'] : 3;
    const shapeId = `shape-import-${shapes.length + 1}`;

    if (className === 'Line' || className === 'Arrow') {
      const points = attrs ? toPointPairs(attrs['points']) : null;
      if (!points || points.length < 2) {
        skippedObjects += 1;
        continue;
      }

      const flippedPoints = points.map((p) => ({ x: p.x, y: flipY(p.y) }));

      if (className === 'Arrow') {
        const startPt = flippedPoints[0];
        const endPt = flippedPoints[flippedPoints.length - 1];
        shapes.push({
          id: shapeId,
          type: 'arrow',
          color: stroke,
          strokeWidth,
          startPoint: startPt,
          endPoint: endPt,
          direction: 'right',
        });
      } else {
        const dash = Array.isArray(attrs?.['dash']) ? (attrs?.['dash'] as unknown[]) : undefined;
        shapes.push({
          id: shapeId,
          type: dash && dash.length > 0 ? 'dashed-line' : 'line',
          color: stroke,
          strokeWidth,
          points: flippedPoints,
        });
      }
      continue;
    }

    if (className === 'Rect') {
      if (!attrs) {
        skippedObjects += 1;
        continue;
      }
      const rx = typeof attrs['x'] === 'number' ? attrs['x'] : null;
      const ry = typeof attrs['y'] === 'number' ? attrs['y'] : null;
      const rw = typeof attrs['width'] === 'number' ? attrs['width'] : null;
      const rh = typeof attrs['height'] === 'number' ? attrs['height'] : null;
      if (rx === null || ry === null || rw === null || rh === null) {
        skippedObjects += 1;
        continue;
      }
      const absW = Math.abs(rw);
      const absH = Math.abs(rh);
      const leftX = rw < 0 ? rx + rw : rx;
      const konvaTopY = rh < 0 ? ry + rh : ry;
      // app y = minimum lat = bottom of rect in Leaflet = canvasH - (konvaTop + absH)
      const appY = flipY(konvaTopY + absH);
      const rotationDeg = typeof attrs['angle'] === 'number' ? attrs['angle'] : 0;
      shapes.push({
        id: shapeId,
        type: 'rectangle',
        color: stroke,
        strokeWidth,
        x: leftX,
        y: appY,
        width: absW,
        height: absH,
        rotationDeg,
      });
      continue;
    }

    if (className === 'Ellipse') {
      if (!attrs) {
        skippedObjects += 1;
        continue;
      }
      const ex = typeof attrs['x'] === 'number' ? attrs['x'] : null;
      const ey = typeof attrs['y'] === 'number' ? attrs['y'] : null;
      const radiusX = typeof attrs['radiusX'] === 'number' ? attrs['radiusX'] : null;
      const radiusY = typeof attrs['radiusY'] === 'number' ? attrs['radiusY'] : null;
      if (ex === null || ey === null || radiusX === null || radiusY === null) {
        skippedObjects += 1;
        continue;
      }
      // Fabric Ellipse with originX="left", originY="top": (x,y) is top-left corner
      const appY = flipY(ey + 2 * radiusY);
      const rotationDeg = typeof attrs['angle'] === 'number' ? attrs['angle'] : 0;
      shapes.push({
        id: shapeId,
        type: 'oval',
        color: stroke,
        strokeWidth,
        x: ex,
        y: appY,
        width: 2 * radiusX,
        height: 2 * radiusY,
        rotationDeg,
      });
      continue;
    }

    if (className === 'Circle') {
      if (!attrs) {
        skippedObjects += 1;
        continue;
      }
      const cx = typeof attrs['x'] === 'number' ? attrs['x'] : null;
      const cy = typeof attrs['y'] === 'number' ? attrs['y'] : null;
      const radius = typeof attrs['radius'] === 'number' ? attrs['radius'] : null;
      if (cx === null || cy === null || radius === null || radius <= 0) {
        skippedObjects += 1;
        continue;
      }
      // Fabric Circle with originX="left", originY="top": (x,y) is top-left corner, center = (x+r, y+r)
      const konvaCenterY = cy + radius;
      shapes.push({
        id: shapeId,
        type: 'circle',
        color: stroke,
        strokeWidth,
        cx: cx + radius,
        cy: flipY(konvaCenterY),
        radius,
      });
      continue;
    }

    skippedObjects += 1;
  }

  if (shapes.length === 0) {
    return null;
  }

  return {
    ok: true,
    skippedObjects,
    payload: {
      schemaVersion: 1,
      pictureId,
      exportedAt: new Date().toISOString(),
      shapes,
      waypoints: [],
    },
  };
}

function isDrawingShape(value: unknown): value is DrawingShape {
  if (!isRecord(value)) {
    return false;
  }

  if (
    typeof value['id'] !== 'string' ||
    typeof value['color'] !== 'string' ||
    typeof value['strokeWidth'] !== 'number'
  ) {
    return false;
  }

  if (value['type'] === 'line' || value['type'] === 'dashed-line') {
    return Array.isArray(value['points']) && value['points'].length >= 2 && value['points'].every(isPoint);
  }

  if (value['type'] === 'rectangle') {
    const hasRotation = value['rotationDeg'] === undefined || typeof value['rotationDeg'] === 'number';
    return (
      typeof value['x'] === 'number' &&
      typeof value['y'] === 'number' &&
      typeof value['width'] === 'number' &&
      typeof value['height'] === 'number' &&
      hasRotation
    );
  }

  if (value['type'] === 'triangle') {
    return Array.isArray(value['points']) && value['points'].length === 3 && value['points'].every(isPoint);
  }

  if (value['type'] === 'circle') {
    return (
      typeof value['cx'] === 'number' &&
      typeof value['cy'] === 'number' &&
      typeof value['radius'] === 'number' &&
      value['radius'] > 0
    );
  }

  if (value['type'] === 'oval') {
    const hasRotation = value['rotationDeg'] === undefined || typeof value['rotationDeg'] === 'number';
    return (
      typeof value['x'] === 'number' &&
      typeof value['y'] === 'number' &&
      typeof value['width'] === 'number' &&
      typeof value['height'] === 'number' &&
      hasRotation
    );
  }

  return false;
}

function isWaypoint(value: unknown): value is Waypoint {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value['id'] === 'string' &&
    typeof value['pictureId'] === 'string' &&
    typeof value['name'] === 'string' &&
    typeof value['x'] === 'number' &&
    typeof value['y'] === 'number' &&
    typeof value['waypointTypeDescription'] === 'string'
  );
}

function isPoint(value: unknown): value is Point {
  return isRecord(value) && typeof value['x'] === 'number' && typeof value['y'] === 'number';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseMaybeJsonObject(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function toPointPairs(value: unknown): Point[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  if (value.length < 4) {
    return null;
  }

  const numericPoints = value.every((item) => typeof item === 'number');
  if (!numericPoints) {
    return null;
  }

  const points: Point[] = [];
  for (let index = 0; index < value.length - 1; index += 2) {
    points.push({ x: value[index] as number, y: value[index + 1] as number });
  }

  return points;
}

function cloneShape(shape: DrawingShape): DrawingShape {
  if (shape.type === 'rectangle' || shape.type === 'oval' || shape.type === 'circle') {
    return { ...shape };
  }

  if (shape.type === 'arrow') {
    return { ...shape };
  }

  return {
    ...shape,
    points: shape.points.map((point: Point) => ({ ...point })),
  } as DrawingShape;
}
