// Aggregates REAL federal data from public sources, server-side (avoids CORS,
// parses XML here, keeps API keys off the client). Returns normalized items
// with real, resolving deep links. Each source is isolated so one failure
// never blanks the feed.
//
// Two-tier relevance:
//  - PRIORITY (starred): item matches Nominal's flagged keyword watchlist (NOMINAL_TAGS).
//  - BROAD feed: every source is defense-scoped (defense agencies, armed-services /
//    appropriations committees, defense orgs, DoD contracts). General-purpose sources
//    (GAO, NASA, DoD news) are filtered to DEFENSE_TERMS so they don't add off-topic noise.

// ── Nominal priority watchlist (drives the ⚑ priority flag & tags) ──
const NOMINAL_TAGS = [
  {label:"HASC",kw:["house armed services","hasc","armed services committee"]},
  {label:"SASC",kw:["senate armed services","sasc"]},
  {label:"HAC-D",kw:["house appropriations","defense subcommittee","hac-d"]},
  {label:"SAC-D",kw:["senate appropriations defense","sac-d","defense appropriations"]},
  {label:"NASA",kw:["nasa","artemis","lunar","jwst","orion"]},
  {label:"Air Force",kw:["air force","usaf","aftc","afrl"]},
  {label:"Space Force",kw:["space force","ussf","guardian","spacecom","space systems command"]},
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

// ── Broad defense-relevance filter (looser than the priority watchlist) ──
const DEFENSE_TERMS = [
  'defense','defence','military','army','navy','air force','space force','marine','pentagon',
  'dod','weapon','missile','hypersonic','nuclear','cyber','autonomous','unmanned','drone',
  'aircraft','warfare','combat','warfighter','intelligence','satellite','radar','munition',
  'artillery','naval','aviation','ndaa','armed services','veteran','darpa','diu','national security',
  'appropriations','procurement','acquisition','shipbuilding','submarine','fighter','squadron',
  'guardian','battalion','brigade','deterrence','homeland','sof ','special operations',
];

// Broad tracked-domain terms: defense PLUS the civilian areas the dashboard
// also tracks (homeland, energy, transportation, AI, science/tech). Used to keep
// general-purpose sources (GAO, committee press) on-topic. Priority flagging still
// comes only from NOMINAL_TAGS — matching these does NOT star an item.
const RELEVANT_TERMS = [
  ...DEFENSE_TERMS,
  // homeland
  'homeland','dhs','border','customs','immigration','cbp','tsa','fema','coast guard','cisa','infrastructure security',
  // energy
  'energy','grid','electric','power plant','renewable','oil','natural gas','pipeline','reactor','doe',
  // transportation
  'transportation','faa','aviation','airport','highway','railway','rail ','transit','vehicle','maritime','port authority','dot',
  // AI
  'artificial intelligence','machine learning','algorithm','automation','large language model',' ai ',
  // science / tech
  'science','technology','research','nsf','nist','quantum','semiconductor','biotech','innovation','spectrum','5g','6g','chips act','r&d',
];

function matchTags(text) {
  const lo = (text || '').toLowerCase();
  return NOMINAL_TAGS.filter(t => t.kw.some(k => lo.includes(k))).map(t => t.label);
}
function isDefenseRelevant(text) {
  const lo = (text || '').toLowerCase();
  return DEFENSE_TERMS.some(k => lo.includes(k));
}
function isTrackedRelevant(text) {
  const lo = (text || '').toLowerCase();
  return RELEVANT_TERMS.some(k => lo.includes(k));
}

function stripHtml(s) {
  return (s || '')
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#160;|&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#8217;|&#8216;|&#039;|&apos;/g, "'").replace(/&#8220;|&#8221;|&quot;/g, '"')
    .replace(/&#8211;|&#8212;/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}
function xtag(el, name) {
  const m = el.match(new RegExp('<' + name + '[^>]*>([\\s\\S]*?)</' + name + '>', 'i'));
  return m ? m[1] : '';
}
function parseRssItems(xml) {
  return (xml.match(/<item>([\s\S]*?)<\/item>/gi) || []).map(block => ({
    title: stripHtml(xtag(block, 'title')),
    link: stripHtml(xtag(block, 'link')),
    pubDate: stripHtml(xtag(block, 'pubDate')),
    description: stripHtml(xtag(block, 'description')),
  }));
}
async function fetchWithTimeout(url, opts = {}, ms = 11000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal, headers: { 'User-Agent': 'NominalFederalDashboard/1.0', ...(opts.headers || {}) } });
  } finally { clearTimeout(t); }
}
// source = sidebar bucket (controls color + filtering); label = badge text shown on the card.
function mk(source, label, type, title, url, summary, publishedAt) {
  return { source, label, type, title, url, summary, publishedAt, tags: matchTags(title + ' ' + summary) };
}
function iso(d) { return d ? new Date(d).toISOString() : new Date().toISOString(); }

