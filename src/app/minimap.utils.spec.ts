import { computeMinimapViewportRect } from './minimap.utils';

describe('minimap.utils', () => {
  it('should compute minimap viewport inside image bounds', () => {
    const rect = computeMinimapViewportRect(
      { width: 220, height: 150 },
      {
        northWest: { x: 10, y: 5 },
        southEast: { x: 210, y: 145 },
      },
      {
        northWest: { x: 40, y: 30 },
        southEast: { x: 180, y: 120 },
      },
    );

    expect(rect).not.toBeNull();
    expect(rect).toEqual({
      left: 40,
      top: 30,
      right: 180,
      bottom: 120,
      width: 140,
      height: 90,
    });
  });

  it('should clamp minimap viewport to projected image bounds', () => {
    const rect = computeMinimapViewportRect(
      { width: 200, height: 120 },
      {
        northWest: { x: 20, y: 10 },
        southEast: { x: 180, y: 110 },
      },
      {
        northWest: { x: -50, y: -30 },
        southEast: { x: 260, y: 170 },
      },
    );

    expect(rect).not.toBeNull();
    expect(rect).toEqual({
      left: 20,
      top: 10,
      right: 180,
      bottom: 110,
      width: 160,
      height: 100,
    });
  });
});
