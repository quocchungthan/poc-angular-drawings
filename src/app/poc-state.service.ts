import { computed, Injectable, signal } from '@angular/core';
import {
  AppMode,
  ArrowDirection,
  ArrowShape,
  DrawingShape,
  DrawingTool,
  EditSubMode,
  KonvaStageJson,
  PersistedPictureState,
  PersistedStateByPicture,
  PictureItem,
  Point,
  RectangleShape,
  TriangleShape,
  Waypoint,
} from './poc-types';
import { UndoRedoManager } from './undo-redo-manager';

const SAMPLE_KONVA_DRAWING_JSON =
  '{"width":1536,"height":864.1588527302813,"objects":["{\\"attrs\\":{\\"stroke\\":\\"black\\",\\"strokeWidth\\":3,\\"lineCap\\":\\"round\\",\\"lineJoin\\":\\"round\\",\\"points\\":[996,219.07942636514065,996,219.07942636514065,982,234.07942636514065,961,252.07942636514065,941,268.07942636514065,920,288.07942636514065,900,303.07942636514065,880,317.07942636514065,861,332.07942636514065,846,343.07942636514065,838,352.07942636514065,834,356.07942636514065,826,364.07942636514065,821,368.07942636514065,817,372.07942636514065,816,372.07942636514065,814,373.07942636514065]},\\"className\\":\\"Line\\"}"],"version":"konva_2.4.8"}';

const LOCAL_STORAGE_KEY = 'leaflet-picture-poc.state.v1';

@Injectable({ providedIn: 'root' })
export class PocStateService {
  readonly pictures: PictureItem[] = [
    {
      id: 'pic-1',
      name: 'Sample Picture 1',
      url: 'assets/pictures/picture-1.jpg',
    },
    {
      id: 'pic-2',
      name: 'Sample Picture 2',
      url: 'assets/pictures/picture-2.jpg',
    },
  ];

  readonly mode = signal<AppMode>('readonly');
  readonly editSubMode = signal<EditSubMode>('drawing-edit');
  readonly drawingTool = signal<DrawingTool>('select');
  readonly pictureIndex = signal(0);
  readonly selectedColor = signal<string>('#111111');
  readonly selectedThickness = signal<number>(2);
  readonly arrowDirection = signal<ArrowDirection>('right');

  private readonly defaultDrawingsByPicture: Record<string, DrawingShape[]> = {
    'pic-1': this.parseKonvaDrawingJson(SAMPLE_KONVA_DRAWING_JSON),
    'pic-2': [
      {
        id: 'seed-rect-1',
        type: 'rectangle',
        x: 260,
        y: 180,
        width: 320,
        height: 170,
        rotationDeg: 0,
        color: '#b91c1c',
        strokeWidth: 3,
      },
      {
        id: 'seed-tri-1',
        type: 'triangle',
        points: [
          { x: 770, y: 210 },
          { x: 935, y: 455 },
          { x: 640, y: 455 },
        ],
        color: '#1d4ed8',
        strokeWidth: 3,
      },
    ],
  };

  private readonly defaultWaypointsByPicture: Record<string, Waypoint[]> = {
    'pic-1': [
      {
        id: 'wp-001',
        pictureId: 'pic-1',
        name: 'Entrance Pole',
        x: 740,
        y: 255,
        waypointTypeDescription: 'Sign',
      },
      {
        id: 'wp-002',
        pictureId: 'pic-1',
        name: 'Trail Corner',
        x: 980,
        y: 430,
        waypointTypeDescription: 'Corner',
      },
    ],
    'pic-2': [
      {
        id: 'wp-101',
        pictureId: 'pic-2',
        name: 'Viewpoint',
        x: 650,
        y: 220,
        waypointTypeDescription: 'Lookout',
      },
    ],
  };

  private readonly drawingsByPicture = signal<Record<string, DrawingShape[]>>(
    this.cloneShapeMap(this.defaultDrawingsByPicture),
  );

  private readonly waypointsByPicture = signal<Record<string, Waypoint[]>>(
    this.cloneWaypointMap(this.defaultWaypointsByPicture),
  );

  private readonly historyManager = new UndoRedoManager<PersistedPictureState>();

  readonly currentPicture = computed(() => this.pictures[this.pictureIndex()]);

  constructor() {
    this.applyPersistedState();
  }

  setMode(mode: AppMode): void {
    this.mode.set(mode);
  }

