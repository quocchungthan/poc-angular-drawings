import * as L from 'leaflet';
import { getShapeCenter } from './poc-state.service';
import { DrawingShape, Point } from './poc-types';

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function rotatePoint(point: Point, center: Point, degrees: number): Point {
  const radians = (degrees * Math.PI) / 180;
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * Math.cos(radians) - dy * Math.sin(radians),
    y: center.y + dx * Math.sin(radians) + dy * Math.cos(radians),
  };
}

export function distance(a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function angleDeg(center: Point, point: Point): number {
  return (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI;
}

export function getRectangleCorners(shape: Extract<DrawingShape, { type: 'rectangle' }>): Point[] {
  const center = getShapeCenter(shape);
  const halfWidth = shape.width / 2;
  const halfHeight = shape.height / 2;
  const baseCorners: Point[] = [
    { x: center.x - halfWidth, y: center.y - halfHeight },
    { x: center.x + halfWidth, y: center.y - halfHeight },
    { x: center.x + halfWidth, y: center.y + halfHeight },
    { x: center.x - halfWidth, y: center.y + halfHeight },
  ];

  const rotation = shape.rotationDeg ?? 0;
  if (rotation === 0) {
    return baseCorners;
  }

  return baseCorners.map((corner) => rotatePoint(corner, center, rotation));
}

export function getRotateHandlePoint(shape: DrawingShape, center: Point): Point {
  if (shape.type === 'rectangle' || shape.type === 'oval') {
    const offset = Math.max(shape.width, shape.height) / 2 + 48;
    const localPoint = { x: center.x, y: center.y - offset };
    return rotatePoint(localPoint, center, shape.rotationDeg ?? 0);
  }

  if (shape.type === 'circle') {
    return {
      x: center.x,
      y: center.y - shape.radius - 48,
    };
  }

  if (shape.type === 'arrow' || shape.type === 'line' || shape.type === 'dashed-line') {
    const pointShape = shape as { points: Point[] };
    const maxDistance = Math.max(...pointShape.points.map((point: Point) => distance(center, point)));
    return {
      x: center.x,
      y: center.y - maxDistance - 48,
    };
  }

  const maxDistance = Math.max(...(shape as { points: Point[] }).points.map((point: Point) => distance(center, point)));
  return {
    x: center.x,
    y: center.y - maxDistance - 48,
  };
}

export function getResizeHandlePoint(shape: Extract<DrawingShape, { type: 'rectangle' | 'oval' | 'circle' }>): Point {
  if (shape.type === 'rectangle') {
    return getRectangleCorners(shape)[2];
  }

  if (shape.type === 'oval') {
    const center = getShapeCenter(shape);
    const localPoint = { x: center.x + shape.width / 2, y: center.y + shape.height / 2 };
    return rotatePoint(localPoint, center, shape.rotationDeg ?? 0);
  }

  return {
    x: shape.cx + shape.radius,
    y: shape.cy,
  };
}

export function getOvalOutlinePoints(shape: Extract<DrawingShape, { type: 'oval' }>, segments = 96): Point[] {
  const center = getShapeCenter(shape);
  const rx = shape.width / 2;
  const ry = shape.height / 2;
  const rotation = shape.rotationDeg ?? 0;
  const points: Point[] = [];

  for (let index = 0; index < segments; index += 1) {
    const theta = (index / segments) * Math.PI * 2;
    const localPoint = {
      x: center.x + rx * Math.cos(theta),
      y: center.y + ry * Math.sin(theta),
    };
    points.push(rotation === 0 ? localPoint : rotatePoint(localPoint, center, rotation));
  }

  return points;
}

export function toPolylinePoints(points: L.LatLng[], fallbackCurrent: L.LatLng): Point[] {
  const source = points.length > 0 ? points : [fallbackCurrent];
  const mapped: Point[] = [];

  for (const latLng of source) {
    const next = { x: latLng.lng, y: latLng.lat };
    const last = mapped[mapped.length - 1];
    if (!last || last.x !== next.x || last.y !== next.y) {
      mapped.push(next);
    }
  }

  if (mapped.length === 1) {
    mapped.push({ ...mapped[0] });
  }

  return mapped;
}

export function getPathLength(points: Point[]): number {
  if (points.length < 2) {
    return 0;
  }

  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += distance(points[index - 1], points[index]);
  }
  return total;
}

export function intersectBounds(a: L.LatLngBounds, b: L.LatLngBounds): L.LatLngBounds | null {
  const west = Math.max(a.getWest(), b.getWest());
  const east = Math.min(a.getEast(), b.getEast());
  const south = Math.max(a.getSouth(), b.getSouth());
  const north = Math.min(a.getNorth(), b.getNorth());

  if (west >= east || south >= north) {
    return null;
  }

  return L.latLngBounds(L.latLng(south, west), L.latLng(north, east));
}

export function updateShapePoint(
  shape: Extract<DrawingShape, { type: 'line' | 'dashed-line' | 'triangle' }>,
  pointIndex: number,
  nextPoint: Point,
): Extract<DrawingShape, { type: 'line' | 'dashed-line' | 'triangle' }> {
  if (pointIndex < 0 || pointIndex >= shape.points.length) {
    return shape;
  }

  const nextPoints = [...shape.points];
  nextPoints[pointIndex] = { ...nextPoint };

  if (shape.type === 'triangle') {
    return {
      ...shape,
      points: [nextPoints[0], nextPoints[1], nextPoints[2]],
    };
  }

  return {
    ...shape,
    points: nextPoints,
  };
}
