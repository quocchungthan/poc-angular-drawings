import { CommonModule } from '@angular/common';
import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, ViewChild, signal } from '@angular/core';
import {
  buildAnnotationsExportFileName,
  parsePictureAnnotationsJson,
  serializePictureAnnotations,
} from './annotations-json';
import { SWIPE_THRESHOLD } from './app.constants';
import { isEditableTarget, resolveKeyboardShortcutAction } from './keyboard-shortcuts';
import { AppMode, DrawingTool, EditSubMode, Waypoint } from './poc-types';
import { moveShape, PocStateService } from './poc-state.service';
import { MapCanvasComponent } from './components/map-canvas.component';
import { MinimapComponent } from './components/minimap.component';
import {
  BoundsSnapshot,
  CanvasContextMenuState,
  CanvasPictureLoadedEvent,
  CanvasSelectionState,
  MinimapViewportState,
} from './components/map-canvas.types';

@Component({
  selector: 'app-root',
  imports: [CommonModule, MapCanvasComponent, MinimapComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App implements AfterViewInit, OnDestroy {
  @ViewChild('importFileInput')
  private readonly importFileInput?: ElementRef<HTMLInputElement>;

  @ViewChild(MapCanvasComponent)
  private readonly mapCanvas?: MapCanvasComponent;

  @ViewChild(MinimapComponent)
  private readonly minimap?: MinimapComponent;

  protected selectedShapeId: string | null = null;
  protected selectedWaypointId: string | null = null;
  protected statusMessage = 'Ready';

  protected contextMenuVisible = false;
  protected contextMenuX = 0;
  protected contextMenuY = 0;
  protected contextWaypoint: Waypoint | null = null;
  protected showChecklist = true;

  protected readonly minimapPictureUrl = signal<string | null>(null);
  protected readonly minimapPictureBounds = signal<BoundsSnapshot | null>(null);
  protected readonly minimapMainViewBounds = signal<BoundsSnapshot | null>(null);

  private touchStartPoint: { x: number; y: number } | null = null;
  private contextMenuOpenedAt = 0;
  private suppressNextPageClick = false;
  private readonly windowKeydownListener = (event: KeyboardEvent) => this.handleKeyboardShortcut(event);

  constructor(protected readonly state: PocStateService) {}

  ngAfterViewInit(): void {
    window.addEventListener('keydown', this.windowKeydownListener);
  }

  ngOnDestroy(): void {
    window.removeEventListener('keydown', this.windowKeydownListener);
  }

  protected setMode(mode: AppMode): void {
    this.hideContextMenu();
    this.state.setMode(mode);
    this.mapCanvas?.syncInputs();
  }

  protected setEditSubMode(subMode: EditSubMode): void {
    this.hideContextMenu();
    this.clearSelection();
    this.mapCanvas?.resetInteractionState();
    this.state.setEditSubMode(subMode);
    this.mapCanvas?.syncInputs();
  }

  protected setDrawingTool(tool: DrawingTool): void {
    this.state.setDrawingTool(tool);
    this.selectedWaypointId = null;
    this.mapCanvas?.syncInputs();
  }

  protected previousPicture(): void {
    this.mapCanvas?.resetInteractionState();
    this.hideContextMenu();
    this.state.previousPicture();
    this.mapCanvas?.syncInputs();
  }

  protected nextPicture(): void {
    this.mapCanvas?.resetInteractionState();
    this.hideContextMenu();
    this.state.nextPicture();
    this.mapCanvas?.syncInputs();
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

    this.mapCanvas?.resetInteractionState();
    this.mapCanvas?.refreshFromState();
    this.statusMessage = 'Undo applied';
  }

  protected redoCurrentPicture(): void {
    const pictureId = this.state.currentPicture().id;
    const redone = this.state.redoPictureState(pictureId);
    if (!redone) {
      this.statusMessage = 'Nothing to redo';
      return;
    }

    this.mapCanvas?.resetInteractionState();
    this.mapCanvas?.refreshFromState();
    this.statusMessage = 'Redo applied';
  }

  protected resetCurrentPicture(): void {
    const picture = this.state.currentPicture();
    this.mapCanvas?.resetInteractionState();
    this.state.resetPictureState(picture.id);
    this.mapCanvas?.refreshFromState();
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

    const parsed = parsePictureAnnotationsJson(rawContent, picture.id, this.mapCanvas?.getCurrentImageSize());
    if (!parsed.ok) {
      this.statusMessage = parsed.error;
      return;
    }

    this.clearSelection();
    this.mapCanvas?.resetInteractionState();
    this.state.replacePictureState(picture.id, {
      shapes: parsed.payload.shapes,
      waypoints: parsed.payload.waypoints,
    });
    this.state.savePictureState(picture.id);
    this.mapCanvas?.refreshFromState();

    const skippedText = parsed.skippedObjects > 0 ? ` (${parsed.skippedObjects} objects skipped)` : '';
    this.statusMessage = `Imported ${parsed.payload.shapes.length} shapes and ${parsed.payload.waypoints.length} waypoints${skippedText}`;
  }

  protected toggleChecklist(): void {
    this.showChecklist = !this.showChecklist;
  }

  protected onThicknessChanged(event: Event): void {
    const input = event.target as HTMLInputElement;
    const thickness = parseFloat(input.value);
    this.state.setSelectedThickness(thickness);
    this.mapCanvas?.updateSelectedShapeProperty('thickness', thickness);
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

    if (Math.abs(deltaX) > SWIPE_THRESHOLD && Math.abs(deltaX) > Math.abs(deltaY)) {
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
    this.mapCanvas?.refreshFromState();
  }

  protected hideContextMenu(): void {
    this.contextMenuVisible = false;
    this.contextWaypoint = null;
    this.mapCanvas?.hideContextMenu();
  }

  protected onPageClick(event: MouseEvent): void {
    if (Date.now() - this.contextMenuOpenedAt < 150) {
      return;
    }

    if (this.suppressNextPageClick) {
      this.suppressNextPageClick = false;
      return;
    }

    this.mapCanvas?.handlePageClick(event);
    this.hideContextMenu();
  }

  protected onMapStatusChanged(status: string): void {
    this.statusMessage = status;
  }

  protected onMapSelectionChanged(selection: CanvasSelectionState): void {
    this.selectedShapeId = selection.selectedShapeId;
    this.selectedWaypointId = selection.selectedWaypointId;
  }

  protected onCanvasContextMenuChanged(state: CanvasContextMenuState): void {
    this.contextMenuVisible = state.visible;
    this.contextMenuX = state.x;
    this.contextMenuY = state.y;
    this.contextWaypoint = state.waypoint;
    this.contextMenuOpenedAt = state.openedAt;
    this.suppressNextPageClick = state.suppressNextPageClick;
  }

  protected onPictureLoaded(event: CanvasPictureLoadedEvent): void {
    this.minimapPictureUrl.set(event.url);
    this.minimapPictureBounds.set(event.bounds);
    this.minimapMainViewBounds.set(event.bounds);
    this.minimap?.syncFromInputs();
  }

  protected onMainViewBoundsChanged(bounds: BoundsSnapshot | null): void {
    this.minimapMainViewBounds.set(bounds);
    this.minimap?.syncFromInputs();
  }

  protected onMinimapViewportChanged(state: MinimapViewportState): void {
    this.mapCanvas?.updateMinimapViewportDataset(state);
  }

  protected onColorChanged(color: string): void {
    this.state.setSelectedColor(color);
    this.mapCanvas?.updateSelectedShapeProperty('color', color);
  }

  private clearSelection(): void {
    this.selectedShapeId = null;
    this.selectedWaypointId = null;
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
      this.mapCanvas?.resetToSelectMode();
      this.statusMessage = 'Selection cleared. Tool switched to Select.';
      return;
    }

    if (action.type === 'delete-selected-shape' && this.selectedShapeId) {
      this.state.removeShape(pictureId, this.selectedShapeId);
      this.selectedShapeId = null;
      this.mapCanvas?.refreshFromState();
      this.statusMessage = 'Shape deleted';
      return;
    }

    if (action.type === 'delete-selected-waypoint' && this.selectedWaypointId) {
      this.state.removeWaypoint(pictureId, this.selectedWaypointId);
      this.selectedWaypointId = null;
      this.mapCanvas?.refreshFromState();
      this.statusMessage = 'Waypoint deleted';
      return;
    }

    if (action.type === 'nudge-selected-shape' && this.selectedShapeId) {
      const shape = this.state.findShape(pictureId, this.selectedShapeId);
      if (!shape) {
        return;
      }

      this.state.updateShape(pictureId, moveShape(shape, action.dx, action.dy));
      this.mapCanvas?.refreshFromState();
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
      this.mapCanvas?.refreshFromState();
      this.statusMessage = `Waypoint nudged (${action.dx}, ${action.dy})`;
    }
  }
}
