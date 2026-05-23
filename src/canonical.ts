function sortObjectKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(sortObjectKeys);
  }
  if (typeof obj === 'object' && obj !== null) {
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(obj as Record<string, unknown>).sort((a, b) =>
      a < b ? -1 : a > b ? 1 : 0
    );
    for (const key of keys) {
      const value = (obj as Record<string, unknown>)[key];
      // undefined values are stripped for canonical consistency —
      // {a: undefined, b:1} and {b:1} MUST produce the same signature.
      if (value !== undefined) {
        sorted[key] = sortObjectKeys(value);
      }
    }
    return sorted;
  }
  return obj;
}

export function canonicalize(obj: unknown): string {
  const sorted = sortObjectKeys(obj);
  return JSON.stringify(sorted);
}

export function testVectors(): { input: unknown; expected: string }[] {
  return [
    { input: { b: 2, a: 1 }, expected: '{"a":1,"b":2}' },
    { input: { z: { b: 2, a: 1 }, a: 1 }, expected: '{"a":1,"z":{"a":1,"b":2}}' },
    { input: [3, 1, 2], expected: '[3,1,2]' },
    { input: { key: 'value\nwith"quotes' }, expected: '{"key":"value\\nwith\\"quotes"}' },
    { input: { a: 1, b: null, c: 3 }, expected: '{"a":1,"b":null,"c":3}' },
  ];
}
