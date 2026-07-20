export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const RESIZE_MAX_PX = 1600;
export const JPEG_QUALITY = 0.9;

/** Scales width/height down so the long edge is at most maxPx, preserving aspect ratio. Never upscales. */
export function computeResizedDimensions(
  width: number,
  height: number,
  maxPx: number,
): { width: number; height: number } {
  if (width <= maxPx && height <= maxPx) {
    return { width, height };
  }
  if (width >= height) {
    return { width: maxPx, height: Math.round((height * maxPx) / width) };
  }
  return { width: Math.round((width * maxPx) / height), height: maxPx };
}
