# Pumping Iron Björkekärr – Träningslogg

En enkel träningslogg-app, byggd åt träningsgruppen "Pumping Iron
Björkekärr (och Hisingen)". Ren HTML/CSS/JS, inget byggsteg – funkar
både öppnad direkt som `index.html` och hostad på GitHub Pages
(`https://tompa711.github.io/pumping-iron-bjorkekarr/`). Inget eget
backend-API - molnlagring (se nedan) går direkt mot Supabase från
webbläsaren. **Kräver inloggning** (mejl + lösenord) - inget
gäst-/lokalt läge längre.

## Design/tema

Mörkt tema i svart/guld, inspirerat av gruppens WhatsApp-ikon
(bodybuilding-poster-känsla), men bygger **inte** på det faktiska
upphovsrättsskyddade fotot (Arnold Schwarzenegger-affischen) – headern
är en egen komposition:

- Rubrikfont: "Bebas Neue" (Google Fonts, laddas i `index.html`).
- Färgpalett: se `:root`-variablerna i `style.css` (`--accent`/
  `--accent-bright` = guld).
- Headern (`.poster` i `style.css`) har en cirkulär "PI"-badge, titel
  och undertext, ovanpå en mörk panel med ett subtilt guld-kryssmönster
  (`.poster::before`) som en nick till vattenmärket på inspirationsbilden.

## Vad appen gör (v1 + v2 + v3 + v4)

- **Inloggning krävs**: appen visar bara inloggnings-/
  registreringsformulär (mejl + lösenord) tills man är inloggad. Resten
  av appen (`#app-content` i `index.html`) är dold fram tills dess.
- **Snabbstatistik** (överst i appen, direkt under inloggningen):
  - **Dagar sedan senaste passet** (vilken passtyp som helst).
  - **Veckostreak**: antal veckor i rad med minst 3 pass. Nuvarande
    (ej avslutade) vecka räknas bara in om den redan nått 3 pass -
    annars påverkar den varken till eller från, och räkningen utgår
    från senast avslutade vecka istället (se `computeWeeklyStreak()`
    i `app.js` för exakt logik).
- **Profil**: Namn, vikt (kg), längd (cm). Sparas i molnet och används
  för att räkna ut BMI och en uppskattning av kaloriförbrukning.
- **Logga pass**: Datum, passtyp och pass-längd (minuter). Passtyper:
  - **Styrka**: man anger dessutom en lista av övningar (namn, vikt,
    reps) – flera övningar kan läggas till i samma pass. Övningsnamnet
    har sökförslag mot wger.de:s publika API (se **Övningssök** nedan).
  - **Löpning / Promenad / Cykling / Crosstrainer** (konditionspass):
    inga övningar/vikt/reps, istället anger man **tempo eller
    snitthastighet** för passet (se nedan), eftersom det gör stor
    skillnad för kaloriförbrukningen om t.ex. löpningen skedde i
    5 min/km eller 10 min/km.
  - Löpning, promenad och crosstrainer anges som **tempo i min/km**
    (lägre värde = snabbare). Cykling anges som **snitthastighet i
    km/h** (högre värde = snabbare) – det är så farten normalt anges
    för respektive aktivitet.
- **Auto-ifylld vikt/reps**: När man skriver in ett övningsnamn man
  loggat förut (matchar exakt, oavsett skiftläge) fylls senast loggade
  vikt och reps i automatiskt i de fälten - bara om de är tomma, så det
  aldrig skriver över något man redan fyllt i för hand. Triggas både
  när man klickar ett wger-sökförslag och när man lämnar fältet
  (`autofillFromHistory()` i `wireExerciseAutocomplete()`, `app.js`).
- **Redigera pass**: Varje rad i historiken har en "Redigera"-knapp som
  laddar in passet i formuläret ovan (datum, längd, typ, tempo/fart,
  ev. övningar) så man kan ändra det och spara igen. "Avbryt
  redigering" återgår till att logga ett nytt pass.
- **Historik**: Tabell över alla sparade pass med passtyp, längd,
  tempo/fart, ev. övningar och uträknade kalorier (baserat på profilens
  vikt, passets längd och en MET-nivå som räknas ut från tempot/farten
  för konditionspass). Man kan ta bort enskilda pass.
