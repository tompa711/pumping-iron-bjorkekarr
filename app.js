// ===================================================================
// Träningslogg – kräver inloggning (mejl + lösenord). All data
// läses och sparas direkt mot Supabase, kopplat till det inloggade
// kontot. Inget lokalt/gäst-läge - #app-content visas först efter
// inloggning (se updateAuthUI()).
// ===================================================================

// ---------- Supabase ----------

const SUPABASE_URL = "https://qnezslbbmfsdhsaiuesf.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFuZXpzbGJibWZzZGhzYWl1ZXNmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0Mzk3MjQsImV4cCI6MjEwNTAxNTcyNH0.tZWe8ETuJfn9TtJZSrQCIre9H3isKaiNLH7u8ncxsk8";

// Anon-nyckeln är avsedd att vara publik (den är låst av
// row-level-security-policyn i Supabase - se CLAUDE.md för SQL:en).
//
// Om CDN-skriptet inte hann ladda (t.ex. dåligt nät) blir den null -
// appen visar då bara inloggningsformuläret (default-läget i HTML:en)
// istället för att krascha.
const supabaseClient = window.supabase
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

let currentUser = null;

// ---------- Antagande för kaloriberäkningen ----------

// MET (Metabolic Equivalent of Task) är ett standardmått för hur
// ansträngande en aktivitet är. Formeln nedan
// (kcal/min = MET * 3.5 * kroppsvikt(kg) / 200) är en vedertagen
// tumregelsformel, inte en exakt mätning.
//
// För konditionspass räknas MET ut från tempot (fart), eftersom det gör
// stor skillnad om man t.ex. springer i 5 min/km eller 10 min/km. Vissa
// typer anges som tempo i "min per km" (löpning, promenad, crosstrainer),
// andra som snitthastighet i "km/h" (cykling) - det är så farten normalt
// anges för respektive aktivitet.
const SESSION_TYPE_LABELS = {
  strength: "Styrka",
  running: "Löpning",
  walking: "Promenad",
  cycling: "Cykling",
  elliptical: "Crosstrainer",
};

// "minPerKm" = tempo anges i minuter per kilometer (lägre = snabbare).
// "kmh" = fart anges direkt i km/h (högre = snabbare).
const PACE_UNIT_BY_TYPE = {
  running: "minPerKm",
  walking: "minPerKm",
  elliptical: "minPerKm",
  cycling: "kmh",
};

const PACE_FIELD_BY_UNIT = {
  minPerKm: { label: "Tempo (min/km)", placeholder: "T.ex. 5.5", step: "0.1", min: "2" },
  kmh: { label: "Snitthastighet (km/h)", placeholder: "T.ex. 24", step: "0.5", min: "5" },
};

function paceToSpeedKmh(type, pace) {
  const unit = PACE_UNIT_BY_TYPE[type];
  if (!unit || !pace || pace <= 0) return 0;
  return unit === "minPerKm" ? 60 / pace : pace;
}

// MET-formlerna nedan är förenklade approximationer baserade på kända
// samband mellan fart och energiåtgång (ACSM:s formler för löpning/gång,
// och ungefärliga MET-nivåer per hastighetsintervall för cykling), inte
// exakta labbmätningar.
function computeMET(type, pace) {
  const speedKmh = paceToSpeedKmh(type, pace);

  switch (type) {
    case "running":
      return speedKmh > 0 ? 0.9524 * speedKmh + 1 : 8.0;
    case "walking":
      return speedKmh > 0 ? 0.4762 * speedKmh + 1 : 3.5;
    case "elliptical":
      return speedKmh > 0 ? 0.7 * speedKmh + 2 : 5.0;
    case "cycling": {
      if (speedKmh <= 0) return 6.8;
      if (speedKmh < 16) return 4.0;
      if (speedKmh < 19) return 6.8;
      if (speedKmh < 22) return 8.0;
      if (speedKmh < 25) return 10.0;
      if (speedKmh < 30) return 12.0;
      return 15.8;
    }
    default:
      return 5.0; // styrka
  }
}

// ---------- Lagringslager: allt går mot Supabase ----------

function profileFromRow(row) {
  if (!row) return null;
  return { name: row.name || "", weightKg: row.weight_kg, heightCm: row.height_cm };
}

