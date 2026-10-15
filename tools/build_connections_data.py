#!/usr/bin/env python3
"""Genera i dati per Connections.

  build_connections_data.py puzzles <connections.json> <app_dir>
      -> app/connections-data.js (archivio puzzle NYT)
  build_connections_data.py glove <glove.6B.zip> <connections.json> <app_dir> [dim] [top_words]
      -> app/glove-vocab.txt + app/glove.bin (vettori normalizzati, int8)
"""
import json, re, sys, zipfile

TOP_WORDS = 60000


def load_puzzles(path):
    data = json.load(open(path, encoding="utf-8"))
    out = []
    for p in data:
        groups = sorted(p.get("answers", []), key=lambda g: g.get("level", 0))
        if len(groups) != 4 or any(len(g.get("members", [])) != 4 for g in groups):
            continue
        out.append({
            "id": int(p["id"]),
            "date": str(p["date"])[:10],
            "groups": [{"name": str(g["group"]), "level": int(g.get("level", i)),
                        "members": [str(m).upper() for m in g["members"]]} for i, g in enumerate(groups)],
        })
    out.sort(key=lambda p: p["id"])
    return out


def tokens(member):
    return [t for t in re.split(r"[^a-z0-9]+", member.lower()) if t]


def build_puzzles(src, app):
    puzzles = load_puzzles(src)
    with open(f"{app}/connections-data.js", "w", encoding="utf-8") as f:
        f.write("// Archivio NYT Connections\nself.CONNECTIONS=")
        json.dump(puzzles, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    print(f"{len(puzzles)} puzzle, ultimo {puzzles[-1]['date']}")


def build_glove(zip_path, src, app, dim=100, top=TOP_WORDS):
    import numpy as np
    wanted = {t for p in load_puzzles(src) for g in p["groups"] for m in g["members"] for t in tokens(m)}
    words, vecs = [], []
    with zipfile.ZipFile(zip_path) as z, z.open(f"glove.6B.{dim}d.txt") as fh:
        for i, line in enumerate(fh):
            w, rest = line.decode("utf-8").rstrip("\n").split(" ", 1)
            if not re.fullmatch(r"[a-z0-9]+", w):
                continue
            if i < top or w in wanted:
                words.append(w)
                vecs.append(np.array(rest.split(" "), dtype=np.float32))
    m = np.stack(vecs)
    m /= np.linalg.norm(m, axis=1, keepdims=True) + 1e-9
    q = np.clip(np.round(m * 127 / np.abs(m).max()), -127, 127).astype(np.int8)
    q.tofile(f"{app}/glove.bin")
    open(f"{app}/glove-vocab.txt", "w").write("\n".join(words))
    missing = sorted(wanted - set(words))
    print(f"{len(words)} parole, {q.nbytes / 1e6:.1f} MB; token puzzle mancanti: {len(missing)} es. {missing[:15]}")


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "puzzles":
        build_puzzles(sys.argv[2], sys.argv[3])
    elif cmd == "glove":
        build_glove(sys.argv[2], sys.argv[3], sys.argv[4], *map(int, sys.argv[5:7]))