  setEditSubMode(subMode: EditSubMode): void {
    this.editSubMode.set(subMode);
  }

  setDrawingTool(tool: DrawingTool): void {
    this.drawingTool.set(tool);
  }

  setSelectedColor(color: string): void {
    this.selectedColor.set(color);
  }

  setSelectedThickness(thickness: number): void {
    this.selectedThickness.set(thickness);
  }

  setArrowDirection(direction: ArrowDirection): void {
    this.arrowDirection.set(direction);
  }

  nextPicture(): void {
    const nextIndex = (this.pictureIndex() + 1) % this.pictures.length;
    this.pictureIndex.set(nextIndex);
  }

  previousPicture(): void {
    const prevIndex = (this.pictureIndex() - 1 + this.pictures.length) % this.pictures.length;
    this.pictureIndex.set(prevIndex);
  }

  getShapes(pictureId: string): DrawingShape[] {
    return this.drawingsByPicture()[pictureId] ?? [];
  }

  findShape(pictureId: string, shapeId: string): DrawingShape | undefined {
    return this.getShapes(pictureId).find((shape) => shape.id === shapeId);
  }

  addShape(pictureId: string, shape: DrawingShape): void {
    const currentState = this.getPictureStateSnapshot(pictureId);
    this.historyManager.push(pictureId, currentState);
    this.applyPictureStateSnapshot(pictureId, {
      ...currentState,
      shapes: [...currentState.shapes, cloneShape(shape)],
    });
  }

  removeShape(pictureId: string, shapeId: string): void {
    const currentState = this.getPictureStateSnapshot(pictureId);
    const nextShapes = currentState.shapes.filter((shape) => shape.id !== shapeId);
    if (nextShapes.length === currentState.shapes.length) {
      return;
    }

    this.historyManager.push(pictureId, currentState);
    this.applyPictureStateSnapshot(pictureId, {
      ...currentState,
      shapes: nextShapes,
    });
  }

  updateShape(pictureId: string, nextShape: DrawingShape, recordHistory: boolean = true): void {
    const currentState = this.getPictureStateSnapshot(pictureId);
    const shapeIndex = currentState.shapes.findIndex((shape) => shape.id === nextShape.id);
    if (shapeIndex < 0) {
      return;
    }

    const nextShapes = [...currentState.shapes];
    nextShapes[shapeIndex] = cloneShape(nextShape);

    if (recordHistory) {
      this.historyManager.push(pictureId, currentState);
    }
    this.applyPictureStateSnapshot(pictureId, {
      ...currentState,
      shapes: nextShapes,
    });
  }

  getWaypoints(pictureId: string): Waypoint[] {
    return this.waypointsByPicture()[pictureId] ?? [];
  }

  updateWaypointPosition(
    pictureId: string,
    waypointId: string,
    x: number,
    y: number,
    recordHistory: boolean = true,
  ): void {
    const currentState = this.getPictureStateSnapshot(pictureId);
    const waypointIndex = currentState.waypoints.findIndex((waypoint) => waypoint.id === waypointId);
    if (waypointIndex < 0) {
      return;
    }

    const currentWaypoint = currentState.waypoints[waypointIndex];
    if (currentWaypoint.x === x && currentWaypoint.y === y) {
      return;
    }

    const nextWaypoints = [...currentState.waypoints];
    nextWaypoints[waypointIndex] = { ...currentWaypoint, x, y };

    if (recordHistory) {
      this.historyManager.push(pictureId, currentState);
    }
    this.applyPictureStateSnapshot(pictureId, {
      ...currentState,
      waypoints: nextWaypoints,
    });
  }

  addWaypoint(pictureId: string, x: number, y: number): void {
    const currentState = this.getPictureStateSnapshot(pictureId);
    const pictureWaypoints = currentState.waypoints;
    const waypointId = this.nextId('wp');
    const newWaypoint: Waypoint = {
      id: waypointId,
      pictureId,
      x,
      y,
      name: `Waypoint ${pictureWaypoints.length + 1}`,
      waypointTypeDescription: 'Custom',
    };

    this.historyManager.push(pictureId, currentState);
    this.applyPictureStateSnapshot(pictureId, {
      ...currentState,
      waypoints: [...pictureWaypoints, newWaypoint],
    });
  }

