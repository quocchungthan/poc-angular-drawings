import { clamp } from './geometry.utils';

export interface MinimapPoint {
  x: number;
  y: number;
}

export interface MinimapProjection {
  northWest: MinimapPoint;
  southEast: MinimapPoint;
}

export interface MinimapSize {
  width: number;
  height: number;
}

export interface MinimapViewportRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export function computeMinimapViewportRect(
  minimapSize: MinimapSize,
  imageProjection: MinimapProjection,
  viewportProjection: MinimapProjection,
): MinimapViewportRect | null {
  const imageLeft = clamp(Math.min(imageProjection.northWest.x, imageProjection.southEast.x), 0, minimapSize.width);
  const imageTop = clamp(Math.min(imageProjection.northWest.y, imageProjection.southEast.y), 0, minimapSize.height);
  const imageRight = clamp(Math.max(imageProjection.northWest.x, imageProjection.southEast.x), 0, minimapSize.width);
  const imageBottom = clamp(Math.max(imageProjection.northWest.y, imageProjection.southEast.y), 0, minimapSize.height);

  if (imageRight <= imageLeft || imageBottom <= imageTop) {
    return null;
  }

  const viewportLeft = clamp(
    Math.min(viewportProjection.northWest.x, viewportProjection.southEast.x),
    imageLeft,
    imageRight,
  );
  const viewportTop = clamp(
    Math.min(viewportProjection.northWest.y, viewportProjection.southEast.y),
    imageTop,
    imageBottom,
  );
  const viewportRight = clamp(
    Math.max(viewportProjection.northWest.x, viewportProjection.southEast.x),
    imageLeft,
    imageRight,
  );
  const viewportBottom = clamp(
    Math.max(viewportProjection.northWest.y, viewportProjection.southEast.y),
    imageTop,
    imageBottom,
  );

  const width = Math.max(0, viewportRight - viewportLeft);
  const height = Math.max(0, viewportBottom - viewportTop);
  if (width <= 0 || height <= 0) {
    return null;
  }

  return {
    left: viewportLeft,
    top: viewportTop,
    right: viewportRight,
    bottom: viewportBottom,
    width,
    height,
  };
}
