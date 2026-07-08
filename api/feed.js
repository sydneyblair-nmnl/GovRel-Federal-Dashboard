// Aggregates REAL federal data from public sources, server-side (avoids CORS,
// parses XML here, keeps any API keys off the client). Returns normalized items
// with real, resolving deep links. Each source is isolated so one failure
// never blanks the feed.

const NOMINAL_TAGS = [
  {label:"HASC",kw:["house armed services","hasc","armed services committee"]},
  {label:"SASC",kw:["senate armed services","sasc"]},
  {label:"HAC-D",kw:["house appropriations","defense subcommittee","hac-d"]},
  {label:"SAC-D",kw:["senate appropriations defense","sac-d","defense appropriations"]},
  {label:"NASA",kw:["nasa","artemis","lunar","jwst","orion"]},
  {label:"Air Force",kw:["air force","usaf","aftc","afrl"]},
  {label:"Space Force",kw:["space force","ussf","guardian","spacecom"]},
  {label:"Army",kw:["army","soldier"]},
  {label:"Navy",kw:["navy","naval","navair","navsea","nswc"]},
  {label:"Dept of Energy",kw:["department of energy","nuclear","nnsa","sandia","los alamos"]},
  {label:"Data",kw:["data sharing","data management","cdao","chief digital","data strategy"]},
  {label:"T&E",kw:["test and evaluation","test & evaluation","operational test"]},
  {label:"Software",kw:["software acquisition","software development","devsecops","software pathway"]},
  {label:"TRMC",kw:["trmc","test resource management","test range"]},
  {label:"MQ-25",kw:["mq-25","stingray","aerial refueling"]},
  {label:"Autonomous",kw:["autonomous","autonomy","unmanned","uncrewed"]},
  {label:"DIU",kw:["diu","defense innovation unit"]},
  {label:"MACH-TB",kw:["mach-tb","hypersonic testbed","hypersonic"]},
  {label:"Golden Dome",kw:["golden dome","missile defense","homeland defense"]},
  {label:"Gray Flag",kw:["gray flag","grey flag"]},
  {label:"DARPA",kw:["darpa"]},
  {label:"NTDC",kw:["ntdc","naval test"]},
  {label:"PACOM",kw:["pacom","indopacom","pacific command","pacific fleet"]},
  {label:"NAVAIR",kw:["navair","naval air systems"]},
  {label:"Right to Repair",kw:["right to repair","repair rights"]},
  {label:"AFTC",kw:["aftc","air force test center","edwards afb"]},
  {label:"Test Pilot",kw:["test pilot","test pilot school"]},
  {label:"RDT&E",kw:["rdt&e","research development test","research, development, test"]},
];

function matchTags(text) {
  const lo = (text || '').toLowerCase();
  return NOMINAL_TAGS.filter(t => t.kw.some(k => lo.includes(k))).map(t => t.label);
}

function stripHtml(s) {
  return (s || '')
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#160;|&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#8217;|&#8216;/g, "'").replace(/&#8220;|&#8221;/g, '"')
    .replace(/&#8211;|&#8212;/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function tag(el, name) {
  const m = el.match(new RegExp('<' + name + '[^>]*>([\\s\\S]*?)</' + name + '>', 'i'));
  return m ? m[1] : '';
}

function parseRssItems(xml) {
  return (xml.match(/<item>([\s\S]*?)<\/item>/gi) || []).map(block => ({
    title: stripHtml(tag(block, 'title')),
    link: stripHtml(tag(block, 'link')),
    pubDate: stripHtml(tag(block, 'pubDate')),
    description: stripHtml(tag(block, 'description')),
  }));
}

async function fetchWithTimeout(url, opts = {}, ms = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal, headers: { 'User-Agent': 'NominalFederalDashboard/1.0', ...(opts.headers || {}) } });
  } finally {
    clearTimeout(t);
  }
}

function item(source, label, type, title, url, summary, publishedAt) {
  const tags = matchTags(title + ' ' + summary);
  return { source, label, type, title, url, summary, publishedAt, tags };
}

// ── Federal Register: documents from defense agencies ────────
async function getFederalRegister() {
  const fields = ['title', 'abstract', 'html_url', 'publication_date', 'type', 'document_number'];
  const qs = new URLSearchParams({ per_page: '8', order: 'newest' });
  fields.forEach(f => qs.append('fields[]', f));
  // Filter by defense agencies (guarantees DoD provenance) rather than a loose text search.
  ['defense-department', 'air-force-department', 'navy-department', 'army-department']
    .forEach(a => qs.append('conditions[agencies][]', a));
  const r = await fetchWithTimeout('https://www.federalregister.gov/api/v1/documents.json?' + qs.toString());
  const d = await r.json();
  const typeMap = { 'Rule': 'rule', 'Proposed Rule': 'rule', 'Notice': 'rule', 'Presidential Document': 'executive' };
  return (d.results || []).map(x =>
    item('federal-register', 'FED REG', typeMap[x.type] || 'rule',
      x.title, x.html_url, x.abstract || x.title, x.publication_date + 'T12:00:00Z'));
}

// ── White House: presidential documents (exec orders etc.) ───
async function getWhiteHouse() {
  const fields = ['title', 'abstract', 'html_url', 'publication_date', 'type'];
  const qs = new URLSearchParams({ per_page: '4', order: 'newest' });
  fields.forEach(f => qs.append('fields[]', f));
  qs.append('conditions[type][]', 'PRESDOCU');
  const r = await fetchWithTimeout('https://www.federalregister.gov/api/v1/documents.json?' + qs.toString());
  const d = await r.json();
  return (d.results || []).map(x =>
    item('white-house', 'WHITE HOUSE', 'executive',
      x.title, x.html_url, x.abstract || x.title, x.publication_date + 'T12:00:00Z'));
}

