// Live Congress tab: recent Senate votes (senate.gov XML), recent House votes
// (House Clerk roll-call XML), upcoming committee hearings (Congress.gov API,
// needs CONGRESS_API_KEY), and HASC/SASC/HAC-D/SAC-D key members
// (theunitedstates.io roster + committee membership, free).

const CONGRESS = 119, SESSION = 2, YEAR = 2026;
const NOMINAL_TAGS = [
  {label:'HASC',kw:['armed services']},{label:'SASC',kw:['armed services']},
  {label:'Space Force',kw:['space force']},{label:'DARPA',kw:['darpa']},
  {label:'Autonomous',kw:['autonomous','unmanned','uncrewed']},{label:'Missile Defense',kw:['missile defense','golden dome']},
  {label:'Hypersonic',kw:['hypersonic']},{label:'RDT&E',kw:['research','development','rdt&e']},
  {label:'Right to Repair',kw:['right to repair']},{label:'Nuclear',kw:['nuclear']},
  {label:'Shipbuilding',kw:['shipbuilding','submarine','naval']},{label:'NDAA',kw:['ndaa','national defense authorization']},
];
function matchTags(t){ const lo=(t||'').toLowerCase(); return [...new Set(NOMINAL_TAGS.filter(x=>x.kw.some(k=>lo.includes(k))).map(x=>x.label))]; }

async function fetchText(url, opts = {}, ms = 12000) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), ms);
  try { const r = await fetch(url, { ...opts, signal: ctrl.signal, headers: { 'User-Agent': 'NominalGRDashboard/1.0', ...(opts.headers||{}) } }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.text(); }
  finally { clearTimeout(t); }
}
const fetchJSON = async (u, o, ms) => JSON.parse(await fetchText(u, { headers: { Accept: 'application/json' }, ...(o||{}) }, ms));
function tag(xml, name) { const m = xml.match(new RegExp('<' + name + '[^>]*>([\\s\\S]*?)</' + name + '>', 'i')); return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g,'').replace(/\s+/g,' ').trim() : ''; }
function num(s){ const n=parseInt(s,10); return isNaN(n)?0:n; }

// ── Senate votes (senate.gov roll-call menu XML) ─────────────
async function senateVotes() {
  const xml = await fetchText(`https://www.senate.gov/legislative/LIS/roll_call_lists/vote_menu_${CONGRESS}_${SESSION}.xml`);
  const blocks = (xml.match(/<vote>[\s\S]*?<\/vote>/gi) || []).slice(0, 6);
  return blocks.map(b => {
    const n = tag(b, 'vote_number');
    const title = tag(b, 'title') || tag(b, 'issue');
    const result = tag(b, 'result');
    const y = num(tag(b, 'yeas')), na = num(tag(b, 'nays'));
    return {
      title, chamber: 'senate', number: n,
      result, y, n: na,
      date: tag(b, 'vote_date'),
      url: `https://www.senate.gov/legislative/LIS/roll_call_votes/vote${CONGRESS}${SESSION}/vote_${CONGRESS}_${SESSION}_${n}.htm`,
      tags: matchTags(title),
    };
  });
}

// ── House votes (House Clerk roll-call XML) ──────────────────
async function houseVotes() {
  const idx = await fetchText(`https://clerk.house.gov/evs/${YEAR}/index.asp`);
  const group = Math.max(0, ...(idx.match(/ROLL_(\d+)/g) || ['ROLL_0']).map(s => num(s.slice(5))));
  const groupHtml = await fetchText(`https://clerk.house.gov/evs/${YEAR}/ROLL_${String(group).padStart(3, '0')}.asp`);
  const rolls = [...new Set((groupHtml.match(/roll(\d{3,4})\.xml/gi) || []).map(s => num(s.replace(/roll|\.xml/gi, ''))))]
    .sort((a, b) => b - a).slice(0, 5);
  const out = [];
  for (const roll of rolls) {
    try {
      const x = await fetchText(`https://clerk.house.gov/evs/${YEAR}/roll${String(roll).padStart(3, '0')}.xml`);
      const title = (tag(x, 'vote-desc') || tag(x, 'legis-num') + ' — ' + tag(x, 'vote-question')).trim();
      out.push({
        title, chamber: 'house', number: String(roll),
        result: tag(x, 'vote-result'),
        y: num(tag(x, 'yea-total')), n: num(tag(x, 'nay-total')),
        date: tag(x, 'action-date'),
        url: `https://clerk.house.gov/Votes/${YEAR}${roll}`,
        tags: matchTags(title + ' ' + tag(x, 'legis-num')),
      });
    } catch (e) { /* skip */ }
  }
  return out;
}

