# Wordle Dashboard

Dashboard web per giocare a **Wordle**, **Quordle**, **Octordle** e **Connections**, con un ottimizzatore che suggerisce le mosse migliori. Gira in un container Podman (nginx che serve file statici); tutto il calcolo avviene nel browser.

## Funzionalità

| Sezione | Cosa fa |
|---|---|
| Wordle / Quordle / Octordle | 1, 4 o 8 board (6, 9, 13 tentativi). Partita **giornaliera** (uguale per tutto il giorno) o **libera**. |
| Assistente | Per giocare sul sito originale: inserisci la parola usata e imposta i colori cliccando le caselle (1–16 board). |
| Ottimizzatore Wordle | Valuta ~13.000 parole: informazione attesa (bit), board risolte attese, candidati rimanenti e soluzioni possibili per board. |
| Connections | Puzzle NYT del giorno, casuale, da archivio (numero) o personalizzato (incolli 16 parole). |
| Ottimizzatore Connections | Probabilità di ogni gruppo di 4, calcolata sulle partizioni compatibili con i tuoi tentativi, usando similarità semantica (GloVe) e categorie dei puzzle passati. |

I progressi vengono salvati nel `localStorage` del browser.

## Requisiti

- [Podman](https://podman.io/) (testato con 5.4 su Raspberry Pi / arm64; funziona anche su x86_64)
- Per rigenerare i dati: `python3` con `numpy`, `curl`

## Installazione ed esecuzione

```sh
cd wordle-dashboard
./run.sh
```

Lo script costruisce l'immagine `wordle-dashboard`, rimuove l'eventuale container precedente e ne avvia uno nuovo. Poi apri:

- http://localhost:8080 dalla macchina stessa
- `http://<ip-della-macchina>:8080` dagli altri dispositivi della rete

Per usare un'altra porta:

```sh
PORT=9000 ./run.sh
```

Dopo ogni modifica ai file in `app/` rilancia `./run.sh`.

### Comandi utili

```sh
podman ps --filter name=wordle-dashboard   # stato
podman logs wordle-dashboard               # log di nginx
podman stop wordle-dashboard               # ferma
podman start wordle-dashboard              # riavvia
podman rm -f wordle-dashboard              # elimina il container
```

### Avvio automatico al boot (systemd, utente)

Il flag `--restart=unless-stopped` non basta: con Podman rootless il container non riparte da solo dopo un riavvio. Per farlo partire al boot:

```sh
mkdir -p ~/.config/containers/systemd
cat > ~/.config/containers/systemd/wordle-dashboard.container <<'EOF'
[Container]
Image=localhost/wordle-dashboard:latest
ContainerName=wordle-dashboard
PublishPort=8080:80

[Service]
Restart=always

[Install]
WantedBy=default.target
EOF

podman rm -f wordle-dashboard          # rimuove il container avviato da run.sh
systemctl --user daemon-reload
systemctl --user start wordle-dashboard
loginctl enable-linger "$USER"         # avvio anche senza login
```

Dopo aver ricostruito l'immagine con `podman build -t wordle-dashboard .`, riavvia con `systemctl --user restart wordle-dashboard`.

### Senza container (sviluppo)

L'app è composta solo da file statici, quindi basta un qualsiasi server HTTP:

```sh
cd app && python3 -m http.server 8080
```

Serve un server HTTP perché i Web Worker e il caricamento dei dati non funzionano aprendo `index.html` come file.

## Aggiornare l'archivio di Connections

Il puzzle giornaliero viene preso dall'archivio incluso nell'app, che non si aggiorna da solo. Per scaricare i puzzle nuovi e ricostruire il container:

```sh
./tools/update-connections.sh
```

Se l'archivio non contiene il puzzle di oggi, la modalità Giornaliera mostra l'ultimo disponibile.

## Rigenerare i dati (opzionale)

I file di dati sono già inclusi in `app/`. Servono solo se vuoi ricrearli.

**Liste di parole Wordle** (`app/words.js`): generate dalle liste di [cfreshman](https://gist.github.com/cfreshman) (`wordle-answers-alphabetical.txt`, `wordle-allowed-guesses.txt`).

**Vettori semantici** (`app/glove.bin`, `app/glove-vocab.txt`): vettori GloVe 6B da 300 dimensioni, ristretti alle 40.000 parole più frequenti più quelle dei puzzle e quantizzati a int8 (~12 MB):

```sh
curl -L -o /tmp/glove.6B.zip https://huggingface.co/stanfordnlp/glove/resolve/main/glove.6B.zip   # ~860 MB
curl -L -o /tmp/connections.json https://raw.githubusercontent.com/Eyefyre/NYT-Connections-Answers/main/connections.json
python3 tools/build_connections_data.py glove /tmp/glove.6B.zip /tmp/connections.json app 300 40000
python3 tools/build_connections_data.py puzzles /tmp/connections.json app
./run.sh
```

## Struttura

```
wordle-dashboard/
├── Containerfile                 # immagine nginx:alpine con i file di app/
├── run.sh                        # build + avvio del container
├── app/
│   ├── index.html, style.css
│   ├── app.js                    # Wordle/Quordle/Octordle e Assistente
│   ├── solver-worker.js          # ottimizzatore Wordle (Web Worker)
│   ├── words.js                  # liste di parole
│   ├── connections-ui.js         # gioco Connections
│   ├── connections-solver.js     # ottimizzatore Connections
│   ├── conn-worker.js            # Web Worker per Connections
│   ├── connections-data.js       # archivio puzzle NYT
│   └── glove.bin, glove-vocab.txt
└── tools/
    ├── build_connections_data.py # genera archivio e vettori
    └── update-connections.sh     # aggiorna l'archivio e ricostruisce
```

## Come funzionano gli ottimizzatori

**Wordle/Quordle/Octordle.** Per ogni board tiene le soluzioni ancora compatibili con i colori ricevuti. Per ogni parola possibile calcola quanta informazione darebbe (entropia della distribuzione dei colori, sommata sulle board) e quante board potrebbe risolvere subito. Una board con un solo candidato rimasto ha la precedenza. Quando i tentativi rimasti non sono più delle board da risolvere, sceglie solo parole che possono essere la soluzione. Su partite simulate ha vinto 15 Quordle su 15 (in media 6,9 tentativi) e 8 Octordle su 8 (in media 10,1 tentativi).

**Connections.** Ogni possibile divisione delle parole in gruppi da 4 riceve un punteggio. Il punteggio somma tre cose: la somiglianza di significato (GloVe), le coppie di parole già comparse insieme in altri puzzle e la vicinanza alle categorie già viste. Le divisioni incompatibili con i tentativi fatti ("sbagliato" / "uno di distanza") vengono scartate, e la probabilità di ogni gruppo si calcola sulle divisioni rimaste. Il puzzle in corso viene escluso dalle statistiche. Sui puzzle dell'archivio il primo suggerimento è corretto in circa il 28% dei casi. I giochi di parole (anagrammi, parole nascoste, omofoni) gli sfuggono spesso.