// helper: fetch an RSS feed, map to items, optionally require defense relevance
async function rssSource({ url, source, label, type, limit, requireDefense }) {
  const r = await fetchWithTimeout(url);
  const xml = await r.text();
  let items = parseRssItems(xml).filter(x => x.title && x.link);
  if (requireDefense) items = items.filter(x => isDefenseRelevant(x.title + ' ' + x.description));
  return items.slice(0, limit).map(x =>
    mk(source, label, type, x.title, x.link, x.description.slice(0, 200), iso(x.pubDate)));
}

// ── Federal Register: documents from defense agencies ────────
async function getFederalRegister() {
  const qs = new URLSearchParams({ per_page: '6', order: 'newest' });
  ['title','abstract','html_url','publication_date','type'].forEach(f => qs.append('fields[]', f));
  ['defense-department','air-force-department','navy-department','army-department']
    .forEach(a => qs.append('conditions[agencies][]', a));
  const r = await fetchWithTimeout('https://www.federalregister.gov/api/v1/documents.json?' + qs.toString());
  const d = await r.json();
  const tmap = { 'Rule':'rule','Proposed Rule':'rule','Notice':'rule','Presidential Document':'executive' };
  return (d.results || []).map(x =>
    mk('federal-register','FED REG', tmap[x.type]||'rule', x.title, x.html_url, x.abstract||x.title, iso(x.publication_date + 'T12:00:00Z')));
}

// ── White House: presidential documents (exec orders etc.) ───
async function getWhiteHouse() {
  const qs = new URLSearchParams({ per_page: '3', order: 'newest' });
  ['title','abstract','html_url','publication_date','type'].forEach(f => qs.append('fields[]', f));
  qs.append('conditions[type][]', 'PRESDOCU');
  const r = await fetchWithTimeout('https://www.federalregister.gov/api/v1/documents.json?' + qs.toString());
  const d = await r.json();
  return (d.results || []).map(x =>
    mk('white-house','WHITE HOUSE','executive', x.title, x.html_url, x.abstract||x.title, iso(x.publication_date + 'T12:00:00Z')));
}

// ── Federal Register by agency (civilian tracked domains) ────
async function frByAgencies({ agencies, source, label, perPage = 4 }) {
  const qs = new URLSearchParams({ per_page: String(perPage), order: 'newest' });
  ['title','abstract','html_url','publication_date','type'].forEach(f => qs.append('fields[]', f));
  agencies.forEach(a => qs.append('conditions[agencies][]', a));
  const r = await fetchWithTimeout('https://www.federalregister.gov/api/v1/documents.json?' + qs.toString());
  const d = await r.json();
  const tmap = { 'Rule':'rule','Proposed Rule':'rule','Notice':'rule','Presidential Document':'executive' };
  return (d.results || []).map(x =>
    mk(source, label, tmap[x.type] || 'rule', x.title, x.html_url, x.abstract || x.title, iso(x.publication_date + 'T12:00:00Z')));
}
const getHomeland       = () => frByAgencies({ agencies:['homeland-security-department'], source:'homeland', label:'HOMELAND', perPage:4 });
const getEnergy         = () => frByAgencies({ agencies:['energy-department','federal-energy-regulatory-commission'], source:'energy', label:'ENERGY', perPage:4 });
const getTransportation = () => frByAgencies({ agencies:['transportation-department','federal-aviation-administration'], source:'transportation', label:'TRANSPORT', perPage:4 });
const getScience        = () => frByAgencies({ agencies:['national-science-foundation','national-institute-of-standards-and-technology'], source:'science', label:'SCI/TECH', perPage:4 });

// ── AI: Federal Register full-text "artificial intelligence" ─
// FR term search matches full text, so post-filter to items whose title/abstract
// actually concern AI (drops docs that merely mention AI in passing).
async function getAI() {
  const qs = new URLSearchParams({ per_page: '10', order: 'newest' });
  ['title','abstract','html_url','publication_date','type'].forEach(f => qs.append('fields[]', f));
  qs.append('conditions[term]', 'artificial intelligence');
  const r = await fetchWithTimeout('https://www.federalregister.gov/api/v1/documents.json?' + qs.toString());
  const d = await r.json();
  const aiRe = /artificial intelligence|machine learning|\bA\.?I\.?\b|algorithm|automated decision/i;
  return (d.results || [])
    .filter(x => aiRe.test((x.title || '') + ' ' + (x.abstract || '')))
    .slice(0, 4)
    .map(x => mk('ai', 'AI', 'rule', x.title, x.html_url, x.abstract || x.title, iso(x.publication_date + 'T12:00:00Z')));
}