function profileToRow(profile) {
  return {
    user_id: currentUser.id,
    name: profile.name,
    weight_kg: profile.weightKg,
    height_cm: profile.heightCm,
  };
}

function sessionFromRow(row) {
  return {
    id: row.id,
    type: row.type,
    date: row.date,
    durationMin: row.duration_min,
    pace: row.pace,
    exercises: row.exercises || [],
  };
}

function sessionToRow(session) {
  return {
    user_id: currentUser.id,
    type: session.type,
    date: session.date,
    duration_min: session.durationMin,
    pace: session.pace,
    exercises: session.exercises,
  };
}

async function loadProfile() {
  if (!currentUser) return null;
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("*")
    .eq("user_id", currentUser.id)
    .maybeSingle();
  if (error) {
    console.error("Kunde inte hämta profil från Supabase:", error);
    return null;
  }
  return profileFromRow(data);
}

async function saveProfile(profile) {
  if (!currentUser) return;
  const { error } = await supabaseClient
    .from("profiles")
    .upsert(profileToRow(profile), { onConflict: "user_id" });
  if (error) alert("Kunde inte spara profilen: " + error.message);
}

async function loadSessions() {
  if (!currentUser) return [];
  const { data, error } = await supabaseClient
    .from("workout_sessions")
    .select("*")
    .eq("user_id", currentUser.id)
    .order("date", { ascending: false });
  if (error) {
    console.error("Kunde inte hämta pass från Supabase:", error);
    return [];
  }
  return (data || []).map(sessionFromRow);
}

async function createSession(session) {
  if (!currentUser) return null;
  const { data, error } = await supabaseClient
    .from("workout_sessions")
    .insert(sessionToRow(session))
    .select()
    .single();
  if (error) {
    alert("Kunde inte spara passet: " + error.message);
    return null;
  }
  return sessionFromRow(data);
}

async function updateSession(id, changes) {
  if (!currentUser) return;
  const { error } = await supabaseClient
    .from("workout_sessions")
    .update(sessionToRow(changes))
    .eq("id", id);
  if (error) alert("Kunde inte uppdatera passet: " + error.message);
}

async function removeSession(id) {
  if (!currentUser) return;
  const { error } = await supabaseClient.from("workout_sessions").delete().eq("id", id);
  if (error) alert("Kunde inte ta bort passet: " + error.message);
}

// ---------- Beräkningar ----------

function computeBMI(weightKg, heightCm) {
  const heightM = heightCm / 100;
  return weightKg / (heightM * heightM);
}

function bmiCategory(bmi) {
  if (bmi < 18.5) return "Undervikt";
  if (bmi < 25) return "Normalvikt";
  if (bmi < 30) return "Övervikt";
  return "Fetma";
}

function computeCaloriesBurned(durationMin, weightKg, type, pace) {
  const met = computeMET(type, pace);
  const kcalPerMin = (met * 3.5 * weightKg) / 200;
  return Math.round(kcalPerMin * durationMin);
}

// ---------- Konto: inloggning/registrering (mejl + lösenord), UI-läge ----------

function showLoginView() {
  document.getElementById("login-view").hidden = false;
  document.getElementById("signup-view").hidden = true;
  document.getElementById("login-status").textContent = "";
  document.getElementById("signup-status").textContent = "";
}

function showSignupView() {
  document.getElementById("login-view").hidden = true;
  document.getElementById("signup-view").hidden = false;
  document.getElementById("login-status").textContent = "";
  document.getElementById("signup-status").textContent = "";
}

document.getElementById("show-signup").addEventListener("click", showSignupView);
document.getElementById("show-login").addEventListener("click", showLoginView);

