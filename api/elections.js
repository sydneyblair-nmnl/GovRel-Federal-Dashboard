// 2026 midterm races: every House seat + every Class-2 Senate seat, with live FEC
// money, committee membership, and Nominal footprint/flagged flags.
// Data: theunitedstates.io (roster + committee membership, free) + FEC OpenFEC API
// (money; needs FEC_API_KEY = a free api.data.gov key). Long cache — FEC updates
// only on filing deadlines and the roster rarely changes.

const FOOTPRINT_HOUSE = new Set(['NY-12', 'CA-15', 'CA-37', 'TN-7', 'TX-37', 'VA-8', 'WA-7']);
const FOOTPRINT_SEN_STATES = new Set(['NY', 'CA', 'TN', 'TX', 'VA', 'WA']);
// Committee thomas_id -> Nominal label. HAC-D / SAC-D are the Defense subcommittees.
const COMMITTEES = { HSAS: 'HASC', SSAS: 'SASC', HSAP02: 'HAC-D', SSAP02: 'SAC-D' };
// Resolved "other flagged" members (stable bioguide IDs).
const FLAGGED = new Set([
  'B000740','B001299','B001319','B001324','C001053','C001055','C001063','C001069',
  'C001096','D000616','E000071','F000459','F000472','F000480','G000604','H001042',
  'J000304','K000377','K000388','K000399','M000934','M001143','M001196','M001233',
  'R000122','R000579','S000510','S001194','S001198','S001232','V000128','W000830',
]);

