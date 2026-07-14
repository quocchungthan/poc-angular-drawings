import { DrawingShape, PersistedPictureState, Point, Waypoint } from './poc-types';
import { parseKonvaLineLikeImport } from './annotations-import/konva-annotations-importer';

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

export function parsePictureAnnotationsJson(
  raw: string,
  expectedPictureId: string,
  imageSize?: { width: number; height: number },
): ParseAnnotationsResult {
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

  const konvaResult = parseKonvaLineLikeImport(parsed, expectedPictureId, imageSize);
  if (konvaResult) {
    return { ok: true, ...konvaResult };
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

  if (value['type'] === 'arrow') {
    return (
      isPoint(value['startPoint']) &&
      isPoint(value['endPoint']) &&
      typeof value['direction'] === 'string'
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
