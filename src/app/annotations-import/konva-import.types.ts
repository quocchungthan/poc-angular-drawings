import { DrawingShape } from '../poc-types';

export interface CoordinateMapper {
  canvasWidth: number;
  canvasHeight: number;
  scaleX: number;
  scaleY: number;
  strokeScale: number;
  mapX: (x: number) => number;
  mapY: (y: number) => number;
}

export interface ShapeStyle {
  color: string;
  strokeWidth: number;
  strokeLineCap?: 'butt' | 'round' | 'square';
  strokeLineJoin?: 'miter' | 'round' | 'bevel';
}

export interface ShapeImportContext {
  attrs: Record<string, unknown>;
  mapper: CoordinateMapper;
  shapeId: string;
  style: ShapeStyle;
}

export type ShapeImporter = (context: ShapeImportContext) => DrawingShape | null;

export interface KonvaImportSuccess {
  payload: {
    schemaVersion: 1;
    pictureId: string;
    exportedAt: string;
    shapes: DrawingShape[];
    waypoints: [];
  };
  skippedObjects: number;
}
