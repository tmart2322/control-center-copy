/** Dismiss reasons per Triage kind (they tune what Triage suggests next time). Shared by the page and its panels. */
import type { TriageItem } from '@/contract';

export const DISMISS_REASONS: Record<TriageItem['kind'], Array<{ value: string; label: string }>> = {
  work_item: [
    { value: 'done_elsewhere', label: 'Done elsewhere' },
    { value: 'not_mine', label: 'Not mine' },
    { value: 'later', label: 'Later' },
    { value: 'wrong_account', label: 'Wrong account' },
  ],
  missed_opp: [
    { value: 'not_my_account', label: 'Not my account' },
    { value: 'covered_by_other_dc', label: 'Covered by another DC' },
    { value: 'not_a_fit', label: 'Not a fit' },
    { value: 'other', label: 'Other' },
  ],
  mapping: [
    { value: 'neither', label: 'Neither of these' },
    { value: 'not_sure', label: 'Not sure' },
    { value: 'not_relevant', label: 'Not relevant' },
  ],
};
