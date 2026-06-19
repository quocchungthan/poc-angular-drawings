export type AppMode = 'readonly' | 'edit';

export type EditSubMode = 'drawing-edit' | 'waypoint-edit';

export type DrawingTool = 'select' | 'line' | 'dashed-line' | 'rectangle' | 'triangle' | 'circle' | 'oval';

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
  type: 'line' | 'dashed-line' | 'rectangle' | 'triangle' | 'circle' | 'oval';
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

export type DrawingShape = LineShape | RectangleShape | TriangleShape | CircleShape | OvalShape;

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