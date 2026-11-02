/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Deterministic Hash Utilities for Blaize Trust Kernel
 * Isolated to prevent circular import dependencies.
 */

/**
 * Fast, deterministic FNV-1a + Murmur-style 256-bit hex hash (synchronous, zero external dependencies,
 * runs identically in Node tests and browser without async SubtleCrypto overhead).
 */
export function computeDeterministicHash(input: string): string {
  const seeds = [
    0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35,
    0x27d4eb2f, 0x165667b1, 0xd3a2646c, 0xfd7046c5,
  ];
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    for (let s = 0; s < 8; s++) {
      let h = seeds[s] ^ code;
      h = Math.imul(h, 0x01000193 + (s << 4));
      h ^= h >>> 13;
      seeds[s] = h >>> 0;
    }
  }
  return seeds.map((n) => n.toString(16).padStart(8, '0')).join('');
}
