/** Hand-written cast for domain 01. Keys are the uid('people', key) slugs every later domain uses. */
export type PersonDef = {
  key: string;
  name: string;
  title: string;
  aff: 'internal' | 'customer' | 'partner' | 'unknown';
  acct: string | null; // account key
  tier: 'leader' | 'manager' | 'ae' | 'teammate' | 'customer_exec' | 'customer' | 'partner' | 'normal' | 'low';
  email: string;
  slack?: number; // slackUser(n)
  org62?: 'user' | 'contact';
  flags: string[]; // me, manager, AE, SE, specialist, champion, exec, partner, csm, deal-desk, director, blocker, external-no-account
  note?: string;
};

export const DOMAIN: Record<string, string> = {
  saltmere: 'saltmere-health.example',
  yarrowdale: 'yarrowdale-health.example',
  'yarrowdale-mg': 'yarrowdale-medical.example',
  'yarrowdale-bh': 'yarrowdale-behavioral.example',
  elderglen: 'elderglengroup.example',
  'elderglen-outdoors': 'elderglen-outdoors.example',
  'elderglen-home': 'elderglen-home.example',
  halvergate: 'halvergatefreight.example',
  ferrowpay: 'ferrowpay.example',
  harrowgate: 'harrowgate-mfg.example',
  cascadia: 'cascadiacounty.example',
  oakhallow: 'oakhallowmutual.example',
  voltmere: 'voltmere.example',
  contoso: 'contoso-market.example',
};

const I = (key: string, name: string, title: string, tier: PersonDef['tier'], slack: number, flags: string[], email?: string): PersonDef => ({
  key, name, title, aff: 'internal', acct: null, tier, slack, org62: 'user', flags,
  email: email ?? `${name.toLowerCase().replace(/[^a-z ]/g, '').split(' ').join('.')}@example.com`,
});
const C = (key: string, name: string, title: string, acct: string, tier: PersonDef['tier'], flags: string[], slack?: number, org62?: 'contact'): PersonDef => ({
  key, name, title, aff: 'customer', acct, tier, slack, org62, flags,
  email: `${name.toLowerCase().replace(/[^a-z ]/g, '').split(' ').join('.')}@${DOMAIN[acct]}`,
});

