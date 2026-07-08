// SAM.gov active contract opportunities (solicitations / RFPs), defense-filtered.
// SEPARATE endpoint with a long (6h) cache on purpose: SAM.gov rate-limits hard
// (1,000 requests/day for entity accounts), so this must NOT be folded into the
// 5-minute /api/feed. Long caching keeps origin calls to a few per day.

const NOMINAL_TAGS = [
  {label:"HASC",kw:["house armed services","hasc"]},
  {label:"SASC",kw:["senate armed services","sasc"]},
  {label:"Space Force",kw:["space force","ussf","guardian"]},
  {label:"Air Force",kw:["air force","usaf","aftc"]},
  {label:"Navy",kw:["navy","naval","navair","navsea"]},
  {label:"Army",kw:["army"]},
  {label:"NASA",kw:["nasa","artemis","lunar"]},
  {label:"Autonomous",kw:["autonomous","autonomy","unmanned","uncrewed"]},
  {label:"DIU",kw:["diu","defense innovation unit"]},
  {label:"DARPA",kw:["darpa"]},
  {label:"MACH-TB",kw:["mach-tb","hypersonic testbed","hypersonic"]},
  {label:"Golden Dome",kw:["golden dome","missile defense"]},
  {label:"MQ-25",kw:["mq-25","stingray"]},
  {label:"T&E",kw:["test and evaluation","operational test"]},
  {label:"Software",kw:["software acquisition","devsecops","software pathway"]},
  {label:"RDT&E",kw:["rdt&e","research development test"]},
  {label:"Right to Repair",kw:["right to repair"]},
];
function matchTags(text) {
  const lo = (text || '').toLowerCase();
  return NOMINAL_TAGS.filter(t => t.kw.some(k => lo.includes(k))).map(t => t.label);
}
// Defense-tech relevance for including an opportunity (matched against the TITLE).
const RELEVANT = [
  'missile','hypersonic','radar','aircraft','rotorcraft','avionics','munition','armament','weapon',
  'warfighter','autonomous','autonomy','unmanned','drone','uas','satellite','space','orbital','launch',
  'isr','c4isr','surveillance','reconnaissance','electronic warfare','guidance','targeting','navigation',
  'naval','submarine','shipboard','nuclear','cyber','artificial intelligence','machine learning',
  'quantum','semiconductor','microelectronic','sensor','propulsion','directed energy','laser',
  'test and evaluation','rdt&e','research and development','prototype','sbir','sttr','modernization',
  'simulation','modeling','systems engineering','integration','command and control','tactical','combat',
  'counter-uas','counter uas','space vehicle','ground system','mission system','software development',
];
// Defense-tech / R&D NAICS codes — an opportunity in one of these industries is
// relevant regardless of title wording.
const TECH_NAICS = new Set([
  '541715','541713','541714','541712','541330','541380','541511','541512','541519',
  '336411','336412','336413','336414','336415','336419','334511','334220','334290',
  '334413','334516','336611','336612','541690','541990','927110','928110','541360',
]);
function relevant(text) {
  const lo = (text || '').toLowerCase();
  return RELEVANT.some(k => lo.includes(k));
}

export default async function handler(req, res) {
  const key = process.env.SAM_API_KEY;
  if (!key) {
    res.setHeader('Cache-Control', 's-maxage=60');
    return res.status(200).json({ items: [], note: 'SAM_API_KEY not set' });
  }
  const pad = n => String(n).padStart(2, '0');
  const fmt = d => `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`;
  const to = new Date();
  const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const url = `https://api.sam.gov/opportunities/v2/search?api_key=${encodeURIComponent(key)}&postedFrom=${fmt(from)}&postedTo=${fmt(to)}&limit=500`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'NominalFederalDashboard/1.0', 'Accept': 'application/json' } });
    if (!r.ok) {
      res.setHeader('Cache-Control', 's-maxage=300');
      return res.status(200).json({ items: [], error: 'SAM.gov HTTP ' + r.status });
    }
    const d = await r.json();
    const raw = d.opportunitiesData || [];
    const items = raw
      // Require topical defense-tech relevance in the TITLE, or a defense-tech/R&D
      // NAICS code. (Being posted by a DoD office isn't enough — that lets through
      // mundane parts/janitorial/scrap solicitations.)
      .filter(o => relevant(o.title || '') || TECH_NAICS.has(String(o.naicsCode || '')))
      .slice(0, 25)
      .map(o => {
        const org = (o.fullParentPathName || o.department || '').split('.')[0];
        const due = o.responseDeadLine ? ' · response due ' + String(o.responseDeadLine).slice(0, 10) : '';
        const naics = o.naicsCode ? ' · NAICS ' + o.naicsCode : '';
        const link = o.uiLink || (o.noticeId ? `https://sam.gov/opp/${o.noticeId}/view` : 'https://sam.gov/search');
        return {
          source: 'opportunities',
          label: 'SAM.gov',
          type: 'contract',
          title: o.title || '(untitled opportunity)',
          url: link,
          summary: `${o.type || 'Opportunity'}${org ? ' · ' + org : ''}${due}${naics}`,
          publishedAt: o.postedDate || new Date().toISOString(),
          tags: matchTags(`${o.title || ''} ${org}`),
        };
      });
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400'); // 6h fresh, 24h stale
    res.status(200).json({ items, total: raw.length, fetchedAt: new Date().toISOString() });
  } catch (e) {
    res.setHeader('Cache-Control', 's-maxage=300');
    res.status(200).json({ items: [], error: String(e) });
  }
}
