import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, input, NgZone, OnDestroy, output, signal, ViewChild } from '@angular/core';
import * as L from 'leaflet';
import { intersectBounds } from '../geometry.utils';
import { computeMinimapViewportRect } from '../minimap.utils';
import { BoundsSnapshot, MinimapViewportState } from './map-canvas.types';

@Component({
  selector: 'app-minimap',
  templateUrl: './minimap.component.html',
  styleUrl: './minimap.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MinimapComponent implements AfterViewInit, OnDestroy {
  readonly pictureUrl = input<string | null>(null);
  readonly pictureBounds = input<BoundsSnapshot | null>(null);
  readonly mainViewBounds = input<BoundsSnapshot | null>(null);

  readonly viewportStateChange = output<MinimapViewportState>();

  @ViewChild('minimapContainer')
  private readonly minimapContainer?: ElementRef<HTMLDivElement>;

  protected readonly viewportVisible = signal(false);
  protected readonly viewportLeft = signal(0);
  protected readonly viewportTop = signal(0);
  protected readonly viewportWidth = signal(0);
  protected readonly viewportHeight = signal(0);
  protected readonly viewportRight = signal(0);
  protected readonly viewportBottom = signal(0);

  private minimap?: L.Map;
  private minimapImageOverlay?: L.ImageOverlay;
  private minimapImageBounds?: L.LatLngBounds;
  private minimapViewportRafId: number | null = null;
  private currentPictureUrl: string | null = null;

  constructor(private readonly ngZone: NgZone) {}

  ngAfterViewInit(): void {
    this.initializeMinimap();
    this.syncFromInputs();
  }

  ngOnDestroy(): void {
    if (this.minimapViewportRafId !== null) {
      cancelAnimationFrame(this.minimapViewportRafId);
      this.minimapViewportRafId = null;
    }

    this.minimap?.remove();
  }

  syncFromInputs(): void {
    const bounds = this.pictureBounds();
    const url = this.pictureUrl();
    if (bounds && url && this.currentPictureUrl !== url) {
      this.syncPicture(url, bounds);
      this.currentPictureUrl = url;
    }

    this.updateViewport();
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

  private syncPicture(url: string, boundsSnapshot: BoundsSnapshot): void {
    const minimap = this.minimap;
    if (!minimap) {
      return;
    }

    if (this.minimapImageOverlay) {
      this.minimapImageOverlay.remove();
    }

    const bounds = this.toBounds(boundsSnapshot);
    this.minimapImageBounds = bounds;
    this.minimapImageOverlay = L.imageOverlay(url, bounds).addTo(minimap);
    minimap.fitBounds(bounds, { animate: false, padding: [0, 0] });
    minimap.setMaxBounds(bounds.pad(0.05));
    minimap.invalidateSize(true);
    this.updateViewport();
  }

  private scheduleViewportUpdate(): void {
    if (this.minimapViewportRafId !== null) {
      return;
    }

    this.minimapViewportRafId = requestAnimationFrame(() => {
      this.minimapViewportRafId = null;
      this.updateViewport();
    });
  }

  private updateViewport(): void {
    const minimap = this.minimap;
    const imageBounds = this.minimapImageBounds;
    const mainBounds = this.mainViewBounds();

    if (!minimap || !imageBounds || !mainBounds) {
      this.setViewportHidden();
      return;
    }

    const minimapSize = minimap.getSize();
    if (minimapSize.x <= 0 || minimapSize.y <= 0) {
      minimap.invalidateSize(false);
      this.scheduleViewportUpdate();
      this.setViewportHidden();
      return;
    }

    const clampedBounds = intersectBounds(this.toBounds(mainBounds), imageBounds);
    if (!clampedBounds) {
      this.setViewportHidden();
      return;
    }

    const imageWest = Math.min(imageBounds.getWest(), imageBounds.getEast());
    const imageEast = Math.max(imageBounds.getWest(), imageBounds.getEast());
    const imageNorth = Math.min(imageBounds.getNorth(), imageBounds.getSouth());
    const imageSouth = Math.max(imageBounds.getNorth(), imageBounds.getSouth());
    const imageWidth = imageEast - imageWest;
    const imageHeight = imageSouth - imageNorth;
    if (imageWidth <= 0 || imageHeight <= 0) {
      this.setViewportHidden();
      return;
    }

    const viewWest = Math.min(clampedBounds.getWest(), clampedBounds.getEast());
    const viewEast = Math.max(clampedBounds.getWest(), clampedBounds.getEast());
    const viewNorth = Math.min(clampedBounds.getNorth(), clampedBounds.getSouth());
    const viewSouth = Math.max(clampedBounds.getNorth(), clampedBounds.getSouth());

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
      this.setViewportHidden();
      return;
    }

    this.viewportVisible.set(true);
    this.viewportLeft.set(rect.left);
    this.viewportTop.set(rect.top);
    this.viewportWidth.set(rect.width);
    this.viewportHeight.set(rect.height);
    this.viewportRight.set(rect.right);
    this.viewportBottom.set(rect.bottom);
    this.emitViewportState({
      visible: true,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      right: rect.right,
      bottom: rect.bottom,
    });
  }

  private setViewportHidden(): void {
    this.viewportVisible.set(false);
    this.emitViewportState({
      visible: false,
      left: 0,
      top: 0,
      width: 0,
      height: 0,
      right: 0,
      bottom: 0,
    });
  }

  private emitViewportState(state: MinimapViewportState): void {
    if (NgZone.isInAngularZone()) {
      this.viewportStateChange.emit(state);
      return;
    }

    this.ngZone.run(() => this.viewportStateChange.emit(state));
  }

  private toBounds(snapshot: BoundsSnapshot): L.LatLngBounds {
    return L.latLngBounds(
      L.latLng(snapshot.north, snapshot.west),
      L.latLng(snapshot.south, snapshot.east),
    );
  }
}
