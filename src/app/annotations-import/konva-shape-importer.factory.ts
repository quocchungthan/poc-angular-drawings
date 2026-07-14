import { importKonvaArrow } from './arrow.importer';
import { importKonvaCircle } from './circle.importer';
import { importKonvaEllipse } from './ellipse.importer';
import { importKonvaLine } from './line.importer';
import { importKonvaTriangle } from './regular-polygon.importer';
import { importKonvaRect } from './rect.importer';
import { ShapeImporter } from './konva-import.types';

const importersByClassName: Record<string, ShapeImporter> = {
  Line: importKonvaLine,
  Arrow: importKonvaArrow,
  Rect: importKonvaRect,
  Ellipse: importKonvaEllipse,
  Circle: importKonvaCircle,
  RegularPolygon: importKonvaTriangle,
};

export function getShapeImporter(className: string): ShapeImporter | undefined {
  return importersByClassName[className];
}
