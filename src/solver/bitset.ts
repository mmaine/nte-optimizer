/**
 * Fixed-width bitsets over the item pool.
 *
 * A build's item set is the thing the team phase intersects, over and over, so
 * it is a `Uint32Array` of about 26 words at 817 items rather than a `Set`.
 * Disjointness of two builds is then a handful of ANDs.
 */
export type Bitset = Uint32Array;

export function bitsetFor(size: number): Bitset {
  return new Uint32Array((size + 31) >>> 5);
}

export function bitsetOf(size: number, members: Iterable<number>): Bitset {
  const set = bitsetFor(size);
  for (const member of members) add(set, member);
  return set;
}

export function add(set: Bitset, member: number): void {
  set[member >>> 5] = set[member >>> 5]! | (1 << (member & 31));
}

export function has(set: Bitset, member: number): boolean {
  return (set[member >>> 5]! & (1 << (member & 31))) !== 0;
}

/** True when the two share no member - the hot check in the team search. */
export function disjoint(a: Bitset, b: Bitset): boolean {
  for (let i = 0; i < a.length; i += 1) {
    if ((a[i]! & b[i]!) !== 0) return false;
  }
  return true;
}

export function overlapCount(a: Bitset, b: Bitset): number {
  let count = 0;
  for (let i = 0; i < a.length; i += 1) {
    let word = a[i]! & b[i]!;
    while (word !== 0) {
      word &= word - 1;
      count += 1;
    }
  }
  return count;
}

export function unionInto(into: Bitset, from: Bitset): void {
  for (let i = 0; i < into.length; i += 1) into[i] = into[i]! | from[i]!;
}

export function clone(set: Bitset): Bitset {
  return new Uint32Array(set);
}

export function members(set: Bitset): number[] {
  const out: number[] = [];
  for (let i = 0; i < set.length; i += 1) {
    let word = set[i]!;
    while (word !== 0) {
      const bit = 31 - Math.clz32(word & -word);
      out.push(i * 32 + bit);
      word &= word - 1;
    }
  }
  return out;
}
