// Web Worker per l'ottimizzatore Connections
importScripts('connections-data.js', 'connections-solver.js');

let solver = null, boardKey = '';
const ready = Promise.all([
  fetch('glove-vocab.txt').then((r) => r.text()),
  fetch('glove.bin').then((r) => r.arrayBuffer()),
]).then(([vocab, buf]) => { solver = new self.ConnSolver(vocab, buf, self.CONNECTIONS); });

self.onmessage = async (e) => {
  const { id, words, remaining, guesses, solved } = e.data;
  await ready;
  const t0 = performance.now();
  const key = words.join('|');
  if (key !== boardKey) { solver.setBoard(words); boardKey = key; }
  const r = solver.solve(remaining, guesses, solved);
  // parole collegate nell'archivio (stesso gruppo in altri puzzle)
  const n = words.length, links = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (remaining.includes(i) && remaining.includes(j) && solver.cooc[i * n + j] > 0) links.push([i, j]);
  }
  self.postMessage({ id, ...r, unknown: solver.unknown, links, ms: Math.round(performance.now() - t0) });
};
