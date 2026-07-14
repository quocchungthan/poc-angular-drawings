import { DrawingShape } from '../poc-types';
import { getRotationDegrees } from './konva-import.helpers';
import { ShapeImportContext } from './konva-import.types';

export function importKonvaRect(context: ShapeImportContext): DrawingShape | null {
  const x = typeof context.attrs['x'] === 'number' ? context.attrs['x'] : null;
  const y = typeof context.attrs['y'] === 'number' ? context.attrs['y'] : null;
  const width = typeof context.attrs['width'] === 'number' ? context.attrs['width'] : null;
  const height = typeof context.attrs['height'] === 'number' ? context.attrs['height'] : null;

  if (x === null || y === null || width === null || height === null) {
    return null;
  }

  const absWidth = Math.abs(width);
  const absHeight = Math.abs(height);
  const leftX = width < 0 ? x + width : x;
  const topY = height < 0 ? y + height : y;
  const rotationDeg = -getRotationDegrees(context.attrs);

  return {
    id: context.shapeId,
    type: 'rectangle',
    color: context.style.color,
    strokeWidth: context.style.strokeWidth,
    strokeLineCap: context.style.strokeLineCap,
    strokeLineJoin: context.style.strokeLineJoin,
    x: context.mapper.mapX(leftX),
    y: context.mapper.mapY(topY + absHeight),
    width: absWidth * context.mapper.scaleX,
    height: absHeight * context.mapper.scaleY,
    rotationDeg,
  };
}
