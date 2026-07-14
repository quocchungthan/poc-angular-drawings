import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, input, NgZone, OnDestroy, output, ViewChild } from '@angular/core';
import * as L from 'leaflet';
import {
  DEFAULT_DRAWING_COLOR,
  DEFAULT_LINE_STROKE_WIDTH,
  DRAG_THRESHOLD,
  POINTER_DELTA_EPSILON,
  POLYLINE_POINT_MIN_DISTANCE,
  WAYPOINT_HIT_RADIUS_PX,
  WAYPOINT_MENU_SUPPRESSION_MS,
} from '../app.constants';
import { shouldCommitDragUpdate } from '../drag.utils';
import {
  angleDeg,
  distance,
  getOvalOutlinePoints,
  getPathLength,
  getRectangleCorners,
  getResizeHandlePoint,
  getRotateHandlePoint,
  toPolylinePoints,
  updateShapePoint,
} from '../geometry.utils';
import { loadImageSize } from '../image.utils';
import { AppMode, ArrowShape, DrawingShape, DrawingTool, EditSubMode, Point, Waypoint } from '../poc-types';
import { getShapeCenter, moveShape, PocStateService, rotateShape, scaleShape } from '../poc-state.service';
import { attachShapeSelectionHandlers, createShapeLayer } from '../shape-rendering.factory';
import {
  BoundsSnapshot,
  CanvasContextMenuState,
  CanvasPictureLoadedEvent,
  CanvasSelectionState,
  MinimapViewportState,
} from './map-canvas.types';

