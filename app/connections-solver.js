// Ottimizzatore Connections: distribuzione di probabilità sulle partizioni in gruppi da 4.
// P(partizione) ∝ exp(Σ punteggio gruppi / T), con i vincoli dei tentativi già fatti.
(function (root) {
  const tokenize = (m) => m.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const popcnt = (x) => { x -= (x >> 1) & 0x55555555; x = (x & 0x33333333) + ((x >> 2) & 0x33333333); return (((x + (x >> 4)) & 0xf0f0f0f) * 0x1010101) >> 24; };

  class ConnSolver {
    constructor(vocabText, buf, puzzles) {
      this.vocab = new Map();
      this.list = vocabText.split('\n');
      this.list.forEach((w, i) => this.vocab.set(w, i));
      this.E = new Int8Array(buf);
      this.D = this.E.length / this.list.length;
      this.puzzles = puzzles || [];
      this.params = { T: 0.05, beta: 0.4, gamma: 0.5, delta: 0, eps: 1, K: 1000 };
    }

    tokenId(t) {
      let id = this.vocab.get(t);
      if (id === undefined && t.length > 3 && t.endsWith('s')) id = this.vocab.get(t.slice(0, -1));
      return id;
    }

    vec(member) {
      const D = this.D;
      const v = new Float32Array(D);
      let k = 0;
      for (const t of tokenize(member)) {
        const id = this.tokenId(t);
        if (id === undefined) continue;
        for (let d = 0; d < D; d++) v[d] += this.E[id * D + d];
        k++;
      }
      let n = 0;
      for (let d = 0; d < D; d++) n += v[d] * v[d];
      n = Math.sqrt(n) || 1;
      for (let d = 0; d < D; d++) v[d] /= n;
      return { v, known: k > 0 };
    }

    // words: le 16 parole del puzzle
    setBoard(words) {
      const W = words.map((w) => w.toUpperCase().trim());
      const n = W.length;
      this.words = W;
      const vs = W.map((w) => this.vec(w));
      this.unknown = W.filter((_, i) => !vs[i].known);
      this.cos = new Float64Array(n * n);
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        let s = 0;
        if (vs[i].known && vs[j].known) for (let d = 0; d < this.D; d++) s += vs[i].v[d] * vs[j].v[d];
        this.cos[i * n + j] = this.cos[j * n + i] = s;
      }
      // parole composte: affissi comuni (es. FIRE+fly, FIRE+work) per categorie "___ X" / "X ___"
      this.affixes = W.map((w) => this.affixSet(w));
      // co-occorrenze nello stesso gruppo in altri puzzle (esclusi quelli quasi identici a questo)
      const idx = new Map(W.map((w, i) => [w, i]));
      this.cooc = new Float64Array(n * n);
      this.protoCache = new Map();
      this.protoSim = null;
      if (this.params.eps) this.buildProtoSim(vs, idx);
      for (const p of this.puzzles) {
        const all = p.groups.flatMap((g) => g.members);
        if (all.filter((m) => idx.has(m)).length >= 8) continue;
        for (const g of p.groups) {
          const ms = g.members.map((m) => idx.get(m)).filter((i) => i !== undefined);
          for (let a = 0; a < ms.length; a++) for (let b = a + 1; b < ms.length; b++) {
            this.cooc[ms[a] * n + ms[b]] += 1; this.cooc[ms[b] * n + ms[a]] += 1;
          }
        }
      }
    }

    // centroidi delle categorie dei puzzle passati: un gruppo i cui membri sono tutti
    // vicini a una categoria già vista (es. "squadre NBA") riceve un bonus
    buildProtoSim(vs, idx) {
      const D = this.D;
      if (!this.protos) {
        const cs = [], owner = [];
        this.puzzles.forEach((p, pi) => p.groups.forEach((g) => {
          const c = new Float32Array(D); let k = 0;
          for (const m of g.members) { const r = this.vec(m); if (!r.known) continue; for (let d = 0; d < D; d++) c[d] += r.v[d]; k++; }
          if (k < 3) return;
          let nn = 0; for (let d = 0; d < D; d++) nn += c[d] * c[d]; nn = Math.sqrt(nn) || 1;
          for (let d = 0; d < D; d++) c[d] /= nn;
          cs.push(c); owner.push(pi);
        }));
        this.protos = cs; this.protoOwner = owner;
      }
      const excl = new Set();
      this.puzzles.forEach((p, pi) => { if (p.groups.flatMap((g) => g.members).filter((m) => idx.has(m)).length >= 8) excl.add(pi); });
      const NG = this.protos.length, n = vs.length;
      this.protoSim = new Float32Array(n * NG);
      for (let i = 0; i < n; i++) for (let g = 0; g < NG; g++) {
        if (!vs[i].known || excl.has(this.protoOwner[g])) { this.protoSim[i * NG + g] = -1; continue; }
        let s = 0; const c = this.protos[g], v = vs[i].v;
        for (let d = 0; d < D; d++) s += v[d] * c[d];
        this.protoSim[i * NG + g] = s;
      }
    }

    protoBonus(ix, G) {
      let b = this.protoCache.get(G);
      if (b !== undefined) return b;
      const NG = this.protos.length, S = this.protoSim;
      const o = ix.map((i) => i * NG);
      b = -1;
      for (let g = 0; g < NG; g++) {
        let m = S[o[0] + g];
        if (m <= b) continue;
        for (let k = 1; k < 4 && m > b; k++) { const s = S[o[k] + g]; if (s < m) m = s; }
        if (m > b) b = m;
      }
      this.protoCache.set(G, b);
      return b;
    }

    affixSet(member) {
      const w = member.toLowerCase().replace(/[^a-z]/g, '');
      const out = new Set();
      if (w.length < 2) return out;
      const ok = (t) => t.length >= 3 && (this.vocab.get(t) ?? 1e9) < 30000;
      for (const v of this.list) {
        if (v.length <= w.length + 2) continue;
        if (v.startsWith(w) && ok(v.slice(w.length))) out.add('>' + v.slice(w.length));
        else if (v.endsWith(w) && ok(v.slice(0, -w.length))) out.add('<' + v.slice(0, -w.length));
      }
      return out;
    }

    // numero di affissi condivisi da tutte le parole del gruppo
    sharedAffix(ix) {
      const sets = ix.map((i) => this.affixes[i]).sort((a, b) => a.size - b.size);
      let c = 0;
      for (const t of sets[0]) if (sets[1].has(t) && sets[2].has(t) && sets[3].has(t)) c++;
      return c;
    }

    aff(i, j) {
      const n = this.words.length;
      return this.cos[i * n + j] + this.params.beta * Math.min(1, this.cooc[i * n + j]);
    }

    // remaining: indici (in this.words) ancora da raggruppare
    // guesses: [{idx:[4 indici], oneAway:bool}] tentativi sbagliati; solved: [[4 indici]] gruppi trovati
    solve(remaining, guesses = [], solved = []) {
      const { T, gamma, K } = this.params;
      const n = remaining.length;
      const toGlobal = (lm) => { let g = 0; for (let b = 0; b < n; b++) if (lm & (1 << b)) g |= 1 << remaining[b]; return g; };
      const gmask = (arr) => arr.reduce((m, i) => m | (1 << i), 0);
      const solvedMasks = solved.map(gmask);
      const wrong = [], oneAway = [];
      for (const g of guesses) {
        const S = gmask(g.idx);
        if (!g.oneAway) wrong.push(S);
        else if (!solvedMasks.some((m) => popcnt(m & S) === 3)) oneAway.push(S);
        else wrong.push(S); // il gruppo a distanza 1 è già risolto: tra i rimanenti nessuno ne condivide 3
      }

      // tutti i gruppi validi di 4 tra le parole rimaste
      const groups = [];
      for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++) for (let d = c + 1; d < n; d++) {
        const lm = (1 << a) | (1 << b) | (1 << c) | (1 << d);
        const G = toGlobal(lm);
        if (wrong.some((S) => popcnt(G & S) >= 3) || oneAway.some((S) => G === S)) continue;
        const ix = [a, b, c, d].map((k) => remaining[k]);
        let sum = 0, min = Infinity;
        for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) { const s = this.aff(ix[p], ix[q]); sum += s; if (s < min) min = s; }
        const comp = this.params.delta && this.sharedAffix(ix) > 0 ? this.params.delta : 0;
        const proto = this.protoSim ? this.params.eps * this.protoBonus(ix, G) : 0;
        groups.push({ lm, G, score: sum / 6 + gamma * min + comp + proto, low: a });
      }
      groups.sort((x, y) => y.score - x.score);

      const run = (list) => {
        const byLow = Array.from({ length: n }, () => []);
        list.forEach((g, i) => byLow[g.low].push(i));
        const marg = new Float64Array(list.length);
        const stack = [0, 0, 0, 0];
        let total = 0, best = -Infinity, bestPart = null, count = 0;
        const offset = list.length ? list[0].score * (n / 4) : 0;
        const full = (1 << n) - 1;
        const rec = (rem, depth, acc) => {
          if (rem === 0) {
            for (const S of oneAway) {
              let ok = false;
              for (let k = 0; k < depth; k++) if (popcnt(list[stack[k]].G & S) === 3) { ok = true; break; }
              if (!ok) return;
            }
            count++;
            const w = Math.exp((acc - offset) / T);
            total += w;
            for (let k = 0; k < depth; k++) marg[stack[k]] += w;
            if (acc > best) { best = acc; bestPart = stack.slice(0, depth); }
            return;
          }
          const low = 31 - Math.clz32(rem & -rem);
          for (const gi of byLow[low]) {
            const g = list[gi];
            if ((g.lm & ~rem) !== 0) continue;
            stack[depth] = gi;
            rec(rem & ~g.lm, depth + 1, acc + g.score);
          }
        };
        rec(full, 0, 0);
        return { marg, total, count, bestPart };
      };

      // i K gruppi migliori + i migliori 150 per ciascuna parola (così ogni parola trova posto)
      const keep = new Set(groups.slice(0, K));
      for (let b = 0; b < n; b++) {
        let c = 0;
        for (const g of groups) if (g.lm & (1 << b)) { keep.add(g); if (++c >= 150) break; }
      }
      let list = groups.filter((g) => keep.has(g));
      let r = run(list);
      if (r.count === 0 && list.length < groups.length) { list = groups; r = run(list); }
      if (r.count === 0) return { groups: [], best: [], partitions: 0 };

      const ranked = list.map((g, i) => ({ g, p: r.marg[i] / r.total }))
        .sort((x, y) => y.p - x.p || y.g.score - x.g.score);
      const idxOf = (lm) => remaining.filter((_, b) => lm & (1 << b));
      return {
        partitions: r.count,
        groups: ranked.slice(0, 12).map(({ g, p }) => ({ idx: idxOf(g.lm), p, score: g.score })),
        best: r.bestPart.map((gi) => idxOf(list[gi].lm)),
      };
    }
  }
  root.ConnSolver = ConnSolver;
  if (typeof module !== 'undefined') module.exports = ConnSolver;
})(typeof self !== 'undefined' ? self : globalThis);