function updateAuthUI() {
  const loggedOut = document.getElementById("auth-logged-out");
  const loggedIn = document.getElementById("auth-logged-in");
  const appContent = document.getElementById("app-content");

  if (currentUser) {
    loggedOut.hidden = true;
    loggedIn.hidden = false;
    appContent.hidden = false;
    document.getElementById("auth-user-email").textContent = currentUser.email;
  } else {
    loggedOut.hidden = false;
    loggedIn.hidden = true;
    appContent.hidden = true;
    showLoginView(); // börja alltid om på inloggningsvyn, t.ex. efter utloggning
  }
}

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const statusEl = document.getElementById("login-status");

  if (!supabaseClient) {
    statusEl.textContent = "Kunde inte ladda inloggningen (kolla internetuppkopplingen och ladda om sidan).";
    return;
  }

  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  statusEl.textContent = "Loggar in …";

  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });

  if (error) {
    statusEl.textContent = `Något gick fel: ${error.message}`;
  } else {
    document.getElementById("login-password").value = "";
  }
  // Lyckad inloggning triggar onAuthStateChange -> updateAuthUI() visar appen.
});

document.getElementById("signup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const statusEl = document.getElementById("signup-status");

  if (!supabaseClient) {
    statusEl.textContent = "Kunde inte ladda registreringen (kolla internetuppkopplingen och ladda om sidan).";
    return;
  }

  const email = document.getElementById("signup-email").value.trim();
  const password = document.getElementById("signup-password").value;
  statusEl.textContent = "Skapar konto …";

  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: window.location.origin + window.location.pathname },
  });

  if (error) {
    statusEl.textContent = `Något gick fel: ${error.message}`;
    return;
  }

  document.getElementById("signup-password").value = "";

  // Supabase svarar med en "tom" identities-lista (utan fel) om mejlen
  // redan har ett bekräftat konto, som skydd mot att kunna leta reda på
  // vilka mejladresser som är registrerade.
  if (data.user && data.user.identities && data.user.identities.length === 0) {
    statusEl.textContent = "Det finns redan ett konto med den mejladressen. Logga in istället.";
    return;
  }

  if (data.session) {
    // E-postbekräftelse avstängd i projektet - man är redan inloggad.
    // onAuthStateChange tar hand om resten.
    return;
  }

  statusEl.textContent = "Konto skapat! Kolla din mejl och bekräfta kontot, logga sedan in.";
});

document.getElementById("sign-out-btn").addEventListener("click", async () => {
  await supabaseClient?.auth.signOut();
});

// ---------- Profil: rendering & events ----------

async function renderProfileStats() {
  const profile = await loadProfile();
  const el = document.getElementById("profile-stats");

  if (!profile || !profile.weightKg || !profile.heightCm) {
    el.innerHTML = `<p class="empty">Fyll i vikt och längd för att se BMI.</p>`;
    return;
  }

  const bmi = computeBMI(profile.weightKg, profile.heightCm);
  el.innerHTML = `
    <span class="stat-pill">BMI: ${bmi.toFixed(1)} (${bmiCategory(bmi)})</span>
  `;
}

async function fillProfileForm() {
  const profile = await loadProfile();
  document.getElementById("profile-name").value = profile ? profile.name || "" : "";
  document.getElementById("profile-weight").value = profile ? profile.weightKg || "" : "";
  document.getElementById("profile-height").value = profile ? profile.heightCm || "" : "";
}

async function refreshProfileUI() {
  await fillProfileForm();
  await renderProfileStats();
}

document.getElementById("profile-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const profile = {
    name: document.getElementById("profile-name").value.trim(),
    weightKg: parseFloat(document.getElementById("profile-weight").value),
    heightCm: parseFloat(document.getElementById("profile-height").value),
  };
  await saveProfile(profile);
  await renderProfileStats();
  await refreshHistoryUI(); // kalorier per pass beror på profilens vikt
});

// ---------- Övningssök mot wger.dev (publikt API, ingen nyckel behövs) ----------

// wger har väldigt få övningar med svensk översättning (bara ett fåtal av
// totalt ~860), så i praktiken blir de allra flesta träffar engelska. Vi
// frågar ändå efter båda språken och föredrar svenska när den finns, så
// att man aldrig får tyska/franska/etc. namn i förslagslistan.
const WGER_API_BASE = "https://wger.de/api/v2";
const WGER_LANGUAGE_ID = { sv: 10, en: 2 };

