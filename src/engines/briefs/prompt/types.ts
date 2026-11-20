/**
 * Minimal input types for brief generation (R-UI-21). Local by design; the orchestrator
 * reconciles them with W0's contract and BE-5's engine. Field names follow DATA-MODEL §17.
 */

export type BriefKind = 'channel' | 'opportunity' | 'relevance';

export interface BriefPerson {
  name: string;
  relation?: 'manager' | 'ae' | 'peer' | 'leader' | 'customer' | 'other';
  slackId?: string;
  isMe?: boolean;
  isExternal?: boolean;
}

export interface BriefItem {
  id: string;
  source: 'slack' | 'gmail' | 'calendar' | 'drive' | 'gemini' | 'org62' | 'claude' | 'vdp';
  at: string;
  author?: BriefPerson;
  /** Channel, subject, file or meeting. */
  where?: string;
  threadRef?: string;
  text: string;
  permalink?: string;
  replyCount?: number;
  reactions?: number;
  /** Calendar items: attended or missed. */
  attended?: boolean | null;
}

export interface OppFieldChange {
  field: string;
  before: string | null;
  after: string | null;
  at: string;
}

export interface BriefOpportunity {
  id: string;
  name: string;
  accountName: string;
  stage?: string;
  closeDate?: string;
  amount?: number | string;
  team?: string[];
  nextSteps?: string;
  fieldChanges: OppFieldChange[];
}

export interface MyContext {
  accounts: Array<{ id: string; name: string; aliases?: string[] }>;
  opportunities: Array<{ id: string; name: string; accountId?: string; stage?: string }>;
  initiatives: Array<{ id: string; title: string; keywords?: string[] }>;
  interests: Array<{ kind: 'skill' | 'product' | 'topic' | 'keyword'; value: string }>;
  people: BriefPerson[];
  policyRules: Array<{ key: string; text: string }>;
}

export interface RelevanceFeedbackExample {
  title: string;
  topicKey?: string;
  featureKeys: string[];
  reason?: string;
  at: string;
}

export interface BriefInput {
  kind: BriefKind;
  now: string;
  user: { name: string; role: string; tz: string; slackId?: string };
  period: { from: string; to: string };
  subscription: {
    id: string;
    label: string;
    scopeKind: 'channel' | 'opportunity' | 'account' | 'person' | 'initiative' | 'search_query';
    style?: 'digest' | 'narrative' | 'changes_only';
    detailLevel?: number;
    maxHighlights: number;
  };
  items: BriefItem[];
  opportunity?: BriefOpportunity;
  myContext: MyContext;
  feedback?: { negatives: RelevanceFeedbackExample[]; positives: Array<{ title: string; featureKeys: string[] }> };
  coverage?: { complete: boolean; note?: string };
}