export const PEOPLE: PersonDef[] = [
  // Vendor side (internal)
  I('owner', 'Rafael Okonkwo', 'Solutions Engineer, Data & AI', 'normal', 1, ['me', 'SE']),
  I('mgr', 'Hana Lindqvist', 'Manager, Solutions Engineering', 'manager', 2, ['manager']),
  I('ae-harbor', 'Theo Brandt', 'Account Executive, Health & Financial Services', 'ae', 3, ['AE']),
  I('ae-commercial', 'Nadia Quraishi', 'Account Executive, Commercial & Public Sector', 'ae', 4, ['AE']),
  I('se-ioana', 'Ioana Petrescu', 'Solutions Engineer', 'teammate', 5, ['SE', 'peer']),
  I('se-tariq', 'Tariq Haddad', 'Solutions Engineer', 'teammate', 6, ['SE', 'peer']),
  I('se-linnea', 'Linnea Vogel', 'Senior Solutions Engineer', 'teammate', 7, ['SE', 'peer']),
  I('spec-gustavo', 'Gustavo Bernal', 'Specialist, Data 360 and Agentforce', 'teammate', 8, ['specialist']),
  I('dir-beatrix', 'Beatrix Oyelaran', 'Regional Vice President, Solutions', 'leader', 9, ['director', 'exec']),
  I('csm-femi', 'Femi Achterberg', 'Customer Success Manager', 'teammate', 10, ['csm']),
  I('deskdesk-yuki', 'Yuki Morimoto', 'Deal Desk Analyst', 'normal', 11, ['deal-desk']),
  // Partner side
  { key: 'ptr-ravindra', name: 'Ravindra Kulkarni', title: 'Principal Architect, Juniper Quay Partners', aff: 'partner', acct: null, tier: 'partner', email: 'ravindra.kulkarni@juniper-quay-partners.example', slack: 12, flags: ['partner'] },
  { key: 'ptr-ines', name: 'Ines Carvalho', title: 'Engagement Manager, Juniper Quay Partners', aff: 'partner', acct: null, tier: 'partner', email: 'ines.carvalho@juniper-quay-partners.example', flags: ['partner'] },
  // Customers
  C('hv-marisol', 'Marisol Quintero', 'Director, Member Experience Analytics', 'saltmere', 'customer', ['champion'], 21, 'contact'),
  C('hv-priyanka', 'Priyanka Deshmukh', 'VP, Data & Analytics', 'saltmere', 'customer_exec', ['exec', 'sponsor'], 22, 'contact'),
  C('hv-gareth', 'Gareth Llewellyn', 'Chief Information Officer', 'saltmere', 'customer_exec', ['exec'], undefined, 'contact'),
  C('hv-soojin', 'Soo-jin Baek', 'Enterprise Architect', 'saltmere', 'customer', ['technical'], 23),
  C('hv-odalys', 'Odalys Crespo', 'Director, Provider Network Operations', 'saltmere', 'customer', [], undefined, 'contact'),
  C('aw-constance', 'Constance Okeke', 'Chief Information Officer', 'yarrowdale', 'customer_exec', ['exec'], undefined, 'contact'),
  C('aw-lars', 'Lars Nyberg', 'Director, Digital Health', 'yarrowdale', 'customer', ['champion'], 24, 'contact'),
  C('awm-amara', 'Amara Diallo', 'VP, Practice Operations', 'yarrowdale-mg', 'customer_exec', ['exec'], 25, 'contact'),
  C('awm-kofi', 'Kofi Asante', 'Manager, Patient Access Systems', 'yarrowdale-mg', 'customer', [], undefined, 'contact'),
  C('awb-rosalind', 'Rosalind Fairweather', 'Chief Clinical Officer', 'yarrowdale-bh', 'customer_exec', ['exec'], undefined, 'contact'),
  C('awb-hugo', 'Hugo Lindahl', 'Intake Program Lead', 'yarrowdale-bh', 'customer', [], 26),
  C('tg-jasmine', 'Jasmine Kowalczyk', 'Chief Data Officer', 'elderglen', 'customer_exec', ['exec'], undefined, 'contact'),
  C('to-brendan', 'Brendan Hartigan', 'VP, eCommerce', 'elderglen-outdoors', 'customer', ['champion', 'renewal-owner'], 27, 'contact'),
  C('to-meiling', 'Mei-Ling Tran', 'Director, CRM Platform', 'elderglen-outdoors', 'customer', ['technical'], 28, 'contact'),
  C('to-kwame', 'Kwame Boateng', 'Senior Analytics Manager', 'elderglen-outdoors', 'customer', [], undefined),
  C('th-dominic', 'Dominic Vasquez', 'Director, Marketing Technology', 'elderglen-home', 'customer', ['champion'], 29, 'contact'),
  C('ns-walter', 'Walter Szymanski', 'VP, Operations', 'halvergate', 'customer_exec', ['exec'], undefined, 'contact'),
  C('ns-anjali', 'Anjali Rao', 'Director, Network Planning', 'halvergate', 'customer', ['champion', 'gone-quiet'], 30, 'contact'),
  C('qp-folasade', 'Folasade Adeyemi', 'Head of Fraud Analytics', 'ferrowpay', 'customer', ['champion'], 31, 'contact'),
  C('qp-isak', 'Isak Bergstrom', 'Chief Technology Officer', 'ferrowpay', 'customer_exec', ['exec'], undefined, 'contact'),
  C('qp-renata', 'Renata Vieira', 'Principal Data Engineer', 'ferrowpay', 'customer', ['technical'], 32),
  C('bw-henrik', 'Henrik Solberg', 'VP, Smart Factory', 'harrowgate', 'customer_exec', ['exec'], 33, 'contact'),
  C('bw-zainab', 'Zainab Farouk', 'Reliability Engineering Lead', 'harrowgate', 'customer', ['champion'], 34, 'contact'),
  C('cc-dolores', 'Dolores Whitcomb', 'County Chief Information Officer', 'cascadia', 'customer_exec', ['exec'], undefined, 'contact'),
  C('cc-samir', 'Samir Banerjee', 'Manager, Digital Services', 'cascadia', 'customer', ['champion', 'onsite-host'], 35, 'contact'),
  C('cc-noor', 'Noor Hakimi', 'Senior Program Analyst', 'cascadia', 'customer', [], undefined),
  C('pc-valentina', 'Valentina Moretti', 'VP, Claims Innovation', 'oakhallow', 'customer_exec', ['exec', 'sponsor'], undefined, 'contact'),
  C('pc-corwin', 'Corwin Aldridge', 'Director, IT Architecture', 'oakhallow', 'customer', ['technical'], 36, 'contact'),
  C('lg-abdullahi', 'Abdullahi Warsame', 'Chief Data Officer', 'voltmere', 'customer_exec', ['exec'], undefined, 'contact'),
  C('lg-petra', 'Petra Novak', 'Director, Grid Analytics', 'voltmere', 'customer', ['watched-contact'], undefined),
  C('cm-julien', 'Julien Marchetti', 'VP, Marketplace Product', 'contoso', 'customer_exec', ['exec'], undefined, 'contact'),
  C('cm-ngozi', 'Ngozi Eze', 'Director, Personalization', 'contoso', 'customer', [], 37),
  // Identity mess (storyline 10)
  { ...C('hv-mari-dup', 'Mari Q.', 'Member Experience (Slack display name)', 'saltmere', 'normal', ['duplicate-merged'], undefined), email: 'mari.q@saltmere-health.example', note: 'Duplicate row for hv-marisol; merged_into_person_id = hv-marisol' },
  // External contact with no account yet (storyline 10)
  { key: 'ext-tobias', name: 'Tobias Reinhardt', title: 'Independent data consultant', aff: 'unknown', acct: null, tier: 'normal', email: 'tobias.reinhardt@example.org', slack: 38, flags: ['external-no-account'], note: 'Joined a shared channel; not tied to any account yet' },
];
