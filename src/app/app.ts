import { CommonModule } from '@angular/common';
import { AfterViewInit, ChangeDetectorRef, Component, effect, ElementRef, NgZone, OnDestroy, ViewChild } from '@angular/core';
import * as L from 'leaflet';
import {
  buildAnnotationsExportFileName,
  parsePictureAnnotationsJson,
  serializePictureAnnotations,
} from './annotations-json';
import { isEditableTarget, resolveKeyboardShortcutAction } from './keyboard-shortcuts';
import { AppMode, ArrowDirection, ArrowShape, DrawingShape, DrawingTool, EditSubMode, Point, Waypoint } from './poc-types';
import { getShapeCenter, moveShape, PocStateService, rotateShape, scaleShape } from './poc-state.service';

@Component({
  selector: 'app-root',
  imports: [CommonModule],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements AfterViewInit, OnDestroy {
  @ViewChild('mapContainer')
  private readonly mapContainer?: ElementRef<HTMLDivElement>;

  @ViewChild('minimapContainer')
  private readonly minimapContainer?: ElementRef<HTMLDivElement>;

  @ViewChild('importFileInput')
  private readonly importFileInput?: ElementRef<HTMLInputElement>;

  protected selectedShapeId: string | null = null;
  protected selectedWaypointId: string | null = null;
  protected statusMessage = 'Ready';

  protected contextMenuVisible = false;
  protected contextMenuX = 0;
  protected contextMenuY = 0;
  protected contextWaypoint: Waypoint | null = null;
  protected showChecklist = true;
  protected minimapViewportVisible = false;
  protected minimapViewportLeft = 0;
  protected minimapViewportTop = 0;
  protected minimapViewportWidth = 0;
  protected minimapViewportHeight = 0;
  protected minimapViewportRight = 0;
  protected minimapViewportBottom = 0;

  private map?: L.Map;
  private minimap?: L.Map;
  private imageOverlay?: L.ImageOverlay;
  private minimapImageOverlay?: L.ImageOverlay;
  private minimapImageBounds?: L.LatLngBounds;
  private currentImageSize?: { width: number; height: number };
  private drawingLayer = L.layerGroup();
  private waypointLayer = L.layerGroup();
  private editHandleLayer = L.layerGroup();
  private drawPreviewLayer = L.layerGroup();
  private minimapViewportRafId: number | null = null;
  private pointerMoveRafId: number | null = null;
  private pendingPointerMoveEvent: L.LeafletMouseEvent | null = null;

  private shapeDragState: ShapeDragState | null = null;
  private drawGestureState: DrawGestureState | null = null;
  private waypointDragState: WaypointDragState | null = null;
  private touchStartPoint: Point | null = null;
  private transformDragState: TransformDragState | null = null;
  private vertexDragState: VertexDragState | null = null;
  private waypointMenuSuppressionState: WaypointMenuSuppressionState | null = null;
  private suppressNextPageClick = false;
  private contextMenuOpenedAt = 0;

  private imageLoadToken = 0;
  private readonly shapeLayers = new Map<string, L.Layer>();
  private readonly windowKeydownListener = (event: KeyboardEvent) => this.handleKeyboardShortcut(event);
  private readonly windowResizeListener = () => this.updateMinimapViewport();
  private readonly windowMouseUpListener = () => this.handleMapMouseUp();

  constructor(
    protected readonly state: PocStateService,
    private readonly ngZone: NgZone,
    private readonly changeDetectorRef: ChangeDetectorRef,
  ) {
    effect(() => {
      const currentPicture = this.state.currentPicture();
      if (this.map) {
        void this.showPicture(currentPicture.url);
      }
    });

    effect(() => {
      this.state.mode();
      this.state.editSubMode();
      this.state.drawingTool();
      if (this.map) {
        this.applyMapInteractionMode();
        this.renderLayers();
      }
    });
  }

  ngAfterViewInit(): void {
    this.initializeMap();
    void this.showPicture(this.state.currentPicture().url);
    window.addEventListener('mouseup', this.windowMouseUpListener);
  }

  ngOnDestroy(): void {
    window.removeEventListener('keydown', this.windowKeydownListener);
    window.removeEventListener('resize', this.windowResizeListener);
    window.removeEventListener('mouseup', this.windowMouseUpListener);

    if (this.minimapViewportRafId !== null) {
      cancelAnimationFrame(this.minimapViewportRafId);
      this.minimapViewportRafId = null;
    }

    if (this.pointerMoveRafId !== null) {
      cancelAnimationFrame(this.pointerMoveRafId);
      this.pointerMoveRafId = null;
      this.pendingPointerMoveEvent = null;
    }

    this.map?.remove();
    this.minimap?.remove();
  }

  protected setMode(mode: AppMode): void {
    this.hideContextMenu();
    this.state.setMode(mode);
  }

  protected setEditSubMode(subMode: EditSubMode): void {
    this.hideContextMenu();
    this.clearSelection();
    this.clearDrawGesture();
    this.state.setEditSubMode(subMode);
  }

  protected setDrawingTool(tool: DrawingTool): void {
    this.state.setDrawingTool(tool);
    this.selectedWaypointId = null;
    this.clearDrawGesture();
  }

  protected previousPicture(): void {
    this.clearDrawGesture();
    this.clearSelection();
    this.hideContextMenu();
    this.state.previousPicture();
  }

  protected nextPicture(): void {
    this.clearDrawGesture();
    this.clearSelection();
    this.hideContextMenu();
    this.state.nextPicture();
  }

  protected saveCurrentPicture(): void {
    const picture = this.state.currentPicture();
    this.state.savePictureState(picture.id);
    this.statusMessage = `Saved ${picture.name} to localStorage`;
  }

  protected canUndoCurrentPicture(): boolean {
    return this.state.canUndoPictureState(this.state.currentPicture().id);
  }

  protected canRedoCurrentPicture(): boolean {
    return this.state.canRedoPictureState(this.state.currentPicture().id);
  }

  protected undoCurrentPicture(): void {
    const pictureId = this.state.currentPicture().id;
    const undone = this.state.undoPictureState(pictureId);
    if (!undone) {
      this.statusMessage = 'Nothing to undo';
      return;
    }

    this.clearDrawGesture();
    this.shapeDragState = null;
    this.transformDragState = null;
    this.vertexDragState = null;
    this.renderLayers();
    this.statusMessage = 'Undo applied';
  }

  protected redoCurrentPicture(): void {
    const pictureId = this.state.currentPicture().id;
    const redone = this.state.redoPictureState(pictureId);
    if (!redone) {
      this.statusMessage = 'Nothing to redo';
      return;
    }

    this.clearDrawGesture();
    this.shapeDragState = null;
    this.transformDragState = null;
    this.vertexDragState = null;
    this.renderLayers();
    this.statusMessage = 'Redo applied';
  }

  protected resetCurrentPicture(): void {
    const picture = this.state.currentPicture();
    this.clearDrawGesture();
    this.shapeDragState = null;
    this.clearSelection();
    this.transformDragState = null;
    this.state.resetPictureState(picture.id);
    this.renderLayers();
    this.statusMessage = `Reset ${picture.name} to seeded state`;
  }

  protected exportCurrentPictureJson(): void {
    const picture = this.state.currentPicture();
    const content = serializePictureAnnotations(
      picture.id,
      {
        shapes: this.state.getShapes(picture.id),
        waypoints: this.state.getWaypoints(picture.id),
      },
      new Date(),
    );

    const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
    const objectUrl = URL.createObjectURL(blob);

    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = buildAnnotationsExportFileName(picture.id, new Date());
    anchor.click();

    URL.revokeObjectURL(objectUrl);
    this.statusMessage = `Exported annotations for ${picture.name}`;
  }

  protected openImportJsonPicker(): void {
    if (!this.importFileInput) {
      return;
    }

    this.importFileInput.nativeElement.value = '';
    this.importFileInput.nativeElement.click();
  }

  protected async onImportJsonSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    const picture = this.state.currentPicture();
    let rawContent = '';

    try {
      rawContent = await file.text();
    } catch {
      this.statusMessage = 'Could not read the selected file.';
      return;
    }

    const parsed = parsePictureAnnotationsJson(rawContent, picture.id, this.currentImageSize);
    if (!parsed.ok) {
      this.statusMessage = parsed.error;
      return;
    }

    this.clearSelection();
    this.clearDrawGesture();
    this.transformDragState = null;
    this.vertexDragState = null;
    this.state.replacePictureState(picture.id, {
      shapes: parsed.payload.shapes,
      waypoints: parsed.payload.waypoints,
    });
    this.state.savePictureState(picture.id);
    this.renderLayers();

    const skippedText = parsed.skippedObjects > 0 ? ` (${parsed.skippedObjects} objects skipped)` : '';
    this.statusMessage = `Imported ${parsed.payload.shapes.length} shapes and ${parsed.payload.waypoints.length} waypoints${skippedText}`;
  }

  protected toggleChecklist(): void {
    this.showChecklist = !this.showChecklist;
  }

  protected updateSelectedShapeProperty(property: 'color' | 'thickness', value: string | number): void {
    if (!this.selectedShapeId) {
      return;
    }

    const pictureId = this.state.currentPicture().id;
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

  protected onThicknessChanged(event: Event): void {
    const input = event.target as HTMLInputElement;
    const thickness = parseFloat(input.value);
    this.state.setSelectedThickness(thickness);
    this.updateSelectedShapeProperty('thickness', thickness);
  }

  protected onTouchStart(event: TouchEvent): void {
    if (event.changedTouches.length === 0) {
      return;
    }

    const touch = event.changedTouches[0];
    this.touchStartPoint = {
      x: touch.clientX,
      y: touch.clientY,
    };
  }

  protected onTouchEnd(event: TouchEvent): void {
    if (this.state.mode() !== 'readonly' || !this.touchStartPoint || event.changedTouches.length === 0) {
      return;
    }

    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - this.touchStartPoint.x;
    const deltaY = touch.clientY - this.touchStartPoint.y;
    this.touchStartPoint = null;

    const swipeThreshold = 60;
    if (Math.abs(deltaX) > swipeThreshold && Math.abs(deltaX) > Math.abs(deltaY)) {
      if (deltaX < 0) {
        this.nextPicture();
      } else {
        this.previousPicture();
      }
    }
  }

  protected onViewWaypointDetail(): void {
    if (!this.contextWaypoint) {
      return;
    }

    this.statusMessage = `Waypoint ${this.contextWaypoint.id}: ${this.contextWaypoint.name} (${this.contextWaypoint.waypointTypeDescription})`;
    this.hideContextMenu();
  }

  protected onOpenWaypointInNewTab(): void {
    if (!this.contextWaypoint) {
      return;
    }

    window.open(`/waypoint/${this.contextWaypoint.id}?mode=poc`, '_blank', 'noopener');
    this.hideContextMenu();
  }

  protected onRemoveWaypoint(): void {
    if (!this.contextWaypoint) {
      return;
    }

    this.state.removeWaypoint(this.state.currentPicture().id, this.contextWaypoint.id);
    if (this.selectedWaypointId === this.contextWaypoint.id) {
      this.selectedWaypointId = null;
    }
    this.statusMessage = `Removed ${this.contextWaypoint.name}`;
    this.hideContextMenu();
    this.renderWaypointLayer();
  }

  protected hideContextMenu(): void {
    this.contextMenuVisible = false;
    this.contextWaypoint = null;
    this.setMapContainerData('contextMenuWaypointId', '');
    this.setMapContainerData('contextMenuX', '');
    this.setMapContainerData('contextMenuY', '');
    this.syncAngularView();
  }

  protected onPageClick(event: MouseEvent): void {
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
    this.map.on('move', () => this.updateMinimapViewport());
    this.map.on('moveend', () => this.updateMinimapViewport());
    this.map.on('zoom', () => this.updateMinimapViewport());
    this.map.on('zoomend', () => this.updateMinimapViewport());
    this.map.on('resize', () => this.updateMinimapViewport());

    this.initializeMinimap();
    window.addEventListener('keydown', this.windowKeydownListener);
    window.addEventListener('resize', this.windowResizeListener);

    this.applyMapInteractionMode();
  }

  private initializeMinimap(): void {
    if (!this.minimapContainer) {
      return;
    }

    this.minimap = L.map(this.minimapContainer.nativeElement, {
      crs: L.CRS.Simple,
      attributionControl: false,
      zoomControl: false,
      minZoom: -8,
      maxZoom: 2,
      zoomSnap: 0.25,
      zoomDelta: 0.25,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      touchZoom: false,
      inertia: false,
    });
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

    this.syncMinimapPicture(url, bounds);

    this.clearDrawGesture();
    this.clearSelection();
    this.transformDragState = null;
    this.shapeDragState = null;
    this.statusMessage = `Viewing ${this.state.currentPicture().name}`;
    this.renderLayers();
  }

  private syncMinimapPicture(url: string, bounds: L.LatLngBounds): void {
    const minimap = this.minimap;
    if (!minimap) {
      return;
    }

    if (this.minimapImageOverlay) {
      this.minimapImageOverlay.remove();
    }

    this.minimapImageBounds = bounds;
    this.minimapImageOverlay = L.imageOverlay(url, bounds).addTo(minimap);
    minimap.fitBounds(bounds, { animate: false, padding: [0, 0] });
    minimap.setMaxBounds(bounds.pad(0.05));
    minimap.invalidateSize(true);
    this.updateMinimapViewport();
  }

  private scheduleMinimapViewportUpdate(): void {
    if (this.minimapViewportRafId !== null) {
      return;
    }

    this.minimapViewportRafId = requestAnimationFrame(() => {
      this.minimapViewportRafId = null;
      this.updateMinimapViewport();
    });
  }

  private updateMinimapViewport(): void {
    if (!this.map || !this.minimap || !this.minimapImageBounds) {
      this.minimapViewportVisible = false;
      this.setMapContainerData('minimapViewportVisible', 'false');
      this.syncAngularView();
      return;
    }

    const minimapSize = this.minimap.getSize();
    if (minimapSize.x <= 0 || minimapSize.y <= 0) {
      this.minimap.invalidateSize(false);
      this.scheduleMinimapViewportUpdate();
      this.minimapViewportVisible = false;
      this.setMapContainerData('minimapViewportVisible', 'false');
      this.syncAngularView();
      return;
    }

    const clampedBounds = intersectBounds(this.map.getBounds(), this.minimapImageBounds);
    if (!clampedBounds) {
      this.minimapViewportVisible = false;
      this.setMapContainerData('minimapViewportVisible', 'false');
      this.syncAngularView();
      return;
    }

    const imageWest = Math.min(this.minimapImageBounds.getWest(), this.minimapImageBounds.getEast());
    const imageEast = Math.max(this.minimapImageBounds.getWest(), this.minimapImageBounds.getEast());
    const imageNorth = Math.min(this.minimapImageBounds.getNorth(), this.minimapImageBounds.getSouth());
    const imageSouth = Math.max(this.minimapImageBounds.getNorth(), this.minimapImageBounds.getSouth());
    const imageWidth = imageEast - imageWest;
    const imageHeight = imageSouth - imageNorth;
    if (imageWidth <= 0 || imageHeight <= 0) {
      this.minimapViewportVisible = false;
      this.setMapContainerData('minimapViewportVisible', 'false');
      this.syncAngularView();
      return;
    }

    const viewWest = Math.min(clampedBounds.getWest(), clampedBounds.getEast());
    const viewEast = Math.max(clampedBounds.getWest(), clampedBounds.getEast());
    const viewNorth = Math.min(clampedBounds.getNorth(), clampedBounds.getSouth());
    const viewSouth = Math.max(clampedBounds.getNorth(), clampedBounds.getSouth());

    // In Leaflet CRS.Simple, high lat = visual top of image. Map lat to minimap DOM y by inverting:
    // DOM y=0 (top) corresponds to imageSouth (max lat), DOM y=height (bottom) to imageNorth (min lat).
    const viewportNorthWest = {
      x: ((viewWest - imageWest) / imageWidth) * minimapSize.x,
      y: ((imageSouth - viewSouth) / imageHeight) * minimapSize.y,
    };
    const viewportSouthEast = {
      x: ((viewEast - imageWest) / imageWidth) * minimapSize.x,
      y: ((imageSouth - viewNorth) / imageHeight) * minimapSize.y,
    };

    const rect = computeMinimapViewportRect(
      {
        width: minimapSize.x,
        height: minimapSize.y,
      },
      {
        northWest: { x: 0, y: 0 },
        southEast: { x: minimapSize.x, y: minimapSize.y },
      },
      {
        northWest: viewportNorthWest,
        southEast: viewportSouthEast,
      },
    );

    if (!rect) {
      this.minimapViewportVisible = false;
      this.setMapContainerData('minimapViewportVisible', 'false');
      this.syncAngularView();
      return;
    }

    this.minimapViewportVisible = true;
    this.minimapViewportLeft = rect.left;
    this.minimapViewportTop = rect.top;
    this.minimapViewportWidth = rect.width;
    this.minimapViewportHeight = rect.height;
    this.minimapViewportRight = rect.right;
    this.minimapViewportBottom = rect.bottom;
    this.setMapContainerData('minimapViewportVisible', 'true');
    this.setMapContainerData('minimapViewportLeft', rect.left.toFixed(2));
    this.setMapContainerData('minimapViewportTop', rect.top.toFixed(2));
    this.setMapContainerData('minimapViewportWidth', rect.width.toFixed(2));
    this.setMapContainerData('minimapViewportHeight', rect.height.toFixed(2));
    this.syncAngularView();
  }

  private applyMapInteractionMode(): void {
    if (!this.map) {
      return;
    }

    const drawingEditMode = this.state.mode() === 'edit' && this.state.editSubMode() === 'drawing-edit';

    if (drawingEditMode) {
      this.map.dragging.disable();
    } else {
      this.map.dragging.enable();
    }

    this.map.scrollWheelZoom.enable();
    this.map.doubleClickZoom.enable();

    if (this.mapContainer) {
      this.mapContainer.nativeElement.style.cursor =
        drawingEditMode && this.state.drawingTool() !== 'select' ? 'crosshair' : 'grab';
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

    const pictureId = this.state.currentPicture().id;
    const shapes = this.state.getShapes(pictureId);
    const drawingEditMode = this.state.mode() === 'edit' && this.state.editSubMode() === 'drawing-edit';

    for (const shape of shapes) {
      const path = this.createShapeLayer(shape, drawingEditMode);
      this.shapeLayers.set(shape.id, path);
      path.addTo(this.drawingLayer);
    }
  }

  private renderWaypointLayer(): void {
    this.waypointLayer.clearLayers();

    const showWaypoints =
      this.state.mode() === 'readonly' ||
      (this.state.mode() === 'edit' && this.state.editSubMode() === 'waypoint-edit');

    if (!showWaypoints) {
      return;
    }

    const pictureId = this.state.currentPicture().id;
    const waypointEditMode = this.state.mode() === 'edit' && this.state.editSubMode() === 'waypoint-edit';
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
            this.statusMessage = `Moved waypoint ${waypoint.id}`;
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

  private getArrowHeadPointsWithKonvaSemantics(arrowShape: ArrowShape): [number, number][] {
    const dx = arrowShape.endPoint.x - arrowShape.startPoint.x;
    const dy = arrowShape.endPoint.y - arrowShape.startPoint.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist === 0) {
      return [];
    }

    const unitX = dx / dist;
    const unitY = dy / dist;
    const pointerLength = Math.max(4, arrowShape.pointerLength ?? arrowShape.strokeWidth * 4);
    const pointerWidth = Math.max(4, arrowShape.pointerWidth ?? arrowShape.strokeWidth * 4);
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

  private createShapeLayer(shape: DrawingShape, interactive: boolean): L.Layer {
    const selected = this.selectedShapeId === shape.id;
    const commonStyle = {
      color: selected ? '#0ea5e9' : shape.color,
      weight: selected ? shape.strokeWidth + 1 : shape.strokeWidth,
      interactive,
      lineCap: shape.strokeLineCap ?? 'round',
      lineJoin: shape.strokeLineJoin ?? 'round',
      smoothFactor: 0,
      noClip: true,
    };

    let layer: L.Layer;
    
    if (shape.type === 'arrow') {
      const arrowShape = shape as ArrowShape;
      
      // Create shaft (line from start to end)
      const shaft = L.polyline(
        [
          [arrowShape.startPoint.y, arrowShape.startPoint.x],
          [arrowShape.endPoint.y, arrowShape.endPoint.x],
        ],
        commonStyle,
      );

      // Create arrowhead (triangle at the end)
      const arrowheadPoints = this.getArrowHeadPointsWithKonvaSemantics(arrowShape);
      const arrowhead = L.polygon(arrowheadPoints, {
        ...commonStyle,
        fill: true,
        fillColor: commonStyle.color,
        fillOpacity: 1,
      });

      // Group them together
      const group = L.layerGroup([shaft, arrowhead]);

      if (interactive) {
        shaft.on('mousedown', (event: L.LeafletMouseEvent) => this.startShapeDrag(shape.id, event));
        shaft.on('click', (event: L.LeafletMouseEvent) => {
          this.selectShape(shape.id);
          this.statusMessage = `Selected shape ${shape.id}`;
          this.renderLayers();
          L.DomEvent.stopPropagation(event);
        });
        arrowhead.on('mousedown', (event: L.LeafletMouseEvent) => this.startShapeDrag(shape.id, event));
        arrowhead.on('click', (event: L.LeafletMouseEvent) => {
          this.selectShape(shape.id);
          this.statusMessage = `Selected shape ${shape.id}`;
          this.renderLayers();
          L.DomEvent.stopPropagation(event);
        });
      }

      return group;
    }
    
    let pathLayer: L.Path;
    if (shape.type === 'line' || shape.type === 'dashed-line') {
      pathLayer = L.polyline(
        shape.points.map((point) => [point.y, point.x] as [number, number]),
        {
          ...commonStyle,
          dashArray: shape.type === 'dashed-line'
            ? (shape.dashPattern && shape.dashPattern.length > 0 ? shape.dashPattern.join(' ') : '8 8')
            : undefined,
        },
      );
    } else if (shape.type === 'rectangle') {
      const corners = getRectangleCorners(shape).map((point) => [point.y, point.x] as [number, number]);
      pathLayer = L.polygon(corners, {
        ...commonStyle,
        fill: true,
        fillColor: commonStyle.color,
        fillOpacity: 0.01,
      });
    } else if (shape.type === 'circle') {
      pathLayer = L.circle([shape.cy, shape.cx], {
        ...commonStyle,
        radius: shape.radius,
        fill: true,
        fillColor: commonStyle.color,
        fillOpacity: 0.01,
      });
    } else if (shape.type === 'oval') {
      pathLayer = L.polygon(
        getOvalOutlinePoints(shape).map((point) => [point.y, point.x] as [number, number]),
        {
          ...commonStyle,
          fill: true,
          fillColor: commonStyle.color,
          fillOpacity: 0.01,
        },
      );
    } else {
      pathLayer = L.polygon(
        shape.points.map((point) => [point.y, point.x] as [number, number]),
        {
          ...commonStyle,
          fill: true,
          fillColor: commonStyle.color,
          fillOpacity: 0.01,
        },
      );
    }

    layer = pathLayer;
    
    if (interactive) {
      layer.on('mousedown', (event: L.LeafletMouseEvent) => this.startShapeDrag(shape.id, event));
      layer.on('click', (event: L.LeafletMouseEvent) => {
        this.selectShape(shape.id);
        this.statusMessage = `Selected shape ${shape.id}`;
        this.renderLayers();
        L.DomEvent.stopPropagation(event);
      });
    }

    return layer;
  }

  private renderEditHandles(): void {
    this.editHandleLayer.clearLayers();

    const drawingSelectMode =
      this.state.mode() === 'edit' &&
      this.state.editSubMode() === 'drawing-edit' &&
      this.state.drawingTool() === 'select';

    if (!drawingSelectMode || !this.selectedShapeId) {
      return;
    }

    const pictureId = this.state.currentPicture().id;
    const shape = this.state.findShape(pictureId, this.selectedShapeId);
    if (!shape) {
      return;
    }

    if (shape.type === 'line' || shape.type === 'dashed-line' || shape.type === 'triangle') {
      this.renderVertexHandles(shape);
      return;
    }

    // Arrows don't have transform handles
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
      const pictureId = this.state.currentPicture().id;
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
        this.state.updateShape(this.state.currentPicture().id, finalizedState.latestShape);
        this.state.savePictureState(this.state.currentPicture().id);
        this.transformDragState = {
          ...finalizedState,
          committed: true,
        };
      }

      this.transformDragState = null;
      this.renderLayers();
      this.statusMessage = `${mode === 'resize' ? 'Resized' : 'Rotated'} ${shape.id}`;
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
        const pictureId = this.state.currentPicture().id;
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
          this.state.updateShape(this.state.currentPicture().id, finalizedShape);
          this.state.savePictureState(this.state.currentPicture().id);
          this.vertexDragState = {
            ...dragState,
            latestShape: finalizedShape,
            moved,
            committed: true,
          };
        }

        this.vertexDragState = null;
        this.renderLayers();
        this.statusMessage = `Updated vertex of ${shape.id}`;
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
    this.statusMessage = `Opened menu for ${waypoint.name}`;
    this.syncAngularView();
  }

  private setMapContainerData(name: string, value: string): void {
    const container = this.mapContainer?.nativeElement;
    if (!container) {
      return;
    }

    container.dataset[name] = value;
  }

  private syncAngularView(): void {
    if (NgZone.isInAngularZone()) {
      this.changeDetectorRef.detectChanges();
      return;
    }

    this.ngZone.run(() => {
      this.changeDetectorRef.detectChanges();
    });
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
    if (!(this.state.mode() === 'edit' && this.state.editSubMode() === 'drawing-edit')) {
      return;
    }

    if (this.isTransformerEventTarget(event.originalEvent?.target)) {
      return;
    }

    const tool = this.state.drawingTool();
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
      if (this.state.mode() === 'readonly' || (this.state.mode() === 'edit' && this.state.editSubMode() === 'waypoint-edit')) {
        const waypoint = this.findWaypointNearContainerPoint(event.containerPoint, this.state.currentPicture().id);
        if (waypoint) {
          this.openWaypointContextMenu(event, waypoint);
        }
      }
      return;
    }

    if (Date.now() - this.contextMenuOpenedAt < 200) {
      return;
    }

    if (this.state.mode() === 'readonly' || (this.state.mode() === 'edit' && this.state.editSubMode() === 'waypoint-edit')) {
      const waypoint = this.findWaypointNearContainerPoint(event.containerPoint, this.state.currentPicture().id);
      if (waypoint) {
        this.openWaypointContextMenu(event, waypoint);
        return;
      }
    }

    this.hideContextMenu();

    if (this.state.mode() === 'edit' && this.state.editSubMode() === 'waypoint-edit') {
      this.selectedShapeId = null;
      this.selectedWaypointId = null;
      this.state.addWaypoint(this.state.currentPicture().id, event.latlng.lng, event.latlng.lat);
      this.statusMessage = 'Waypoint added';
      this.renderWaypointLayer();
      return;
    }

    if (!(this.state.mode() === 'edit' && this.state.editSubMode() === 'drawing-edit')) {
      return;
    }

    const tool = this.state.drawingTool();
    if (tool === 'select') {
      this.clearSelection();
      this.renderLayers();
      return;
    }
  }

  private handleMapContextMenu(event: L.LeafletMouseEvent): void {
    if (this.isTransformerEventTarget(event.originalEvent?.target)) {
      this.consumeLeafletMouseEvent(event);
      return;
    }

    if (this.state.mode() === 'readonly' || (this.state.mode() === 'edit' && this.state.editSubMode() === 'waypoint-edit')) {
      const waypoint = this.findWaypointNearContainerPoint(event.containerPoint, this.state.currentPicture().id);
      if (waypoint && !this.shouldSuppressWaypointMenu(waypoint.id)) {
        if (this.state.mode() === 'edit' && this.state.editSubMode() === 'waypoint-edit') {
          this.selectedWaypointId = waypoint.id;
          this.selectedShapeId = null;
        }

        this.openWaypointContextMenu(event, waypoint);
        this.consumeLeafletMouseEvent(event);
        return;
      }
    }

    this.hideContextMenu();
  }

  private buildShapeFromTwoPoints(start: L.LatLng, end: L.LatLng, tool: DrawingTool): DrawingShape {
    const strokeWidth = this.state.selectedThickness();
    const color = this.state.selectedColor();
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
    const pictureId = this.state.currentPicture().id;
    const shape = this.state.findShape(pictureId, shapeId);
    if (!shape) {
      return;
    }

    this.selectedShapeId = shapeId;
    // Update UI controls with the selected shape's properties
    this.state.setSelectedColor(shape.color);
    this.state.setSelectedThickness(shape.strokeWidth);
    if (shape.type === 'arrow') {
      const arrowShape = shape as ArrowShape;
      this.state.setArrowDirection(arrowShape.direction);
    }
  }

  private startShapeDrag(shapeId: string, event: L.LeafletMouseEvent): void {
    if (this.state.drawingTool() !== 'select') {
      return;
    }

    const pictureId = this.state.currentPicture().id;
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
    this.statusMessage = `Dragging ${shapeId}`;
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
        this.state.addShape(this.state.currentPicture().id, shape);
        this.statusMessage = `Created ${shape.type}`;
      }

      this.renderLayers();
      return;
    }

    if (this.shapeDragState && shouldCommitDragUpdate(this.shapeDragState.moved, this.shapeDragState.committed)) {
      this.state.updateShape(this.state.currentPicture().id, this.shapeDragState.latestShape);
      this.state.savePictureState(this.state.currentPicture().id);
      this.statusMessage = `Moved ${this.shapeDragState.shapeId}`;
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

  private clearSelection(): void {
    this.selectedShapeId = null;
    this.selectedWaypointId = null;
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

    const previewLayer = this.createShapeLayer(previewShape, false);
    previewLayer.addTo(this.drawPreviewLayer);
  }

  private resetToSelectMode(): void {
    this.hideContextMenu();
    this.clearDrawGesture();
    this.shapeDragState = null;
    this.transformDragState = null;
    this.vertexDragState = null;
    this.clearSelection();
    this.state.setDrawingTool('select');
    this.renderLayers();
  }

  private handleKeyboardShortcut(event: KeyboardEvent): void {
    const action = resolveKeyboardShortcutAction({
      key: event.key,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      mode: this.state.mode(),
      editSubMode: this.state.editSubMode(),
      drawingTool: this.state.drawingTool(),
      hasSelectedShape: this.selectedShapeId !== null,
      hasSelectedWaypoint: this.selectedWaypointId !== null,
      focusInEditable: isEditableTarget(event.target),
    });

    if (action.type === 'none') {
      return;
    }

    event.preventDefault();

    const pictureId = this.state.currentPicture().id;

    if (action.type === 'undo') {
      this.undoCurrentPicture();
      return;
    }

    if (action.type === 'redo') {
      this.redoCurrentPicture();
      return;
    }

    if (action.type === 'reset-to-select') {
      this.resetToSelectMode();
      this.statusMessage = 'Selection cleared. Tool switched to Select.';
      return;
    }

    if (action.type === 'delete-selected-shape' && this.selectedShapeId) {
      this.state.removeShape(pictureId, this.selectedShapeId);
      this.selectedShapeId = null;
      this.transformDragState = null;
      this.shapeDragState = null;
      this.renderLayers();
      this.statusMessage = 'Shape deleted';
      return;
    }

    if (action.type === 'delete-selected-waypoint' && this.selectedWaypointId) {
      this.state.removeWaypoint(pictureId, this.selectedWaypointId);
      this.selectedWaypointId = null;
      this.renderWaypointLayer();
      this.statusMessage = 'Waypoint deleted';
      return;
    }

    if (action.type === 'nudge-selected-shape' && this.selectedShapeId) {
      const shape = this.state.findShape(pictureId, this.selectedShapeId);
      if (!shape) {
        return;
      }

      this.state.updateShape(pictureId, moveShape(shape, action.dx, action.dy));
      this.renderLayers();
      this.statusMessage = `Shape nudged (${action.dx}, ${action.dy})`;
      return;
    }

    if (action.type === 'nudge-selected-waypoint' && this.selectedWaypointId) {
      const waypoint = this.state.getWaypoints(pictureId).find((item) => item.id === this.selectedWaypointId);
      if (!waypoint) {
        return;
      }

      this.state.updateWaypointPosition(
        pictureId,
        waypoint.id,
        waypoint.x + action.dx,
        waypoint.y + action.dy,
      );
      this.renderWaypointLayer();
      this.statusMessage = `Waypoint nudged (${action.dx}, ${action.dy})`;
    }
  }

  private buildLineShapeFromPath(
    tool: Extract<DrawingTool, 'line' | 'dashed-line'>,
    points: Point[],
  ): DrawingShape {
    const id = `shape-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    return {
      id,
      type: tool,
      strokeWidth: 3,
      color: '#111111',
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

    return nearestDistance <= 18 ? nearest : null;
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

const DRAG_THRESHOLD = 2;
const WAYPOINT_MENU_SUPPRESSION_MS = 250;
const POINTER_DELTA_EPSILON = 0.2;
const POLYLINE_POINT_MIN_DISTANCE = 1;

async function loadImageSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      reject(new Error(`Could not load image: ${src}`));
    };
    image.src = src;
  });
}

function getRectangleCorners(shape: Extract<DrawingShape, { type: 'rectangle' }>): Point[] {
  const center = getShapeCenter(shape);
  const halfWidth = shape.width / 2;
  const halfHeight = shape.height / 2;
  const baseCorners: Point[] = [
    { x: center.x - halfWidth, y: center.y - halfHeight },
    { x: center.x + halfWidth, y: center.y - halfHeight },
    { x: center.x + halfWidth, y: center.y + halfHeight },
    { x: center.x - halfWidth, y: center.y + halfHeight },
  ];

  const rotation = shape.rotationDeg ?? 0;
  if (rotation === 0) {
    return baseCorners;
  }

  return baseCorners.map((corner) => rotatePoint(corner, center, rotation));
}

function getRotateHandlePoint(shape: DrawingShape, center: Point): Point {
  if (shape.type === 'rectangle' || shape.type === 'oval') {
    const offset = Math.max(shape.width, shape.height) / 2 + 48;
    const localPoint = { x: center.x, y: center.y - offset };
    return rotatePoint(localPoint, center, shape.rotationDeg ?? 0);
  }

  if (shape.type === 'circle') {
    return {
      x: center.x,
      y: center.y - shape.radius - 48,
    };
  }

  if (shape.type === 'arrow' || shape.type === 'line' || shape.type === 'dashed-line') {
    const pointShape = shape as any;
    const maxDistance = Math.max(...pointShape.points.map((point: Point) => distance(center, point)));
    return {
      x: center.x,
      y: center.y - maxDistance - 48,
    };
  }

  const maxDistance = Math.max(...(shape as any).points.map((point: Point) => distance(center, point)));
  return {
    x: center.x,
    y: center.y - maxDistance - 48,
  };
}

function rotatePoint(point: Point, center: Point, degrees: number): Point {
  const radians = (degrees * Math.PI) / 180;
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * Math.cos(radians) - dy * Math.sin(radians),
    y: center.y + dx * Math.sin(radians) + dy * Math.cos(radians),
  };
}

function distance(a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function angleDeg(center: Point, point: Point): number {
  return (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI;
}

function updateShapePoint(
  shape: Extract<DrawingShape, { type: 'line' | 'dashed-line' | 'triangle' }>,
  pointIndex: number,
  nextPoint: Point,
): Extract<DrawingShape, { type: 'line' | 'dashed-line' | 'triangle' }> {
  if (pointIndex < 0 || pointIndex >= shape.points.length) {
    return shape;
  }

  const nextPoints = [...shape.points];
  nextPoints[pointIndex] = { ...nextPoint };

  if (shape.type === 'triangle') {
    return {
      ...shape,
      points: [nextPoints[0], nextPoints[1], nextPoints[2]],
    };
  }

  return {
    ...shape,
    points: nextPoints,
  };
}

function getResizeHandlePoint(shape: Extract<DrawingShape, { type: 'rectangle' | 'oval' | 'circle' }>): Point {
  if (shape.type === 'rectangle') {
    return getRectangleCorners(shape)[2];
  }

  if (shape.type === 'oval') {
    const center = getShapeCenter(shape);
    const localPoint = { x: center.x + shape.width / 2, y: center.y + shape.height / 2 };
    return rotatePoint(localPoint, center, shape.rotationDeg ?? 0);
  }

  return {
    x: shape.cx + shape.radius,
    y: shape.cy,
  };
}

function getOvalOutlinePoints(shape: Extract<DrawingShape, { type: 'oval' }>, segments = 96): Point[] {
  const center = getShapeCenter(shape);
  const rx = shape.width / 2;
  const ry = shape.height / 2;
  const rotation = shape.rotationDeg ?? 0;
  const points: Point[] = [];

  for (let index = 0; index < segments; index += 1) {
    const theta = (index / segments) * Math.PI * 2;
    const localPoint = {
      x: center.x + rx * Math.cos(theta),
      y: center.y + ry * Math.sin(theta),
    };
    points.push(rotation === 0 ? localPoint : rotatePoint(localPoint, center, rotation));
  }

  return points;
}

function toPolylinePoints(points: L.LatLng[], fallbackCurrent: L.LatLng): Point[] {
  const source = points.length > 0 ? points : [fallbackCurrent];
  const mapped: Point[] = [];

  for (const latLng of source) {
    const next = { x: latLng.lng, y: latLng.lat };
    const last = mapped[mapped.length - 1];
    if (!last || last.x !== next.x || last.y !== next.y) {
      mapped.push(next);
    }
  }

  if (mapped.length === 1) {
    mapped.push({ ...mapped[0] });
  }

  return mapped;
}

function getPathLength(points: Point[]): number {
  if (points.length < 2) {
    return 0;
  }

  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += distance(points[index - 1], points[index]);
  }
  return total;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function shouldCommitDragUpdate(moved: boolean, committed: boolean): boolean {
  return moved && !committed;
}

interface MinimapPoint {
  x: number;
  y: number;
}

interface MinimapProjection {
  northWest: MinimapPoint;
  southEast: MinimapPoint;
}

interface MinimapSize {
  width: number;
  height: number;
}

interface MinimapViewportRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export function computeMinimapViewportRect(
  minimapSize: MinimapSize,
  imageProjection: MinimapProjection,
  viewportProjection: MinimapProjection,
): MinimapViewportRect | null {
  const imageLeft = clamp(Math.min(imageProjection.northWest.x, imageProjection.southEast.x), 0, minimapSize.width);
  const imageTop = clamp(Math.min(imageProjection.northWest.y, imageProjection.southEast.y), 0, minimapSize.height);
  const imageRight = clamp(Math.max(imageProjection.northWest.x, imageProjection.southEast.x), 0, minimapSize.width);
  const imageBottom = clamp(Math.max(imageProjection.northWest.y, imageProjection.southEast.y), 0, minimapSize.height);

  if (imageRight <= imageLeft || imageBottom <= imageTop) {
    return null;
  }

  const viewportLeft = clamp(
    Math.min(viewportProjection.northWest.x, viewportProjection.southEast.x),
    imageLeft,
    imageRight,
  );
  const viewportTop = clamp(
    Math.min(viewportProjection.northWest.y, viewportProjection.southEast.y),
    imageTop,
    imageBottom,
  );
  const viewportRight = clamp(
    Math.max(viewportProjection.northWest.x, viewportProjection.southEast.x),
    imageLeft,
    imageRight,
  );
  const viewportBottom = clamp(
    Math.max(viewportProjection.northWest.y, viewportProjection.southEast.y),
    imageTop,
    imageBottom,
  );

  const width = Math.max(0, viewportRight - viewportLeft);
  const height = Math.max(0, viewportBottom - viewportTop);
  if (width <= 0 || height <= 0) {
    return null;
  }

  return {
    left: viewportLeft,
    top: viewportTop,
    right: viewportRight,
    bottom: viewportBottom,
    width,
    height,
  };
}

function intersectBounds(a: L.LatLngBounds, b: L.LatLngBounds): L.LatLngBounds | null {
  const west = Math.max(a.getWest(), b.getWest());
  const east = Math.min(a.getEast(), b.getEast());
  const south = Math.max(a.getSouth(), b.getSouth());
  const north = Math.min(a.getNorth(), b.getNorth());

  if (west >= east || south >= north) {
    return null;
  }

  return L.latLngBounds(L.latLng(south, west), L.latLng(north, east));
}