// ── DoD: recent large contract awards via USAspending ────────
async function getDoDContracts() {
  const fmt = d => d.toISOString().slice(0, 10);
  const body = {
    filters: {
      award_type_codes: ['A','B','C','D'],
      agencies: [{ type:'awarding', tier:'toptier', name:'Department of Defense' }],
      time_period: [{ start_date: fmt(new Date(Date.now() - 30*24*60*60*1000)), end_date: fmt(new Date()) }],
    },
    fields: ['Award ID','Recipient Name','Award Amount','Description','generated_internal_id','Start Date'],
    limit: 6, sort: 'Award Amount', order: 'desc',
  };
  const r = await fetchWithTimeout('https://api.usaspending.gov/api/v2/search/spending_by_award/', {
    method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body),
  });
  const d = await r.json();
  return (d.results || []).map(x => {
    const amt = x['Award Amount'] ? '$' + Number(x['Award Amount']).toLocaleString('en-US',{maximumFractionDigits:0}) : '';
    const recip = x['Recipient Name'] || 'Unknown recipient';
    return mk('dod','DOD CONTRACT','contract',
      `${recip} — ${amt} DoD contract`,
      'https://www.usaspending.gov/award/' + encodeURIComponent(x.generated_internal_id),
      (x.Description || `Contract award ${x['Award ID']||''} to ${recip}.`).slice(0,200),
      iso(x['Start Date'] ? x['Start Date'] + 'T12:00:00Z' : null));
  });
}

// ── DoD / defense-org news feeds (ArticleCS + DARPA RSS) ─────
const getDoDNews    = () => rssSource({ url:'https://www.defense.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=9&Site=945&max=10', source:'dod', label:'DOD NEWS', type:'report', limit:5, requireDefense:false });
const getDARPA      = () => rssSource({ url:'https://www.darpa.mil/rss.xml', source:'dod', label:'DARPA', type:'report', limit:5, requireDefense:false });
const getSpaceForce = () => rssSource({ url:'https://www.spaceforce.mil/DesktopModules/ArticleCS/RSS.ashx?ContentType=1&Site=1060&max=10', source:'dod', label:'SPACE FORCE', type:'report', limit:5, requireDefense:false });
const getAirForce   = () => rssSource({ url:'https://www.af.mil/DesktopModules/ArticleCS/RSS.ashx?ContentType=1&Site=1&max=10', source:'dod', label:'AIR FORCE', type:'report', limit:4, requireDefense:true });

// ── House Appropriations press releases — tracked domains (defense, homeland,
//    energy, transportation, science); drops off-topic subcommittees (Labor/HHS/Ag) ──
async function getHouseApprops() {
  const r = await fetchWithTimeout('https://appropriations.house.gov/rss.xml');
  const xml = await r.text();
  return parseRssItems(xml)
    .filter(x => x.title && x.link && isTrackedRelevant(x.title + ' ' + x.description))
    .slice(0, 6)
    .map(x => mk('congress', 'HOUSE APPROPS', 'hearing', x.title, x.link, x.description.slice(0, 200), iso(x.pubDate)));
}

// ── Congress: recent bills, filtered to defense relevance (needs free key) ──
async function getCongress() {
  const key = process.env.CONGRESS_API_KEY;
  if (!key) return [];
  const billTypeName = { hr:'house-bill', s:'senate-bill', hjres:'house-joint-resolution', sjres:'senate-joint-resolution', hconres:'house-concurrent-resolution', sconres:'senate-concurrent-resolution', hres:'house-resolution', sres:'senate-resolution' };
  const out = [];
  try {
    const r = await fetchWithTimeout(`https://api.congress.gov/v3/bill?limit=40&sort=updateDate+desc&api_key=${key}`);
    const d = await r.json();
    (d.bills || []).forEach(b => {
      const action = (b.latestAction && b.latestAction.text) ? b.latestAction.text : '';
      const blob = `${b.title || ''} ${action}`;
      if (!isDefenseRelevant(blob)) return; // keep only defense-relevant legislation
      const typeName = billTypeName[(b.type || '').toLowerCase()] || (b.type || '').toLowerCase();
      const url = `https://www.congress.gov/bill/${b.congress}th-congress/${typeName}/${b.number}`;
      out.push(mk('congress','CONGRESS','hearing',
        `${(b.type || '').toUpperCase()} ${b.number}: ${b.title}`, url, action || b.title,
        iso(b.latestAction && b.latestAction.actionDate ? b.latestAction.actionDate + 'T12:00:00Z' : null)));
    });
  } catch (e) { /* isolate */ }
  return out.slice(0, 8);
}

