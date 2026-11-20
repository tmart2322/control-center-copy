/**
 * Post-pass 92: realism fixes from the aggregate-shape review (reads and rewrites tables in place; deterministic).
 * Runs after 91-consistency. One module per theme in data/realism-*.ts; item numbers refer to the review list.
 */
import { activity } from './data/realism-activity';
import { drafts } from './data/realism-drafts';
import { ops } from './data/realism-ops';
import { sources } from './data/realism-sources';
import { work } from './data/realism-work';
import { audit } from './data/realism-audit';

activity();
drafts();
ops();
sources();
work();
audit();
console.log('92-realism: done');