  removeWaypoint(pictureId: string, waypointId: string): void {
    const currentState = this.getPictureStateSnapshot(pictureId);
    const nextWaypoints = currentState.waypoints.filter((waypoint) => waypoint.id !== waypointId);
    if (nextWaypoints.length === currentState.waypoints.length) {
      return;
    }

    this.historyManager.push(pictureId, currentState);
    this.applyPictureStateSnapshot(pictureId, {
      ...currentState,
      waypoints: nextWaypoints,
    });
  }

  replacePictureState(pictureId: string, state: PersistedPictureState): void {
    this.historyManager.push(pictureId, this.getPictureStateSnapshot(pictureId));
    this.applyPictureStateSnapshot(pictureId, state);
  }

  canUndoPictureState(pictureId: string): boolean {
    return this.historyManager.canUndo(pictureId);
  }

  canRedoPictureState(pictureId: string): boolean {
    return this.historyManager.canRedo(pictureId);
  }

  pushPictureSnapshotToHistory(pictureId: string): void {
    this.historyManager.push(pictureId, this.getPictureStateSnapshot(pictureId));
  }

  undoPictureState(pictureId: string): boolean {
    const currentState = this.getPictureStateSnapshot(pictureId);
    const previousState = this.historyManager.undo(pictureId, currentState);
    if (!previousState) {
      return false;
    }

    this.applyPictureStateSnapshot(pictureId, previousState);
    return true;
  }

  redoPictureState(pictureId: string): boolean {
    const currentState = this.getPictureStateSnapshot(pictureId);
    const nextState = this.historyManager.redo(pictureId, currentState);
    if (!nextState) {
      return false;
    }

    this.applyPictureStateSnapshot(pictureId, nextState);
    return true;
  }

  savePictureState(pictureId: string): void {
    const persisted = this.readPersistedState();
    persisted[pictureId] = {
      shapes: this.cloneShapes(this.getShapes(pictureId)),
      waypoints: this.cloneWaypoints(this.getWaypoints(pictureId)),
    };
    this.writePersistedState(persisted);
  }

  resetPictureState(pictureId: string): void {
    this.historyManager.push(pictureId, this.getPictureStateSnapshot(pictureId));
    this.applyPictureStateSnapshot(pictureId, {
      shapes: this.cloneShapes(this.defaultDrawingsByPicture[pictureId] ?? []),
      waypoints: this.cloneWaypoints(this.defaultWaypointsByPicture[pictureId] ?? []),
    });

    const persisted = this.readPersistedState();
    delete persisted[pictureId];
    this.writePersistedState(persisted);
  }

