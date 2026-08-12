// 2026 midterm races: every House seat + every Class-2 Senate seat, with live FEC
// money, committee membership, and Nominal footprint/flagged flags.
// Data: theunitedstates.io (roster + committee membership, free) + FEC OpenFEC API
// (money; needs FEC_API_KEY = a free api.data.gov key). Long cache — FEC updates
// only on filing deadlines and the roster rarely changes.

const FOOTPRINT_HOUSE = new Set(['NY-12', 'CA-15', 'CA-37', 'TN-7', 'TX-37', 'VA-8', 'WA-7']);
const FOOTPRINT_SEN_STATES = new Set(['NY', 'CA', 'TN', 'TX', 'VA', 'WA']);
// Committee thomas_id -> Nominal label. HAC-D / SAC-D are the Defense subcommittees.
// HSAP/SSAP = full House/Senate Appropriations committees (superset of the HAC-D/
// SAC-D defense subcommittees). Order matters: defense-subcommittee codes are checked
// before the full-committee codes so a defense-sub member shows the more specific tag.
const COMMITTEES = { HSAP02: 'HAC-D', SSAP02: 'SAC-D', HSAS: 'HASC', SSAS: 'SASC', HSAP: 'HAC', SSAP: 'SAC' };
// Resolved "other flagged" members (stable bioguide IDs). (Moulton, M001196, is
// tracked as a Senate candidate instead — see SENATE_CANDIDATES — so he's not here.)
const FLAGGED = new Set([
  'B000740','B001299','B001319','B001324','C001053','C001055','C001063','C001069',
  'C001096','D000616','E000071','F000459','F000472','F000480','G000604','H001042',
  'J000304','K000377','K000388','K000399','M000934','M001143','M001233',
  'R000122','R000579','S000510','S001194','S001198','S001232','V000128','W000830',
]);
// House members running for Senate — tracked as a dedicated Senate-tab candidate row
// (not incumbents, so they aren't in the roster-built Senate list).
const SENATE_CANDIDATES = [
  { name: 'Seth Moulton', state: 'MA', party: 'D', currentSeat: 'MA-6', fecId: 'S6MA00296' },
];
// Incumbents NOT running for their current seat in 2026 (retiring, running for
// other office) or who lost renomination — so the "incumbent" isn't on the ballot
// and the seat is effectively open. Keyed by seat id, so at-large (-0) and numbered
// districts both match the computed seat. Manually curated from Ballotpedia/Wikipedia
// open-seat trackers (record 60+ House retirements this cycle); refresh periodically.
const NOT_SEEKING_HOUSE = {
  'CA-11': 'retiring', 'CA-26': 'retiring', 'DC-0': 'retiring', 'FL-24': 'retiring',
  'IL-2': 'running for Senate', 'IL-4': 'retiring', 'IL-7': 'retiring', 'IL-8': 'running for Senate', 'IL-9': 'retiring',
  'LA-6': 'running for state senate', 'ME-2': 'retiring', 'MD-5': 'retiring', 'MA-6': 'running for Senate',
  'MI-11': 'running for Senate', 'MN-2': 'running for Senate', 'NH-1': 'running for Senate',
  'NJ-12': 'retiring', 'NY-7': 'retiring', 'NY-12': 'retiring', 'PA-3': 'retiring', 'TN-9': 'retiring',
  'TX-30': 'running for Senate', 'TX-33': 'retiring', 'TX-37': 'retiring', 'VI-0': 'running for Governor',
  'AL-1': 'running for Senate', 'AZ-1': 'running for Governor', 'AZ-5': 'running for Governor', 'CA-48': 'retiring',
  'FL-2': 'retiring', 'FL-11': 'retiring', 'FL-16': 'retiring', 'FL-19': 'running for Governor',
  'GA-1': 'running for Senate', 'GA-10': 'running for Senate', 'GA-11': 'retiring',
  'IA-2': 'running for Senate', 'IA-4': 'running for Governor', 'KY-6': 'running for Senate', 'LA-5': 'running for Senate',
  'MI-10': 'running for Governor', 'MO-6': 'retiring', 'MT-1': 'retiring', 'NE-2': 'retiring', 'NV-2': 'retiring',
  'NY-21': 'retiring', 'NC-11': 'retiring', 'OK-1': 'running for Senate', 'SC-1': 'running for Governor', 'SC-5': 'running for Governor',
  'SD-0': 'running for Governor', 'TN-6': 'running for Governor', 'TX-8': 'retiring', 'TX-10': 'retiring', 'TX-19': 'retiring',
  'TX-21': 'running for AG', 'TX-22': 'retiring', 'TX-38': 'running for Senate', 'UT-4': 'retiring', 'WA-4': 'retiring',
  'WI-7': 'running for Governor', 'WY-0': 'running for Senate',
};
const NOT_SEEKING_SENATE = {
  'IL': 'retiring', 'MI': 'retiring', 'MN': 'retiring', 'NH': 'retiring', 'AL': 'running for Governor',
  'IA': 'retiring', 'KY': 'retiring', 'MT': 'retiring', 'NC': 'retiring', 'OK': 'retiring', 'WY': 'retiring',
  'LA': 'lost primary', 'TX': 'lost primary',
};
// State primary dates (2026, ISO). Lets the dashboard say whether a race is DECIDED
// or still UPCOMING, and show the primary date. LA is the decisive runoff date.
const STATE_PRIMARY = {
  TX: '2026-03-03', AR: '2026-03-03', NC: '2026-03-03', IL: '2026-03-17',
  NE: '2026-05-12', WV: '2026-05-12', LA: '2026-06-27',
  AL: '2026-05-19', GA: '2026-05-19', KY: '2026-05-19', ID: '2026-05-19', OR: '2026-05-19', PA: '2026-05-19',
  CA: '2026-06-02', IA: '2026-06-02', MT: '2026-06-02', NM: '2026-06-02', NJ: '2026-06-02', SD: '2026-06-02',
  ME: '2026-06-09', NV: '2026-06-09', SC: '2026-06-09', OK: '2026-06-16',
  MD: '2026-06-23', NY: '2026-06-23', UT: '2026-06-23', CO: '2026-06-30', AZ: '2026-07-21',
  KS: '2026-08-04', MI: '2026-08-04', MO: '2026-08-04', VA: '2026-08-04', WA: '2026-08-04', TN: '2026-08-06',
  CT: '2026-08-11', MN: '2026-08-11', VT: '2026-08-11', WI: '2026-08-11',
  AK: '2026-08-18', FL: '2026-08-18', WY: '2026-08-18',
  MA: '2026-09-01', NH: '2026-09-08', RI: '2026-09-09', DE: '2026-09-15', DC: '2026-06-16',
};
// Confirmed 2026 Senate nominees for open seats whose primary has been decided
// (verified from race results — the winner, NOT merely the top fundraiser; several
// top fundraisers LOST: Krishnamoorthi IL, Craig MN, Fleming LA). [display name, party].
const SENATE_NOMINEES = {
  AL: [['Barry Moore', 'R'], ['Everett Wess', 'D']],
  IA: [['Ashley Hinson', 'R'], ['Josh Turek', 'D']],
  IL: [['Juliana Stratton', 'D'], ['Don Tracy', 'R']],
  KY: [['Andy Barr', 'R'], ['Charles Booker', 'D']],
  LA: [['Julia Letlow', 'R'], ['Jamie Davis', 'D']],
  MI: [['Abdul El-Sayed', 'D'], ['Mike Rogers', 'R']],
  MN: [['Peggy Flanagan', 'D'], ['Michele Tafoya', 'R']],
  MT: [['Kurt Alme', 'R'], ['Alani Bankhead', 'D'], ['Seth Bodnar', 'I']],
  NC: [['Roy Cooper', 'D'], ['Michael Whatley', 'R']],
  OK: [['Kevin Hern', 'R'], ['Jim Priest', 'D']],
  TX: [['James Talarico', 'D'], ['Ken Paxton', 'R']],
};
// House open-seat nominees are curated per-race as they're confirmed. Empty for now —
// House open seats fall back to leading-fundraiser + primary-status labeling.
const HOUSE_NOMINEES = {};

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
    SENATE_CANDIDATES.forEach(c => careFecIds.add(c.fecId)); // ensure their Senate money is fetched

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
    // The general-election opponent = best-funded candidate of the OPPOSITE party
    // (skips same-party primary rivals). Post-primary this is effectively the nominee.
    const opponentOf = (seat, fecIds, party) => {
      const own = new Set(fecIds || []);
      const incParty = party === 'R' ? 'REP' : party === 'D' ? 'DEM' : '';
      const top = (bySeat[seat] || [])
        .filter(c => !own.has(c.id) && c.m && c.m.receipts > 0 && (c.party || '').toUpperCase() !== incParty)
        .sort((a, b) => b.m.receipts - a.m.receipts)[0];
      return top ? { name: top.name, party: top.party, receipts: top.m.receipts, cash: top.m.cash } : null;
    };
    // For OPEN seats (no incumbent on the ballot): who's actually running. Take the
    // best-funded candidate of each major party for the seat, plus any better-funded
    // independent, so both sides show. Money is the only free post-primary signal, so
    // this is "leading fundraisers," not an official nominee list.
    const runnersFor = (seat, fecIds) => {
      const own = new Set(fecIds || []);
      const cands = (bySeat[seat] || []).filter(c => !own.has(c.id) && c.m && c.m.receipts > 0);
      const picks = [];
      for (const P of ['REP', 'DEM']) {
        const top = cands.filter(c => (c.party || '').toUpperCase().startsWith(P))
          .sort((a, b) => b.m.receipts - a.m.receipts)[0];
        if (top) picks.push({ name: top.name, party: top.party, receipts: top.m.receipts, cash: top.m.cash });
      }
      const other = cands.filter(c => !['REP', 'DEM'].some(P => (c.party || '').toUpperCase().startsWith(P)))
        .sort((a, b) => b.m.receipts - a.m.receipts)[0];
      if (other && (!picks.length || other.m.receipts > Math.min(...picks.map(p => p.receipts))))
        picks.push({ name: other.name, party: other.party, receipts: other.m.receipts, cash: other.m.cash });
      return picks.sort((a, b) => b.receipts - a.receipts).slice(0, 3);
    };
    // Curated nominees for a seat, with FEC money attached by matching last name +
    // party against the candidate pool (money is optional — a nominee outside the
    // fetched pool still shows, just without a $ figure).
    const nomineeRunners = (seat, list) => list.map(([name, party]) => {
      const last = name.trim().split(/\s+/).pop().toUpperCase();
      const pi = party === 'R' ? 'R' : party === 'D' ? 'D' : 'I';
      const c = (bySeat[seat] || []).find(x => (x.name || '').toUpperCase().startsWith(last + ',') && ((x.party || '').toUpperCase()[0] === pi));
      return { name, party, nominee: true, receipts: c && c.m ? c.m.receipts : null, cash: c && c.m ? c.m.cash : null };
    });
    const today = new Date().toISOString().slice(0, 10);
    // Everything the open-seat display needs: who's running (confirmed nominees if we
    // have them, else leading fundraisers) plus whether the primary is decided.
    const openInfo = (seat, state, fecIds, nomMap) => {
      const nom = nomMap[seat];
      const pd = STATE_PRIMARY[state] || null;
      return {
        runners: nom ? nomineeRunners(seat, nom) : runnersFor(seat, fecIds),
        runnersAreNominees: !!nom,
        primaryDate: pd,
        primaryPassed: pd ? pd <= today : null,
      };
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
        const oi = NOT_SEEKING_HOUSE[seat] ? openInfo(seat, t.state, fecIds, HOUSE_NOMINEES) : null;
        house.push({
          chamber: 'house', seat, state: t.state, district: t.district, bioguide: big,
          incumbent: name, party, committees: comms,
          footprint, flagged: footprint || FLAGGED.has(big),
          notSeeking: NOT_SEEKING_HOUSE[seat] || null,
          runners: oi ? oi.runners : null, runnersAreNominees: oi ? oi.runnersAreNominees : false,
          primaryDate: oi ? oi.primaryDate : null, primaryPassed: oi ? oi.primaryPassed : null,
          fec: im, opponent: opponentOf(seat, fecIds, party), challengers: challengers(seat, fecIds, party),
        });
      } else if (t.type === 'sen' && String(t.end || '').startsWith('2027')) {
        // Class-2 seats (term ends Jan 2027) are up in 2026
        const footprint = FOOTPRINT_SEN_STATES.has(t.state);
        const oi = NOT_SEEKING_SENATE[t.state] ? openInfo(t.state, t.state, fecIds, SENATE_NOMINEES) : null;
        senate.push({
          chamber: 'senate', seat: t.state, state: t.state, bioguide: big,
          incumbent: name, party, committees: comms,
          footprint, flagged: footprint || FLAGGED.has(big),
          notSeeking: NOT_SEEKING_SENATE[t.state] || null,
          runners: oi ? oi.runners : null, runnersAreNominees: oi ? oi.runnersAreNominees : false,
          primaryDate: oi ? oi.primaryDate : null, primaryPassed: oi ? oi.primaryPassed : null,
          fec: im, opponent: opponentOf(t.state, fecIds, party), challengers: challengers(t.state, fecIds, party),
        });
      }
    }
    // House members running for Senate — add as dedicated (non-incumbent) Senate rows.
    for (const c of SENATE_CANDIDATES) {
      senate.push({
        chamber: 'senate', seat: c.state, state: c.state, bioguide: null,
        incumbent: c.name, party: c.party, committees: [],
        footprint: FOOTPRINT_SEN_STATES.has(c.state), flagged: true,
        candidate: true, currentSeat: c.currentSeat,
        fec: moneyById[c.fecId] || null, challengers: [],
      });
    }
    house.sort((a, b) => a.state.localeCompare(b.state) || (a.district - b.district));
    senate.sort((a, b) => a.state.localeCompare(b.state) || (a.candidate === b.candidate ? 0 : a.candidate ? 1 : -1));

    res.setHeader('Cache-Control', 's-maxage=43200, stale-while-revalidate=86400'); // 12h fresh, 24h stale
    res.status(200).json({
      house, senate,
      meta: {
        houseRaces: house.length, senateRaces: senate.length,
        flaggedHouse: house.filter(r => r.flagged).length,
        flaggedSenate: senate.filter(r => r.flagged).length,
        openHouse: house.filter(r => r.notSeeking).length,
        openSenate: senate.filter(r => r.notSeeking).length,
        fetchedAt: new Date().toISOString(),
      },
    });
  } catch (e) {
    res.setHeader('Cache-Control', 's-maxage=120');
    res.status(200).json({ house: [], senate: [], error: String(e) });
  }
}
