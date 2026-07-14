import { DrawingShape } from '../poc-types';
import { SHAPE_ID_PREFIX } from './konva-import.constants';
import {
  createCoordinateMapper,
  createShapeStyle,
  isRecord,
  parseMaybeJsonObject,
} from './konva-import.helpers';
import { getShapeImporter } from './konva-shape-importer.factory';
import { KonvaImportSuccess } from './konva-import.types';

export function parseKonvaLineLikeImport(
  value: unknown,
  pictureId: string,
  imageSize?: { width: number; height: number },
): KonvaImportSuccess | null {
  if (!isRecord(value) || !Array.isArray(value['objects'])) {
    return null;
  }

  const canvasWidth = typeof value['width'] === 'number' ? value['width'] : 0;
  const canvasHeight = typeof value['height'] === 'number' ? value['height'] : 0;
  const mapper = createCoordinateMapper(canvasWidth, canvasHeight, imageSize);

  const shapes: DrawingShape[] = [];
  let skippedObjects = 0;

  for (const rawObject of value['objects']) {
    const parsedObject = parseMaybeJsonObject(rawObject);
    if (!parsedObject) {
      skippedObjects += 1;
      continue;
    }

    const className = typeof parsedObject['className'] === 'string' ? parsedObject['className'] : '';
    const attrs = isRecord(parsedObject['attrs']) ? parsedObject['attrs'] : null;
    const importer = getShapeImporter(className);

    if (!importer || !attrs) {
      skippedObjects += 1;
      continue;
    }

    const shape = importer({
      attrs,
      mapper,
      shapeId: `${SHAPE_ID_PREFIX}${shapes.length + 1}`,
      style: createShapeStyle(attrs, mapper.strokeScale),
    });

    if (!shape) {
      skippedObjects += 1;
      continue;
    }

    shapes.push(shape);
  }

  if (shapes.length === 0) {
    return null;
  }

  return {
    skippedObjects,
    payload: {
      schemaVersion: 1,
      pictureId,
      exportedAt: new Date().toISOString(),
      shapes,
      waypoints: [],
    },
  };
}
