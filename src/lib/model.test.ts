import { describe, expect, it } from 'vitest';
import { checkFiles, compressionResult, formatBytes, LIMITS, move, rotate } from './model';
import { imageDimensions } from './image-dimensions';

describe('page state', () => {
  it('moves pages without mutating the original and ignores invalid moves', () => {
    const values = [0, 1, 2];
    expect(move(values, 0, 2)).toEqual([1, 2, 0]);
    expect(values).toEqual([0, 1, 2]);
    expect(move(values, -1, 2)).toBe(values);
    expect(move(values, 1, 3)).toBe(values);
  });
  it('adds rotation to selected original page references and normalizes angles', () => {
    const pages = [{ original: 2, rotation: 270 }, { original: 0, rotation: 0 }];
    expect(rotate(pages, new Set([2]), 90)).toEqual([{ original: 2, rotation: 0 }, pages[1]]);
    expect(rotate(pages, new Set([0]), -90)[1].rotation).toBe(270);
    expect(pages[0].rotation).toBe(270);
  });
});

describe('size reporting and input limits', () => {
  it('recommends the exact original when output is equal or larger', () => {
    const original = new Uint8Array(100);
    for (const size of [100, 101, 200]) {
      const result = compressionResult(original, new Uint8Array(size));
      expect(result.bytes).toBe(original);
      expect(result.name).toBe('original.pdf');
      expect(result.message).toContain('No size reduction achieved');
    }
    expect(compressionResult(original, new Uint8Array(75)).message).toContain('25.0% smaller');
  });
  it('rejects empty, oversized and excessive inputs', () => {
    expect(() => checkFiles([])).toThrow('at least');
    expect(() => checkFiles([new File([], 'empty')])).toThrow('Empty');
    expect(() => checkFiles([new File(['x'], 'x')], LIMITS.totalBytes)).toThrow('60 MB');
    expect(() => checkFiles([new File(['x'], 'x')], 0, 60)).toThrow('60 files');
    expect(formatBytes(1024)).toBe('1.0 KB');
  });
  it('guards PNG dimensions before decoding', () => {
    const bytes = new Uint8Array(24);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 0x89504e47); view.setUint32(4, 0x0d0a1a0a);
    view.setUint32(16, 200); view.setUint32(20, 100);
    expect(imageDimensions(bytes)).toEqual({ width: 200, height: 100, format: 'png' });
    view.setUint32(16, 16001);
    expect(() => imageDimensions(bytes)).toThrow('16,000');
    expect(() => imageDimensions(new Uint8Array([0, 1]))).toThrow('Unsupported');
  });
});
