import * as L from 'leaflet';
import {
  angleDeg,
  clamp,
  distance,
  getOvalOutlinePoints,
  getPathLength,
  getRectangleCorners,
  intersectBounds,
  rotatePoint,
  toPolylinePoints,
  updateShapePoint,
} from './geometry.utils';

describe('geometry.utils', () => {
  it('should rotate point around center', () => {
    const rotated = rotatePoint({ x: 2, y: 1 }, { x: 1, y: 1 }, 90);
    expect(rotated.x).toBeCloseTo(1, 6);
    expect(rotated.y).toBeCloseTo(2, 6);
  });

  it('should compute distance and angle', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(angleDeg({ x: 0, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(90, 6);
  });

  it('should compute rotated rectangle corners', () => {
    const corners = getRectangleCorners({
      id: 'r',
      type: 'rectangle',
      x: 0,
      y: 0,
      width: 10,
      height: 4,
      rotationDeg: 0,
      color: '#000',
      strokeWidth: 1,
    });

    expect(corners.length).toBe(4);
    expect(corners[0]).toEqual({ x: 0, y: 0 });
    expect(corners[2]).toEqual({ x: 10, y: 4 });
  });

  it('should generate non-empty oval outline points', () => {
    const points = getOvalOutlinePoints({
      id: 'o',
      type: 'oval',
      x: 0,
      y: 0,
      width: 10,
      height: 6,
      rotationDeg: 0,
      color: '#000',
      strokeWidth: 1,
    }, 12);

    expect(points.length).toBe(12);
  });

  it('should convert to unique polyline points and compute path length', () => {
    const points = toPolylinePoints([
      L.latLng(1, 1),
      L.latLng(1, 1),
      L.latLng(4, 5),
    ], L.latLng(1, 1));

    expect(points).toEqual([
      { x: 1, y: 1 },
      { x: 5, y: 4 },
    ]);
    expect(getPathLength(points)).toBe(5);
  });

  it('should clamp and intersect bounds', () => {
    expect(clamp(10, 0, 5)).toBe(5);
    const a = L.latLngBounds(L.latLng(0, 0), L.latLng(10, 10));
    const b = L.latLngBounds(L.latLng(5, 5), L.latLng(15, 15));
    const overlap = intersectBounds(a, b);
    expect(overlap).not.toBeNull();
    expect(overlap?.getWest()).toBe(5);
    expect(overlap?.getSouth()).toBe(5);
    expect(overlap?.getEast()).toBe(10);
    expect(overlap?.getNorth()).toBe(10);
  });

  it('should update shape point safely', () => {
    const line = {
      id: 'l',
      type: 'line' as const,
      color: '#000',
      strokeWidth: 1,
      points: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    };

    const updated = updateShapePoint(line, 1, { x: 2, y: 3 });
    expect(updated.points[1]).toEqual({ x: 2, y: 3 });
  });
});