- **Statistik**: Ett eget kort under historiken med
  - **Tränade minuter per vecka**: summan av pass-längd för **alla**
    pass (styrka + kondition), grupperat per kalendervecka
    (måndag-baserad, ISO-veckonummer som etikett).
  - **Förbrukade kalorier per vecka**: summan av uppskattad
    kaloriförbrukning (samma beräkning som i historiken) för alla pass,
    per vecka. Kräver att profilens vikt är ifylld - annars visas en
    uppmaning om det istället för grafen.
  - Båda graferna visas som enkla stapeldiagram i ren CSS/HTML (ingen
    chart-bibliotek), och visar bara de senaste 12 veckorna **som
    faktiskt har loggade pass** - hopp i tränings-glesa perioder visas
    inte som nollstaplar. Delar samma vecko-grupperingslogik
    (`computeWeeklyAggregate()` i `app.js`, tar en `valueFn` per
    graf-typ) och samma återanvändbara rendering
    (`renderWeeklyBarChart()`).
  - **Personliga rekord**: en tabell per övningsnamn (bara styrkepass)
    med högsta vikt någonsin loggad och högsta volym i ett enskilt set
    (vikt × reps) någonsin loggad. Övningsnamn matchas exakt
    (skiftlägeskänsligt för visning, men grupperas skiftlägesokänsligt).
  - Allt beräknas client-side i `app.js` från samma sessionsdata som
    historiken, ingen extra Supabase-fråga.

## Datalagring: allt i Supabase

All data sparas i Supabase (Postgres-databas i molnet), kopplat till
det inloggade kontot via `user_id`. Synkas mellan alla
enheter/webbläsare man loggar in med samma mejl på. Inget lokalt
gäst-läge - `loadProfile()`/`loadSessions()` returnerar tomt om ingen
är inloggad (`!currentUser`), vilket aldrig ska hända i praktiken
eftersom `#app-content` är dolt tills man loggat in.

CRUD går via: `loadProfile()`, `saveProfile()`, `loadSessions()`,
`createSession()`, `updateSession()`, `removeSession()` i `app.js`.

**Datamodell** (se `profileFromRow`/`profileToRow`/`sessionFromRow`/
`sessionToRow` i `app.js` för mappningen mot Supabase-kolumnerna):

- Profil: `{ name, weightKg, heightCm }`
- Pass: `{ id, type, date, durationMin, pace, exercises: [{ name, weight, reps }] }`
  - `type` är `"strength"`, `"running"`, `"walking"`, `"cycling"` eller
    `"elliptical"`.
  - `exercises` är alltid en tom lista `[]` utom för `"strength"`.
  - `pace` är `null` för `"strength"`. För övriga typer är det ett tal:
    tempo i **min/km** för löpning/promenad/crosstrainer, eller
    snitthastighet i **km/h** för cykling (se `PACE_UNIT_BY_TYPE` i
    `app.js`).

## Inloggning & molnlagring (Supabase)

- **Bibliotek**: `@supabase/supabase-js` laddas via CDN
  (jsdelivr, pinnad version) i `index.html` - inget npm/byggsteg.
- **Inloggning**: mejl + lösenord (`supabaseClient.auth.signInWithPassword` /
  `.signUp`), med separata formulär för inloggning och registrering på
  samma sida (`#login-view`/`#signup-view` i `index.html`, växlas via
  `showLoginView()`/`showSignupView()` i `app.js`).
  - Lösenord kräver minst 6 tecken (`minlength="6"` client-side, samma
    minimum som Supabase Auth har som default).
  - Om **e-postbekräftelse** är påslaget i projektet (default för nya
    Supabase-projekt) måste man bekräfta mejlen (länk i mejlet) innan
    man kan logga in efter registrering - `emailRedirectTo` pekar då
    tillbaka till appens egen URL. Är det avstängt loggas man in direkt
    efter registrering.
  - Försöker man registrera en redan existerande, bekräftad mejladress
    svarar Supabase utan fel men med en tom `identities`-lista (skydd
    mot att kunna leta reda på registrerade mejladresser) - det
    hanteras i `signup-form`-hanteraren och visar "logga in istället".
- **Projekt**: `https://qnezslbbmfsdhsaiuesf.supabase.co`. `anon`-nyckeln
  ligger hårdkodad i `app.js` - det är avsiktligt och säkert **så länge
  RLS-policyn nedan är aktiv**: anon-nyckeln ger bara åtkomst till rader
  som `auth.uid()` äger, aldrig andras data.
- **UI-gating**: `updateAuthUI()` i `app.js` visar/döljer
  `#app-content` (profil, pass-formulär, historik) beroende på om
  `currentUser` är satt. Utloggad ser man bara inloggningsformuläret.