async function searchWgerExercises(term, signal) {
  const url =
    `${WGER_API_BASE}/exerciseinfo/?name__search=${encodeURIComponent(term)}` +
    `&language__code=en,sv&limit=8&format=json`;

  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`wger-sökning misslyckades (${res.status})`);
  const data = await res.json();

  return data.results
    .map((ex) => {
      const translations = ex.translations || [];
      const swedish = translations.find((t) => t.language === WGER_LANGUAGE_ID.sv);
      const english = translations.find((t) => t.language === WGER_LANGUAGE_ID.en);
      const match = swedish || english;
      if (!match) return null;
      return { name: match.name, category: ex.category ? ex.category.name : "" };
    })
    .filter(Boolean);
}

function wireExerciseAutocomplete(row) {
  const input = row.querySelector(".ex-name");
  const list = row.querySelector(".ex-suggestions");
  const weightInput = row.querySelector(".ex-weight");
  const repsInput = row.querySelector(".ex-reps");
  let debounceTimer = null;
  let controller = null;

  function hideSuggestions() {
    list.hidden = true;
    list.innerHTML = "";
  }

  // Fyller i senast loggade vikt/reps för övningen, men bara i fält som
  // fortfarande är tomma - skriver aldrig över något man redan angett.
  function autofillFromHistory(name) {
    const stats = lastExerciseStatsByName.get(name.trim().toLowerCase());
    if (!stats) return;
    if (!weightInput.value) weightInput.value = stats.weight;
    if (!repsInput.value) repsInput.value = stats.reps;
  }

  function renderSuggestions(term, results) {
    // Om man hunnit skriva vidare (eller radera) innan svaret kom tillbaka
    // ska det gamla svaret inte visas.
    if (input.value.trim() !== term) return;

    if (results.length === 0) {
      hideSuggestions();
      return;
    }

    list.innerHTML = results
      .map(
        (r, i) =>
          `<li data-index="${i}">${r.name}${r.category ? ` <span class="ex-suggestion-cat">(${r.category})</span>` : ""}</li>`
      )
      .join("");
    list.hidden = false;

    list.querySelectorAll("li").forEach((li, i) => {
      // mousedown (inte click) så den hinner köras innan inputens
      // blur-händelse döljer listan.
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        input.value = results[i].name;
        hideSuggestions();
        autofillFromHistory(results[i].name);
      });
    });
  }

  input.addEventListener("input", () => {
    const term = input.value.trim();
    clearTimeout(debounceTimer);

    if (term.length < 2) {
      hideSuggestions();
      return;
    }

    debounceTimer = setTimeout(() => {
      if (controller) controller.abort();
      controller = new AbortController();
      searchWgerExercises(term, controller.signal)
        .then((results) => renderSuggestions(term, results))
        .catch((err) => {
          if (err.name !== "AbortError") hideSuggestions();
        });
    }, 300);
  });

  input.addEventListener("blur", () => {
    // Liten fördröjning så ett klick på ett förslag (mousedown ovan) hinner
    // köras innan listan döljs.
    setTimeout(hideSuggestions, 150);
    autofillFromHistory(input.value);
  });
}

// ---------- Nytt pass: dynamiska övningsrader ----------

function addExerciseRow() {
  const container = document.getElementById("exercise-rows");
  const row = document.createElement("div");
  row.className = "exercise-row";
  row.innerHTML = `
    <label>
      Övning
      <div class="autocomplete">
        <input type="text" class="ex-name" placeholder="T.ex. Bänkpress" autocomplete="off" required>
        <ul class="ex-suggestions" hidden></ul>
      </div>
    </label>
    <label>
      Vikt (kg)
      <input type="number" class="ex-weight" min="0" step="0.5" placeholder="T.ex. 60">
    </label>
    <label>
      Reps
      <input type="number" class="ex-reps" min="1" placeholder="T.ex. 10">
    </label>
    <button type="button" class="secondary remove-row">✕</button>
  `;
  row.querySelector(".remove-row").addEventListener("click", () => row.remove());
  wireExerciseAutocomplete(row);
  container.appendChild(row);
}

document.getElementById("add-exercise-row").addEventListener("click", addExerciseRow);

// ---------- Passtyp: visa/dölj övnings- och tempo-fälten ----------

