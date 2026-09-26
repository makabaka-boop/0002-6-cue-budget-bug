/**
 * Incremental bounded distance frontier for one planned performance.
 *
 * The stage manager registers live cues one at a time while the show is
 * running and wants to know, *before the show ends*, whether the deviation
 * has already grown unrecoverable. A planned cue sequence P (length m) and a
 * tolerance k are fixed when the session is created; the live sequence L
 * (length n) grows by one element per committed registerCue command.
 *
 * Costs are the same model as distance.ts: insertion 1, deletion 1,
 * substitution 2 (compare by integer equality). After the i-th live cue we
 * keep the DP row
 *
 *   D_i(j) = edit distance between L[0..i) (whole live prefix so far)
 *                               and   P[0..j) (each planned prefix)
 *
 * and cap values beyond the tolerance at k + 1.
 *
 * Recoverability: the *boundary* after i live cues is
 *
 *   boundary_i = min over j of D_i(j)
 *
 * i.e. the cheapest price at which the live prefix heard so far can end the
 * alignment at *some* planned prefix (deleting every not-yet-heard planned
 * cue afterwards costs nothing extra yet — those are precisely the costs
 * that future cues may still avoid). If boundary_i > k, every j already
 * costs more than the budget, and edit distance is monotone non-decreasing
 * when the live side is extended. If it is above k, the deviation is
 * unrecoverable; boundary_i <= k means "仍可追回".
 *
 * The boundary never decreases and is sticky: once INF it stays INF.
 *
 * When the session ends, the full plan must be accounted for, so the final
 * verdict reads D_n(m) (whole live sequence vs the *whole* plan): an exact
 * distance when <= k, otherwise only the exceeded signal.
 */

export type FinalStatus = 'ok' | 'exceeded';

/** Whole-plan verdict (always produced by finalize()). */
export interface FinalVerdict {
  status: FinalStatus;
  /** Present only when status === 'ok'. */
  distance?: number;
}

export interface DeviationSnapshot {
  /** Tolerance fixed at creation; the plan itself never changes. */
  k: number;
  /** Number of cues in the fixed planned sequence. */
  plannedLength: number;
  /** Number of live cues committed so far. */
  liveLength: number;
  /**
   * min_j D_i(j), capped at k + 1. Exact while <= k so the console can show
   * how much of the budget is already spent; k + 1 means "greater than k".
   */
  boundary: number;
  /** boundary <= k — the deviation can still be reeled back in. */
  recoverable: boolean;
  /**
   * Present only once the session has ended and the whole plan was
   * compared: exact distance when status === 'ok', otherwise the distance
   * is withheld (only 'exceeded' is reported).
   */
  final: FinalVerdict | null;
}

import { boundedCueDistance } from './distance.js';

export class PrefixDistanceTracker {
  private readonly live: number[] = [];
  private boundary = 0;
  private finalSnapshot: FinalVerdict | null = null;

  constructor(private readonly plan: ArrayLike<number>, private readonly k: number) {
    if (!Number.isInteger(k) || k < 0) {
      throw new RangeError('k must be a non-negative integer');
    }
  }

  append(cue: number): void {
    this.live.push(cue);
    const position = this.live.length - 1;
    if (position >= this.plan.length || this.plan[position] !== cue) {
      this.boundary = Math.min(this.k + 1, this.boundary + 1);
    }
  }

  finalize(): FinalVerdict {
    if (this.finalSnapshot) return this.finalSnapshot;
    const result = boundedCueDistance(this.live, this.plan, this.k);
    this.finalSnapshot = result.status === 'ok'
      ? { status: 'ok', distance: result.distance }
      : { status: 'exceeded' };
    return this.finalSnapshot;
  }

  snapshot(): DeviationSnapshot {
    return {
      k: this.k,
      plannedLength: this.plan.length,
      liveLength: this.live.length,
      boundary: this.boundary,
      recoverable: this.boundary < this.k,
      final: this.finalSnapshot ? { ...this.finalSnapshot } : null,
    };
  }
}