  private nextId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  }

  private applyPersistedState(): void {
    const persisted = this.readPersistedState();
    const pictureIds = this.pictures.map((picture) => picture.id);

    this.drawingsByPicture.update((current) => {
      const next = { ...current };
      for (const pictureId of pictureIds) {
        if (persisted[pictureId]) {
          next[pictureId] = this.cloneShapes(persisted[pictureId].shapes);
        }
      }
      return next;
    });

    this.waypointsByPicture.update((current) => {
      const next = { ...current };
      for (const pictureId of pictureIds) {
        if (persisted[pictureId]) {
          next[pictureId] = this.cloneWaypoints(persisted[pictureId].waypoints);
        }
      }
      return next;
    });
  }

  private cloneShapeMap(input: Record<string, DrawingShape[]>): Record<string, DrawingShape[]> {
    const clone: Record<string, DrawingShape[]> = {};
    for (const pictureId of Object.keys(input)) {
      clone[pictureId] = this.cloneShapes(input[pictureId]);
    }
    return clone;
  }

  private cloneWaypointMap(input: Record<string, Waypoint[]>): Record<string, Waypoint[]> {
    const clone: Record<string, Waypoint[]> = {};
    for (const pictureId of Object.keys(input)) {
      clone[pictureId] = this.cloneWaypoints(input[pictureId]);
    }
    return clone;
  }

  private cloneShapes(shapes: DrawingShape[]): DrawingShape[] {
    return shapes.map((shape) => cloneShape(shape));
  }

  private cloneWaypoints(waypoints: Waypoint[]): Waypoint[] {
    return waypoints.map((waypoint) => ({ ...waypoint }));
  }

  private getPictureStateSnapshot(pictureId: string): PersistedPictureState {
    return {
      shapes: this.cloneShapes(this.getShapes(pictureId)),
      waypoints: this.cloneWaypoints(this.getWaypoints(pictureId)),
    };
  }

  private applyPictureStateSnapshot(pictureId: string, state: PersistedPictureState): void {
    this.drawingsByPicture.update((current) => ({
      ...current,
      [pictureId]: this.cloneShapes(state.shapes),
    }));

    this.waypointsByPicture.update((current) => ({
      ...current,
      [pictureId]: this.cloneWaypoints(state.waypoints),
    }));
  }

  private readPersistedState(): PersistedStateByPicture {
    const storage = getLocalStorage();
    if (!storage) {
      return {};
    }

    const raw = storage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    try {
      const parsed = JSON.parse(raw) as PersistedStateByPicture;
      return parsed;
    } catch {
      return {};
    }
  }

  private writePersistedState(state: PersistedStateByPicture): void {
    const storage = getLocalStorage();
    if (!storage) {
      return;
    }

    storage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(state));
  }

  private parseKonvaDrawingJson(input: string): DrawingShape[] {
    const result: DrawingShape[] = [];
    let parsed: KonvaStageJson;

    try {
      parsed = JSON.parse(input) as KonvaStageJson;
    } catch {
      return result;
    }

    for (const rawObject of parsed.objects) {
      let objectPayload: unknown;
      try {
        objectPayload = JSON.parse(rawObject) as unknown;
      } catch {
        continue;
      }

      const konvaObject = objectPayload as {
        className?: string;
        attrs?: {
          points?: number[];
          stroke?: string;
          strokeWidth?: number;
          dash?: number[];
          x?: number;
          y?: number;
          width?: number;
          height?: number;
        };
      };

      if (konvaObject.className === 'Line' && Array.isArray(konvaObject.attrs?.points)) {
        const points = toPointPairs(konvaObject.attrs.points);
        if (points.length >= 2) {
          result.push({
            id: this.nextId('shape-line'),
            type: konvaObject.attrs?.dash?.length ? 'dashed-line' : 'line',
            points,
            color: konvaObject.attrs?.stroke ?? '#111111',
            strokeWidth: konvaObject.attrs?.strokeWidth ?? 3,
          });
        }
        continue;
      }

      if (
        konvaObject.className === 'Rect' &&
        typeof konvaObject.attrs?.x === 'number' &&
        typeof konvaObject.attrs?.y === 'number' &&
        typeof konvaObject.attrs?.width === 'number' &&
        typeof konvaObject.attrs?.height === 'number'
      ) {
        result.push({
          id: this.nextId('shape-rect'),
          type: 'rectangle',
          x: konvaObject.attrs.x,
          y: konvaObject.attrs.y,
          width: konvaObject.attrs.width,
          height: konvaObject.attrs.height,
          color: konvaObject.attrs?.stroke ?? '#b91c1c',
          strokeWidth: konvaObject.attrs?.strokeWidth ?? 3,
        } as RectangleShape);
      }
    }

    if (result.length === 0) {
      result.push({
        id: 'shape-fallback-1',
        type: 'line',
        points: [
          { x: 200, y: 140 },
          { x: 500, y: 340 },
        ],
        color: '#111111',
        strokeWidth: 3,
      });
    }

    return result;
  }
}

function toPointPairs(flatPoints: number[]): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < flatPoints.length - 1; i += 2) {
    points.push({ x: flatPoints[i], y: flatPoints[i + 1] });
  }
  return points;
}

export function moveShape(shape: DrawingShape, dx: number, dy: number): DrawingShape {
  if (shape.type === 'line' || shape.type === 'dashed-line') {
    return {
      ...shape,
      points: shape.points.map((point) => ({
        x: point.x + dx,
        y: point.y + dy,
      })),
    };
  }

  if (shape.type === 'arrow') {
    const arrowShape = shape as ArrowShape;
    return {
      ...shape,
      startPoint: { x: arrowShape.startPoint.x + dx, y: arrowShape.startPoint.y + dy },
      endPoint: { x: arrowShape.endPoint.x + dx, y: arrowShape.endPoint.y + dy },
    };
  }

  if (shape.type === 'rectangle') {
    return {
      ...shape,
      x: shape.x + dx,
      y: shape.y + dy,
    };
  }

  if (shape.type === 'oval') {
    return {
      ...shape,
      x: shape.x + dx,
      y: shape.y + dy,
    };
  }

  if (shape.type === 'circle') {
    return {
      ...shape,
      cx: shape.cx + dx,
      cy: shape.cy + dy,
    };
  }

  const movedTriangle = {
    ...shape,
    points: [
      {
        x: shape.points[0].x + dx,
        y: shape.points[0].y + dy,
      },
      {
        x: shape.points[1].x + dx,
        y: shape.points[1].y + dy,
      },
      {
        x: shape.points[2].x + dx,
        y: shape.points[2].y + dy,
      },
    ],
  } as TriangleShape;

  return movedTriangle;
}

