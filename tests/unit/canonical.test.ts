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

  // --- strict byte-level sort tests for case-differing keys ---

  it('should sort case-differing keys deterministically', () => {
    // "F" (0x46) < "f" (0x66) in byte order, so "Foo" comes before "foo"
    const input = { foo: 2, Foo: 1 };
    const result = canonicalize(input);
    expect(result).toBe('{"Foo":1,"foo":2}');
  });

  it('should produce identical output regardless of insertion order for case-differing keys', () => {
    // These two objects are semantically the same JSON but with different key insertion order
    const a = canonicalize({ Foo: 1, foo: 2 });
    const b = canonicalize({ foo: 2, Foo: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"Foo":1,"foo":2}');
  });

  it('should sort multiple case variants deterministically', () => {
    const input = { zebra: 3, Zebra: 1, ZEBRA: 2 };
    const result = canonicalize(input);
    // ASCII: Z=0x5A, z=0x7A, so Z < z
    // Among Z-prefixed: ZEBRA (E=0x45) < Zebra (e=0x65)
    expect(result).toBe('{"ZEBRA":2,"Zebra":1,"zebra":3}');
  });

  it('should sort unicode keys deterministically by UTF-16 code unit', () => {
    const input = { 'é': 2, e: 1 }; // é (U+00E9) vs e (U+0065)
    const result = canonicalize(input);
    // e = 0x0065, é = 0x00E9 — so "e" < "é"
    expect(result).toBe('{"e":1,"é":2}');
  });

  it('should sort mixed special characters deterministically', () => {
    const input = { 'a_b': 2, 'a-b': 1, 'a.b': 3 };
    const result = canonicalize(input);
    // ASCII: - (0x2D) < . (0x2E) < _ (0x5F)
    expect(result).toBe('{"a-b":1,"a.b":3,"a_b":2}');
  });

  it('should handle deeply nested case-differing keys', () => {
    const input = { data: { Foo: 1, foo: 2, bar: { A: 1, a: 2 } } };
    const result = canonicalize(input);
    expect(result).toBe('{"data":{"Foo":1,"bar":{"A":1,"a":2},"foo":2}}');
  });

  it('should handle empty objects', () => {
    expect(canonicalize({})).toBe('{}');
  });

  it('should handle null values (preserved, unlike undefined)', () => {
    const input = { a: 1, b: null };
    const result = canonicalize(input);
    expect(result).toBe('{"a":1,"b":null}');
  });

  it('should handle empty arrays', () => {
    const input = { items: [] };
    const result = canonicalize(input);
    expect(result).toBe('{"items":[]}');
  });
});
