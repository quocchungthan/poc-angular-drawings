import { DrawingShape } from '../poc-types';
import { ensurePositiveScale, getNodeScale } from './konva-import.helpers';
import { ShapeImportContext } from './konva-import.types';

export function importKonvaCircle(context: ShapeImportContext): DrawingShape | null {
  const cx = typeof context.attrs['x'] === 'number' ? context.attrs['x'] : null;
  const cy = typeof context.attrs['y'] === 'number' ? context.attrs['y'] : null;
  const radius = typeof context.attrs['radius'] === 'number' ? context.attrs['radius'] : null;

  if (cx === null || cy === null || radius === null || radius <= 0) {
    return null;
  }

  const nodeScale = getNodeScale(context.attrs);
  const averageNodeScale = ensurePositiveScale((Math.abs(nodeScale.scaleX) + Math.abs(nodeScale.scaleY)) / 2);

  return {
    id: context.shapeId,
    type: 'circle',
    color: context.style.color,
    strokeWidth: context.style.strokeWidth,
    strokeLineCap: context.style.strokeLineCap,
    strokeLineJoin: context.style.strokeLineJoin,
    cx: context.mapper.mapX(cx),
    cy: context.mapper.mapY(cy),
    radius: radius * averageNodeScale * Math.min(context.mapper.scaleX, context.mapper.scaleY),
  };
}