async function getJSON(url, opts = {}, ms = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal, headers: { 'User-Agent': 'NominalGRDashboard/1.0', 'Accept': 'application/json', ...(opts.headers || {}) } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

function money(m) {
  return m ? {
    receipts: m.receipts || 0,
    cash: (m.last_cash_on_hand_end_period != null ? m.last_cash_on_hand_end_period : m.cash_on_hand_end_period) || 0,
    disbursements: m.disbursements || 0,
  } : null;
}

export default async function handler(req, res) {
  const key = process.env.FEC_API_KEY;
  if (!key) {
    res.setHeader('Cache-Control', 's-maxage=60');
    return res.status(200).json({ house: [], senate: [], note: 'FEC_API_KEY not set' });
  }
  try {
    // 1) roster + committee membership (free, no key)
    const [leg, comm] = await Promise.all([
      getJSON('https://unitedstates.github.io/congress-legislators/legislators-current.json'),
      getJSON('https://unitedstates.github.io/congress-legislators/committee-membership-current.json'),
    ]);
    const commSets = {};
    for (const code of Object.keys(COMMITTEES)) commSets[code] = new Set((comm[code] || []).map(m => m.bioguide));
    const committeesFor = big => Object.keys(COMMITTEES).filter(c => commSets[c].has(big)).map(c => COMMITTEES[c]);

    // Care-set = members the user filters to (footprint + flagged + committee). Their FEC
    // money is fetched DIRECTLY by candidate id so safe-seat/low-fundraising incumbents
    // aren't missed (a receipts-sorted top-N would drop them).
    const careFecIds = new Set();
    for (const p of leg) {
      const t = p.terms[p.terms.length - 1];
      const big = p.id.bioguide;
      const isRep = t.type === 'rep', isSen2026 = t.type === 'sen' && String(t.end || '').startsWith('2027');
      if (!isRep && !isSen2026) continue;
      const foot = isRep ? FOOTPRINT_HOUSE.has(`${t.state}-${t.district}`) : FOOTPRINT_SEN_STATES.has(t.state);
      const care = foot || FLAGGED.has(big) || committeesFor(big).length > 0;
      if (care) (p.id.fec || []).forEach(id => careFecIds.add(id));
    }

    // 2) FEC money. (a) care-set by candidate_id (guaranteed), (b) top-N by receipts for
    //    broad coverage of other high-profile races + challenger context.
    const fecCands = [];
    const collect = d => (d.results || []).forEach(r => fecCands.push({
      id: r.candidate_id, name: r.name, party: (r.party || '').slice(0, 3),
      state: r.state, district: r.district != null ? String(parseInt(r.district, 10)) : null,
      office: r.office, incumbent: r.incumbent_challenge === 'I', m: money(r),
    }));
    // (a) care-set in batches of 40 candidate_ids
    const careArr = [...careFecIds];
    for (let i = 0; i < careArr.length; i += 40) {
      const ids = careArr.slice(i, i + 40).map(id => 'candidate_id=' + encodeURIComponent(id)).join('&');
      try { collect(await getJSON(`https://api.open.fec.gov/v1/candidates/totals/?api_key=${key}&election_year=2026&per_page=100&${ids}`)); }
      catch (e) { /* skip batch */ }
    }
    // (b) top-N by receipts
    for (const [office, pages] of [['H', 5], ['S', 2]]) {
      for (let p = 1; p <= pages; p++) {
        try {
          const d = await getJSON(`https://api.open.fec.gov/v1/candidates/totals/?api_key=${key}&election_year=2026&office=${office}&per_page=100&page=${p}&sort=-receipts`);
          collect(d);
          if (!d.pagination || p >= (d.pagination.pages || 0)) break;
        } catch (e) { /* skip page */ }
      }
    }
    const moneyById = {};
    fecCands.forEach(c => { if (c.id) moneyById[c.id] = c.m; });
    // challengers grouped by seat
    const bySeat = {};
    fecCands.forEach(c => {
      const seat = c.office === 'H' ? `${c.state}-${c.district}` : c.state;
      (bySeat[seat] = bySeat[seat] || []).push(c);
    });

    const incMoney = fecIds => {
      for (const id of (fecIds || [])) if (moneyById[id]) return moneyById[id];
      return null;
    };
    const challengers = (seat, fecIds, party) => {
      const own = new Set(fecIds || []);
      return (bySeat[seat] || [])
        .filter(c => !own.has(c.id) && c.m && c.m.receipts > 0)
        .sort((a, b) => b.m.receipts - a.m.receipts)
        .slice(0, 2)
        .map(c => ({ name: c.name, party: c.party, receipts: c.m.receipts, cash: c.m.cash }));
    };

    const house = [], senate = [];
    for (const person of leg) {
      const t = person.terms[person.terms.length - 1];
      const big = person.id.bioguide;
      const fecIds = person.id.fec || [];
      const name = person.name.official_full || `${person.name.first} ${person.name.last}`;
      const party = (t.party || '')[0] || '?';
      const comms = committeesFor(big);
      const im = incMoney(fecIds);
      if (t.type === 'rep') {
        const seat = `${t.state}-${t.district}`;
        const footprint = FOOTPRINT_HOUSE.has(seat);
        house.push({
          chamber: 'house', seat, state: t.state, district: t.district, bioguide: big,
          incumbent: name, party, committees: comms,
          footprint, flagged: footprint || FLAGGED.has(big),
          fec: im, challengers: challengers(seat, fecIds, party),
        });
      } else if (t.type === 'sen' && String(t.end || '').startsWith('2027')) {
        // Class-2 seats (term ends Jan 2027) are up in 2026
        const footprint = FOOTPRINT_SEN_STATES.has(t.state);
        senate.push({
          chamber: 'senate', seat: t.state, state: t.state, bioguide: big,
          incumbent: name, party, committees: comms,
          footprint, flagged: footprint || FLAGGED.has(big),
          fec: im, challengers: challengers(t.state, fecIds, party),
        });
      }
    }
    house.sort((a, b) => a.state.localeCompare(b.state) || (a.district - b.district));
    senate.sort((a, b) => a.state.localeCompare(b.state));

    res.setHeader('Cache-Control', 's-maxage=43200, stale-while-revalidate=86400'); // 12h fresh, 24h stale
    res.status(200).json({
      house, senate,
      meta: {
        houseRaces: house.length, senateRaces: senate.length,
        flaggedHouse: house.filter(r => r.flagged).length,
        flaggedSenate: senate.filter(r => r.flagged).length,
        fetchedAt: new Date().toISOString(),
      },
    });
  } catch (e) {
    res.setHeader('Cache-Control', 's-maxage=120');
    res.status(200).json({ house: [], senate: [], error: String(e) });
  }
}
