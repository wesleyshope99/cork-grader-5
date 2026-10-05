// Two-pass capture: find the disc, then re-crop straight from the source so
// the disc fills the size the thresholds were tuned at, then measure that.
//
// Why: the pore thresholds (black-hat kernel, porosity cuts) were tuned with
// the disc filling a 260px circle in the 300x300 canvas. A loose calibration
// ring -- which works fine for *finding* the disc -- leaves it at ~170-200px,
// and porosity then reads ~0.7x lower (clean discs ~0.64x), which grades
// everything too leniently. Pass 1 uses the calibrated region only to locate
// the disc; pass 2 re-renders from the full-resolution source with that disc
// centered at the design size, so the loose ring no longer matters and more
// native pixels land on the disc.

import { drawNormalizedDisk, transformFromCalibration, CANVAS_SIZE, DISK_PX } from './crop.js';
import { detectDisc } from './detect.js';
import { measureDisk } from './measure.js';

// Pass 1 only has to locate the disc, so accept a small disc anywhere in the
// ring (a loose, off-center ring is the point). Pass 2 re-renders that disc at
// the design size, so it must land there: a disc that doesn't means pass 1
// misjudged it, and we refuse to grade rather than measure the wrong thing.
const PASS1_BOUNDS = { maxCenterDrift: 70, minRadius: 45, maxRadius: DISK_PX / 2 };
const PASS2_BOUNDS = { maxCenterDrift: 15, minRadius: DISK_PX / 2 * 0.9, maxRadius: DISK_PX / 2 * 1.1 };

// willReadFrequently: detect/measure both call getImageData on these.
const pass1Canvas = document.createElement('canvas');
pass1Canvas.width = pass1Canvas.height = CANVAS_SIZE;
const pass1Ctx = pass1Canvas.getContext('2d', { willReadFrequently: true });

const pass2Canvas = document.createElement('canvas');
pass2Canvas.width = pass2Canvas.height = CANVAS_SIZE;
const pass2Ctx = pass2Canvas.getContext('2d', { willReadFrequently: true });

/**
 * The transform that renders a disc found in a first-pass canvas centered at
 * the design size. Maps the detected circle back into source pixels (inverting
 * drawNormalizedDisk's mapping), then reuses transformFromCalibration.
 */
export function refinedTransform(firstTransform, disk, sourceWidth, sourceHeight) {
  const half = CANVAS_SIZE / 2;
  return transformFromCalibration({
    cx: sourceWidth / 2 + (disk.cx - half - firstTransform.offsetX) / firstTransform.scale,
    cy: sourceHeight / 2 + (disk.cy - half - firstTransform.offsetY) / firstTransform.scale,
    radius: disk.radius / firstTransform.scale,
  }, sourceWidth, sourceHeight, { diskPx: DISK_PX });
}

/**
 * `source` is anything drawNormalizedDisk accepts (a frame snapshot canvas,
 * image, or video); `firstTransform` comes from the calibration. Returns
 * { detected: false } if either pass can't confidently find the disc --
 * never a fallback measurement -- otherwise
 * { detected: true, result, disk, canvas } where `canvas` is the re-cropped
 * image that was actually measured and `disk` the boundary found in it.
 */
export function captureAndMeasure(source, firstTransform, diameterMm) {
  drawNormalizedDisk(pass1Ctx, source, firstTransform, { canvasSize: CANVAS_SIZE, diskPx: DISK_PX });
  const coarse = detectDisc(pass1Canvas, PASS1_BOUNDS);
  if (!coarse.detected) return { detected: false };

  const sw = source.videoWidth || source.naturalWidth || source.width;
  const sh = source.videoHeight || source.naturalHeight || source.height;
  const tight = refinedTransform(firstTransform, coarse, sw, sh);

  // Clip wider than the design disc (diskPx = the whole canvas) so the disc's
  // rim is never truncated and the detector sees a margin of real background.
  drawNormalizedDisk(pass2Ctx, source, tight, { canvasSize: CANVAS_SIZE, diskPx: CANVAS_SIZE });
  const disk = detectDisc(pass2Canvas, PASS2_BOUNDS);
  if (!disk.detected) return { detected: false };

  return { detected: true, result: measureDisk(pass2Canvas, diameterMm, disk), disk, canvas: pass2Canvas };
}
