import { Point } from '../poc-types';
import {
  DEFAULT_NODE_SCALE,
  DEFAULT_STROKE_COLOR,
  DEFAULT_STROKE_WIDTH,
  MIN_NON_ZERO_SCALE,
} from './konva-import.constants';
import { CoordinateMapper, ShapeStyle } from './konva-import.types';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parseMaybeJsonObject(value: unknown): Record<string, unknown> | null {
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

export function toPointPairs(value: unknown): Point[] | null {
  if (!Array.isArray(value) || value.length < 4) {
    return null;
  }

  if (!value.every((item) => typeof item === 'number')) {
    return null;
  }

  const points: Point[] = [];
  for (let index = 0; index < value.length - 1; index += 2) {
    points.push({ x: value[index] as number, y: value[index + 1] as number });
  }

  return points;
}

export function toNumericArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const numeric = value.filter((item): item is number => typeof item === 'number');
  return numeric.length > 0 ? numeric : undefined;
}

export function normalizeLineCap(value: unknown): 'butt' | 'round' | 'square' | undefined {
  return value === 'butt' || value === 'round' || value === 'square' ? value : undefined;
}

export function normalizeLineJoin(value: unknown): 'miter' | 'round' | 'bevel' | undefined {
  return value === 'miter' || value === 'round' || value === 'bevel' ? value : undefined;
}

export function createCoordinateMapper(
  canvasWidth: number,
  canvasHeight: number,
  imageSize?: { width: number; height: number },
): CoordinateMapper {
  const scaleX = imageSize && canvasWidth > 0 ? imageSize.width / canvasWidth : 1;
  const scaleY = imageSize && canvasHeight > 0 ? imageSize.height / canvasHeight : 1;
  const strokeScale = Math.max(
    MIN_NON_ZERO_SCALE,
    (Math.abs(scaleX) + Math.abs(scaleY)) / 2,
  );

  return {
    canvasWidth,
    canvasHeight,
    scaleX,
    scaleY,
    strokeScale,
    mapX: (x) => x * scaleX,
    mapY: (y) => (canvasHeight > 0 ? (canvasHeight - y) * scaleY : y * scaleY),
  };
}

export function createShapeStyle(attrs: Record<string, unknown>, strokeScale: number): ShapeStyle {
  const stroke = typeof attrs['stroke'] === 'string' ? attrs['stroke'] : DEFAULT_STROKE_COLOR;
  const strokeWidthRaw =
    typeof attrs['strokeWidth'] === 'number' ? attrs['strokeWidth'] : DEFAULT_STROKE_WIDTH;

  return {
    color: stroke,
    strokeWidth: strokeWidthRaw * strokeScale,
    strokeLineCap: normalizeLineCap(attrs['lineCap']),
    strokeLineJoin: normalizeLineJoin(attrs['lineJoin']),
  };
}

export function getRotationDegrees(attrs: Record<string, unknown>): number {
  if (typeof attrs['rotation'] === 'number') {
    return attrs['rotation'];
  }

  if (typeof attrs['angle'] === 'number') {
    return attrs['angle'];
  }

  return 0;
}

export function getNodeScale(attrs: Record<string, unknown>): { scaleX: number; scaleY: number } {
  const scaleX = typeof attrs['scaleX'] === 'number' ? attrs['scaleX'] : DEFAULT_NODE_SCALE;
  const scaleY = typeof attrs['scaleY'] === 'number' ? attrs['scaleY'] : DEFAULT_NODE_SCALE;
  return { scaleX, scaleY };
}

export function ensurePositiveScale(value: number): number {
  return Math.max(MIN_NON_ZERO_SCALE, Math.abs(value));
}
