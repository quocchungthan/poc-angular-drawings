import { DrawingShape, Point } from '../poc-types';
import {
  TRIANGLE_SIDES,
  TRIANGLE_START_ANGLE_RAD,
  TRIANGLE_VERTEX_COUNT,
} from './konva-import.constants';
import { getNodeScale, getRotationDegrees } from './konva-import.helpers';
import { ShapeImportContext } from './konva-import.types';

export function importKonvaTriangle(context: ShapeImportContext): DrawingShape | null {
  const sides = typeof context.attrs['sides'] === 'number' ? context.attrs['sides'] : 0;
  const centerX = typeof context.attrs['x'] === 'number' ? context.attrs['x'] : null;
  const centerY = typeof context.attrs['y'] === 'number' ? context.attrs['y'] : null;
  const radius = typeof context.attrs['radius'] === 'number' ? context.attrs['radius'] : null;

  if (sides !== TRIANGLE_SIDES || centerX === null || centerY === null || radius === null) {
    return null;
  }

  const nodeScale = getNodeScale(context.attrs);
  const rotationRad = (getRotationDegrees(context.attrs) * Math.PI) / 180;
  const cosRotation = Math.cos(rotationRad);
  const sinRotation = Math.sin(rotationRad);

  const vertices = Array.from({ length: TRIANGLE_VERTEX_COUNT }).map((_, index) => {
    const angle = TRIANGLE_START_ANGLE_RAD + (index * 2 * Math.PI) / TRIANGLE_VERTEX_COUNT;
    const localX = radius * Math.cos(angle);
    const localY = radius * Math.sin(angle);
    const scaledX = localX * nodeScale.scaleX;
    const scaledY = localY * nodeScale.scaleY;
    const transformedX = scaledX * cosRotation - scaledY * sinRotation;
    const transformedY = scaledX * sinRotation + scaledY * cosRotation;

    return {
      x: context.mapper.mapX(centerX + transformedX),
      y: context.mapper.mapY(centerY + transformedY),
    };
  });

  const orderedPoints = orderTrianglePoints(vertices);
  return {
    id: context.shapeId,
    type: 'triangle',
    color: context.style.color,
    strokeWidth: context.style.strokeWidth,
    strokeLineCap: context.style.strokeLineCap,
    strokeLineJoin: context.style.strokeLineJoin,
    points: orderedPoints,
  };
}

function orderTrianglePoints(vertices: Point[]): [Point, Point, Point] {
  const sortedByTop = [...vertices].sort((a, b) => b.y - a.y);
  const apex = sortedByTop[0];
  const basePoints = sortedByTop.slice(1).sort((a, b) => b.x - a.x);
  return [apex, basePoints[0], basePoints[1]];
}