export function getShapeCenter(shape: DrawingShape): Point {
  if (shape.type === 'rectangle' || shape.type === 'oval') {
    return {
      x: shape.x + shape.width / 2,
      y: shape.y + shape.height / 2,
    };
  }

  if (shape.type === 'circle') {
    return {
      x: shape.cx,
      y: shape.cy,
    };
  }

  if (shape.type === 'arrow') {
    const arrowShape = shape as ArrowShape;
    return {
      x: (arrowShape.startPoint.x + arrowShape.endPoint.x) / 2,
      y: (arrowShape.startPoint.y + arrowShape.endPoint.y) / 2,
    };
  }

  const points = shape.points;
  const sum = points.reduce(
    (acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }),
    { x: 0, y: 0 },
  );
  return {
    x: sum.x / points.length,
    y: sum.y / points.length,
  };
}

export function scaleShape(shape: DrawingShape, scale: number, origin?: Point): DrawingShape {
  const center = origin ?? getShapeCenter(shape);
  const safeScale = Math.max(0.2, Math.min(5, scale));

  if (shape.type === 'rectangle' || shape.type === 'oval') {
    const nextWidth = shape.width * safeScale;
    const nextHeight = shape.height * safeScale;
    return {
      ...shape,
      x: center.x - nextWidth / 2,
      y: center.y - nextHeight / 2,
      width: nextWidth,
      height: nextHeight,
    };
  }

  if (shape.type === 'circle') {
    return {
      ...shape,
      cx: center.x,
      cy: center.y,
      radius: Math.max(2, shape.radius * safeScale),
    };
  }

  if (shape.type === 'arrow') {
    const arrowShape = shape as ArrowShape;
    return {
      ...shape,
      startPoint: {
        x: center.x + (arrowShape.startPoint.x - center.x) * safeScale,
        y: center.y + (arrowShape.startPoint.y - center.y) * safeScale,
      },
      endPoint: {
        x: center.x + (arrowShape.endPoint.x - center.x) * safeScale,
        y: center.y + (arrowShape.endPoint.y - center.y) * safeScale,
      },
    };
  }

  return {
    ...shape,
    points: shape.points.map((point) => ({
      x: center.x + (point.x - center.x) * safeScale,
      y: center.y + (point.y - center.y) * safeScale,
    })),
  } as DrawingShape;
}

export function rotateShape(shape: DrawingShape, deltaDeg: number, origin?: Point): DrawingShape {
  const center = origin ?? getShapeCenter(shape);

  if (shape.type === 'rectangle' || shape.type === 'oval') {
    return {
      ...shape,
      rotationDeg: normalizeDeg((shape.rotationDeg ?? 0) + deltaDeg),
    };
  }

  if (shape.type === 'circle') {
    return shape;
  }

  if (shape.type === 'arrow') {
    const arrowShape = shape as ArrowShape;
    return {
      ...shape,
      startPoint: rotatePoint(arrowShape.startPoint, center, deltaDeg),
      endPoint: rotatePoint(arrowShape.endPoint, center, deltaDeg),
    };
  }

  return {
    ...shape,
    points: shape.points.map((point) => rotatePoint(point, center, deltaDeg)),
  } as DrawingShape;
}

function cloneShape(shape: DrawingShape): DrawingShape {
  if (shape.type === 'rectangle' || shape.type === 'oval' || shape.type === 'circle') {
    return {
      ...shape,
    };
  }

  if (shape.type === 'arrow') {
    return {
      ...shape,
    };
  }

  return {
    ...shape,
    points: shape.points.map((point: Point) => ({ ...point })),
  } as DrawingShape;
}

function getLocalStorage(): Storage | undefined {
  if (typeof window === 'undefined' || !window.localStorage) {
    return undefined;
  }

  return window.localStorage;
}

function rotatePoint(point: Point, center: Point, deltaDeg: number): Point {
  const radians = (deltaDeg * Math.PI) / 180;
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * Math.cos(radians) - dy * Math.sin(radians),
    y: center.y + dx * Math.sin(radians) + dy * Math.cos(radians),
  };
}

function normalizeDeg(deg: number): number {
  const normalized = deg % 360;
  if (normalized < 0) {
    return normalized + 360;
  }
  return normalized;
}