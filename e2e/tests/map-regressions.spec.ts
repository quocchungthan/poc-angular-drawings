import { expect, Locator, Page, test } from '@playwright/test';

type ViewportRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type MinimapViewportState = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const STORAGE_KEY = 'leaflet-picture-poc.state.v1';
const SEEDED_WAYPOINT_ID = 'wp-001';
const SEEDED_WAYPOINT_X = 740;
const SEEDED_WAYPOINT_Y = 255;

test.describe('Leaflet map regressions', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.clear();
    });

    await page.goto('/');
    await expect(page.getByTestId('map-container')).toBeVisible();

    const checklistToggle = page.getByRole('button', { name: 'Demo Checklist' });
    if ((await checklistToggle.getAttribute('class'))?.includes('active')) {
      await checklistToggle.click();
    }

    await expect(getWaypointMarker(page, SEEDED_WAYPOINT_ID)).toBeVisible();
  });

  test('waypoint drag persists after mouse release', async ({ page }) => {
    await page.getByRole('button', { name: 'Edit' }).click();
    await page.getByRole('button', { name: 'Waypoint Edit' }).click();

    const marker = getWaypointMarker(page, SEEDED_WAYPOINT_ID);
    const before = await getBoxOrThrow(marker, 'seed waypoint marker before drag');

    const fromX = before.x + before.width / 2;
    const fromY = before.y + before.height / 2;
    const toX = fromX + 140;
    const toY = fromY + 90;

    await page.mouse.move(fromX, fromY);
    await page.mouse.down();
    await page.mouse.move(toX, toY, { steps: 16 });
    await page.mouse.up();

    await expect(statusMessage(page)).toContainText(`Moved waypoint ${SEEDED_WAYPOINT_ID}`);

    const after = await getBoxOrThrow(marker, 'seed waypoint marker after drag');
    const movedDistance = Math.hypot(after.x - before.x, after.y - before.y);
    expect(movedDistance).toBeGreaterThan(20);

    const persistedWaypoint = await page.evaluate(
      ({ storageKey, waypointId }) => {
        const raw = window.localStorage.getItem(storageKey);
        if (!raw) {
          return null;
        }

        const parsed = JSON.parse(raw) as Record<string, { waypoints: Array<{ id: string; x: number; y: number }> }>;
        const pictureState = parsed['pic-1'];
        if (!pictureState) {
          return null;
        }

        return pictureState.waypoints.find((waypoint) => waypoint.id === waypointId) ?? null;
      },
      { storageKey: STORAGE_KEY, waypointId: SEEDED_WAYPOINT_ID },
    );

    expect(persistedWaypoint).not.toBeNull();
    expect(persistedWaypoint?.x).not.toBe(SEEDED_WAYPOINT_X);
    expect(persistedWaypoint?.y).not.toBe(SEEDED_WAYPOINT_Y);
  });

  test('waypoint click reliably opens context menu at marker location', async ({ page }) => {
    const marker = getWaypointMarker(page, SEEDED_WAYPOINT_ID);
    for (let iteration = 0; iteration < 3; iteration += 1) {
      const markerBox = await getBoxOrThrow(marker, `seed waypoint marker for click iteration ${iteration}`);
      const markerCenterX = markerBox.x + markerBox.width / 2;
      const markerCenterY = markerBox.y + markerBox.height / 2;

      await page.mouse.click(markerCenterX, markerCenterY);

      await expect
        .poll(async () => getMapData(page, 'contextMenuWaypointId'))
        .toBe(SEEDED_WAYPOINT_ID);

      const menuX = Number(await getMapData(page, 'contextMenuX'));
      const menuY = Number(await getMapData(page, 'contextMenuY'));
      expect(Number.isNaN(menuX)).toBe(false);
      expect(Number.isNaN(menuY)).toBe(false);
      expect(Math.abs(menuX - markerCenterX)).toBeLessThan(120);
      expect(Math.abs(menuY - markerCenterY)).toBeLessThan(120);
    }
  });

  test('waypoint right click opens context menu in waypoint edit mode', async ({ page }) => {
    await page.getByRole('button', { name: 'Edit' }).click();
    await page.getByRole('button', { name: 'Waypoint Edit' }).click();

    const marker = getWaypointMarker(page, SEEDED_WAYPOINT_ID);
    const markerBox = await getBoxOrThrow(marker, 'seed waypoint marker for edit-mode context menu');
    const markerCenterX = markerBox.x + markerBox.width / 2;
    const markerCenterY = markerBox.y + markerBox.height / 2;

    await page.mouse.click(markerCenterX, markerCenterY, { button: 'right' });

    await expect(page.getByTestId('waypoint-context-menu')).toBeVisible();
    await expect
      .poll(async () => getMapData(page, 'contextMenuWaypointId'))
      .toBe(SEEDED_WAYPOINT_ID);
  });

  test('minimap viewport updates with main map zoom and pan', async ({ page }) => {
    const mapContainer = page.getByTestId('map-container');
    const minimapViewport = page.getByTestId('minimap-viewport');
    await page.locator('.leaflet-control-zoom-in').first().click();
    await expect
      .poll(async () => getMapData(page, 'minimapViewportVisible'))
      .toBe('true');

    const initialRect = await readMinimapViewportState(page);
    const initialViewportBox = await getBoxOrThrow(minimapViewport, 'initial minimap viewport');

    await page.locator('.leaflet-control-zoom-in').first().click();

    await expect
      .poll(async () => {
        const next = await readMinimapViewportState(page);
        const widthChanged = Math.abs(next.width - initialRect.width) > 0.5;
        const heightChanged = Math.abs(next.height - initialRect.height) > 0.5;
        return widthChanged || heightChanged;
      })
      .toBe(true);

    const zoomedRect = await readMinimapViewportState(page);
    await expect
      .poll(async () => {
        const currentViewportBox = await getBoxOrThrow(minimapViewport, 'zoomed minimap viewport');
        const widthChanged = Math.abs(currentViewportBox.width - initialViewportBox.width) > 0.5;
        const heightChanged = Math.abs(currentViewportBox.height - initialViewportBox.height) > 0.5;
        return widthChanged || heightChanged;
      })
      .toBe(true);

    const mapBox = await getBoxOrThrow(mapContainer, 'map container for pan');
    const startX = mapBox.x + mapBox.width * 0.55;
    const startY = mapBox.y + mapBox.height * 0.45;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 110, startY + 80, { steps: 18 });
    await page.mouse.up();

    await expect
      .poll(async () => {
        const current = await readMinimapViewportState(page);
        const dx = Math.abs(current.left - zoomedRect.left);
        const dy = Math.abs(current.top - zoomedRect.top);
        return dx > 1 || dy > 1;
      })
      .toBe(true);

    await expect
      .poll(async () => {
        const currentViewportBox = await getBoxOrThrow(minimapViewport, 'panned minimap viewport');
        const dx = Math.abs(currentViewportBox.x - initialViewportBox.x);
        const dy = Math.abs(currentViewportBox.y - initialViewportBox.y);
        return dx > 1 || dy > 1;
      })
      .toBe(true);
  });
});

