'use strict';
// Connections: gioco (archivio NYT) + puzzle personalizzato + ottimizzatore
const Conn = (() => {
  const $ = (s) => document.querySelector(s);
  const P = self.CONNECTIONS;
  const byId = new Map(P.map((p) => [p.id, p]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

  let source = store.get('conn:source', 'daily'); // daily | random | archive | custom
  let helpOn = store.get('conn:help', false);
  let st = null;          // stato partita
  let selected = new Set();
  let pending = null;     // custom: tentativo in attesa del risultato

  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  function newState(p) {
    const words = p.groups.flatMap((g) => g.members);
    return { pid: p.id, date: p.date, words, groups: p.groups, order: shuffle([...words]), solved: [], guesses: [], mistakes: 0, over: false, won: false };
  }
  const key = () => (st.pid ? `conn:p${st.pid}` : 'conn:custom');
  const save = () => { store.set(key(), st); if (st.pid) store.set('conn:lastArchive', st.pid); };

  function loadPuzzle(id) {
    const p = byId.get(id);
    if (!p) return toast('Puzzle non trovato');
    st = store.get(`conn:p${id}`, null) || newState(p);
    selected.clear(); pending = null;
    $('#conn-num').value = id;
  }

  function loadSource() {
    if (source === 'daily') {
      const p = P.find((x) => x.date === today()) || P[P.length - 1];
      loadPuzzle(p.id);
    } else if (source === 'random') {
      loadPuzzle(store.get('conn:lastRandom', null) || randomId());
    } else if (source === 'archive') {
      loadPuzzle(store.get('conn:lastArchive', P[P.length - 1].id));
    } else {
      st = store.get('conn:custom', null);
      selected.clear(); pending = null;
    }
    $('#conn-custom-box').hidden = source !== 'custom' || (st && st.words.length === 16);
  }
  function randomId() { const id = P[Math.floor(Math.random() * P.length)].id; store.set('conn:lastRandom', id); return id; }

  // ---------- azioni ----------
  function toggle(w) {
    if (!st || st.over || pending) return;
    if (selected.has(w)) selected.delete(w);
    else if (selected.size < 4) selected.add(w);
    render(false);
  }

  function submit() {
    if (!st || st.over || selected.size !== 4 || pending) return;
    const g = [...selected];
    const same = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
    if (st.guesses.some((x) => same(x.members, g))) return toast('Già provato!');
    if (!st.groups) { pending = g; return render(false); }
    const hit = st.groups.find((grp) => same(grp.members, g));
    if (hit) return applyResult(g, 'ok', hit);
    const oneAway = st.groups.some((grp) => grp.members.filter((m) => g.includes(m)).length === 3);
    if (oneAway) toast('Uno di distanza…');
    applyResult(g, oneAway ? 'one' : 'wrong');
  }

  function applyResult(g, result, hit) {
    st.guesses.push({ members: g, result });
    if (result === 'ok') {
      st.solved.push(hit || { name: `Gruppo ${st.solved.length + 1}`, level: st.solved.length, members: g });
      st.order = st.order.filter((w) => !g.includes(w));
    } else st.mistakes++;
    selected.clear(); pending = null;
    if (st.solved.length === 4) { st.over = true; st.won = true; toast(st.mistakes ? `Risolto con ${st.mistakes} errori` : 'Perfetto!', 2500); }
    else if (st.groups && st.mistakes >= 4) {
      st.over = true;
      for (const grp of st.groups) if (!st.solved.includes(grp) && !st.solved.some((s) => s.name === grp.name)) st.solved.push({ ...grp, revealed: true });
      st.order = [];
      toast('Partita finita', 2500);
    } else if (st.solved.length === 3) {
      // l'ultimo gruppo è determinato
      const last = st.order.slice();
      const hit2 = st.groups && st.groups.find((grp) => grp.members.every((m) => last.includes(m)));
      st.solved.push(hit2 || { name: `Gruppo 4`, level: 3, members: last });
      st.order = []; st.over = true; st.won = true;
      toast(st.mistakes ? `Risolto con ${st.mistakes} errori` : 'Perfetto!', 2500);
    }
    save(); render(true);
  }

  function startCustom() {
    const words = $('#conn-custom-text').value.split(/[\n,;]+/).map((w) => w.trim().toUpperCase()).filter(Boolean);
    const uniq = [...new Set(words)];
    if (uniq.length !== 16) return toast(`Servono 16 parole diverse (ne hai ${uniq.length})`);
    st = { pid: null, words: uniq, groups: null, order: [...uniq], solved: [], guesses: [], mistakes: 0, over: false, won: false };
    selected.clear(); pending = null;
    save(); $('#conn-custom-box').hidden = true; render(true);
  }

  // ---------- ottimizzatore ----------
  let worker = null, reqId = 0, last = null;
  function requestSolve() {
    if (!st || st.over || st.order.length === 0) { last = null; renderSolver(); return; }
    if (!worker) {
      worker = new Worker('conn-worker.js');
      worker.onmessage = (e) => { if (e.data.id === reqId) { last = e.data; renderSolver(); } };
    }
    $('#conn-meta').textContent = 'Calcolo in corso… (la prima volta carica il modello semantico, ~6 MB)';
    $('#conn-sugg').innerHTML = '';
    const ix = (w) => st.words.indexOf(w);
    worker.postMessage({
      id: ++reqId,
      words: st.words,
      remaining: st.order.map(ix).sort((a, b) => a - b),
      guesses: st.guesses.filter((g) => g.result !== 'ok').map((g) => ({ idx: g.members.map(ix), oneAway: g.result === 'one' })),
      solved: st.solved.map((g) => g.members.map(ix)),
    });
  }

  function renderSolver() {
    if (!last) { $('#conn-meta').textContent = st && st.over ? 'Partita conclusa.' : ''; $('#conn-sugg').innerHTML = ''; $('#conn-best').innerHTML = ''; return; }
    const W = st.words;
    $('#conn-meta').innerHTML = `${last.partitions.toLocaleString('it')} partizioni compatibili valutate in ${last.ms} ms.` +
      (last.unknown.length ? ` <span class="warn">Parole sconosciute al modello: ${last.unknown.map(esc).join(', ')}</span>` : '');
    $('#conn-sugg').innerHTML = last.groups.map((g, i) => `
      <tr data-g="${g.idx.join(',')}" title="Clicca per selezionarlo">
        <td>${i + 1}</td><td class="cw">${g.idx.map((k) => esc(W[k])).join(' · ')}</td>
        <td><div class="pbar"><i style="width:${(g.p * 100).toFixed(1)}%"></i><span>${(g.p * 100).toFixed(1)}%</span></div></td></tr>`).join('');
    $('#conn-best').innerHTML = last.best.map((g, i) => `<div class="cgroup lv${(st.solved.length + i) % 4} mini">${g.map((k) => esc(W[k])).join(', ')}</div>`).join('') +
      (last.links.length ? `<div class="muted" style="margin-top:8px">Già comparse insieme in altri puzzle: ${last.links.map(([a, b]) => `${esc(W[a])}+${esc(W[b])}`).join(', ')}</div>` : '');
  }

  // ---------- rendering ----------
  function render(recompute) {
    document.querySelectorAll('#conn-source button').forEach((b) => b.classList.toggle('active', b.dataset.src === source));
    $('#conn-archive').hidden = source !== 'archive';
    $('#conn-new').hidden = source !== 'random';
    $('#conn-edit').hidden = source !== 'custom';
    $('#conn-help').checked = helpOn;
    const showSolver = helpOn || source === 'custom';
    $('#conn-solver').hidden = !showSolver;
    if (!st) { $('#conn-board').innerHTML = ''; $('#conn-solved').innerHTML = ''; $('#conn-status').textContent = ''; $('#conn-result').hidden = true; return; }

    $('#conn-solved').innerHTML = st.solved.map((g) => `
      <div class="cgroup lv${g.level}${g.revealed ? ' revealed' : ''}"><b>${esc(g.name)}</b><span>${g.members.map(esc).join(', ')}</span></div>`).join('');
    $('#conn-board').innerHTML = st.order.map((w) =>
      `<button class="cword${selected.has(w) ? ' sel' : ''}${pending && pending.includes(w) ? ' pend' : ''}" data-w="${esc(w)}"><span style="font-size:${w.length > 9 ? 11 : w.length > 7 ? 13 : 15}px">${esc(w)}</span></button>`).join('');
    $('#conn-dots').innerHTML = st.groups
      ? 'Errori rimasti: ' + Array.from({ length: 4 }, (_, i) => `<i class="dot${i < 4 - st.mistakes ? '' : ' off'}"></i>`).join('')
      : `Errori: ${st.mistakes}`;
    $('#conn-status').textContent = st.pid ? `Puzzle #${st.pid} · ${st.date}` : 'Puzzle personalizzato';
    $('#conn-result').hidden = !pending;
    $('#conn-submit').disabled = selected.size !== 4 || st.over || !!pending;
    $('#conn-history').innerHTML = st.guesses.map((g) => `<div class="hist ${g.result}">${g.members.map(esc).join(', ')} — ${{ ok: '✓ corretto', one: 'uno di distanza', wrong: '✗ sbagliato' }[g.result]}</div>`).join('');
    if (showSolver && recompute) requestSolve();
    else if (showSolver && !last) requestSolve();
  }

  let toastTimer;
  function toast(msg, ms = 1500) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  // ---------- eventi ----------
  $('#conn-source').addEventListener('click', (e) => {
    const s = e.target.dataset.src; if (!s) return;
    source = s; store.set('conn:source', s); last = null;
    loadSource(); render(true);
  });
  $('#conn-new').addEventListener('click', () => { last = null; loadPuzzle(randomId()); render(true); });
  $('#conn-go').addEventListener('click', () => { last = null; loadPuzzle(+$('#conn-num').value); render(true); });
  $('#conn-num').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#conn-go').click(); });
  $('#conn-num').max = P[P.length - 1].id;
  $('#conn-edit').addEventListener('click', () => { $('#conn-custom-box').hidden = false; if (st) $('#conn-custom-text').value = st.words.join('\n'); });
  $('#conn-custom-go').addEventListener('click', () => { last = null; startCustom(); });
  $('#conn-help').addEventListener('change', (e) => { helpOn = e.target.checked; store.set('conn:help', helpOn); render(true); });
  $('#conn-board').addEventListener('click', (e) => { const b = e.target.closest('.cword'); if (b) toggle(b.dataset.w); });
  $('#conn-shuffle').addEventListener('click', () => { if (st) { shuffle(st.order); save(); render(false); } });
  $('#conn-clear').addEventListener('click', () => { selected.clear(); render(false); });
  $('#conn-submit').addEventListener('click', submit);
  $('#conn-reset').addEventListener('click', () => {
    if (!st) return;
    st = st.pid ? newState(byId.get(st.pid)) : { ...st, order: [...st.words], solved: [], guesses: [], mistakes: 0, over: false, won: false };
    selected.clear(); pending = null; last = null; save(); render(true);
  });
  $('#conn-result').addEventListener('click', (e) => { const r = e.target.dataset.r; if (r && pending) applyResult(pending, r); });
  $('#conn-result-cancel').addEventListener('click', () => { pending = null; render(false); });
  $('#conn-solver').addEventListener('click', (e) => {
    const tr = e.target.closest('[data-g]'); if (!tr || !st || st.over || pending) return;
    selected = new Set(tr.dataset.g.split(',').map((k) => st.words[+k]));
    render(false);
  });

  return {
    show() { if (!st) loadSource(); render(true); },
  };
})();
