'use strict';

const VALID = new Set([...ANSWERS, ...ALLOWED]);
const CFG = { wordle: { n: 1, max: 6 }, quordle: { n: 4, max: 9 }, octordle: { n: 8, max: 13 } };
const $ = (s) => document.querySelector(s);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

let tab = 'quordle';
let seedMode = store.get('seedMode', 'daily');
let helpOn = store.get('helpOn', false);
let game = null;
let assist = store.get('assist', null) || { n: 4, max: 9, wide: false, guesses: [], fb: [], input: '' };

// ---------- logica Wordle ----------
function feedback(guess, answer) {
  const res = [0, 0, 0, 0, 0], cnt = {};
  for (let i = 0; i < 5; i++) {
    if (guess[i] === answer[i]) res[i] = 2; else cnt[answer[i]] = (cnt[answer[i]] || 0) + 1;
  }
  for (let i = 0; i < 5; i++) {
    if (res[i] !== 2 && cnt[guess[i]] > 0) { res[i] = 1; cnt[guess[i]]--; }
  }
  return res;
}
const toInt = (a) => a[0] + 3 * a[1] + 9 * a[2] + 27 * a[3] + 81 * a[4];
const allGreen = (a) => a && a.every((v) => v === 2);

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function rngFrom(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function pickAnswers(n, rnd) {
  const out = new Set();
  while (out.size < n) out.add(ANSWERS[Math.floor(rnd() * ANSWERS.length)]);
  return [...out];
}

// ---------- partita ----------
const gameKey = () => `game:${tab}:${seedMode}`;
function loadGame(forceNew) {
  const { n, max } = CFG[tab];
  const saved = store.get(gameKey(), null);
  const day = todayKey();
  if (!forceNew && saved && (seedMode === 'free' || saved.day === day)) { game = saved; return; }
  const rnd = seedMode === 'daily' ? rngFrom(`${day}:${tab}`) : Math.random;
  game = { n, max, day, answers: pickAnswers(n, rnd), guesses: [], input: '', over: false };
  saveGame();
}
const saveGame = () => store.set(gameKey(), game);
const solvedAt = (b) => game.guesses.indexOf(game.answers[b]);

function gameHistory() {
  return game.answers.map((ans) => {
    const h = [];
    for (const g of game.guesses) {
      const f = feedback(g, ans);
      h.push([g, f]);
      if (allGreen(f)) break;
    }
    return h;
  });
}

function assistHistory() {
  const out = [];
  for (let b = 0; b < assist.n; b++) {
    const h = [];
    for (let r = 0; r < assist.guesses.length; r++) {
      const f = assist.fb[r][b];
      if (!f) break;
      h.push([assist.guesses[r], f]);
      if (allGreen(f)) break;
    }
    out.push(h);
  }
  return out;
}

// ---------- input ----------
function current() { return tab === 'assist' ? assist : game; }

function press(k) {
  const st = current();
  if (tab !== 'assist' && game.over) return;
  if (/^[a-z]$/.test(k)) { if (st.input.length < 5) st.input += k; }
  else if (k === 'back') st.input = st.input.slice(0, -1);
  else if (k === 'enter') return submit();
  render(false);
}

function submit() {
  const st = current();
  const w = st.input;
  if (w.length < 5) return toast('Servono 5 lettere');
  if (!VALID.has(w)) { shake(); return toast('Parola non valida'); }
  if (tab === 'assist') {
    if (assist.guesses.length >= assist.max) return toast('Tentativi esauriti');
    const hist = assistHistory();
    assist.fb.push(hist.map((h) => {
      if (h.length && allGreen(h[h.length - 1][1])) return null;
      // pre-compila i verdi già noti in quella posizione
      return [...w].map((c, i) => (h.some(([g, f]) => g[i] === c && f[i] === 2) ? 2 : 0));
    }));
    assist.guesses.push(w);
    assist.input = '';
    store.set('assist', assist);
  } else {
    game.guesses.push(w);
    game.input = '';
    const solved = game.answers.filter((_, b) => solvedAt(b) >= 0).length;
    if (solved === game.n) { game.over = true; game.won = true; toast(`Vinto in ${game.guesses.length}/${game.max}!`, 2500); }
    else if (game.guesses.length >= game.max) { game.over = true; toast('Partita persa', 2500); }
    saveGame();
  }
  render(true);
}

function cycleTile(r, b, i) {
  const f = assist.fb[r][b];
  if (!f) return;
  f[i] = (f[i] + 1) % 3;
  // le righe successive di una board risolta tornano disponibili / vengono disattivate
  const solvedRow = assist.fb.findIndex((row) => allGreen(row[b]));
  for (let rr = r + 1; rr < assist.guesses.length; rr++) {
    if (solvedRow >= 0 && rr > solvedRow) assist.fb[rr][b] = null;
    else if (!assist.fb[rr][b]) assist.fb[rr][b] = [0, 0, 0, 0, 0];
  }
  store.set('assist', assist);
  render(true);
}

// ---------- rendering ----------
const tile = (ch, cls, attrs = '') => `<div class="tile ${cls}" ${attrs}>${ch || ''}</div>`;
const emptyRow = (cls = '') => `<div class="row">${tile('', cls).repeat(5)}</div>`;

function renderBoards() {
  const isAssist = tab === 'assist';
  const st = current();
  const el = $('#boards');
  el.className = `n${st.n}`;
  let html = '';
  for (let b = 0; b < st.n; b++) {
    let rows = '', done = -1;
    const total = st.max;
    let r = 0;
    for (; r < st.guesses.length; r++) {
      const w = st.guesses[r];
      if (done >= 0) { rows += emptyRow('dead'); continue; }
      const f = isAssist ? st.fb[r][b] : feedback(w, game.answers[b]);
      if (!f) { rows += emptyRow('dead'); continue; }
      rows += `<div class="row">${[...w].map((c, i) => tile(c, `s${f[i]}${isAssist ? ' click' : ''}`, isAssist ? `data-r="${r}" data-b="${b}" data-i="${i}"` : '')).join('')}</div>`;
      if (allGreen(f)) done = r;
    }
    const over = !isAssist && game.over;
    if (r < total) {
      if (done < 0 && !over) {
        rows += `<div class="row">${[0, 1, 2, 3, 4].map((i) => tile(st.input[i], st.input[i] ? 'typing' : '')).join('')}</div>`;
        r++;
      }
      for (; r < total; r++) rows += emptyRow(done >= 0 ? 'dead' : '');
    }
    let cls = done >= 0 ? 'solved' : '';
    let label = done >= 0 ? `✓ in ${done + 1}` : '';
    if (over && done < 0) { cls = 'failed'; label = game.answers[b].toUpperCase(); }
    html += `<div class="board ${cls}"><div class="label"><span>Board ${b + 1}</span><span>${label}</span></div>${rows}</div>`;
  }
  el.innerHTML = html;
  $('#input-preview').textContent = st.input || '';
}

const KB = ['qwertyuiop', 'asdfghjkl', '<zxcvbnm>'];
const SEG_COLORS = { '-1': 'transparent', 0: '#232327', 1: 'var(--yellow)', 2: 'var(--green)', solved: '#1e1e22' };

function renderKeyboard(histories) {
  const n = histories.length;
  const status = histories.map((h) => {
    const s = {};
    for (const [w, f] of h) for (let i = 0; i < 5; i++) s[w[i]] = Math.max(s[w[i]] ?? -1, f[i]);
    return s;
  });
  const solved = histories.map((h) => h.length > 0 && allGreen(h[h.length - 1][1]));
  const cols = n <= 2 ? n : n <= 8 ? (n === 4 ? 2 : 4) : 4;
  const rowsN = Math.ceil(n / cols);
  $('#keyboard').innerHTML = KB.map((row) => `<div class="krow">${[...row].map((c) => {
    if (c === '<') return '<button class="key wide" data-k="enter">Invio</button>';
    if (c === '>') return '<button class="key wide" data-k="back">⌫</button>';
    const segs = status.map((s, b) => `<i style="background:${solved[b] ? SEG_COLORS.solved : SEG_COLORS[s[c] ?? -1]}"></i>`).join('');
    return `<button class="key" data-k="${c}"><div class="segs" style="grid-template-columns:repeat(${cols},1fr);grid-template-rows:repeat(${rowsN},1fr)">${segs}</div><span>${c}</span></button>`;
  }).join('')}</div>`).join('');
}

function renderStatus() {
  if (tab === 'assist') return;
  const solved = game.answers.filter((_, b) => solvedAt(b) >= 0).length;
  let s = `Tentativo ${Math.min(game.guesses.length + 1, game.max)}/${game.max} · ${solved}/${game.n} risolte`;
  if (game.over) s = game.won ? `🎉 Vinto in ${game.guesses.length}/${game.max}` : `Persa (${solved}/${game.n} risolte)`;
  $('#status').textContent = s + (seedMode === 'daily' ? ` · ${game.day}` : '');
}

function render(recompute) {
  const histories = tab === 'assist' ? assistHistory() : gameHistory();
  renderBoards();
  renderKeyboard(histories);
  renderStatus();
  const showSolver = tab === 'assist' || helpOn;
  $('#solver').hidden = !showSolver;
  if (showSolver && recompute) requestSolve(histories);
}

// ---------- ottimizzatore ----------
const worker = new Worker('solver-worker.js');
let reqId = 0, solveTimer = null, lastSolve = null;

function requestSolve(histories) {
  clearTimeout(solveTimer);
  $('#solver-meta').textContent = 'Calcolo in corso…';
  solveTimer = setTimeout(() => {
    const st = current();
    worker.postMessage({
      id: ++reqId,
      boards: histories.map((h) => ({ history: h.map(([w, f]) => [w, toInt(f)]) })),
      turnsLeft: st.max - st.guesses.length,
      wide: tab === 'assist' && assist.wide,
    });
  }, 150);
}

worker.onmessage = (e) => {
  const d = e.data;
  if (d.id !== reqId) return;
  lastSolve = d;
  renderSolver(d);
};

function renderSolver(d) {
  const st = current();
  const finished = d.boards.every((b) => b.solved) || st.guesses.length >= st.max;
  $('#solver-meta').innerHTML = finished ? 'Partita conclusa.' :
    `Valutate ${d.pool.toLocaleString('it')} parole in ${d.ms} ms.` +
    (d.endgame ? ' <b class="warn">Fase finale: priorità alle parole che risolvono subito.</b>' : '');
  $('#sugg tbody').innerHTML = finished ? '' : d.suggestions.map((s, i) => `
    <tr data-w="${s.word}" class="${s.pSolve > 0 ? 'cand' : ''}" title="Clicca per inserirla">
      <td>${i + 1}</td><td class="w">${s.word}</td><td>${s.bits.toFixed(2)}</td>
      <td>${s.pSolve.toFixed(2)}</td><td>${s.expRemaining.toFixed(1)}</td>
      <td>${s.boards.map((b) => b + 1).join(', ') || '—'}</td></tr>`).join('');
  $('#cands').innerHTML = d.boards.map((b, i) => {
    if (b.solved) return `<div class="cboard"><b>Board ${i + 1}</b> <span class="muted">✓ risolta</span></div>`;
    if (b.count === 0) return `<div class="cboard"><b>Board ${i + 1}</b> <span class="warn">nessuna parola compatibile — controlla i colori</span></div>`;
    const p = (100 / b.count).toFixed(b.count > 100 ? 2 : 1);
    return `<div class="cboard"><b>Board ${i + 1}</b> ${b.count} candidati · ${p}% ciascuno${b.extended ? ' <span class="warn">(lista estesa)</span>' : ''}
      <div class="chips">${b.cands.map((w) => `<span class="chip" data-w="${w}">${w}</span>`).join('')}${b.count > b.cands.length ? `<span class="muted">+${b.count - b.cands.length}</span>` : ''}</div></div>`;
  }).join('');
}

function useWord(w) {
  if (tab !== 'assist' && game.over) return;
  current().input = w;
  render(false);
}

// ---------- UI ----------
let toastTimer;
function toast(msg, ms = 1400) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
function shake() {
  document.querySelectorAll('.tile.typing, .row:has(.tile.typing)').forEach((r) => {
    if (r.classList.contains('row')) { r.classList.remove('shake'); void r.offsetWidth; r.classList.add('shake'); }
  });
}

function switchTab(t) {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
  $('#play').hidden = t === 'connections';
  $('#conn').hidden = t !== 'connections';
  store.set('tab', t);
  if (t === 'connections') { tab = t; return Conn.show(); }
  tab = t;
  $('#game-toolbar').hidden = t === 'assist';
  $('#assist-toolbar').hidden = t !== 'assist';
  if (t !== 'assist') loadGame(false);
  else { $('#assist-n').value = assist.n; $('#assist-max').value = assist.max; $('#assist-wide').checked = assist.wide; }
  render(true);
}

$('#tabs').addEventListener('click', (e) => { if (e.target.dataset.tab) switchTab(e.target.dataset.tab); });
$('#seed-mode').addEventListener('click', (e) => {
  if (!e.target.dataset.seed) return;
  seedMode = e.target.dataset.seed; store.set('seedMode', seedMode);
  document.querySelectorAll('#seed-mode button').forEach((b) => b.classList.toggle('active', b.dataset.seed === seedMode));
  loadGame(false); render(true);
});
$('#new-game').addEventListener('click', () => {
  if (seedMode === 'daily') { toast('La giornaliera è una sola: passa a "Libera" per nuove partite'); return; }
  loadGame(true); render(true);
});
$('#help-toggle').checked = helpOn;
$('#help-toggle').addEventListener('change', (e) => { helpOn = e.target.checked; store.set('helpOn', helpOn); render(true); });

$('#assist-n').addEventListener('change', (e) => {
  const n = +e.target.value;
  const defMax = { 1: 6, 2: 7, 4: 9, 8: 13, 16: 21 }[n];
  assist = { n, max: defMax, wide: assist.wide, guesses: [], fb: [], input: '' };
  $('#assist-max').value = defMax;
  store.set('assist', assist); render(true);
});
$('#assist-max').addEventListener('change', (e) => { assist.max = Math.max(assist.guesses.length || 1, Math.min(30, +e.target.value || 1)); e.target.value = assist.max; store.set('assist', assist); render(true); });
$('#assist-wide').addEventListener('change', (e) => { assist.wide = e.target.checked; store.set('assist', assist); render(true); });
$('#assist-undo').addEventListener('click', () => { assist.guesses.pop(); assist.fb.pop(); store.set('assist', assist); render(true); });
$('#assist-reset').addEventListener('click', () => { assist.guesses = []; assist.fb = []; assist.input = ''; store.set('assist', assist); render(true); });

$('#keyboard').addEventListener('click', (e) => { const k = e.target.closest('.key'); if (k) { press(k.dataset.k); k.blur(); } });
$('#boards').addEventListener('click', (e) => {
  const t = e.target.closest('.tile.click');
  if (t) cycleTile(+t.dataset.r, +t.dataset.b, +t.dataset.i);
});
$('#solver').addEventListener('click', (e) => { const t = e.target.closest('[data-w]'); if (t) useWord(t.dataset.w); });
document.addEventListener('keydown', (e) => {
  if (tab === 'connections') return;
  if (e.ctrlKey || e.metaKey || e.altKey || ['INPUT', 'SELECT'].includes(e.target.tagName)) return;
  if (e.key === 'Enter') { e.preventDefault(); press('enter'); }
  else if (e.key === 'Backspace') press('back');
  else if (/^[a-zA-Z]$/.test(e.key)) press(e.key.toLowerCase());
});

document.querySelectorAll('#seed-mode button').forEach((b) => b.classList.toggle('active', b.dataset.seed === seedMode));
switchTab(store.get('tab', 'quordle'));
