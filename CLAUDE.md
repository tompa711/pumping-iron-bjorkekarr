# Träningslogg

En enkel träningslogg-app som körs helt lokalt i webbläsaren. Ingen
backend, inget byggsteg – öppna bara `index.html` i webbläsaren.

## Vad appen gör (v1 + v2 + v3)

- **Profil**: Namn, vikt (kg), längd (cm). Sparas lokalt och används för
  att räkna ut BMI och en uppskattning av kaloriförbrukning.
- **Logga pass**: Datum, passtyp och pass-längd (minuter). Passtyper:
  - **Styrka**: man anger dessutom en lista av övningar (namn, vikt,
    reps) – flera övningar kan läggas till i samma pass.
  - **Löpning / Promenad / Cykling / Crosstrainer** (konditionspass):
    inga övningar/vikt/reps, istället anger man **tempo eller
    snitthastighet** för passet (se nedan), eftersom det gör stor
    skillnad för kaloriförbrukningen om t.ex. löpningen skedde i
    5 min/km eller 10 min/km.
  - Löpning, promenad och crosstrainer anges som **tempo i min/km**
    (lägre värde = snabbare). Cykling anges som **snitthastighet i
    km/h** (högre värde = snabbare) – det är så farten normalt anges
    för respektive aktivitet.
- **Redigera pass**: Varje rad i historiken har en "Redigera"-knapp som
  laddar in passet i formuläret ovan (datum, längd, typ, tempo/fart,
  ev. övningar) så man kan ändra det och spara igen. "Avbryt
  redigering" återgår till att logga ett nytt pass.
- **Historik**: Tabell över alla sparade pass med passtyp, längd,
  tempo/fart, ev. övningar och uträknade kalorier (baserat på profilens
  vikt, passets längd och en MET-nivå som räknas ut från tempot/farten
  för konditionspass). Man kan ta bort enskilda pass.

## Datalagring

All data sparas i webbläsarens `localStorage` (ingen server, ingen
databas). Det betyder:

- Data finns bara på den dator/webbläsare där den sparades.
- Rensar man webbläsarens data (cache/cookies) försvinner loggen.
- Ingen data skickas någonstans – allt stannar lokalt.

Två nycklar används:
- `traningslogg_profile` – ett objekt: `{ name, weightKg, heightCm }`
- `traningslogg_sessions` – en lista av pass:
  `{ id, type, date, durationMin, pace, exercises: [{ name, weight, reps }] }`
  - `type` är `"strength"`, `"running"`, `"walking"`, `"cycling"` eller
    `"elliptical"`.
  - `exercises` är alltid en tom lista `[]` utom för `"strength"`.
  - `pace` är `null` för `"strength"`. För övriga typer är det ett tal:
    tempo i **min/km** för löpning/promenad/crosstrainer, eller
    snitthastighet i **km/h** för cykling (se `PACE_UNIT_BY_TYPE` i
    `app.js`).
  - Pass sparade innan `type` fanns tolkas som `"strength"`
    (`s.type || "strength"`) för bakåtkompatibilitet.

## Beräkningar

- **BMI** = vikt(kg) / längd(m)².
- **Kalorier per pass** använder en MET-baserad tumregelsformel:
  `kcal/min = MET * 3.5 * kroppsvikt(kg) / 200`. MET (Metabolic
  Equivalent of Task) räknas ut olika beroende på passtyp
  (se `computeMET()` i `app.js`):
  - **Styrka**: fast schablonvärde, MET 5.0.
  - **Löpning**: `MET = 0.9524 × fart(km/h) + 1` (ACSM:s löpformel).
  - **Promenad**: `MET = 0.4762 × fart(km/h) + 1` (ACSM:s gångformel,
    mest träffsäker för lugnare promenadtempo).
  - **Crosstrainer**: `MET = 0.7 × fart(km/h) + 2` (grov
    approximation, ingen vedertagen standardformel finns).
  - **Cykling**: MET-nivå per hastighetsintervall (t.ex. <16 km/h → 4.0,
    19–22 km/h → 8.0, 25–30 km/h → 12.0, osv).

  Fart i km/h räknas i sin tur ut från det inmatade tempot/hastigheten
  (`paceToSpeedKmh()`): `60 / tempo(min/km)` för löpning/promenad/
  crosstrainer, eller direkt som det inmatade värdet för cykling.

  Detta är uppskattningar baserade på kända samband mellan fart och
  energiåtgång, inte exakta labbmätningar (ingen pulsdata används).

## Filstruktur

- `index.html` – sidstruktur och formulär
- `style.css` – utseende
- `app.js` – all logik: spara/läsa localStorage, beräkningar, rendering
- `CLAUDE.md` – den här filen

Rent vanilla JS, ingen framework, inga externa beroenden. Ingen
byggprocess krävs.

## Möjliga nästa steg (inte byggt än)

- Statistik över tid (t.ex. graf på volym eller vikt per övning, eller
  tempoutveckling för löpning).
- Export/import av data (t.ex. till JSON-fil) som backup, eftersom
  localStorage är knutet till en enskild webbläsare/dator.
- Fler konditionspasstyper (t.ex. simning, rodd) eller möjlighet att
  själv justera MET-formeln/faktorn.
- Automatisk uträkning av distans (utifrån längd + tempo/fart) och
  visning av den i historiken.
- En riktig backend om datan ska synkas mellan enheter.
