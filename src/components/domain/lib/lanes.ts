/**
 * Lane packing for time blocks (pure, React-free). Shared by the Today timeline, the domain DaySpine and the
 * Home day ribbon so overlapping meetings are laid out the same way everywhere.
 */

/** A half-open interval [s, e) in any unit (minutes of the day, epoch ms), plus its packed column. */
export interface LaneBox {
  s: number;
  e: number;
  /** 0-based column inside its overlap cluster. */
  col: number;
  /** Columns in its overlap cluster (≥ 1). */
  cols: number;
}

/**
 * Pack overlapping blocks into columns (calendar-style clusters), in place. Blocks that touch end to start do
 * not overlap. Inside a cluster each block takes the lowest column whose last block has ended; every block in
 * the cluster gets the cluster's column count, so they share the width (or height) evenly.
 */
export function packColumns<T extends LaneBox>(items: T[]): void {
  for (const cluster of overlapClusters(items)) {
    const ends: number[] = [];
    for (const it of cluster) {
      let c = ends.findIndex((end) => end <= it.s);
      if (c < 0) {
        c = ends.length;
        ends.push(it.e);
      } else ends[c] = it.e;
      it.col = c;
    }
    for (const it of cluster) it.cols = Math.max(1, ends.length);
  }
}

/** Group blocks into overlap clusters (chains of overlapping blocks), each sorted by start, longest first. */
export function overlapClusters<T extends Pick<LaneBox, 's' | 'e'>>(items: T[]): T[][] {
  const sorted = [...items].sort((a, b) => a.s - b.s || b.e - a.e);
  const out: T[][] = [];
  let cluster: T[] = [];
  let clusterEnd = -Infinity;
  for (const it of sorted) {
    if (cluster.length && it.s >= clusterEnd) {
      out.push(cluster);
      cluster = [];
    }
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.e);
  }
  if (cluster.length) out.push(cluster);
  return out;
}

/** True when two half-open intervals share any time (back to back is not an overlap). */
export const overlapsBox = (a: Pick<LaneBox, 's' | 'e'>, b: Pick<LaneBox, 's' | 'e'>): boolean => a.s < b.e && a.e > b.s;
