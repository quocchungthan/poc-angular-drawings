import { DrawingShape } from '../poc-types';
import { getNodeScale, getRotationDegrees } from './konva-import.helpers';
import { ShapeImportContext } from './konva-import.types';

export function importKonvaEllipse(context: ShapeImportContext): DrawingShape | null {
  const x = typeof context.attrs['x'] === 'number' ? context.attrs['x'] : null;
  const y = typeof context.attrs['y'] === 'number' ? context.attrs['y'] : null;
  const radiusX = typeof context.attrs['radiusX'] === 'number' ? context.attrs['radiusX'] : null;
  const radiusY = typeof context.attrs['radiusY'] === 'number' ? context.attrs['radiusY'] : null;

  if (x === null || y === null || radiusX === null || radiusY === null) {
    return null;
  }

  const nodeScale = getNodeScale(context.attrs);
  const width = 2 * Math.abs(radiusX * nodeScale.scaleX);
  const height = 2 * Math.abs(radiusY * nodeScale.scaleY);
  if (width <= 0 || height <= 0) {
    return null;
  }

  const leftX = x - width / 2;
  const topY = y - height / 2;
  const rotationDeg = -getRotationDegrees(context.attrs);

  return {
    id: context.shapeId,
    type: 'oval',
    color: context.style.color,
    strokeWidth: context.style.strokeWidth,
    strokeLineCap: context.style.strokeLineCap,
    strokeLineJoin: context.style.strokeLineJoin,
    x: context.mapper.mapX(leftX),
    y: context.mapper.mapY(topY + height),
    width: width * context.mapper.scaleX,
    height: height * context.mapper.scaleY,
    rotationDeg,
  };
}
