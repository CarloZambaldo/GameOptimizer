// Web Worker: filtra i candidati per ogni board e calcola i tentativi migliori.
importScripts('words.js');

const ALL = self.ANSWERS.concat(self.ALLOWED);
const NA = self.ANSWERS.length;
const N = ALL.length;
const W = new Uint8Array(N * 5);
const INDEX = new Map();
ALL.forEach((w, i) => {
  INDEX.set(w, i);
  for (let j = 0; j < 5; j++) W[i * 5 + j] = w.charCodeAt(j) - 97;
});

const cnt = new Int8Array(26);
const res = new Int8Array(5);
const SOLVED = 242; // tutte verdi

// Pattern in base 3 (0 grigio, 1 giallo, 2 verde), posizione i pesa 3^i
function pat(gi, ai) {
  const go = gi * 5, ao = ai * 5;
  for (let i = 0; i < 5; i++) {
    const a = W[ao + i];
    if (W[go + i] === a) res[i] = 2;
    else { res[i] = 0; cnt[a]++; }
  }
  for (let i = 0; i < 5; i++) {
    if (res[i] !== 2) {
      const c = W[go + i];
      if (cnt[c] > 0) { res[i] = 1; cnt[c]--; }
    }
  }
  for (let i = 0; i < 5; i++) cnt[W[ao + i]] = 0;
  return res[0] + 3 * res[1] + 9 * res[2] + 27 * res[3] + 81 * res[4];
}

function filter(history, limit) {
  const out = [];
  for (let a = 0; a < limit; a++) {
    let ok = true;
    for (const [gi, p] of history) {
      if (pat(gi, a) !== p) { ok = false; break; }
    }
    if (ok) out.push(a);
  }
  return out;
}

const hist = new Uint16Array(243);
const touched = new Uint8Array(243);
const touchedList = new Uint8Array(243);

self.onmessage = (e) => {
  const { id, boards, turnsLeft, wide } = e.data;
  const t0 = performance.now();

  // 1. Candidati per board
  const info = boards.map((b) => {
    const history = [];
    for (const [w, p] of b.history) {
      const gi = INDEX.get(w);
      if (gi === undefined) continue;
      history.push([gi, p]);
      if (p === SOLVED) return { solved: true, word: w, cands: [], extended: false };
    }
    let cands = filter(history, wide ? N : NA);
    let extended = !!wide;
    if (cands.length === 0 && !wide) { cands = filter(history, N); extended = true; }
    return { solved: false, cands, extended };
  });

  const open = info.filter((b) => !b.solved && b.cands.length > 0);
  const unsolved = info.filter((b) => !b.solved).length;

  // 2. Raggruppa board con lo stesso insieme di candidati (es. primo turno)
  const groups = new Map();
  for (const b of open) {
    const key = b.cands.length < 50 ? b.cands.join(',') : b.cands.length + ':' + b.cands.slice(0, 50).join(',');
    const g = groups.get(key);
    if (g) g.m++; else groups.set(key, { cands: b.cands, set: new Set(b.cands), m: 1 });
  }
  const G = [...groups.values()];
  const work = G.reduce((s, g) => s + g.cands.length, 0);

  // 3. Insieme di tentativi da valutare: tutte le parole se il calcolo è sostenibile
  let poolSize = N * work > 25e6 ? NA : N;
  const extra = new Set();
  for (const g of G) for (const c of g.cands) if (c >= poolSize) extra.add(c);

  const endgame = turnsLeft <= unsolved;
  const TOP = 15;
  const top = [];

  const evaluate = (gi) => {
    let H = 0, P = 0, exp = 0, sureSolves = 0;
    const solves = [];
    for (let k = 0; k < G.length; k++) {
      const g = G[k];
      const n = g.cands.length;
      const isCand = g.set.has(gi);
      if (isCand) { P += g.m / n; solves.push(k); if (n === 1) sureSolves += g.m; }
      if (n === 1) { exp += isCand ? 0 : g.m; continue; }
      let nt = 0;
      for (const a of g.cands) {
        const p = pat(gi, a);
        if (!touched[p]) { touched[p] = 1; touchedList[nt++] = p; }
        hist[p]++;
      }
      let s = 0, sq = 0;
      for (let t = 0; t < nt; t++) {
        const p = touchedList[t];
        let c = hist[p];
        sq += (p === SOLVED ? 0 : c * c);
        s += c * Math.log2(c);
        hist[p] = 0; touched[p] = 0;
      }
      H += g.m * (Math.log2(n) - s / n);
      exp += g.m * (sq / n);
    }
    // punteggio: informazione totale + bonus per le board risolvibili subito
    let score = H + 2 * (P - sureSolves) + 10 * sureSolves;
    if (endgame) score = P * 100 + H;
    return { gi, score, H, P, exp, solves };
  };

  const consider = (r) => {
    if (top.length < TOP || r.score > top[top.length - 1].score) {
      top.push(r);
      top.sort((a, b) => b.score - a.score || b.P - a.P);
      if (top.length > TOP) top.pop();
    }
  };

  if (G.length > 0) {
    for (let gi = 0; gi < poolSize; gi++) consider(evaluate(gi));
    for (const gi of extra) consider(evaluate(gi));
  }

  // mappa gruppo -> indici board
  const boardOfGroup = G.map((g) => info.map((b, i) => (b.cands === g.cands || (!b.solved && b.cands.length === g.cands.length && b.cands.every((c, j) => c === g.cands[j]))) ? i : -1).filter((i) => i >= 0));

  self.postMessage({
    id,
    ms: Math.round(performance.now() - t0),
    pool: poolSize + extra.size,
    endgame,
    boards: info.map((b) => ({
      solved: b.solved,
      count: b.cands.length,
      extended: b.extended,
      cands: b.cands.slice(0, 60).map((i) => ALL[i]),
    })),
    suggestions: top.map((r) => ({
      word: ALL[r.gi],
      score: r.score,
      bits: r.H,
      pSolve: r.P,
      expRemaining: r.exp,
      boards: [...new Set(r.solves.flatMap((k) => boardOfGroup[k]))].sort((a, b) => a - b),
    })),
  });
};