// ── DoD: recent large contract awards via USAspending ────────
async function getDoD() {
  const end = new Date();
  const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const fmt = d => d.toISOString().slice(0, 10);
  const body = {
    filters: {
      award_type_codes: ['A', 'B', 'C', 'D'],
      agencies: [{ type: 'awarding', tier: 'toptier', name: 'Department of Defense' }],
      time_period: [{ start_date: fmt(start), end_date: fmt(end) }],
    },
    fields: ['Award ID', 'Recipient Name', 'Award Amount', 'Description', 'generated_internal_id', 'Start Date'],
    limit: 8,
    sort: 'Award Amount',
    order: 'desc',
  };
  const r = await fetchWithTimeout('https://api.usaspending.gov/api/v2/search/spending_by_award/', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const d = await r.json();
  return (d.results || []).map(x => {
    const amt = x['Award Amount'] ? '$' + Number(x['Award Amount']).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '';
    const recip = x['Recipient Name'] || 'Unknown recipient';
    const desc = (x.Description || '').slice(0, 180);
    return item('dod', 'DOD', 'contract',
      `${recip} awarded ${amt} DoD contract`,
      'https://www.usaspending.gov/award/' + encodeURIComponent(x.generated_internal_id),
      desc || `Contract award ${x['Award ID'] || ''} to ${recip}.`,
      (x['Start Date'] ? x['Start Date'] + 'T12:00:00Z' : new Date().toISOString()));
  });
}

// ── NASA: latest news releases (RSS) ─────────────────────────
async function getNASA() {
  const r = await fetchWithTimeout('https://www.nasa.gov/news-release/feed/');
  const xml = await r.text();
  return parseRssItems(xml).slice(0, 6).map(x =>
    item('nasa', 'NASA', 'report', x.title, x.link, x.description.slice(0, 180),
      x.pubDate ? new Date(x.pubDate).toISOString() : new Date().toISOString()));
}

// ── GAO: latest reports (RSS) ────────────────────────────────
async function getGAO() {
  const r = await fetchWithTimeout('https://www.gao.gov/rss/reports.xml');
  const xml = await r.text();
  return parseRssItems(xml).slice(0, 8).map(x =>
    item('gao', 'GAO', 'report', x.title, x.link, x.description.slice(0, 180),
      x.pubDate ? new Date(x.pubDate).toISOString() : new Date().toISOString()));
}

// ── Congress: recent bills + hearings (needs free API key) ───
async function getCongress() {
  const key = process.env.CONGRESS_API_KEY;
  if (!key) return []; // gracefully absent until key is set
  const billTypeName = { hr: 'house-bill', s: 'senate-bill', hjres: 'house-joint-resolution', sjres: 'senate-joint-resolution', hconres: 'house-concurrent-resolution', sconres: 'senate-concurrent-resolution', hres: 'house-resolution', sres: 'senate-resolution' };
  const out = [];
  try {
    const r = await fetchWithTimeout(`https://api.congress.gov/v3/bill?limit=10&sort=updateDate+desc&api_key=${key}`);
    const d = await r.json();
    (d.bills || []).forEach(b => {
      const congress = b.congress;
      const typeName = billTypeName[(b.type || '').toLowerCase()] || (b.type || '').toLowerCase();
      const url = `https://www.congress.gov/bill/${congress}th-congress/${typeName}/${b.number}`;
      const summary = (b.latestAction && b.latestAction.text) ? b.latestAction.text : (b.title || '');
      out.push(item('congress', 'CONGRESS', 'hearing', `${(b.type || '').toUpperCase()} ${b.number}: ${b.title}`, url, summary,
        (b.latestAction && b.latestAction.actionDate ? b.latestAction.actionDate + 'T12:00:00Z' : new Date().toISOString())));
    });
  } catch (e) { /* isolate */ }
  return out;
}

// ── SCOTUS: no clean feed — link to the real slip-opinions page
function getSCOTUS() {
  const term = '25'; // October Term 2025
  return [item('scotus', 'SCOTUS', 'decision',
    'Supreme Court — latest slip opinions (October Term 2025)',
    `https://www.supremecourt.gov/opinions/slipopinion/${term}`,
    'Official list of the most recent Supreme Court slip opinions. No machine-readable feed exists, so this links to the live opinions page.',
    new Date().toISOString())];
}

export default async function handler(req, res) {
  const sources = [
    ['federal-register', getFederalRegister],
    ['white-house', getWhiteHouse],
    ['dod', getDoD],
    ['nasa', getNASA],
    ['gao', getGAO],
    ['congress', getCongress],
    ['scotus', async () => getSCOTUS()],
  ];
  const settled = await Promise.allSettled(sources.map(([, fn]) => fn()));
  const items = [];
  const sourceStatus = {};
  settled.forEach((s, i) => {
    const id = sources[i][0];
    if (s.status === 'fulfilled' && Array.isArray(s.value)) {
      items.push(...s.value);
      sourceStatus[id] = s.value.length;
    } else {
      sourceStatus[id] = 0;
    }
  });
  // Short cache at the CDN edge so all users share one upstream fetch per few minutes.
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  res.status(200).json({ items, sourceStatus, fetchedAt: new Date().toISOString() });
}
