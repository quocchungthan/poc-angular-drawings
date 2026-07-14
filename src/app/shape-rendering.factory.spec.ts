import * as L from 'leaflet';
import { createShapeLayer } from './shape-rendering.factory';

describe('shape-rendering.factory', () => {
  it('should create arrow as layer group with shaft and head', () => {
    const layer = createShapeLayer({
      id: 'a',
      type: 'arrow',
      strokeWidth: 2,
      color: '#111111',
      startPoint: { x: 0, y: 0 },
      endPoint: { x: 10, y: 0 },
      direction: 'right',
    }, true, { selected: false });

    expect(layer instanceof L.LayerGroup).toBe(true);
    expect((layer as L.LayerGroup).getLayers().length).toBe(2);
  });

  it('should create dashed line with default dash array', () => {
    const layer = createShapeLayer({
      id: 'd',
      type: 'dashed-line',
      strokeWidth: 2,
      color: '#111111',
      points: [{ x: 0, y: 0 }, { x: 10, y: 10 }],
    }, false, { selected: false }) as L.Polyline;

    expect((layer.options as { dashArray?: string }).dashArray).toBe('8 8');
  });

  it('should create polygon for triangle', () => {
    const layer = createShapeLayer({
      id: 't',
      type: 'triangle',
      strokeWidth: 2,
      color: '#111111',
      points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }],
    }, false, { selected: true });

    expect(layer instanceof L.Polygon).toBe(true);
  });
});
