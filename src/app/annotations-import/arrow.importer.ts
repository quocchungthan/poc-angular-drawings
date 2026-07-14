import { DrawingShape } from '../poc-types';
import { toPointPairs } from './konva-import.helpers';
import { ShapeImportContext } from './konva-import.types';

export function importKonvaArrow(context: ShapeImportContext): DrawingShape | null {
  const points = toPointPairs(context.attrs['points']);
  if (!points || points.length < 2) {
    return null;
  }

  const mappedPoints = points.map((point) => ({
    x: context.mapper.mapX(point.x),
    y: context.mapper.mapY(point.y),
  }));

  const pointerLength =
    typeof context.attrs['pointerLength'] === 'number' ? context.attrs['pointerLength'] : undefined;
  const pointerWidth =
    typeof context.attrs['pointerWidth'] === 'number' ? context.attrs['pointerWidth'] : undefined;

  return {
    id: context.shapeId,
    type: 'arrow',
    color: context.style.color,
    strokeWidth: context.style.strokeWidth,
    strokeLineCap: context.style.strokeLineCap,
    strokeLineJoin: context.style.strokeLineJoin,
    startPoint: mappedPoints[0],
    endPoint: mappedPoints[mappedPoints.length - 1],
    direction: 'right',
    pointerLength,
    pointerWidth,
  };
}