### Databasschema (kör i Supabase → SQL Editor, en gång)

Detta är **inte körbart av Claude** - Claude har bara den publika
anon-nyckeln, ingen admin-/SQL-åtkomst till projektet. Kör följande i
Supabase dashboardens SQL Editor innan inloggning/molnlagring funkar:

```sql
create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text,
  weight_kg numeric,
  height_cm numeric,
  updated_at timestamptz default now()
);

create table public.workout_sessions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  date date not null,
  duration_min numeric not null,
  pace numeric,
  exercises jsonb not null default '[]'::jsonb,
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;
alter table public.workout_sessions enable row level security;

create policy "Users manage their own profile"
  on public.profiles for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users manage their own sessions"
  on public.workout_sessions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

### Övrig Supabase-konfiguration (görs en gång, i dashboarden)

- **Authentication → URL Configuration**: lägg till appens
  GitHub Pages-URL (`https://tompa711.github.io/pumping-iron-bjorkekarr/`)
  som både **Site URL** och i listan **Redirect URLs**. Behövs bara om
  e-postbekräftelse är påslaget (se ovan) - annars skickas ingen
  bekräftelselänk alls.
- **Authentication → Providers → Email → "Confirm email"**: avstängt
  gör att man loggas in direkt efter registrering (inget mejl skickas
  alls då, vilket också undviker Supabase inbyggda mejlgräns på
  2 mejl/timme). Påslaget kräver ett mejl per ny användare (en gång,
  inte per inloggning) innan de kan logga in.
- Inloggning/registrering med lösenord funkar även lokalt via `file://`
  (till skillnad från den gamla magisk länk-lösningen) - bara den
  eventuella bekräftelselänken i mejlet kräver en riktig http(s)-URL.

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

## Övningssök (wger.de API)

När man skriver i övningsnamnfältet (vid styrka) visas sökförslag från
[wger.de](https://wger.de):s publika REST-API – inget konto/API-nyckel
behövs. Klickar man på ett förslag fylls namnet i automatiskt.

- **Endpoint**: `GET https://wger.de/api/v2/exerciseinfo/?name__search=<sökterm>&language__code=en,sv&limit=8&format=json`
  (se `searchWgerExercises()` i `app.js`). `name__search` gör en
  fulltext-/likhetssökning på wger-sidan (fungerar även med smärre
  stavfel), och `language__code` begränsar träffarna till de exercises
  som har en engelsk eller svensk översättning.
- Sökningen körs debounced (300 ms efter senaste tangenttryckning, min.
  2 tecken) och avbryter ev. tidigare pågående sökning
  (`AbortController`) så gamla svar inte hinner "vinna" över nya.
- **Språkval**: varje övning kan ha flera språköversättningar i svaret
  (`translations`-listan). Vi väljer svenska (`language: 10`) om den
  finns, annars engelska (`language: 2`) – aldrig något annat språk,
  så listan inte blandar in tyska/franska/etc. namn.
- **Viktigt att veta**: wger:s databas har väldigt få övningar med
  svensk översättning (endast ett fåtal av totalt ~860 övningar, mot
  nästan alla på engelska). I praktiken blir nästan alla sökförslag
  därför på engelska – det är en begränsning i wger:s data, inte i vår
  kod.
- Fungerar bara med internetuppkoppling. Utan uppkoppling (eller om
  wger.de är nere) visas helt enkelt inga förslag – man kan ändå skriva
  in övningsnamnet fritt för hand precis som innan, det är aldrig ett
  krav att välja ur listan.

## Filstruktur

- `index.html` – sidstruktur och formulär
- `style.css` – utseende
- `app.js` – all logik: auth, Supabase-lagring, beräkningar, rendering
- `CLAUDE.md` – den här filen

Vanilla JS + `@supabase/supabase-js` via CDN. Inget npm, inget
byggsteg.

## Möjliga nästa steg (inte byggt än)

- Statistik över tid för konditionspass (t.ex. tempoutveckling för
  löpning) - idag finns bara volym/PR-statistik för styrkepass.
- Export/import av data (t.ex. till JSON-fil) som backup.
- Fler konditionspasstyper (t.ex. simning, rodd) eller möjlighet att
  själv justera MET-formeln/faktorn.
- Automatisk uträkning av distans (utifrån längd + tempo/fart) och
  visning av den i historiken.
- Delad logg mellan gruppens medlemmar (idag är molnlagringen
  per-användare/privat, inte delad mellan olika konton).
