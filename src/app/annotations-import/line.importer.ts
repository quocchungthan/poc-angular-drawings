import { DrawingShape } from '../poc-types';
import { toNumericArray, toPointPairs } from './konva-import.helpers';
import { ShapeImportContext } from './konva-import.types';

export function importKonvaLine(context: ShapeImportContext): DrawingShape | null {
  const points = toPointPairs(context.attrs['points']);
  if (!points || points.length < 2) {
    return null;
  }

  const mappedPoints = points.map((point) => ({
    x: context.mapper.mapX(point.x),
    y: context.mapper.mapY(point.y),
  }));

  const dashPattern = toNumericArray(context.attrs['dash']);
  return {
    id: context.shapeId,
    type: dashPattern && dashPattern.length > 0 ? 'dashed-line' : 'line',
    color: context.style.color,
    strokeWidth: context.style.strokeWidth,
    strokeLineCap: context.style.strokeLineCap,
    strokeLineJoin: context.style.strokeLineJoin,
    dashPattern,
    points: mappedPoints,
  };
}
