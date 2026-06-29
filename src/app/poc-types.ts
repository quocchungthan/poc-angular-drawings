export type AppMode = 'readonly' | 'edit';

export type EditSubMode = 'drawing-edit' | 'waypoint-edit';

export type DrawingTool = 'select' | 'line' | 'dashed-line' | 'rectangle' | 'triangle' | 'circle' | 'oval' | 'arrow';

export type ArrowDirection = 'up' | 'down' | 'left' | 'right';

export interface PictureItem {
  id: string;
  name: string;
  url: string;
}

export interface Point {
  x: number;
  y: number;
}

interface ShapeBase {
  id: string;
  type: 'line' | 'dashed-line' | 'rectangle' | 'triangle' | 'circle' | 'oval' | 'arrow';
  color: string;
  strokeWidth: number;
}

export interface LineShape extends ShapeBase {
  type: 'line' | 'dashed-line';
  points: Point[];
}

export interface RectangleShape extends ShapeBase {
  type: 'rectangle';
  x: number;
  y: number;
  width: number;
  height: number;
  rotationDeg?: number;
}

export interface TriangleShape extends ShapeBase {
  type: 'triangle';
  points: [Point, Point, Point];
}

export interface CircleShape extends ShapeBase {
  type: 'circle';
  cx: number;
  cy: number;
  radius: number;
}

export interface OvalShape extends ShapeBase {
  type: 'oval';
  x: number;
  y: number;
  width: number;
  height: number;
  rotationDeg?: number;
}

export interface ArrowShape extends ShapeBase {
  type: 'arrow';
  startPoint: Point;
  endPoint: Point;
  direction: ArrowDirection;
}

export type DrawingShape = LineShape | RectangleShape | TriangleShape | CircleShape | OvalShape | ArrowShape;

export interface Waypoint {
  id: string;
  pictureId: string;
  name: string;
  x: number;
  y: number;
  waypointTypeDescription: string;
}

export interface KonvaStageJson {
  width: number;
  height: number;
  objects: string[];
  version: string;
}

export interface PersistedPictureState {
  shapes: DrawingShape[];
  waypoints: Waypoint[];
}

export type PersistedStateByPicture = Record<string, PersistedPictureState>;