@Component({
  selector: 'app-map-canvas',
  templateUrl: './map-canvas.component.html',
  styleUrl: './map-canvas.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MapCanvasComponent implements AfterViewInit, OnDestroy {
  readonly pictureUrl = input.required<string>();
  readonly pictureId = input.required<string>();
  readonly pictureName = input.required<string>();
  readonly mode = input.required<AppMode>();
  readonly editSubMode = input.required<EditSubMode>();
  readonly drawingTool = input.required<DrawingTool>();
  readonly selectedColor = input.required<string>();
  readonly selectedThickness = input.required<number>();

  readonly statusMessageChange = output<string>();
  readonly selectionChange = output<CanvasSelectionState>();
  readonly contextMenuStateChange = output<CanvasContextMenuState>();
  readonly pictureLoaded = output<CanvasPictureLoadedEvent>();
  readonly mainViewBoundsChange = output<BoundsSnapshot | null>();

  @ViewChild('mapContainer')
  private readonly mapContainer?: ElementRef<HTMLDivElement>;

  private map?: L.Map;
  private imageOverlay?: L.ImageOverlay;
  private currentImageSize?: { width: number; height: number };

  private drawingLayer = L.layerGroup();
  private waypointLayer = L.layerGroup();
  private editHandleLayer = L.layerGroup();
  private drawPreviewLayer = L.layerGroup();

  private pointerMoveRafId: number | null = null;
  private pendingPointerMoveEvent: L.LeafletMouseEvent | null = null;

  private shapeDragState: ShapeDragState | null = null;
  private drawGestureState: DrawGestureState | null = null;
  private waypointDragState: WaypointDragState | null = null;
  private transformDragState: TransformDragState | null = null;
  private vertexDragState: VertexDragState | null = null;
  private waypointMenuSuppressionState: WaypointMenuSuppressionState | null = null;

  private selectedShapeId: string | null = null;
  private selectedWaypointId: string | null = null;
  private contextMenuVisible = false;
  private contextWaypoint: Waypoint | null = null;
  private contextMenuX = 0;
  private contextMenuY = 0;
  private suppressNextPageClick = false;
  private contextMenuOpenedAt = 0;

  private imageLoadToken = 0;
  private readonly shapeLayers = new Map<string, L.Layer>();
  private readonly windowMouseUpListener = () => this.handleMapMouseUp();

  constructor(
    private readonly state: PocStateService,
    private readonly ngZone: NgZone,
  ) {}

  ngAfterViewInit(): void {
    this.initializeMap();
    void this.showPicture(this.pictureUrl());
    window.addEventListener('mouseup', this.windowMouseUpListener);
  }

  ngOnDestroy(): void {
    window.removeEventListener('mouseup', this.windowMouseUpListener);

    if (this.pointerMoveRafId !== null) {
      cancelAnimationFrame(this.pointerMoveRafId);
      this.pointerMoveRafId = null;
      this.pendingPointerMoveEvent = null;
    }

    this.map?.remove();
  }

  syncInputs(): void {
    if (!this.map) {
      return;
    }

    this.applyMapInteractionMode();
    this.renderLayers();

    const currentUrl = (this.imageOverlay as { _url?: string } | undefined)?._url;
    if (currentUrl !== this.pictureUrl()) {
      void this.showPicture(this.pictureUrl());
    }
  }

  getCurrentImageSize(): { width: number; height: number } | undefined {
    return this.currentImageSize;
  }

  resetInteractionState(): void {
    this.clearDrawGesture();
    this.shapeDragState = null;
    this.transformDragState = null;
    this.vertexDragState = null;
    this.hideContextMenu();
    this.clearSelection();
  }

  refreshFromState(): void {
    this.renderLayers();
  }

  updateSelectedShapeProperty(property: 'color' | 'thickness', value: string | number): void {
    if (!this.selectedShapeId) {
      return;
    }

    const pictureId = this.pictureId();
    const shape = this.state.findShape(pictureId, this.selectedShapeId);
    if (!shape) {
      return;
    }

    const updatedShape = { ...shape };
    if (property === 'color' && typeof value === 'string') {
      updatedShape.color = value;
    } else if (property === 'thickness' && typeof value === 'number') {
      updatedShape.strokeWidth = value;
    }

    this.state.updateShape(pictureId, updatedShape);
    this.state.savePictureState(pictureId);
    this.renderLayers();
  }

  resetToSelectMode(): void {
    this.hideContextMenu();
    this.clearDrawGesture();
    this.shapeDragState = null;
    this.transformDragState = null;
    this.vertexDragState = null;
    this.clearSelection();
    this.state.setDrawingTool('select');
    this.renderLayers();
  }

  hideContextMenu(): void {
    this.contextMenuVisible = false;
    this.contextWaypoint = null;
    this.setMapContainerData('contextMenuWaypointId', '');
    this.setMapContainerData('contextMenuX', '');
    this.setMapContainerData('contextMenuY', '');
    this.emitContextMenuState();
  }

  handlePageClick(event: MouseEvent): void {
    if (Date.now() - this.contextMenuOpenedAt < 150) {
      return;
    }

    if (this.suppressNextPageClick) {
      this.suppressNextPageClick = false;
      return;
    }

    if (this.isWaypointEventTarget(event.target)) {
      return;
    }

    this.hideContextMenu();
  }

  updateMinimapViewportDataset(state: MinimapViewportState): void {
    this.setMapContainerData('minimapViewportVisible', state.visible ? 'true' : 'false');
    if (!state.visible) {
      return;
    }

    this.setMapContainerData('minimapViewportLeft', state.left.toFixed(2));
    this.setMapContainerData('minimapViewportTop', state.top.toFixed(2));
    this.setMapContainerData('minimapViewportWidth', state.width.toFixed(2));
    this.setMapContainerData('minimapViewportHeight', state.height.toFixed(2));
  }

  clearSelection(): void {
    this.selectedShapeId = null;
    this.selectedWaypointId = null;
    this.emitSelection();
  }

  private initializeMap(): void {
    if (!this.mapContainer) {
      return;
    }

    this.map = L.map(this.mapContainer.nativeElement, {
      crs: L.CRS.Simple,
      attributionControl: false,
      zoomControl: true,
      minZoom: -2,
      maxZoom: 4,
      zoomSnap: 0.25,
      zoomDelta: 0.25,
      wheelPxPerZoomLevel: 25,
      maxBoundsViscosity: 0.5,
      zoomAnimation: false,
      inertia: false,
    });

    this.drawingLayer.addTo(this.map);
    this.waypointLayer.addTo(this.map);
    this.editHandleLayer.addTo(this.map);
    this.drawPreviewLayer.addTo(this.map);

    this.map.on('mousedown', (event: L.LeafletMouseEvent) => this.handleMapMouseDown(event));
    this.map.on('click', (event: L.LeafletMouseEvent) => this.handleMapClick(event));
    this.map.on('mousemove', (event: L.LeafletMouseEvent) => this.handleMapMouseMove(event));
    this.map.on('mouseup', (event: L.LeafletMouseEvent) => this.handleMapMouseUp(event));
    this.map.on('contextmenu', (event: L.LeafletMouseEvent) => this.handleMapContextMenu(event));
    this.map.on('move', () => this.emitMainViewBounds());
    this.map.on('moveend', () => this.emitMainViewBounds());
    this.map.on('zoom', () => this.emitMainViewBounds());
    this.map.on('zoomend', () => this.emitMainViewBounds());
    this.map.on('resize', () => this.emitMainViewBounds());

    this.applyMapInteractionMode();
    this.emitMainViewBounds();
  }

  private async showPicture(url: string): Promise<void> {
    const localMap = this.map;
    if (!localMap) {
      return;
    }

    const token = ++this.imageLoadToken;
    const size = await loadImageSize(url);
    if (token !== this.imageLoadToken) {
      return;
    }

    this.currentImageSize = size;
    const bounds = L.latLngBounds(L.latLng(0, 0), L.latLng(size.height, size.width));

    if (this.imageOverlay) {
      this.imageOverlay.remove();
    }

    this.imageOverlay = L.imageOverlay(url, bounds).addTo(localMap);
    localMap.fitBounds(bounds, { animate: false });
    localMap.panInsideBounds(bounds);
    localMap.setMaxBounds(bounds.pad(0.3));

    this.clearDrawGesture();
    this.clearSelection();
    this.transformDragState = null;
    this.shapeDragState = null;
    this.emitStatus(`Viewing ${this.pictureName()}`);
    this.renderLayers();
    this.emitMainViewBounds();
    this.emitPictureLoaded(url, bounds, size);
  }

  private emitPictureLoaded(url: string, bounds: L.LatLngBounds, imageSize: { width: number; height: number }): void {
    this.emitInAngular(() => {
      this.pictureLoaded.emit({
        url,
        bounds: {
          west: bounds.getWest(),
          east: bounds.getEast(),
          north: bounds.getNorth(),
          south: bounds.getSouth(),
        },
        imageSize,
      });
    });
  }

  private emitMainViewBounds(): void {
    if (!this.map) {
      this.emitInAngular(() => this.mainViewBoundsChange.emit(null));
      return;
    }

    // Leaflet throws in tests if bounds are requested before initial view is ready.
    if (!this.imageOverlay) {
      return;
    }

    const bounds = this.map.getBounds();
    this.emitInAngular(() => {
      this.mainViewBoundsChange.emit({
        west: bounds.getWest(),
        east: bounds.getEast(),
        north: bounds.getNorth(),
        south: bounds.getSouth(),
      });
    });
  }

  private applyMapInteractionMode(): void {
    if (!this.map) {
      return;
    }

    const drawingEditMode = this.mode() === 'edit' && this.editSubMode() === 'drawing-edit';

    if (drawingEditMode) {
      this.map.dragging.disable();
    } else {
      this.map.dragging.enable();
    }

    this.map.scrollWheelZoom.enable();
    this.map.doubleClickZoom.enable();

    if (this.mapContainer) {
      this.mapContainer.nativeElement.style.cursor =
        drawingEditMode && this.drawingTool() !== 'select' ? 'crosshair' : 'grab';
    }
  }

  private renderLayers(): void {
    this.renderDrawingLayer();
    this.renderWaypointLayer();
    this.renderEditHandles();
  }

  private renderDrawingLayer(): void {
    this.drawingLayer.clearLayers();
    this.shapeLayers.clear();

    const pictureId = this.pictureId();
    const shapes = this.state.getShapes(pictureId);
    const drawingEditMode = this.mode() === 'edit' && this.editSubMode() === 'drawing-edit';

    for (const shape of shapes) {
      const path = createShapeLayer(shape, drawingEditMode, {
        selected: this.selectedShapeId === shape.id,
      });

      if (drawingEditMode) {
        attachShapeSelectionHandlers(
          path,
          shape.id,
          (event: L.LeafletMouseEvent) => this.startShapeDrag(shape.id, event),
          (event: L.LeafletMouseEvent) => {
            this.selectShape(shape.id);
            this.emitStatus(`Selected shape ${shape.id}`);
            this.renderLayers();
            L.DomEvent.stopPropagation(event);
          },
        );
      }

      this.shapeLayers.set(shape.id, path);
      path.addTo(this.drawingLayer);
    }
  }

  private renderWaypointLayer(): void {
    this.waypointLayer.clearLayers();

    const showWaypoints =
      this.mode() === 'readonly' ||
      (this.mode() === 'edit' && this.editSubMode() === 'waypoint-edit');

    if (!showWaypoints) {
      return;
    }

    const pictureId = this.pictureId();
    const waypointEditMode = this.mode() === 'edit' && this.editSubMode() === 'waypoint-edit';
    const waypoints = this.state.getWaypoints(pictureId);

    for (const waypoint of waypoints) {
      const marker = L.marker([waypoint.y, waypoint.x], {
        draggable: waypointEditMode,
        icon: this.createWaypointIcon(waypoint, waypoint.id === this.selectedWaypointId),
      });

      marker.bindTooltip(
        `${waypoint.name} (${waypoint.id}) - ${waypoint.waypointTypeDescription}`,
        {
          direction: 'top',
          offset: [0, -16],
          sticky: true,
          className: 'waypoint-tooltip',
        },
      );

      marker.on('click', (event: L.LeafletMouseEvent) => {
        if (this.shouldSuppressWaypointMenu(waypoint.id)) {
          this.consumeLeafletMouseEvent(event);
          return;
        }

        if (waypointEditMode) {
          this.selectedWaypointId = waypoint.id;
          this.selectedShapeId = null;
          this.emitSelection();
        }

        this.openWaypointContextMenu(event, waypoint);
        this.consumeLeafletMouseEvent(event);
      });

      marker.on('contextmenu', (event: L.LeafletMouseEvent) => {
        if (this.shouldSuppressWaypointMenu(waypoint.id)) {
          this.consumeLeafletMouseEvent(event);
          return;
        }

        if (waypointEditMode) {
          this.selectedWaypointId = waypoint.id;
          this.selectedShapeId = null;
          this.emitSelection();
        }

        this.openWaypointContextMenu(event, waypoint);
        this.consumeLeafletMouseEvent(event);
      });

      if (!waypointEditMode) {
        marker.on('mousedown', (event: L.LeafletMouseEvent) => {
          if (this.shouldSuppressWaypointMenu(waypoint.id)) {
            this.consumeLeafletMouseEvent(event);
            return;
          }

          this.openWaypointContextMenu(event, waypoint);
          this.consumeLeafletMouseEvent(event);
        });
      }

      if (waypointEditMode) {
        marker.on('dragstart', () => {
          this.waypointDragState = {
            waypointId: waypoint.id,
            startX: waypoint.x,
            startY: waypoint.y,
            moved: false,
            committed: false,
          };
        });

        marker.on('drag', () => {
          const nextPosition = marker.getLatLng();
          if (!this.waypointDragState || this.waypointDragState.waypointId !== waypoint.id) {
            return;
          }

          const moved = this.hasMovedEnough(
            { x: this.waypointDragState.startX, y: this.waypointDragState.startY },
            { x: nextPosition.lng, y: nextPosition.lat },
          );
          if (moved && !this.waypointDragState.moved) {
            this.waypointDragState = {
              ...this.waypointDragState,
              moved: true,
            };
          }
        });

        marker.on('dragend', () => {
          const nextPosition = marker.getLatLng();
          const dragState = this.waypointDragState;
          if (!dragState) {
            return;
          }

          const moved =
            dragState.moved ||
            this.hasMovedEnough(
              { x: dragState.startX, y: dragState.startY },
              { x: nextPosition.lng, y: nextPosition.lat },
            );

          if (shouldCommitDragUpdate(moved, dragState.committed)) {
            this.state.updateWaypointPosition(pictureId, waypoint.id, nextPosition.lng, nextPosition.lat);
            this.state.savePictureState(pictureId);
            this.markWaypointMenuSuppressed(waypoint.id);
            this.emitStatus(`Moved waypoint ${waypoint.id}`);
            this.waypointDragState = {
              ...dragState,
              committed: true,
            };
          }

          this.waypointDragState = null;
        });
      }

      marker.addTo(this.waypointLayer);
    }
  }

  private renderEditHandles(): void {
    this.editHandleLayer.clearLayers();

    const drawingSelectMode =
      this.mode() === 'edit' &&
      this.editSubMode() === 'drawing-edit' &&
      this.drawingTool() === 'select';

    if (!drawingSelectMode || !this.selectedShapeId) {
      return;
    }

    const pictureId = this.pictureId();
    const shape = this.state.findShape(pictureId, this.selectedShapeId);
    if (!shape) {
      return;
    }

    if (shape.type === 'line' || shape.type === 'dashed-line' || shape.type === 'triangle') {
      this.renderVertexHandles(shape);
      return;
    }

    if (shape.type === 'arrow') {
      return;
    }

    const transformShape = shape as TransformableShape;
    const center = getShapeCenter(transformShape);
    const resizePoint = getResizeHandlePoint(transformShape);
    const resizeHandle = this.createTransformHandle('resize', transformShape, center, resizePoint);
    resizeHandle.addTo(this.editHandleLayer);

    if (transformShape.type === 'rectangle' || transformShape.type === 'oval') {
      const rotatePoint = getRotateHandlePoint(transformShape, center);
      const rotateHandle = this.createTransformHandle('rotate', transformShape, center, rotatePoint);
      rotateHandle.addTo(this.editHandleLayer);
    }
  }

  private createTransformHandle(
    mode: 'resize' | 'rotate',
    shape: TransformableShape,
    center: Point,
    handlePoint: Point,
  ): L.Marker {
    const marker = L.marker([handlePoint.y, handlePoint.x], {
      draggable: true,
      icon: this.createEditHandleIcon(mode),
      zIndexOffset: 1000,
    });

    marker.on('dragstart', () => {
      const pictureId = this.pictureId();
      const latestShape = this.state.findShape(pictureId, shape.id);
      if (!latestShape || (latestShape.type !== 'rectangle' && latestShape.type !== 'oval' && latestShape.type !== 'circle')) {
        return;
      }

      const markerLatLng = marker.getLatLng();
      this.transformDragState = {
        shapeId: latestShape.id,
        mode,
        center,
        startShape: latestShape,
        latestShape,
        moved: false,
        committed: false,
        startDistance: distance(center, { x: markerLatLng.lng, y: markerLatLng.lat }),
        startAngle: angleDeg(center, { x: markerLatLng.lng, y: markerLatLng.lat }),
      };
    });

    marker.on('drag', () => {
      this.applyTransformDrag(marker.getLatLng());
    });

    marker.on('dragend', () => {
      const dragState = this.transformDragState;
      if (!dragState) {
        return;
      }

      this.applyTransformDrag(marker.getLatLng());

      const finalizedState = this.transformDragState ?? dragState;

      if (shouldCommitDragUpdate(finalizedState.moved, finalizedState.committed)) {
        this.state.updateShape(this.pictureId(), finalizedState.latestShape);
        this.state.savePictureState(this.pictureId());
        this.transformDragState = {
          ...finalizedState,
          committed: true,
        };
      }

      this.transformDragState = null;
      this.renderLayers();
      this.emitStatus(`${mode === 'resize' ? 'Resized' : 'Rotated'} ${shape.id}`);
    });

    return marker;
  }

  private renderVertexHandles(shape: Extract<DrawingShape, { type: 'line' | 'dashed-line' | 'triangle' }>): void {
    shape.points.forEach((point, pointIndex) => {
      const vertexHandle = L.marker([point.y, point.x], {
        draggable: true,
        icon: this.createEditHandleIcon('vertex'),
        zIndexOffset: 1000,
      });

      vertexHandle.on('dragstart', () => {
        const pictureId = this.pictureId();
        const activeShape = this.state.findShape(pictureId, shape.id);
        if (
          !activeShape ||
          activeShape.type === 'rectangle' ||
          activeShape.type === 'circle' ||
          activeShape.type === 'oval' ||
          activeShape.type === 'arrow'
        ) {
          return;
        }

        const pointsShape = activeShape as Extract<DrawingShape, { type: 'line' | 'dashed-line' | 'triangle' }>;
        this.vertexDragState = {
          shapeId: activeShape.id,
          pointIndex,
          startPoint: { ...pointsShape.points[pointIndex] },
          startShape: pointsShape,
          latestShape: pointsShape,
          moved: false,
          committed: false,
        };
      });

      vertexHandle.on('drag', () => {
        if (!this.vertexDragState) {
          return;
        }

        const nextShape = updateShapePoint(this.vertexDragState.startShape, this.vertexDragState.pointIndex, {
          x: vertexHandle.getLatLng().lng,
          y: vertexHandle.getLatLng().lat,
        });

        this.vertexDragState = {
          ...this.vertexDragState,
          latestShape: nextShape,
          moved: true,
        };
        this.updateShapeLayerPreview(nextShape);
      });

      vertexHandle.on('dragend', () => {
        const dragState = this.vertexDragState;
        if (!dragState) {
          return;
        }

        const finalPoint = {
          x: vertexHandle.getLatLng().lng,
          y: vertexHandle.getLatLng().lat,
        };
        const finalizedShape = updateShapePoint(dragState.startShape, dragState.pointIndex, finalPoint);
        const moved = dragState.moved || this.hasMovedEnough(dragState.startPoint, finalPoint);

        if (shouldCommitDragUpdate(moved, dragState.committed)) {
          this.state.updateShape(this.pictureId(), finalizedShape);
          this.state.savePictureState(this.pictureId());
          this.vertexDragState = {
            ...dragState,
            latestShape: finalizedShape,
            moved,
            committed: true,
          };
        }

        this.vertexDragState = null;
        this.renderLayers();
        this.emitStatus(`Updated vertex of ${shape.id}`);
      });

      vertexHandle.addTo(this.editHandleLayer);
    });
  }

  private createEditHandleIcon(mode: 'resize' | 'rotate' | 'vertex'): L.DivIcon {
    return L.divIcon({
      className: `edit-handle edit-handle-${mode}`,
      html: mode === 'resize' ? 'R' : mode === 'rotate' ? 'O' : 'V',
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });
  }

  private applyTransformDrag(latLng: L.LatLng): void {
    if (!this.transformDragState) {
      return;
    }

    const pointer = { x: latLng.lng, y: latLng.lat };
    let nextShape = this.transformDragState.startShape;

    if (this.transformDragState.mode === 'resize') {
      if (this.transformDragState.startDistance <= 0.0001) {
        return;
      }

      const ratio = distance(this.transformDragState.center, pointer) / this.transformDragState.startDistance;
      nextShape = scaleShape(
        this.transformDragState.startShape,
        ratio,
        this.transformDragState.center,
      ) as TransformableShape;
    } else {
      const nextAngle = angleDeg(this.transformDragState.center, pointer);
      const deltaDeg = nextAngle - this.transformDragState.startAngle;
      nextShape = rotateShape(
        this.transformDragState.startShape,
        deltaDeg,
        this.transformDragState.center,
      ) as TransformableShape;
    }

    this.transformDragState = {
      ...this.transformDragState,
      latestShape: nextShape,
      moved: true,
    };
    this.updateShapeLayerPreview(nextShape);
  }

  private createWaypointIcon(waypoint: Waypoint, selected: boolean): L.DivIcon {
    const shortType = waypoint.waypointTypeDescription.slice(0, 1).toUpperCase();
    return L.divIcon({
      className: `waypoint-pin waypoint-${waypoint.id}${selected ? ' selected' : ''}`,
      html: `<span class="waypoint-label" data-testid="waypoint-${waypoint.id}" data-waypoint-id="${waypoint.id}">${shortType}</span>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });
  }

  private openWaypointContextMenu(event: L.LeafletMouseEvent, waypoint: Waypoint): void {
    this.suppressNextPageClick = true;
    this.contextMenuOpenedAt = Date.now();
    this.contextMenuX = event.containerPoint.x;
    this.contextMenuY = event.containerPoint.y;
    this.contextWaypoint = waypoint;
    this.contextMenuVisible = true;
    this.setMapContainerData('contextMenuWaypointId', waypoint.id);
    this.setMapContainerData('contextMenuX', event.containerPoint.x.toFixed(2));
    this.setMapContainerData('contextMenuY', event.containerPoint.y.toFixed(2));
    this.emitStatus(`Opened menu for ${waypoint.name}`);
    this.emitContextMenuState();
  }

  private setMapContainerData(name: string, value: string): void {
    const container = this.mapContainer?.nativeElement;
    if (!container) {
      return;
    }

    container.dataset[name] = value;
  }

  private shouldSuppressWaypointMenu(waypointId: string): boolean {
    if (!this.waypointMenuSuppressionState) {
      return false;
    }

    const now = Date.now();
    if (now > this.waypointMenuSuppressionState.until) {
      this.waypointMenuSuppressionState = null;
      return false;
    }

    return this.waypointMenuSuppressionState.waypointId === waypointId;
  }

  private markWaypointMenuSuppressed(waypointId: string): void {
    this.waypointMenuSuppressionState = {
      waypointId,
      until: Date.now() + WAYPOINT_MENU_SUPPRESSION_MS,
    };
  }

  private consumeLeafletMouseEvent(event: L.LeafletMouseEvent): void {
    const originalEvent = event.originalEvent;
    if (originalEvent) {
      originalEvent.preventDefault();
      originalEvent.stopPropagation();
      L.DomEvent.stop(originalEvent);
      return;
    }

    L.DomEvent.stopPropagation(event);
  }

  private hasMovedEnough(start: Point, current: Point): boolean {
    return distance(start, current) >= DRAG_THRESHOLD;
  }

  private updateShapeLayerPreview(shape: DrawingShape): void {
    const layer = this.shapeLayers.get(shape.id);
    if (!layer) {
      return;
    }

    if (shape.type === 'line' || shape.type === 'dashed-line') {
      (layer as L.Polyline).setLatLngs(shape.points.map((point) => [point.y, point.x] as [number, number]));
      return;
    }

    if (shape.type === 'triangle') {
      (layer as L.Polygon).setLatLngs(shape.points.map((point) => [point.y, point.x] as [number, number]));
      return;
    }

    if (shape.type === 'rectangle') {
      (layer as L.Polygon).setLatLngs(getRectangleCorners(shape).map((point) => [point.y, point.x] as [number, number]));
      return;
    }

    if (shape.type === 'circle') {
      const circle = layer as L.Circle;
      circle.setLatLng([shape.cy, shape.cx]);
      circle.setRadius(shape.radius);
      return;
    }

    if (shape.type === 'oval') {
      (layer as L.Polygon).setLatLngs(
        getOvalOutlinePoints(shape).map((point) => [point.y, point.x] as [number, number]),
      );
    }
  }

  private handleMapMouseDown(event: L.LeafletMouseEvent): void {
    if (!(this.mode() === 'edit' && this.editSubMode() === 'drawing-edit')) {
      return;
    }

    if (this.isTransformerEventTarget(event.originalEvent?.target)) {
      return;
    }

    const tool = this.drawingTool();
    if (tool === 'select') {
      return;
    }

    this.clearSelection();
    this.drawGestureState = {
      tool,
      start: event.latlng,
      current: event.latlng,
      points: [event.latlng],
    };
    this.renderDrawPreview();
  }

  private handleMapClick(event: L.LeafletMouseEvent): void {
    if (this.isTransformerEventTarget(event.originalEvent?.target)) {
      return;
    }

    if (Date.now() - this.contextMenuOpenedAt < 150) {
      return;
    }

    if (this.isWaypointEventTarget(event.originalEvent?.target)) {
      if (this.mode() === 'readonly' || (this.mode() === 'edit' && this.editSubMode() === 'waypoint-edit')) {
        const waypoint = this.findWaypointNearContainerPoint(event.containerPoint, this.pictureId());
        if (waypoint) {
          this.openWaypointContextMenu(event, waypoint);
        }
      }
      return;
    }

    if (Date.now() - this.contextMenuOpenedAt < 200) {
      return;
    }

    if (this.mode() === 'readonly' || (this.mode() === 'edit' && this.editSubMode() === 'waypoint-edit')) {
      const waypoint = this.findWaypointNearContainerPoint(event.containerPoint, this.pictureId());
      if (waypoint) {
        this.openWaypointContextMenu(event, waypoint);
        return;
      }
    }

    this.hideContextMenu();

    if (this.mode() === 'edit' && this.editSubMode() === 'waypoint-edit') {
      this.selectedShapeId = null;
      this.selectedWaypointId = null;
      this.emitSelection();
      this.state.addWaypoint(this.pictureId(), event.latlng.lng, event.latlng.lat);
      this.emitStatus('Waypoint added');
      this.renderWaypointLayer();
      return;
    }

    if (!(this.mode() === 'edit' && this.editSubMode() === 'drawing-edit')) {
      return;
    }

    const tool = this.drawingTool();
    if (tool === 'select') {
      this.clearSelection();
      this.renderLayers();
    }
  }

  private handleMapContextMenu(event: L.LeafletMouseEvent): void {
    if (this.isTransformerEventTarget(event.originalEvent?.target)) {
      this.consumeLeafletMouseEvent(event);
      return;
    }

    if (this.mode() === 'readonly' || (this.mode() === 'edit' && this.editSubMode() === 'waypoint-edit')) {
      const waypoint = this.findWaypointNearContainerPoint(event.containerPoint, this.pictureId());
      if (waypoint && !this.shouldSuppressWaypointMenu(waypoint.id)) {
        if (this.mode() === 'edit' && this.editSubMode() === 'waypoint-edit') {
          this.selectedWaypointId = waypoint.id;
          this.selectedShapeId = null;
          this.emitSelection();
        }

        this.openWaypointContextMenu(event, waypoint);
        this.consumeLeafletMouseEvent(event);
        return;
      }
    }

    this.hideContextMenu();
  }

  private buildShapeFromTwoPoints(start: L.LatLng, end: L.LatLng, tool: DrawingTool): DrawingShape {
    const strokeWidth = this.selectedThickness() ?? DEFAULT_LINE_STROKE_WIDTH;
    const color = this.selectedColor() ?? DEFAULT_DRAWING_COLOR;
    const id = `shape-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    if (tool === 'line' || tool === 'dashed-line') {
      return {
        id,
        type: tool,
        strokeWidth,
        color,
        points: [
          { x: start.lng, y: start.lat },
          { x: end.lng, y: end.lat },
        ],
      };
    }

    if (tool === 'rectangle') {
      return {
        id,
        type: 'rectangle',
        strokeWidth,
        color,
        x: Math.min(start.lng, end.lng),
        y: Math.min(start.lat, end.lat),
        width: Math.abs(end.lng - start.lng),
        height: Math.abs(end.lat - start.lat),
        rotationDeg: 0,
      };
    }

    if (tool === 'circle') {
      return {
        id,
        type: 'circle',
        strokeWidth,
        color,
        cx: start.lng,
        cy: start.lat,
        radius: Math.max(2, distance({ x: start.lng, y: start.lat }, { x: end.lng, y: end.lat })),
      };
    }

    if (tool === 'oval') {
      return {
        id,
        type: 'oval',
        strokeWidth,
        color,
        x: Math.min(start.lng, end.lng),
        y: Math.min(start.lat, end.lat),
        width: Math.max(2, Math.abs(end.lng - start.lng)),
        height: Math.max(2, Math.abs(end.lat - start.lat)),
        rotationDeg: 0,
      };
    }

    if (tool === 'arrow') {
      return {
        id,
        type: 'arrow',
        strokeWidth,
        color,
        startPoint: { x: start.lng, y: start.lat },
        endPoint: { x: end.lng, y: end.lat },
        direction: this.state.arrowDirection(),
      };
    }

    const topPoint = { x: (start.lng + end.lng) / 2, y: Math.min(start.lat, end.lat) };
    const rightPoint = { x: Math.max(start.lng, end.lng), y: Math.max(start.lat, end.lat) };
    const leftPoint = { x: Math.min(start.lng, end.lng), y: Math.max(start.lat, end.lat) };

    return {
      id,
      type: 'triangle',
      strokeWidth,
      color,
      points: [topPoint, rightPoint, leftPoint],
    };
  }

  private selectShape(shapeId: string): void {
    const pictureId = this.pictureId();
    const shape = this.state.findShape(pictureId, shapeId);
    if (!shape) {
      return;
    }

    this.selectedShapeId = shapeId;
    this.selectedWaypointId = null;
    this.emitSelection();

    this.state.setSelectedColor(shape.color);
    this.state.setSelectedThickness(shape.strokeWidth);
    if (shape.type === 'arrow') {
      const arrowShape = shape as ArrowShape;
      this.state.setArrowDirection(arrowShape.direction);
    }
  }

  private startShapeDrag(shapeId: string, event: L.LeafletMouseEvent): void {
    if (this.drawingTool() !== 'select') {
      return;
    }

    const pictureId = this.pictureId();
    const shape = this.state.findShape(pictureId, shapeId);
    if (!shape) {
      return;
    }

    this.shapeDragState = {
      shapeId,
      startPointerLatLng: event.latlng,
      lastPointerLatLng: event.latlng,
      latestShape: shape,
      moved: false,
      committed: false,
    };
    this.selectedShapeId = shapeId;
    this.selectedWaypointId = null;
    this.emitSelection();
    this.emitStatus(`Dragging ${shapeId}`);
    L.DomEvent.stopPropagation(event);
  }

  private handleMapMouseMove(event: L.LeafletMouseEvent): void {
    this.pendingPointerMoveEvent = event;
    if (this.pointerMoveRafId !== null) {
      return;
    }

    this.pointerMoveRafId = requestAnimationFrame(() => {
      this.pointerMoveRafId = null;
      const latestEvent = this.pendingPointerMoveEvent;
      this.pendingPointerMoveEvent = null;
      if (!latestEvent) {
        return;
      }

      this.applyPointerMove(latestEvent);
    });
  }

  private applyPointerMove(event: L.LeafletMouseEvent): void {
    if (this.drawGestureState) {
      const nextPoints =
        this.drawGestureState.tool === 'line' || this.drawGestureState.tool === 'dashed-line'
          ? this.appendPolylinePoint(this.drawGestureState.points, event.latlng)
          : this.drawGestureState.points;

      this.drawGestureState = {
        ...this.drawGestureState,
        current: event.latlng,
        points: nextPoints,
      };
      this.renderDrawPreview();
      return;
    }

    if (this.transformDragState) {
      return;
    }

    if (!this.shapeDragState) {
      return;
    }

    const deltaX = event.latlng.lng - this.shapeDragState.lastPointerLatLng.lng;
    const deltaY = event.latlng.lat - this.shapeDragState.lastPointerLatLng.lat;
    if (distance({ x: 0, y: 0 }, { x: deltaX, y: deltaY }) < POINTER_DELTA_EPSILON) {
      return;
    }

    const movedShape = moveShape(this.shapeDragState.latestShape, deltaX, deltaY);
    this.shapeDragState = {
      ...this.shapeDragState,
      lastPointerLatLng: event.latlng,
      latestShape: movedShape,
      moved: this.shapeDragState.moved || this.hasMovedEnough(
        { x: this.shapeDragState.startPointerLatLng.lng, y: this.shapeDragState.startPointerLatLng.lat },
        { x: event.latlng.lng, y: event.latlng.lat },
      ),
    };
    this.updateShapeLayerPreview(movedShape);
  }

  private handleMapMouseUp(event?: L.LeafletMouseEvent): void {
    const hasActiveShapeFlow = this.drawGestureState !== null || this.shapeDragState !== null;
    if (!hasActiveShapeFlow) {
      return;
    }

    this.flushPendingPointerMove();

    if (event) {
      this.applyPointerMove(event);
    }

    if (this.drawGestureState) {
      const { tool, start, current, points } = this.drawGestureState;
      this.clearDrawGesture();

      let shape: DrawingShape | null = null;
      if (tool === 'line' || tool === 'dashed-line') {
        const polylinePoints = toPolylinePoints(points, current);
        const pathLength = getPathLength(polylinePoints);
        if (polylinePoints.length >= 2 && pathLength >= 2) {
          shape = this.buildLineShapeFromPath(tool, polylinePoints);
        }
      } else {
        const movedDistance = distance(
          { x: start.lng, y: start.lat },
          { x: current.lng, y: current.lat },
        );
        if (movedDistance >= 2) {
          shape = this.buildShapeFromTwoPoints(start, current, tool);
        }
      }

      if (shape) {
        this.selectedShapeId = shape.id;
        this.selectedWaypointId = null;
        this.emitSelection();
        this.state.addShape(this.pictureId(), shape);
        this.emitStatus(`Created ${shape.type}`);
      }

      this.renderLayers();
      return;
    }

    if (this.shapeDragState && shouldCommitDragUpdate(this.shapeDragState.moved, this.shapeDragState.committed)) {
      this.state.updateShape(this.pictureId(), this.shapeDragState.latestShape);
      this.state.savePictureState(this.pictureId());
      this.emitStatus(`Moved ${this.shapeDragState.shapeId}`);
      this.shapeDragState = {
        ...this.shapeDragState,
        committed: true,
      };
    }

    this.shapeDragState = null;
    this.renderLayers();
  }

  private flushPendingPointerMove(): void {
    if (this.pointerMoveRafId !== null) {
      cancelAnimationFrame(this.pointerMoveRafId);
      this.pointerMoveRafId = null;
    }

    const latestEvent = this.pendingPointerMoveEvent;
    this.pendingPointerMoveEvent = null;

    if (latestEvent) {
      this.applyPointerMove(latestEvent);
    }
  }

  private clearDrawGesture(): void {
    this.drawGestureState = null;
    this.drawPreviewLayer.clearLayers();
  }

  private renderDrawPreview(): void {
    this.drawPreviewLayer.clearLayers();
    if (!this.drawGestureState) {
      return;
    }

    let previewShape: DrawingShape;
    if (this.drawGestureState.tool === 'line' || this.drawGestureState.tool === 'dashed-line') {
      previewShape = this.buildLineShapeFromPath(
        this.drawGestureState.tool,
        toPolylinePoints(this.drawGestureState.points, this.drawGestureState.current),
      );
    } else {
      previewShape = this.buildShapeFromTwoPoints(
        this.drawGestureState.start,
        this.drawGestureState.current,
        this.drawGestureState.tool,
      );
    }

    const previewLayer = createShapeLayer(previewShape, false, {
      selected: false,
    });
    previewLayer.addTo(this.drawPreviewLayer);
  }

  private buildLineShapeFromPath(
    tool: Extract<DrawingTool, 'line' | 'dashed-line'>,
    points: Point[],
  ): DrawingShape {
    const id = `shape-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    return {
      id,
      type: tool,
      strokeWidth: this.selectedThickness() ?? DEFAULT_LINE_STROKE_WIDTH,
      color: this.selectedColor() ?? DEFAULT_DRAWING_COLOR,
      points,
    };
  }

  private appendPolylinePoint(points: L.LatLng[], nextPoint: L.LatLng): L.LatLng[] {
    const last = points[points.length - 1];
    if (!last) {
      return [nextPoint];
    }

    const movedDistance = distance({ x: last.lng, y: last.lat }, { x: nextPoint.lng, y: nextPoint.lat });
    if (movedDistance < POLYLINE_POINT_MIN_DISTANCE) {
      return points;
    }

    return [...points, nextPoint];
  }

  private isWaypointEventTarget(target: EventTarget | null | undefined): boolean {
    if (!(target instanceof Element)) {
      return false;
    }

    return (
      target.closest('.waypoint-pin') !== null ||
      target.closest('.leaflet-marker-icon') !== null ||
      target.closest('.waypoint-tooltip') !== null
    );
  }

  private isTransformerEventTarget(target: EventTarget | null | undefined): boolean {
    if (!(target instanceof Element)) {
      return false;
    }

    return target.closest('.edit-handle') !== null;
  }

  private findWaypointNearContainerPoint(containerPoint: L.Point, pictureId: string): Waypoint | null {
    if (!this.map) {
      return null;
    }

    let nearest: Waypoint | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const waypoint of this.state.getWaypoints(pictureId)) {
      const waypointPoint = this.map.latLngToContainerPoint([waypoint.y, waypoint.x]);
      const dx = waypointPoint.x - containerPoint.x;
      const dy = waypointPoint.y - containerPoint.y;
      const distancePx = Math.sqrt(dx * dx + dy * dy);
      if (distancePx < nearestDistance) {
        nearestDistance = distancePx;
        nearest = waypoint;
      }
    }

    return nearestDistance <= WAYPOINT_HIT_RADIUS_PX ? nearest : null;
  }

  private emitStatus(message: string): void {
    this.emitInAngular(() => this.statusMessageChange.emit(message));
  }

  private emitSelection(): void {
    this.emitInAngular(() => {
      this.selectionChange.emit({
        selectedShapeId: this.selectedShapeId,
        selectedWaypointId: this.selectedWaypointId,
      });
    });
  }

  private emitContextMenuState(): void {
    this.emitInAngular(() => {
      this.contextMenuStateChange.emit({
        visible: this.contextMenuVisible,
        x: this.contextMenuX,
        y: this.contextMenuY,
        waypoint: this.contextWaypoint,
        openedAt: this.contextMenuOpenedAt,
        suppressNextPageClick: this.suppressNextPageClick,
      });
    });
  }

  private emitInAngular(action: () => void): void {
    if (NgZone.isInAngularZone()) {
      action();
      return;
    }

    this.ngZone.run(action);
  }
}

interface TransformDragState {
  shapeId: string;
  mode: 'resize' | 'rotate';
  center: Point;
  startShape: Extract<DrawingShape, { type: 'rectangle' | 'oval' | 'circle' }>;
  latestShape: Extract<DrawingShape, { type: 'rectangle' | 'oval' | 'circle' }>;
  moved: boolean;
  committed: boolean;
  startDistance: number;
  startAngle: number;
}

interface ShapeDragState {
  shapeId: string;
  startPointerLatLng: L.LatLng;
  lastPointerLatLng: L.LatLng;
  latestShape: DrawingShape;
  moved: boolean;
  committed: boolean;
}

interface DrawGestureState {
  tool: Exclude<DrawingTool, 'select'>;
  start: L.LatLng;
  current: L.LatLng;
  points: L.LatLng[];
}

interface VertexDragState {
  shapeId: string;
  pointIndex: number;
  startPoint: Point;
  startShape: Extract<DrawingShape, { type: 'line' | 'dashed-line' | 'triangle' }>;
  latestShape: Extract<DrawingShape, { type: 'line' | 'dashed-line' | 'triangle' }>;
  moved: boolean;
  committed: boolean;
}

interface WaypointDragState {
  waypointId: string;
  startX: number;
  startY: number;
  moved: boolean;
  committed: boolean;
}

interface WaypointMenuSuppressionState {
  waypointId: string;
  until: number;
}

type TransformableShape = Extract<DrawingShape, { type: 'rectangle' | 'oval' | 'circle' }>;
