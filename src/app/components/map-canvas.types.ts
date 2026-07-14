import { Waypoint } from '../poc-types';

export interface BoundsSnapshot {
  west: number;
  east: number;
  north: number;
  south: number;
}

export interface MinimapViewportState {
  visible: boolean;
  left: number;
  top: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

export interface CanvasPictureLoadedEvent {
  url: string;
  bounds: BoundsSnapshot;
  imageSize: {
    width: number;
    height: number;
  };
}

export interface CanvasContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  waypoint: Waypoint | null;
  openedAt: number;
  suppressNextPageClick: boolean;
}

export interface CanvasSelectionState {
  selectedShapeId: string | null;
  selectedWaypointId: string | null;
}