function updateSessionTypeUI() {
  const type = document.getElementById("session-type").value;
  const isStrength = type === "strength";
  const paceUnit = PACE_UNIT_BY_TYPE[type];

  document.getElementById("strength-section").hidden = !isStrength;
  document.getElementById("pace-label").hidden = isStrength;

  const paceInput = document.getElementById("session-pace");
  if (paceUnit) {
    const config = PACE_FIELD_BY_UNIT[paceUnit];
    document.getElementById("pace-label-text").textContent = config.label;
    paceInput.placeholder = config.placeholder;
    paceInput.step = config.step;
    paceInput.min = config.min;
  }

  // Dolda fält får inte vara "required" - annars vägrar webbläsaren
  // skicka formuläret utan att visa något felmeddelande alls, eftersom
  // den inte kan visa valideringsbubblan på ett dolt fält.
  document.querySelectorAll("#exercise-rows .ex-name").forEach((input) => {
    input.required = isStrength;
  });
  paceInput.required = !isStrength;
}

document.getElementById("session-type").addEventListener("change", updateSessionTypeUI);

// ---------- Formulär-läge: nytt pass vs. redigera pass ----------

function resetSessionForm() {
  document.getElementById("session-form").reset();
  document.getElementById("session-editing-id").value = "";
  document.getElementById("exercise-rows").innerHTML = "";
  addExerciseRow();
  updateSessionTypeUI();
  document.getElementById("session-date").valueAsDate = new Date();
  document.getElementById("session-form-title").textContent = "Logga nytt pass";
  document.getElementById("session-submit-btn").textContent = "Spara pass";
  document.getElementById("cancel-edit-btn").hidden = true;
}

async function startEditingSession(id) {
  const sessions = await loadSessions();
  const session = sessions.find((s) => s.id === id);
  if (!session) return;

  document.getElementById("session-editing-id").value = session.id;
  document.getElementById("session-type").value = session.type || "strength";
  document.getElementById("session-date").value = session.date;
  document.getElementById("session-duration").value = session.durationMin;
  document.getElementById("session-pace").value = session.pace || "";

  document.getElementById("exercise-rows").innerHTML = "";
  if (session.exercises.length > 0) {
    session.exercises.forEach((ex) => {
      addExerciseRow();
      const row = document.getElementById("exercise-rows").lastElementChild;
      row.querySelector(".ex-name").value = ex.name;
      row.querySelector(".ex-weight").value = ex.weight;
      row.querySelector(".ex-reps").value = ex.reps;
    });
  } else {
    addExerciseRow();
  }

  updateSessionTypeUI();
  document.getElementById("session-form-title").textContent = "Redigera pass";
  document.getElementById("session-submit-btn").textContent = "Uppdatera pass";
  document.getElementById("cancel-edit-btn").hidden = false;
  document.getElementById("session-form").scrollIntoView({ behavior: "smooth" });
}

document.getElementById("cancel-edit-btn").addEventListener("click", resetSessionForm);

// ---------- Spara / uppdatera pass ----------

document.getElementById("session-form").addEventListener("submit", async (e) => {
  e.preventDefault();

  const editingId = document.getElementById("session-editing-id").value;
  const type = document.getElementById("session-type").value;
  const date = document.getElementById("session-date").value;
  const durationMin = parseFloat(document.getElementById("session-duration").value);

  let exercises = [];
  let pace = null;

  if (type === "strength") {
    document.querySelectorAll("#exercise-rows .exercise-row").forEach((row) => {
      const name = row.querySelector(".ex-name").value.trim();
      const weight = parseFloat(row.querySelector(".ex-weight").value) || 0;
      const reps = parseInt(row.querySelector(".ex-reps").value, 10) || 0;
      if (name) exercises.push({ name, weight, reps });
    });

    if (exercises.length === 0) {
      alert("Lägg till minst en övning innan du sparar passet.");
      return;
    }
  } else {
    pace = parseFloat(document.getElementById("session-pace").value);
    if (!pace || pace <= 0) {
      alert("Ange tempo/snitthastighet innan du sparar passet.");
      return;
    }
  }

  if (editingId) {
    await updateSession(Number(editingId), { type, date, durationMin, exercises, pace });
  } else {
    await createSession({ type, date, durationMin, exercises, pace });
  }

  resetSessionForm();
  await refreshHistoryUI();
});

// ---------- Historik: rendering ----------

async function deleteSession(id) {
  await removeSession(id);
  await refreshHistoryUI();
}