// ── HASC / SASC: recent committee hearings & markups (Congress.gov API) ──
// Armed Services committees have no RSS; the API lists committee meetings but
// individual meetings lack stable public pages, so each links to the committee's
// hearings page (a real, resolving page) while the title reflects the specific event.
async function getArmedServices() {
  const key = process.env.CONGRESS_API_KEY;
  if (!key) return [];
  const targets = [
    { chamber: 'house',  code: 'hsas00', label: 'HASC', page: 'https://armedservices.house.gov/committee-activity/hearings' },
    { chamber: 'senate', code: 'ssas00', label: 'SASC', page: 'https://www.armed-services.senate.gov/hearings' },
  ];
  const out = [];
  for (const t of targets) {
    try {
      const listR = await fetchWithTimeout(`https://api.congress.gov/v3/committee-meeting/119/${t.chamber}?limit=6&api_key=${key}`);
      const list = await listR.json();
      const meetings = list.committeeMeetings || [];
      let added = 0;
      for (const m of meetings) {
        if (added >= 3 || !m.url) continue;
        try {
          const detailUrl = m.url + (m.url.includes('?') ? '&' : '?') + 'api_key=' + key;
          const dR = await fetchWithTimeout(detailUrl);
          const d = await dR.json();
          const cm = d.committeeMeeting || {};
          const comms = cm.committees || [];
          const isArmed = comms.some(c => (c.systemCode || '').toLowerCase() === t.code || /armed services/i.test(c.name || ''));
          if (!isArmed) continue;
          const title = cm.title || `${t.label} committee meeting`;
          out.push(mk('congress', t.label, 'hearing', `${t.label}: ${title}`, t.page, title, iso(cm.date || m.updateDate)));
          added++;
        } catch (e) { /* skip this meeting */ }
      }
    } catch (e) { /* isolate chamber */ }
  }
  return out;
}

// ── NASA: news, filtered to space/defense relevance ──────────
const getNASA = () => rssSource({ url:'https://www.nasa.gov/news-release/feed/', source:'nasa', label:'NASA', type:'report', limit:4, requireDefense:false })
  .then(items => {
    // NASA news is broad; keep space/tech/defense-relevant, drop pure earth-science photos
    const NASA_KEEP = ['space force','national security','defense','satellite','launch','artemis','moon','mars','rocket','orbit','spacecraft','mission','technology','propulsion','contract','award'];
    return items.filter(i => NASA_KEEP.some(k => (i.title + ' ' + i.summary).toLowerCase().includes(k)));
  });

// ── GAO: reports, filtered to tracked domains (defense + civilian) ──
async function getGAO() {
  const r = await fetchWithTimeout('https://www.gao.gov/rss/reports.xml');
  const xml = await r.text();
  return parseRssItems(xml)
    .filter(x => x.title && x.link && isTrackedRelevant(x.title + ' ' + x.description))
    .slice(0, 6)
    .map(x => mk('gao', 'GAO', 'report', x.title, x.link, x.description.slice(0, 200), iso(x.pubDate)));
}

// ── SCOTUS: no clean feed — link to the real slip-opinions page
function getSCOTUS() {
  return [mk('scotus','SCOTUS','decision',
    'Supreme Court — latest slip opinions (October Term 2025)',
    'https://www.supremecourt.gov/opinions/slipopinion/25',
    'Official list of the most recent Supreme Court slip opinions. No machine-readable feed exists, so this links to the live opinions page.',
    new Date().toISOString())];
}

export default async function handler(req, res) {
  const sources = [
    ['federal-register', getFederalRegister],
    ['white-house', getWhiteHouse],
    ['dod', getDoDContracts],
    ['dod', getDoDNews],
    ['dod', getDARPA],
    ['dod', getSpaceForce],
    ['dod', getAirForce],
    ['congress', getCongress],
    ['congress', getArmedServices],
    ['congress', getHouseApprops],
    ['nasa', getNASA],
    ['gao', getGAO],
    ['homeland', getHomeland],
    ['energy', getEnergy],
    ['transportation', getTransportation],
    ['ai', getAI],
    ['science', getScience],
    ['scotus', async () => getSCOTUS()],
  ];
  const settled = await Promise.allSettled(sources.map(([, fn]) => fn()));
  const items = [];
  const sourceStatus = {};
  settled.forEach((s, i) => {
    const id = sources[i][0];
    const n = (s.status === 'fulfilled' && Array.isArray(s.value)) ? s.value.length : 0;
    if (n) items.push(...s.value);
    sourceStatus[id] = (sourceStatus[id] || 0) + n;
  });
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  res.status(200).json({ items, sourceStatus, fetchedAt: new Date().toISOString() });
}
