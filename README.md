# Valutazione VRU — Web App Offline per Istruttori di Guida

PWA mobile-first statica (senza backend) costruita con **TypeScript Vanilla + Vite + Workbox**, utilizzabile offline sullo smartphone dell'istruttore al termine di una lezione pratica su strada. Implementa la griglia [griglia_valutazione_vru_istruttori.pdf](./griglia_valutazione_vru_istruttori.pdf) (protocollo CIECA / EFA / FORS, Matrice GDE Livelli 1–4, Red Flag PRACDRIVA, debriefing GROW HERMES).

## Funzionalità principali

* **Flusso su singolo dispositivo con passaggio cieco:** l'istruttore valuta i 6 domini (con supporto `N/A` per veicoli senza ADAS e soglia proporzionale `20/25`) e le 3 Red Flag; i voti e le segnalazioni istruttore vengono smontati dal DOM prima della consegna del telefono all'allievo.
* **Autovalutazione in linguaggio non tecnico e schermata di riconsegna:** l'allievo valuta gli stessi domini attivi in italiano semplice, quindi una schermata intermedia invita a restituire il telefono prima di rivelare confronto ed esito.
* **Confronto, debriefing GROW e PNG `1080px`:** grafico a barre orizzontali HTML/CSS (soglia `4/5`), indice di calibrazione (`A - I` e punti ciechi per dominio), 4 domande guida GROW canoniche in sola lettura, consigli di ripasso deterministici e condivisione sincrona di un PNG `1080px` renderizzato via Canvas 2D nativo.
* **Statistiche anonime di gruppo e Vista Coordinatore:** nessun archivio nominativo (`studentLabel` opzionale risiede solo in RAM). I record anonimi di gruppo (`YYYY-MM`, fascia km, zero PII, zero ID istruttore) sono salvati in `localStorage`, esportabili in `.json` versionato e aggregabili localmente nella Vista Coordinatore con deduplicazione su `evaluationId` ed export `.csv` per Excel/Fogli Google.

## Requisiti e Comandi Locali

Prerequisiti: Node.js `>= 20`.

```bash
npm install
npm run dev            # Server di sviluppo locale
npm run typecheck      # Verifica TypeScript strict (tsc --noEmit)
npm run lint           # ESLint v9 (--max-warnings=0)
npm run test           # Unit test Vitest
npm run test:coverage  # Unit test con soglia >= 90% branch coverage
npm run build          # Build statico PWA + Service Worker in dist/
npm run preview        # Anteprima produzione su http://127.0.0.1:4173
npm run test:e2e       # Test E2E mobile 390x844 offline (Playwright)
```

*(Su Windows PowerShell con criteri di esecuzione restrittivi, usare `npm.cmd` al posto di `npm`.)*

## Pubblicazione su Hosting Statico HTTPS

Il risultato di `npm run build` (`dist/`) è interamente statico con `base: "./"`, pubblicabile su qualsiasi hosting HTTPS (Netlify, Cloudflare Pages, GitHub Pages, o server web dell'autoscuola) senza backend né variabili d'ambiente.

## Installazione su Smartphone (iOS e Android)

1. Apri l'URL HTTPS della web app una prima volta con connessione attiva (per installare il precache offline del Service Worker).
2. **iOS (Safari):** tocca il pulsante *Condividi* → *«Aggiungi a schermata Home»* → *Aggiungi*. L'installazione su Home Screen previene la pulizia automatica dei dati browser dopo 7 giorni di inattività.
3. **Android (Chrome):** tocca il menu *⋮* → *«Installa app»* o *«Aggiungi a schermata Home»*.

## Nota Procedurale su Privacy e Anonimato (GDPR & Art. 4 L. 300/1970)

* L'applicazione non trasmette alcun dato verso server esterni (`connect-src 'none'`).
* L'eventuale nome o iniziali dell'allievo inseriti per intestare il PNG restano solo in memoria volatile e non vengono mai scritti in `localStorage` né nei file `.json`/`.csv`.
* I file `.json` statistici contengono esclusivamente mese (`YYYY-MM`), fascia km, tipo veicolo, meteo/luce, punteggi numerici, Red Flag booleane ed esito, ordinati per `evaluationId` casuale.
* **Raccomandazione operativa per il coordinatore:** raccogliere e importare insieme i file `.json` mensili di più istruttori prima di analizzare le medie, evitando di esaminare isolatamente file con `< 5` guide così da preservare l'anonimato di gruppo sia per gli allievi sia per gli istruttori.
