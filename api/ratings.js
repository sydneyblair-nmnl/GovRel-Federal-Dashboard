// Race outlook ratings (Toss-up / Tilt / Lean / Likely / Safe), scraped from
// Wikipedia's 2026 election-ratings tables (which aggregate Cook, Sabato, Inside
// Elections, DDHQ, etc.). Not real-time — cached 7 days, which is plenty for ratings.
// Wikipedia lists only competitive races; safe/uncontested seats simply have no rating.

const STATE = {'Alabama':'AL','Alaska':'AK','Arizona':'AZ','Arkansas':'AR','California':'CA','Colorado':'CO','Connecticut':'CT','Delaware':'DE','Florida':'FL','Georgia':'GA','Hawaii':'HI','Idaho':'ID','Illinois':'IL','Indiana':'IN','Iowa':'IA','Kansas':'KS','Kentucky':'KY','Louisiana':'LA','Maine':'ME','Maryland':'MD','Massachusetts':'MA','Michigan':'MI','Minnesota':'MN','Mississippi':'MS','Missouri':'MO','Montana':'MT','Nebraska':'NE','Nevada':'NV','New Hampshire':'NH','New Jersey':'NJ','New Mexico':'NM','New York':'NY','North Carolina':'NC','North Dakota':'ND','Ohio':'OH','Oklahoma':'OK','Oregon':'OR','Pennsylvania':'PA','Rhode Island':'RI','South Carolina':'SC','South Dakota':'SD','Tennessee':'TN','Texas':'TX','Utah':'UT','Vermont':'VT','Virginia':'VA','Washington':'WA','West Virginia':'WV','Wisconsin':'WI','Wyoming':'WY'};

function norm(rating, party) {
  const lab = { solid: 'Safe', safe: 'Safe', strong: 'Safe', likely: 'Likely', lean: 'Lean', tilt: 'Tilt', tossup: 'Toss-up', 'toss-up': 'Toss-up' }[(rating || '').toLowerCase()] || rating;
  return lab === 'Toss-up' ? 'Toss-up' : `${lab} ${party}`;
}
// Ordered spectrum so we can average every rater's call into a consensus.
const SPECTRUM = { 'safe r': 4, 'likely r': 3, 'lean r': 2, 'tilt r': 1, 'toss-up': 0, 'tilt d': -1, 'lean d': -2, 'likely d': -3, 'safe d': -4 };
const LABELS = ['Safe D', 'Likely D', 'Lean D', 'Tilt D', 'Toss-up', 'Tilt R', 'Lean R', 'Likely R', 'Safe R']; // index = value + 4

async function wikitext(page, section) {
  const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(page)}&format=json&prop=wikitext${section != null ? '&section=' + section : ''}`;
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 14000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'NominalGRDashboard/1.0 (sydney.blair@nominal.io)', 'Accept': 'application/json' } });
    const d = await r.json();
    return (d.parse && d.parse.wikitext && d.parse.wikitext['*']) || '';
  } finally { clearTimeout(t); }
}

// Find the "Predictions"/"ratings" section index on a page.
async function ratingsSection(page) {
  const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(page)}&format=json&prop=sections`;
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'NominalGRDashboard/1.0 (sydney.blair@nominal.io)', 'Accept': 'application/json' } });
    const d = await r.json();
    const s = ((d.parse && d.parse.sections) || []).find(x => /rating|predict|forecast/i.test(x.line));
    return s ? s.index : null;
  } finally { clearTimeout(t); }
}

// Consensus = average of ALL raters' calls in the row, mapped back to a label.
function consensusRating(body) {
  const nums = [...body.matchAll(/\{\{USRaceRating\|(\w+)\|(\w+)/gi)]
    .map(m => SPECTRUM[norm(m[1], m[2]).toLowerCase()])
    .filter(n => n !== undefined);
  if (!nums.length) return null;
  const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
  return LABELS[Math.round(avg) + 4];
}

async function getSenate() {
  const sec = await ratingsSection('2026 United States Senate elections');
  const wt = await wikitext('2026 United States Senate elections', sec);
  const out = {};
  // Optional "special " so special elections (FL for Rubio's seat, OH for Vance's) are
  // their own split boundaries — otherwise the preceding state absorbs their ratings
  // rows and its consensus gets skewed (e.g. Safe-D Delaware averaged toward Toss-up).
  const parts = wt.split(/!\s*\[\[2026 United States Senate (?:special )?election in ([^|\]]+?)(?:\|[^\]]+)?\]\]/);
  for (let i = 1; i < parts.length; i += 2) {
    const code = STATE[parts[i].trim()];
    const r = consensusRating(parts[i + 1] || '');
    if (code && r) out[code] = r;
  }
  return out;
}

async function getHouse() {
  const wt = await wikitext('2026 United States House of Representatives election ratings');
  const out = {};
  const parts = wt.split(/\{\{ushr\|(\w+)\|(\w+)\|/i);
  for (let i = 1; i < parts.length; i += 3) {
    const st = (parts[i] || '').toUpperCase();
    let dist = (parts[i + 1] || '').toUpperCase();
    dist = dist === 'AL' ? '0' : (/^\d+$/.test(dist) ? String(parseInt(dist, 10)) : dist);
    const r = consensusRating(parts[i + 2] || '');
    if (st && r) out[`${st}-${dist}`] = r;
  }
  return out;
}

export default async function handler(req, res) {
  try {
    const [senate, house] = await Promise.all([getSenate().catch(() => ({})), getHouse().catch(() => ({}))]);
    res.setHeader('Cache-Control', 's-maxage=604800, stale-while-revalidate=1209600'); // 7d fresh, 14d stale
    res.status(200).json({ senate, house, source: 'Wikipedia race-ratings tables', fetchedAt: new Date().toISOString() });
  } catch (e) {
    res.setHeader('Cache-Control', 's-maxage=3600');
    res.status(200).json({ senate: {}, house: {}, error: String(e) });
  }
}