function renderHistory(allSessions, profile) {
  const el = document.getElementById("history");
  const sessions = allSessions.slice().sort((a, b) => (a.date < b.date ? 1 : -1));

  if (sessions.length === 0) {
    el.innerHTML = `<p class="empty">Inga pass loggade ännu.</p>`;
    return;
  }

  const rows = sessions
    .map((s) => {
      const type = s.type || "strength";
      const details =
        type === "strength"
          ? `<ul class="ex-list">${s.exercises
              .map((ex) => `<li>${ex.name}: ${ex.weight} kg × ${ex.reps} reps</li>`)
              .join("")}</ul>`
          : "–";

      const paceUnit = PACE_UNIT_BY_TYPE[type];
      const pace = paceUnit
        ? `${s.pace ?? "–"} ${paceUnit === "minPerKm" ? "min/km" : "km/h"}`
        : "–";

      let calories = "–";
      if (profile && profile.weightKg) {
        calories = `${computeCaloriesBurned(s.durationMin, profile.weightKg, type, s.pace)} kcal`;
      }

      return `
        <tr>
          <td>${s.date}</td>
          <td>${SESSION_TYPE_LABELS[type] || type}</td>
          <td>${s.durationMin} min</td>
          <td>${pace}</td>
          <td>${details}</td>
          <td>${calories}</td>
          <td>
            <button class="secondary edit-link" data-id="${s.id}">Redigera</button>
            <button class="danger-link" data-id="${s.id}">Ta bort</button>
          </td>
        </tr>
      `;
    })
    .join("");

  el.innerHTML = `
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Datum</th>
            <th>Typ</th>
            <th>Längd</th>
            <th>Tempo/fart</th>
            <th>Övningar</th>
            <th>Kalorier (uppskattat)</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;

  el.querySelectorAll(".danger-link").forEach((btn) => {
    btn.addEventListener("click", () => deleteSession(Number(btn.dataset.id)));
  });
  el.querySelectorAll(".edit-link").forEach((btn) => {
    btn.addEventListener("click", () => startEditingSession(Number(btn.dataset.id)));
  });
}

// ---------- Statistik: volym per vecka & personliga rekord ----------

// Måndagen (lokal midnatt) i veckan som ett datum tillhör.
function getMonday(dateStr) {
  const date = new Date(dateStr + "T00:00:00");
  const dayIndex = (date.getDay() + 6) % 7; // 0 = måndag
  date.setDate(date.getDate() - dayIndex);
  return date;
}

// ISO 8601-veckonummer, baserat på torsdagen i veckan (måndag+3 dagar).
function formatWeekLabel(monday) {
  const thursday = new Date(monday);
  thursday.setDate(thursday.getDate() + 3);
  const firstThursday = new Date(thursday.getFullYear(), 0, 4);
  const firstDayIndex = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstDayIndex + 3);
  const weekNumber = 1 + Math.round((thursday - firstThursday) / (7 * 24 * 3600 * 1000));
  return `v.${weekNumber}`;
}

function computeWeeklyVolume(sessions) {
  const byWeek = new Map(); // "YYYY-MM-DD" (måndag) -> { monday, volume }

  sessions
    .filter((s) => (s.type || "strength") === "strength")
    .forEach((s) => {
      const monday = getMonday(s.date);
      const key = monday.toISOString().slice(0, 10);
      const volume = s.exercises.reduce((sum, ex) => sum + ex.weight * ex.reps, 0);
      const entry = byWeek.get(key) || { monday, volume: 0 };
      entry.volume += volume;
      byWeek.set(key, entry);
    });

  return Array.from(byWeek.values())
    .sort((a, b) => a.monday - b.monday)
    .slice(-12) // senaste 12 veckorna med loggade styrkepass
    .map((entry) => ({ label: formatWeekLabel(entry.monday), volume: Math.round(entry.volume) }));
}

function computePersonalRecords(sessions) {
  const records = new Map(); // övningsnamn -> { maxWeight, maxVolume }

  sessions
    .filter((s) => (s.type || "strength") === "strength")
    .forEach((s) => {
      s.exercises.forEach((ex) => {
        if (!ex.name) return;
        const volume = ex.weight * ex.reps;
        const existing = records.get(ex.name) || { maxWeight: null, maxVolume: null };

        if (!existing.maxWeight || ex.weight > existing.maxWeight.weight) {
          existing.maxWeight = { weight: ex.weight, reps: ex.reps };
        }
        if (!existing.maxVolume || volume > existing.maxVolume.volume) {
          existing.maxVolume = { weight: ex.weight, reps: ex.reps, volume };
        }

        records.set(ex.name, existing);
      });
    });

  return Array.from(records.entries())
    .map(([name, r]) => ({ name, ...r }))
    .sort((a, b) => a.name.localeCompare(b.name, "sv"));
}

// Senast loggade vikt/reps per övningsnamn, används för att auto-fylla
// övningsraderna. `sessions` kommer redan sorterad nyast->äldst från
// loadSessions(), så första träffen per namn är den senaste.
function computeLastExerciseStats(sessions) {
  const map = new Map();

  sessions
    .filter((s) => (s.type || "strength") === "strength")
    .forEach((s) => {
      s.exercises.forEach((ex) => {
        if (!ex.name) return;
        const key = ex.name.trim().toLowerCase();
        if (!map.has(key)) {
          map.set(key, { weight: ex.weight, reps: ex.reps });
        }
      });
    });

  return map;
}

function renderWeeklyVolumeChart(sessions) {
  const el = document.getElementById("weekly-volume-chart");
  const weeks = computeWeeklyVolume(sessions);

  if (weeks.length === 0) {
    el.innerHTML = `<p class="empty">Inga styrkepass loggade ännu.</p>`;
    return;
  }

  const maxVolume = Math.max(...weeks.map((w) => w.volume), 1);

  el.innerHTML = `
    <div class="volume-chart">
      ${weeks
        .map(
          (w) => `
            <div class="volume-chart-col">
              <div class="volume-chart-value">${w.volume.toLocaleString("sv-SE")}</div>
              <div class="volume-chart-bar" style="height: ${Math.max((w.volume / maxVolume) * 100, 3)}%"></div>
              <div class="volume-chart-label">${w.label}</div>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderPersonalRecords(sessions) {
  const el = document.getElementById("personal-records");
  const records = computePersonalRecords(sessions);

  if (records.length === 0) {
    el.innerHTML = `<p class="empty">Inga styrkeövningar loggade ännu.</p>`;
    return;
  }

  const rows = records
    .map(
      (r) => `
        <tr>
          <td>${r.name}</td>
          <td>${r.maxWeight.weight} kg × ${r.maxWeight.reps}</td>
          <td>${r.maxVolume.volume.toLocaleString("sv-SE")} kg (${r.maxVolume.weight} kg × ${r.maxVolume.reps})</td>
        </tr>
      `
    )
    .join("");

  el.innerHTML = `
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Övning</th>
            <th>Högsta vikt</th>
            <th>Högsta volym (ett set)</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderStatistics(sessions) {
  renderWeeklyVolumeChart(sessions);
  renderPersonalRecords(sessions);
}

let lastExerciseStatsByName = new Map();

async function refreshHistoryUI() {
  const [sessions, profile] = await Promise.all([loadSessions(), loadProfile()]);
  lastExerciseStatsByName = computeLastExerciseStats(sessions);
  renderHistory(sessions, profile);
  renderStatistics(sessions);
}

// ---------- Init ----------

resetSessionForm(); // sätter startläge: tom övningsrad, dagens datum, "styrka" synlig

// Utan Supabase-biblioteket (t.ex. CDN:et hann inte ladda pga dåligt nät)
// finns inget att göra - HTML:ens default-läge visar redan bara
// inloggningsformuläret, så vi lämnar det så istället för att krascha.

// onAuthStateChange fyrar ett "INITIAL_SESSION"-event direkt vid start
// (med ev. redan inloggad session), och sedan "SIGNED_IN"/"SIGNED_OUT" när
// man loggar in/ut - inklusive om e-postbekräftelse är påslaget och man
// klickar på bekräftelselänken i mejlet och kommer tillbaka hit. Det är
// alltså den enda platsen vi behöver trigga om profil/historik ska
// laddas om.
supabaseClient?.auth.onAuthStateChange(async (event, session) => {
  currentUser = session ? session.user : null;
  updateAuthUI();
  await refreshProfileUI();
  await refreshHistoryUI();
});
