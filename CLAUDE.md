# Träningslogg

En enkel träningslogg-app som körs helt lokalt i webbläsaren. Ingen
backend, inget byggsteg – öppna bara `index.html` i webbläsaren.

## Vad appen gör (v1)

- **Profil**: Namn, vikt (kg), längd (cm). Sparas lokalt och används för
  att räkna ut BMI och en uppskattning av kaloriförbrukning.
- **Logga pass**: Datum, pass-längd (minuter) och en lista av övningar
  (namn, vikt, reps) per pass. Man kan lägga till flera övningar i
  samma pass.
- **Historik**: Tabell över alla sparade pass, med uträknade kalorier
  per pass baserat på profilens vikt och passets längd. Man kan ta bort
  enskilda pass.

## Datalagring

All data sparas i webbläsarens `localStorage` (ingen server, ingen
databas). Det betyder:

- Data finns bara på den dator/webbläsare där den sparades.
- Rensar man webbläsarens data (cache/cookies) försvinner loggen.
- Ingen data skickas någonstans – allt stannar lokalt.

Två nycklar används:
- `traningslogg_profile` – ett objekt: `{ name, weightKg, heightCm }`
- `traningslogg_sessions` – en lista av pass:
  `{ id, date, durationMin, exercises: [{ name, weight, reps }] }`

## Beräkningar

- **BMI** = vikt(kg) / längd(m)².
- **Kalorier per pass** använder en MET-baserad tumregelsformel:
  `kcal/min = MET * 3.5 * kroppsvikt(kg) / 200`, med MET = 5.0 som ett
  schablonvärde för styrketräning med måttlig-hög intensitet. Detta är
  en uppskattning, inte en exakt mätning (ingen pulsdata eller
  liknande används).

## Filstruktur

- `index.html` – sidstruktur och formulär
- `style.css` – utseende
- `app.js` – all logik: spara/läsa localStorage, beräkningar, rendering
- `CLAUDE.md` – den här filen

Rent vanilla JS, ingen framework, inga externa beroenden. Ingen
byggprocess krävs.

## Möjliga nästa steg (inte byggt än)

- Redigera/uppdatera ett redan sparat pass.
- Statistik över tid (t.ex. graf på volym eller vikt per övning).
- Export/import av data (t.ex. till JSON-fil) som backup, eftersom
  localStorage är knutet till en enskild webbläsare/dator.
- Egen justerbar MET-faktor per övningstyp (styrka vs. konditionsinslag)
  istället för ett fast schablonvärde.
- En riktig backend om datan ska synkas mellan enheter.
