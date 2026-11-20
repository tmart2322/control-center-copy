/**
 * Opp classifier from line items and products (R-UI-14; method from the D360 sweep).
 *
 *  D360 signal:  a D360 line item (Data 360, Data Cloud, Data Services, Profiles, Marketing Data Bundle,
 *                Private Connect), EXCLUDING $0 Provisioning and Foundations entitlements;
 *                or, failing that, D360 words in the opp name.
 *  Flex-only:    Flex Credits lines but no D360 line and no D360 name token. Kept as a separate
 *                category because Flex can be Agentforce or D360.
 *  Threshold:    amount > $10k, and the opp is open or closed-won this quarter.
 */
import type { Classification, LineItemRecord, OppRecord } from './types';

const D360_PRODUCT = /\b(data\s*360|data\s*cloud|data\s*services?|marketing\s+data\s+bundle|private\s+connect|profiles?)\b/i;
/** "Profiles" alone is only a D360 product when it is not a user-permission profile. */
const NOT_D360_PROFILE = /\b(user|permission|admin|security|sharing)\s+profiles?\b/i;
const ENTITLEMENT = /\b(provisioning|foundations?)\b/i;
const FLEX = /\bflex\s*credits?\b/i;
const D360_NAME = /(\bd360\b|\bdata[\s-]?360\b|\bdata[\s-]?cloud\b|\bdc360\b|\bdata\s+services?\b|\bprivate\s+connect\b|\bmarketing\s+data\s+bundle\b)/gi;

export function classifyLineItems(opp: Pick<OppRecord, 'name'>, lines: readonly LineItemRecord[]): Classification {
  const d360Products: string[] = [];
  const excluded: string[] = [];
  let d360 = 0;
  let flex = 0;
  for (const l of lines) {
    const name = l.productName ?? '';
    if (FLEX.test(name)) {
      flex += l.totalPrice;
      continue;
    }
    if (!D360_PRODUCT.test(name) || NOT_D360_PROFILE.test(name)) continue;
    if (l.totalPrice <= 0 && ENTITLEMENT.test(name)) {
      excluded.push(name);
      continue;
    }
    d360 += l.totalPrice;
    d360Products.push(name);
  }
  const nameTokens = [...(opp.name.match(D360_NAME) ?? [])].map((t) => t.toLowerCase());
  const hasD360Line = d360Products.length > 0;
  const signal: Classification['signal'] = hasD360Line ? 'd360_line' : nameTokens.length ? 'name_token' : flex !== 0 || lines.some((l) => FLEX.test(l.productName ?? '')) ? 'flex_only' : 'none';
  return {
    signal,
    hasD360Line,
    d360LineAmount: d360,
    flexLineAmount: flex,
    d360Products: [...new Set(d360Products)].sort(),
    excludedEntitlements: [...new Set(excluded)].sort(),
    nameTokens: [...new Set(nameTokens)].sort(),
  };
}

export interface ThresholdOptions {
  minAmount: number; // 10_000 (strictly greater)
  /** Quarter window for "closed this quarter" (YYYY-MM-DD, inclusive). */
  windowStart: string;
  windowEnd: string;
}

export const DEFAULT_MIN_AMOUNT = 10_000;

export const isDeadStage = (stage: string): boolean => /\b(dead|duplicate|closed\s*-?\s*lost|lost)\b/i.test(stage);
export const isDuplicateStage = (stage: string): boolean => /duplicate/i.test(stage);

/** > $10k and (open, or closed-won with a close date in the window). Lost/dead never qualify. */
export function passesThreshold(opp: OppRecord, o: ThresholdOptions): boolean {
  if ((opp.amount ?? 0) <= o.minAmount) return false;
  if (isDeadStage(opp.stageName)) return false;
  if (!opp.isClosed) return true;
  return opp.isWon && opp.closeDate >= o.windowStart && opp.closeDate <= o.windowEnd;
}

export function isRenewal(opp: Pick<OppRecord, 'type' | 'name'>): boolean {
  if (opp.type) return /renewal/i.test(opp.type);
  return /\brenewal\b/i.test(opp.name);
}
