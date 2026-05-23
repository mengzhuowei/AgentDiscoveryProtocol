import { canonicalize, testVectors } from '../../src/canonical';

describe('Canonical JSON', () => {
  it('should pass all test vectors', () => {
    const vectors = testVectors();
    
    for (const { input, expected } of vectors) {
      const result = canonicalize(input);
      expect(result).toBe(expected);
    }
  });

  it('should sort object keys', () => {
    const input = { z: 1, a: 2, m: 3 };
    const result = canonicalize(input);
    expect(result).toBe('{"a":2,"m":3,"z":1}');
  });

  it('should preserve array order', () => {
    const input = { arr: [3, 1, 2] };
    const result = canonicalize(input);
    expect(result).toBe('{"arr":[3,1,2]}');
  });

  it('should handle nested objects', () => {
    const input = { outer: { b: 2, a: 1 }, top: 0 };
    const result = canonicalize(input);
    expect(result).toBe('{"outer":{"a":1,"b":2},"top":0}');
  });

  it('should skip undefined values', () => {
    const input = { a: 1, b: undefined, c: 3 } as { a: number; b: undefined; c: number };
    const result = canonicalize(input);
    expect(result).toBe('{"a":1,"c":3}');
  });
});
