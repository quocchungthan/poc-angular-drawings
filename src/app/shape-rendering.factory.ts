import * as L from 'leaflet';
import { DEFAULT_DASH_ARRAY, MIN_ARROW_POINTER_SIZE } from './app.constants';
import { getOvalOutlinePoints, getRectangleCorners } from './geometry.utils';
import { ArrowShape, DrawingShape } from './poc-types';

export interface ShapeStyleOptions {
  selected: boolean;
}

function getArrowHeadPointsWithKonvaSemantics(arrowShape: ArrowShape): [number, number][] {
  const dx = arrowShape.endPoint.x - arrowShape.startPoint.x;
  const dy = arrowShape.endPoint.y - arrowShape.startPoint.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist === 0) {
    return [];
  }

  const unitX = dx / dist;
  const unitY = dy / dist;
  const pointerLength = Math.max(MIN_ARROW_POINTER_SIZE, arrowShape.pointerLength ?? arrowShape.strokeWidth * 4);
  const pointerWidth = Math.max(MIN_ARROW_POINTER_SIZE, arrowShape.pointerWidth ?? arrowShape.strokeWidth * 4);
  const halfWidth = pointerWidth / 2;

  const perpX = -unitY;
  const perpY = unitX;
  const baseX = arrowShape.endPoint.x - unitX * pointerLength;
  const baseY = arrowShape.endPoint.y - unitY * pointerLength;
  const leftX = baseX + perpX * halfWidth;
  const leftY = baseY + perpY * halfWidth;
  const rightX = baseX - perpX * halfWidth;
  const rightY = baseY - perpY * halfWidth;

  return [
    [arrowShape.endPoint.y, arrowShape.endPoint.x],
    [leftY, leftX],
    [rightY, rightX],
  ];
}

function getDashArray(shape: DrawingShape): string | undefined {
  if (shape.type !== 'dashed-line') {
    return undefined;
  }

  if (shape.dashPattern && shape.dashPattern.length > 0) {
    return shape.dashPattern.join(' ');
  }

  return DEFAULT_DASH_ARRAY;
}

function buildCommonStyle(shape: DrawingShape, interactive: boolean, options: ShapeStyleOptions): L.PolylineOptions {
  const color = options.selected ? '#0ea5e9' : shape.color;
  return {
    color,
    weight: options.selected ? shape.strokeWidth + 1 : shape.strokeWidth,
    interactive,
    lineCap: shape.strokeLineCap ?? 'round',
    lineJoin: shape.strokeLineJoin ?? 'round',
    smoothFactor: 0,
    noClip: true,
  };
}

export function createShapeLayer(shape: DrawingShape, interactive: boolean, options: ShapeStyleOptions): L.Layer {
  const commonStyle = buildCommonStyle(shape, interactive, options);

  if (shape.type === 'arrow') {
    const shaft = L.polyline(
      [
        [shape.startPoint.y, shape.startPoint.x],
        [shape.endPoint.y, shape.endPoint.x],
      ],
      commonStyle,
    );

    const arrowheadPoints = getArrowHeadPointsWithKonvaSemantics(shape);
    const arrowhead = L.polygon(arrowheadPoints, {
      ...commonStyle,
      fill: true,
      fillColor: commonStyle.color,
      fillOpacity: 1,
    });

    return L.layerGroup([shaft, arrowhead]);
  }

  if (shape.type === 'line' || shape.type === 'dashed-line') {
    return L.polyline(
      shape.points.map((point) => [point.y, point.x] as [number, number]),
      {
        ...commonStyle,
        dashArray: getDashArray(shape),
      },
    );
  }

  if (shape.type === 'rectangle') {
    const corners = getRectangleCorners(shape).map((point) => [point.y, point.x] as [number, number]);
    return L.polygon(corners, {
      ...commonStyle,
      fill: true,
      fillColor: commonStyle.color,
      fillOpacity: 0.01,
    });
  }

  if (shape.type === 'circle') {
    return L.circle([shape.cy, shape.cx], {
      ...commonStyle,
      radius: shape.radius,
      fill: true,
      fillColor: commonStyle.color,
      fillOpacity: 0.01,
    });
  }

  if (shape.type === 'oval') {
    return L.polygon(
      getOvalOutlinePoints(shape).map((point) => [point.y, point.x] as [number, number]),
      {
        ...commonStyle,
        fill: true,
        fillColor: commonStyle.color,
        fillOpacity: 0.01,
      },
    );
  }

  return L.polygon(
    shape.points.map((point) => [point.y, point.x] as [number, number]),
    {
      ...commonStyle,
      fill: true,
      fillColor: commonStyle.color,
      fillOpacity: 0.01,
    },
  );
}

export function attachShapeSelectionHandlers(
  layer: L.Layer,
  shapeId: string,
  onDragStart: (event: L.LeafletMouseEvent) => void,
  onClick: (event: L.LeafletMouseEvent) => void,
): void {
  const attachToLayer = (target: L.Layer) => {
    target.on('mousedown', onDragStart);
    target.on('click', onClick);
  };

  if (layer instanceof L.LayerGroup) {
    layer.eachLayer((child) => attachToLayer(child));
    return;
  }

  attachToLayer(layer);
}