function getWaypointMarker(page: Page, waypointId: string): Locator {
  return page.locator(`.leaflet-marker-icon:has([data-waypoint-id="${waypointId}"])`).first();
}

function statusMessage(page: Page): Locator {
  return page.getByTestId('status-hint').locator('span').first();
}

async function getMapData(page: Page, key: string): Promise<string> {
  return page.getByTestId('map-container').evaluate((element, dataKey) => {
    const mapElement = element as HTMLDivElement;
    return mapElement.dataset[dataKey as keyof DOMStringMap] ?? '';
  }, key);
}

async function readMinimapViewportState(page: Page): Promise<MinimapViewportState> {
  const [left, top, width, height] = await Promise.all([
    getMapData(page, 'minimapViewportLeft'),
    getMapData(page, 'minimapViewportTop'),
    getMapData(page, 'minimapViewportWidth'),
    getMapData(page, 'minimapViewportHeight'),
  ]);

  return {
    left: Number(left),
    top: Number(top),
    width: Number(width),
    height: Number(height),
  };
}

async function getBoxOrThrow(locator: Locator, description: string): Promise<ViewportRect> {
  const box = await locator.boundingBox();
  expect(box, `${description} should have a measurable bounding box`).not.toBeNull();

  return box as ViewportRect;
}