// ── Upcoming/recent committee hearings (Congress.gov API) ────
// Defense committees we track: HASC, SASC, HAC-D, SAC-D.
const HEARING_COMMS = {
  hsas00: 'HASC', ssas00: 'SASC', hsap02: 'HAC-D', ssap02: 'SAC-D',
};
async function hearings() {
  const key = process.env.CONGRESS_API_KEY;
  if (!key) return [];
  const out = [];
  for (const chamber of ['house', 'senate']) {
    try {
      const list = await fetchJSON(`https://api.congress.gov/v3/committee-meeting/${CONGRESS}/${chamber}?limit=15&api_key=${key}`);
      let checked = 0;
      for (const m of (list.committeeMeetings || [])) {
        if (checked >= 10 || !m.url) continue; checked++;
        try {
          const d = await fetchJSON(m.url + (m.url.includes('?') ? '&' : '?') + 'api_key=' + key);
          const cm = d.committeeMeeting || {};
          const codes = (cm.committees || []).map(c => (c.systemCode || '').toLowerCase());
          const hit = codes.find(c => HEARING_COMMS[c]);
          if (!hit) continue;
          const page = chamber === 'house'
            ? (HEARING_COMMS[hit] === 'HAC-D' ? 'https://appropriations.house.gov/subcommittees/defense-116th-congress' : 'https://armedservices.house.gov/committee-activity/hearings')
            : (HEARING_COMMS[hit] === 'SAC-D' ? 'https://www.appropriations.senate.gov/hearings' : 'https://www.armed-services.senate.gov/hearings');
          out.push({
            committee: HEARING_COMMS[hit],
            title: cm.title || `${HEARING_COMMS[hit]} committee meeting`,
            date: (cm.date || '').slice(0, 10), time: (cm.date || '').slice(11, 16),
            url: page, tags: matchTags(cm.title || ''),
          });
          if (out.length >= 6) break;
        } catch (e) { /* skip meeting */ }
      }
    } catch (e) { /* skip chamber */ }
    if (out.length >= 6) break;
  }
  return out;
}

// ── Key members: HASC/SASC/HAC-D/SAC-D leadership (free roster) ──
const MEMBER_COMMS = { HSAS: 'HASC', SSAS: 'SASC', HSAP02: 'HAC-D', SSAP02: 'SAC-D' };
async function keyMembers() {
  const [leg, comm] = await Promise.all([
    fetchJSON('https://unitedstates.github.io/congress-legislators/legislators-current.json'),
    fetchJSON('https://unitedstates.github.io/congress-legislators/committee-membership-current.json'),
  ]);
  const byBig = {}; for (const p of leg) byBig[p.id.bioguide] = p;
  const memberUrl = p => `https://www.congress.gov/member/${(p.name.official_full||'').toLowerCase().replace(/[^a-z ]/g,'').trim().replace(/\s+/g,'-')}/${p.id.bioguide}`;
  const out = [];
  for (const [code, label] of Object.entries(MEMBER_COMMS)) {
    const members = (comm[code] || []).slice().sort((a, b) => (a.rank || 99) - (b.rank || 99)).slice(0, 2); // chair + ranking
    for (const m of members) {
      const p = byBig[m.bioguide]; if (!p) continue;
      const t = p.terms[p.terms.length - 1];
      out.push({
        name: p.name.official_full, role: `${m.title || (m.rank === 1 ? 'Chair' : 'Member')}, ${label}`,
        party: (t.party || '')[0], state: t.state,
        url: memberUrl(p),
      });
    }
  }
  return out;
}

export default async function handler(req, res) {
  const [sv, hv, hr, km] = await Promise.allSettled([senateVotes(), houseVotes(), hearings(), keyMembers()]);
  const val = r => r.status === 'fulfilled' && Array.isArray(r.value) ? r.value : [];
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=7200'); // 30m fresh, 2h stale
  res.status(200).json({
    senateVotes: val(sv), houseVotes: val(hv), hearings: val(hr), members: val(km),
    fetchedAt: new Date().toISOString(),
  });
}
