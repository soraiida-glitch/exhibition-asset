import { describe, expect, it } from 'vitest';
import { computeResizedDimensions } from '../image-utils';

describe('computeResizedDimensions', () => {
  it('does not upscale images already within the max size', () => {
    expect(computeResizedDimensions(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });

  it('scales down a landscape image to the max long edge, preserving aspect ratio', () => {
    expect(computeResizedDimensions(3200, 1600, 1600)).toEqual({ width: 1600, height: 800 });
  });

  it('scales down a portrait image to the max long edge, preserving aspect ratio', () => {
    expect(computeResizedDimensions(1600, 3200, 1600)).toEqual({ width: 800, height: 1600 });
  });

  it('treats a square image at the exact max as unchanged', () => {
    expect(computeResizedDimensions(1600, 1600, 1600)).toEqual({ width: 1600, height: 1600 });
  });
});
