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
    notes: row.notes || "",
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
    notes: session.notes || null, // tom anteckning sparas som null
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

// Kroppsvikt loggas separat från passen (och från profilens vikt).
function weightLogFromRow(row) {
  return { id: row.id, date: row.date, weightKg: Number(row.weight_kg) };
}

function weightLogToRow(log) {
  return { user_id: currentUser.id, date: log.date, weight_kg: log.weightKg };
}

// Nyast först; flera loggningar samma dag sorteras på när de skapades.
async function loadWeightLogs() {
  if (!currentUser) return [];
  const { data, error } = await supabaseClient
    .from("body_weight_logs")
    .select("*")
    .eq("user_id", currentUser.id)
    .order("date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) {
    console.error("Kunde inte hämta viktloggar från Supabase:", error);
    return [];
  }
  return (data || []).map(weightLogFromRow);
}

async function createWeightLog(log) {
  if (!currentUser) return;
  const { error } = await supabaseClient.from("body_weight_logs").insert(weightLogToRow(log));
  if (error) alert("Kunde inte spara vikten: " + error.message);
}

async function updateWeightLog(id, changes) {
  if (!currentUser) return;
  const { error } = await supabaseClient
    .from("body_weight_logs")
    .update(weightLogToRow(changes))
    .eq("id", id);
  if (error) alert("Kunde inte uppdatera viktloggen: " + error.message);
}

async function removeWeightLog(id) {
  if (!currentUser) return;
  const { error } = await supabaseClient.from("body_weight_logs").delete().eq("id", id);
  if (error) alert("Kunde inte ta bort viktloggen: " + error.message);
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

// Växlar mellan de tre vyerna inuti #auth-logged-out: "login", "signup",
// "forgot" (begär återställningslänk).
function setAuthView(view) {
  document.getElementById("login-view").hidden = view !== "login";
  document.getElementById("signup-view").hidden = view !== "signup";
  document.getElementById("forgot-view").hidden = view !== "forgot";
  document.getElementById("login-status").textContent = "";
  document.getElementById("signup-status").textContent = "";
  document.getElementById("forgot-status").textContent = "";
}

function showLoginView() {
  setAuthView("login");
}

document.getElementById("show-signup").addEventListener("click", () => setAuthView("signup"));
document.getElementById("show-login").addEventListener("click", () => setAuthView("login"));
document.getElementById("show-forgot").addEventListener("click", () => setAuthView("forgot"));
document.getElementById("show-login-from-forgot").addEventListener("click", () => setAuthView("login"));

// Sant mellan att man klickat på återställningslänken i mejlet och att man
// faktiskt satt ett nytt lösenord - visar då "Välj nytt lösenord"-kortet
// istället för att släppa in i appen på den tillfälliga recovery-sessionen.
let inPasswordRecovery = false;

function updateAuthUI() {
  const loggedOut = document.getElementById("auth-logged-out");
  const loggedIn = document.getElementById("auth-logged-in");
  const appContent = document.getElementById("app-content");
  const recovery = document.getElementById("recovery-view");

  if (inPasswordRecovery) {
    loggedOut.hidden = true;
    loggedIn.hidden = true;
    appContent.hidden = true;
    recovery.hidden = false;
    return;
  }

  recovery.hidden = true;

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

document.getElementById("forgot-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const statusEl = document.getElementById("forgot-status");

  if (!supabaseClient) {
    statusEl.textContent = "Kunde inte ladda funktionen (kolla internetuppkopplingen och ladda om sidan).";
    return;
  }

  const email = document.getElementById("forgot-email").value.trim();
  statusEl.textContent = "Skickar länk …";

  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + window.location.pathname,
  });

  statusEl.textContent = error
    ? `Något gick fel: ${error.message}`
    : "Länk skickad! Kolla din mejl och klicka på länken för att välja ett nytt lösenord.";
});

document.getElementById("reset-password-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const statusEl = document.getElementById("reset-password-status");
  const newPassword = document.getElementById("reset-password-new").value;

  const { error } = await supabaseClient.auth.updateUser({ password: newPassword });

  if (error) {
    statusEl.textContent = `Något gick fel: ${error.message}`;
    return;
  }

  document.getElementById("reset-password-new").value = "";
  inPasswordRecovery = false;
  updateAuthUI();
  await refreshProfileUI();
  await refreshHistoryUI();
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
  const previous = await loadProfile();
  await saveProfile(profile);
  await renderProfileStats();
  await refreshHistoryUI(); // kalorier per pass beror på profilens vikt

  // Ändrad vikt i profilen loggas även i viktloggen (se logWeightForToday).
  const weightChanged = !previous || Number(previous.weightKg) !== profile.weightKg;
  if (profile.weightKg > 0 && weightChanged) {
    await logWeightForToday(profile.weightKg);
    await refreshWeightUI();
  }
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

      // Svensk översättning har ofta bara namn men ingen beskrivning -
      // fall då tillbaka på den engelska beskrivningen.
      const description =
        [match, swedish, english].find((t) => t && t.description && t.description.trim())
          ?.description || "";

      const images = ex.images || [];
      const mainImage = images.find((img) => img.is_main) || images[0];

      return {
        name: match.name,
        category: ex.category ? ex.category.name : "",
        equipment: (ex.equipment || []).map((eq) => eq.name),
        description,
        image: mainImage
          ? {
              url: (mainImage.thumbnails && mainImage.thumbnails.medium) || mainImage.image,
              author: mainImage.license_author || "",
            }
          : null,
      };
    })
    .filter(Boolean);
}

// ---------- Infokort för vald wger-övning (bild + instruktioner) ----------

// wger:s beskrivningar är HTML skriven av användare, så vi bygger om den
// med bara ofarliga formateringstaggar - allt annat (script, attribut,
// länkar, bilder osv.) blir ren text.
const WGER_ALLOWED_TAGS = new Set(["P", "UL", "OL", "LI", "EM", "STRONG", "B", "I", "BR"]);

function sanitizeWgerHtml(html) {
  const source = new DOMParser().parseFromString(html, "text/html").body;
  const fragment = document.createDocumentFragment();

  function copyChildren(from, to) {
    from.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        to.appendChild(document.createTextNode(node.textContent));
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        if (WGER_ALLOWED_TAGS.has(node.tagName)) {
          const clean = document.createElement(node.tagName.toLowerCase());
          copyChildren(node, clean);
          to.appendChild(clean);
        } else {
          copyChildren(node, to);
        }
      }
    });
  }

  copyChildren(source, fragment);
  return fragment;
}

const EXERCISE_INFO_EMPTY_TEXT = "Ingen visning finns tillgänglig i databasen.";

// `emptyText` visas när övningen varken har bild eller beskrivning
// (används även för "Hämtar..." och felmeddelanden).
function showExerciseInfo(exercise, emptyText = EXERCISE_INFO_EMPTY_TEXT) {
  const dialog = document.getElementById("exercise-info");
  const figure = document.getElementById("exercise-info-figure");
  const img = document.getElementById("exercise-info-img");
  const credit = document.getElementById("exercise-info-credit");
  const meta = document.getElementById("exercise-info-meta");
  const desc = document.getElementById("exercise-info-desc");
  const empty = document.getElementById("exercise-info-empty");

  document.getElementById("exercise-info-title").textContent = exercise.name;
  empty.textContent = emptyText;

  const metaParts = [exercise.category, ...exercise.equipment].filter(Boolean);
  meta.textContent = metaParts.join(" · ");
  meta.hidden = metaParts.length === 0;

  const descFragment = exercise.description ? sanitizeWgerHtml(exercise.description) : null;
  const hasDescription = !!descFragment && descFragment.textContent.trim() !== "";
  desc.replaceChildren(...(hasDescription ? [descFragment] : []));
  desc.hidden = !hasDescription;

  function updateEmptyState() {
    empty.hidden = !(figure.hidden && desc.hidden);
  }

  if (exercise.image) {
    figure.hidden = false;
    img.alt = exercise.name;
    img.onerror = () => {
      // Trasig bildlänk: dölj bilden istället för att visa en trasig ikon.
      figure.hidden = true;
      updateEmptyState();
    };
    img.src = exercise.image.url;
    credit.textContent = exercise.image.author
      ? `Bild: ${exercise.image.author} via wger.de`
      : "Bild via wger.de";
  } else {
    figure.hidden = true;
    img.removeAttribute("src");
  }

  updateEmptyState();
  if (!dialog.open) dialog.showModal();
}

// "Visa övning"-knappen visar övningen på den rad man senast var i. Valde
// man ett wger-förslag på raden återanvänds det svaret direkt; annars
// (namn inskrivet för hand, eller inladdat vid redigering) slås namnet
// upp hos wger och måste matcha exakt (skiftlägesokänsligt).
const wgerExerciseByRow = new WeakMap();
let activeExerciseRow = null;
let exerciseInfoRequestId = 0;

function emptyExerciseInfo(name) {
  return { name, category: "", equipment: [], description: "", image: null };
}

async function findWgerExerciseByName(name) {
  const results = await searchWgerExercises(name);
  const wanted = name.toLowerCase();
  return results.find((r) => r.name.trim().toLowerCase() === wanted) || null;
}

function exerciseRowForInfoButton() {
  const rows = [...document.querySelectorAll("#exercise-rows .exercise-row")];
  const hasName = (row) => row.querySelector(".ex-name").value.trim() !== "";
  if (activeExerciseRow && rows.includes(activeExerciseRow) && hasName(activeExerciseRow)) {
    return activeExerciseRow;
  }
  return rows.reverse().find(hasName) || null;
}

document.getElementById("show-exercise-info").addEventListener("click", async () => {
  const requestId = ++exerciseInfoRequestId;
  const row = exerciseRowForInfoButton();

  if (!row) {
    showExerciseInfo(emptyExerciseInfo("Ingen övning vald"), "Skriv in eller välj en övning först.");
    return;
  }

  const name = row.querySelector(".ex-name").value.trim();
  const cached = wgerExerciseByRow.get(row);
  if (cached) {
    showExerciseInfo(cached);
    return;
  }

  showExerciseInfo(emptyExerciseInfo(name), "Hämtar från wger.de…");
  try {
    const found = await findWgerExerciseByName(name);
    // Hann man stänga och öppna en annan övning under tiden ska det här
    // svaret inte skriva över den.
    if (requestId !== exerciseInfoRequestId) return;
    if (found) wgerExerciseByRow.set(row, found);
    showExerciseInfo(found || emptyExerciseInfo(name));
  } catch {
    if (requestId !== exerciseInfoRequestId) return;
    showExerciseInfo(emptyExerciseInfo(name), "Kunde inte nå wger.de just nu.");
  }
});

(function wireExerciseInfoDialog() {
  const dialog = document.getElementById("exercise-info");
  // Stängs kortet medan en uppslagning pågår ska svaret inte öppna det igen.
  dialog.addEventListener("close", () => exerciseInfoRequestId++);
  document.getElementById("exercise-info-close").addEventListener("click", () => dialog.close());
  // Klick på den mörka bakgrunden utanför kortet stänger också.
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });
})();

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

    // Byggs med textContent (inte innerHTML) eftersom namnen kommer från
    // wger:s användarskrivna data.
    list.replaceChildren(
      ...results.map((r) => {
        const li = document.createElement("li");
        li.textContent = r.name;
        if (r.category) {
          const cat = document.createElement("span");
          cat.className = "ex-suggestion-cat";
          cat.textContent = ` (${r.category})`;
          li.appendChild(cat);
        }
        // mousedown (inte click) så den hinner köras innan inputens
        // blur-händelse döljer listan.
        li.addEventListener("mousedown", (e) => {
          e.preventDefault();
          input.value = r.name;
          hideSuggestions();
          autofillFromHistory(r.name);
          wgerExerciseByRow.set(row, r);
          activeExerciseRow = row;
        });
        return li;
      })
    );
    list.hidden = false;
  }

  input.addEventListener("focus", () => {
    activeExerciseRow = row;
  });

  input.addEventListener("input", () => {
    const term = input.value.trim();
    clearTimeout(debounceTimer);
    // Namnet har ändrats - ett tidigare valt wger-förslag gäller inte längre.
    wgerExerciseByRow.delete(row);

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
  document.getElementById("session-notes").value = session.notes;

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
  const notes = document.getElementById("session-notes").value.trim();

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
    await updateSession(Number(editingId), { type, date, durationMin, exercises, pace, notes });
  } else {
    await createSession({ type, date, durationMin, exercises, pace, notes });
  }

  resetSessionForm();
  await refreshHistoryUI();
});

// ---------- Historik: rendering ----------

// Fritext från användaren (anteckningar, övningsnamn) som stoppas in i
// HTML-mallar måste escapas så att t.ex. "<" inte tolkas som en tagg.
function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// Tabellerna (historik, personliga rekord, viktloggar) visas som tabell på
// bred skärm och som ett kort per post på mobil (se `.responsive-table` i
// style.css). Varje post ligger i en egen <tbody> så att den kan bli ett
// kort, och varje cell får sin kolumnrubrik som `data-label` - den visas
// som etikett framför värdet i kortläget. Tomma värden ("–") döljs där.
function responsiveCell(label, content) {
  const emptyClass = content === "–" ? ' class="is-empty"' : "";
  return `<td data-label="${label}"${emptyClass}>${content}</td>`;
}

function actionCell(id) {
  return `
    <td class="cell-actions">
      <button class="secondary edit-link" data-id="${id}">Redigera</button>
      <button class="danger-link" data-id="${id}">Ta bort</button>
    </td>`;
}

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
              .map((ex) => `<li>${escapeHtml(ex.name)}: ${ex.weight} kg × ${ex.reps} reps</li>`)
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

      // Anteckningen får en egen rad under passet, över hela tabellbredden.
      const noteRow = s.notes
        ? `<tr class="note-row"><td colspan="7"><span class="note-label">Anteckning:</span> ${escapeHtml(s.notes)}</td></tr>`
        : "";

      return `
        <tbody>
          <tr${s.notes ? ' class="has-note"' : ""}>
            ${responsiveCell("Datum", s.date)}
            ${responsiveCell("Typ", SESSION_TYPE_LABELS[type] || type)}
            ${responsiveCell("Längd", `${s.durationMin} min`)}
            ${responsiveCell("Tempo/fart", pace)}
            ${responsiveCell("Övningar", details)}
            ${responsiveCell("Kalorier", calories)}
            ${actionCell(s.id)}
          </tr>
          ${noteRow}
        </tbody>
      `;
    })
    .join("");

  el.innerHTML = `
    <div class="table-scroll">
      <table class="responsive-table">
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
        ${rows}
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

// ---------- Statistik: minuter/kalorier per vecka & personliga rekord ----------

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

// Grupperar ALLA pass (styrka + kondition) per vecka och summerar ett
// värde per pass (t.ex. längd eller kalorier) - `valueFn(session)`.
function computeWeeklyAggregate(sessions, valueFn) {
  const byWeek = new Map(); // "YYYY-MM-DD" (måndag) -> { monday, value }

  sessions.forEach((s) => {
    const monday = getMonday(s.date);
    const key = monday.toISOString().slice(0, 10);
    const entry = byWeek.get(key) || { monday, value: 0 };
    entry.value += valueFn(s);
    byWeek.set(key, entry);
  });

  return Array.from(byWeek.values())
    .sort((a, b) => a.monday - b.monday)
    .slice(-12) // senaste 12 veckorna med loggade pass
    .map((entry) => ({ label: formatWeekLabel(entry.monday), value: Math.round(entry.value) }));
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

// Antal dagar sedan det senast loggade passet (vilken passtyp som helst).
// Räknat på datum, inte klockslag - "idag" ger 0.
function computeDaysSinceLastSession(sessions) {
  if (sessions.length === 0) return null;

  const latestDate = sessions.reduce((latest, s) => (s.date > latest ? s.date : latest), sessions[0].date);
  const todayStr = new Date().toISOString().slice(0, 10);
  return Math.round((new Date(todayStr) - new Date(latestDate)) / (24 * 3600 * 1000));
}

// Antal veckor i rad (bakåt från nuvarande vecka) med minst 3 pass
// (vilken passtyp som helst). Om nuvarande vecka ännu inte nått 3 pass
// räknas den inte in än (den är inte "bruten", bara inte klar), och
// räkningen börjar då från senast avslutade vecka istället.
function computeWeeklyStreak(sessions) {
  const countByWeekKey = new Map();
  sessions.forEach((s) => {
    const key = getMonday(s.date).toISOString().slice(0, 10);
    countByWeekKey.set(key, (countByWeekKey.get(key) || 0) + 1);
  });

  const todayStr = new Date().toISOString().slice(0, 10);
  const currentMonday = getMonday(todayStr);
  const currentKey = currentMonday.toISOString().slice(0, 10);
  const currentCount = countByWeekKey.get(currentKey) || 0;

  const cursor = new Date(currentMonday);
  if (currentCount < 3) {
    cursor.setDate(cursor.getDate() - 7); // hoppa till förra veckan
  }

  let streak = 0;
  while ((countByWeekKey.get(cursor.toISOString().slice(0, 10)) || 0) >= 3) {
    streak++;
    cursor.setDate(cursor.getDate() - 7);
  }

  return streak;
}

function renderRestDayCounter(sessions) {
  const valueEl = document.getElementById("rest-days-value");
  const labelEl = document.getElementById("rest-days-label");
  const days = computeDaysSinceLastSession(sessions);

  if (days === null) {
    valueEl.textContent = "–";
    labelEl.textContent = "Inga pass loggade än";
  } else if (days <= 0) {
    valueEl.textContent = "0";
    labelEl.textContent = "dagar sedan senaste passet - snyggt! 💪";
  } else {
    valueEl.textContent = days;
    labelEl.textContent = days === 1 ? "dag sedan senaste passet" : "dagar sedan senaste passet";
  }
}

function renderStreakCounter(sessions) {
  document.getElementById("streak-value").textContent = computeWeeklyStreak(sessions);
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

// `unit` visas efter värdet bara på mobil (liggande staplar, gott om
// plats). På bred skärm är staplarna för smala för t.ex. "1 966 kcal", så
// där visas bara siffran och enheten står i grafens rubrik istället.
function renderWeeklyBarChart(elementId, weeks, emptyMessage, unit) {
  const el = document.getElementById(elementId);

  if (weeks.length === 0) {
    el.innerHTML = `<p class="empty">${emptyMessage}</p>`;
    return;
  }

  const maxValue = Math.max(...weeks.map((w) => w.value), 1);

  el.innerHTML = `
    <div class="volume-chart">
      ${weeks
        .map(
          (w) => `
            <div class="volume-chart-col">
              <div class="volume-chart-value">${w.value.toLocaleString("sv-SE")}<span class="volume-chart-unit"> ${unit}</span></div>
              <div class="volume-chart-bar" style="--pct: ${Math.max((w.value / maxValue) * 100, 3)}%"></div>
              <div class="volume-chart-label">${w.label}</div>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderWeeklyMinutesChart(sessions) {
  const weeks = computeWeeklyAggregate(sessions, (s) => s.durationMin);
  renderWeeklyBarChart(
    "weekly-minutes-chart",
    weeks,
    "Inga pass loggade ännu.",
    "min"
  );
}

function renderWeeklyCaloriesChart(sessions, profile) {
  if (!profile || !profile.weightKg) {
    document.getElementById("weekly-calories-chart").innerHTML =
      `<p class="empty">Fyll i din vikt under "Din profil" för att se förbrukade kalorier per vecka.</p>`;
    return;
  }

  const weeks = computeWeeklyAggregate(sessions, (s) =>
    computeCaloriesBurned(s.durationMin, profile.weightKg, s.type || "strength", s.pace)
  );
  renderWeeklyBarChart(
    "weekly-calories-chart",
    weeks,
    "Inga pass loggade ännu.",
    "kcal"
  );
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
        <tbody>
          <tr>
            ${responsiveCell("Övning", escapeHtml(r.name))}
            ${responsiveCell("Högsta vikt", `${r.maxWeight.weight} kg × ${r.maxWeight.reps}`)}
            ${responsiveCell("Högsta volym", `${r.maxVolume.volume.toLocaleString("sv-SE")} kg (${r.maxVolume.weight} kg × ${r.maxVolume.reps})`)}
          </tr>
        </tbody>
      `
    )
    .join("");

  el.innerHTML = `
    <div class="table-scroll">
      <table class="responsive-table">
        <thead>
          <tr>
            <th>Övning</th>
            <th>Högsta vikt</th>
            <th>Högsta volym (ett set)</th>
          </tr>
        </thead>
        ${rows}
      </table>
    </div>
  `;
}

function renderStatistics(sessions, profile) {
  renderWeeklyMinutesChart(sessions);
  renderWeeklyCaloriesChart(sessions, profile);
  renderPersonalRecords(sessions);
}

let lastExerciseStatsByName = new Map();

async function refreshHistoryUI() {
  const [sessions, profile] = await Promise.all([loadSessions(), loadProfile()]);
  lastExerciseStatsByName = computeLastExerciseStats(sessions);
  renderRestDayCounter(sessions);
  renderStreakCounter(sessions);
  renderHistory(sessions, profile);
  renderStatistics(sessions, profile);
}

// ---------- Kroppsvikt: logga, graf, historik ----------

function formatSignedKg(diff) {
  if (Math.abs(diff) < 0.05) return "±0.0 kg";
  return `${diff > 0 ? "+" : "−"}${Math.abs(diff).toFixed(1)} kg`;
}

function formatShortDate(dateStr, withYear) {
  const opts = { day: "numeric", month: "short" };
  if (withYear) opts.year = "numeric";
  return new Date(dateStr + "T00:00:00").toLocaleDateString("sv-SE", opts);
}

// Runda axel-steg till "snygga" värden så att y-axeln får hela/halva kilon.
function niceWeightAxis(min, max) {
  const steps = [0.5, 1, 2, 5, 10, 20];
  const span = Math.max(max - min, 0.1);
  const step = steps.find((s) => span / s <= 4) || 50;
  let lo = Math.floor(min / step) * step;
  let hi = Math.ceil(max / step) * step;
  if (hi - lo < step * 2) {
    lo -= step;
    hi += step;
  }
  const ticks = [];
  for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(Math.round(v * 10) / 10);
  return { lo, hi, ticks };
}

// Dagens datum i lokal tid (inte UTC, som toISOString/valueAsDate ger -
// annars blir "idag" gårdagen mellan midnatt och 02:00 svensk sommartid).
function todayLocalISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Profilens vikt och viktloggen hålls i synk åt båda hållen:
// - ändrad vikt i profilen loggas på dagens datum (uppdaterar dagens
//   loggning om det redan finns en, så det inte blir dubbletter), och
// - en loggning på det senaste datumet uppdaterar profilens vikt.
// Äldre loggningar (bakåt i tiden) rör inte profilen.
async function logWeightForToday(weightKg) {
  const today = todayLocalISO();
  const logs = await loadWeightLogs();
  const todays = logs.find((log) => log.date === today); // nyast skapad först
  if (todays) {
    if (todays.weightKg !== weightKg) await updateWeightLog(todays.id, { date: today, weightKg });
  } else {
    await createWeightLog({ date: today, weightKg });
  }
}

async function syncProfileWeightFromLatestLog(savedDate) {
  const logs = await loadWeightLogs();
  const latest = logs[0];
  if (!latest || latest.date !== savedDate) return false;

  const profile = (await loadProfile()) || { name: "", weightKg: null, heightCm: null };
  if (Number(profile.weightKg) === latest.weightKg) return false;
  await saveProfile({ ...profile, weightKg: latest.weightKg });
  return true;
}

function resetWeightForm() {
  document.getElementById("weight-form").reset();
  document.getElementById("weight-editing-id").value = "";
  document.getElementById("weight-date").value = todayLocalISO();
  document.getElementById("weight-form-title").textContent = "Kroppsvikt";
  document.getElementById("weight-submit-btn").textContent = "Spara vikt";
  document.getElementById("weight-cancel-edit-btn").hidden = true;
}

function startEditingWeightLog(log) {
  document.getElementById("weight-editing-id").value = log.id;
  document.getElementById("weight-date").value = log.date;
  document.getElementById("weight-kg").value = log.weightKg;
  document.getElementById("weight-form-title").textContent = "Redigera viktloggning";
  document.getElementById("weight-submit-btn").textContent = "Uppdatera vikt";
  document.getElementById("weight-cancel-edit-btn").hidden = false;
  document.getElementById("weight-form").scrollIntoView({ behavior: "smooth" });
}

document.getElementById("weight-cancel-edit-btn").addEventListener("click", resetWeightForm);

document.getElementById("weight-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const editingId = document.getElementById("weight-editing-id").value;
  const log = {
    date: document.getElementById("weight-date").value,
    weightKg: parseFloat(document.getElementById("weight-kg").value),
  };

  if (editingId) {
    await updateWeightLog(Number(editingId), log);
  } else {
    await createWeightLog(log);
  }

  resetWeightForm();
  await refreshWeightUI();

  if (await syncProfileWeightFromLatestLog(log.date)) {
    await refreshProfileUI();
    await refreshHistoryUI(); // kalorier per pass beror på profilens vikt
  }
});

function renderWeightSummary(logsAsc) {
  const el = document.getElementById("weight-summary");
  if (logsAsc.length === 0) {
    el.textContent = "";
    el.hidden = true;
    return;
  }
  const first = logsAsc[0];
  const last = logsAsc[logsAsc.length - 1];
  el.hidden = false;
  el.textContent =
    logsAsc.length === 1
      ? `Senast: ${last.weightKg.toFixed(1)} kg (${last.date}).`
      : `Senast: ${last.weightKg.toFixed(1)} kg (${last.date}) · ` +
        `${formatSignedKg(last.weightKg - first.weightKg)} sedan första loggningen (${first.date}).`;
}

// Linjediagram i ren SVG (inget chart-bibliotek). Ritas i containerns
// faktiska pixelbredd så att text och punkter inte förvrängs, och ritas om
// vid fönsterstorleksändring (se `lastWeightLogsAsc` nedan).
function renderWeightChart(logsAsc) {
  const el = document.getElementById("weight-chart");

  if (logsAsc.length === 0) {
    el.innerHTML = `<p class="empty">Ingen vikt loggad ännu.</p>`;
    return;
  }

  const width = el.clientWidth || 600;
  const height = 220;
  const m = { top: 16, right: 60, bottom: 28, left: 40 };
  const plotW = width - m.left - m.right;
  const plotH = height - m.top - m.bottom;

  const times = logsAsc.map((l) => new Date(l.date + "T00:00:00").getTime());
  const tMin = times[0];
  const tMax = times[times.length - 1];
  const weights = logsAsc.map((l) => l.weightKg);
  const axis = niceWeightAxis(Math.min(...weights), Math.max(...weights));

  const x = (t) => (tMax === tMin ? m.left + plotW / 2 : m.left + ((t - tMin) / (tMax - tMin)) * plotW);
  const y = (w) => m.top + (1 - (w - axis.lo) / (axis.hi - axis.lo)) * plotH;
  const points = logsAsc.map((l, i) => ({ ...l, px: x(times[i]), py: y(l.weightKg) }));

  const multiYear = new Date(tMin).getFullYear() !== new Date(tMax).getFullYear();
  const last = points[points.length - 1];

  const grid = axis.ticks
    .map(
      (v) => `
        <line class="wc-grid" x1="${m.left}" x2="${m.left + plotW}" y1="${y(v)}" y2="${y(v)}"></line>
        <text class="wc-axis" x="${m.left - 6}" y="${y(v)}" text-anchor="end" dominant-baseline="middle">${v}</text>`
    )
    .join("");

  const xLabels =
    points.length === 1
      ? `<text class="wc-axis" x="${last.px}" y="${height - 8}" text-anchor="middle">${formatShortDate(last.date, true)}</text>`
      : `<text class="wc-axis" x="${m.left}" y="${height - 8}" text-anchor="start">${formatShortDate(logsAsc[0].date, multiYear)}</text>
         <text class="wc-axis" x="${m.left + plotW}" y="${height - 8}" text-anchor="end">${formatShortDate(last.date, multiYear)}</text>`;

  // Vid många loggningar blir punkterna brus - visa då bara linjen + slutpunkten.
  const dotPoints = points.length <= 30 ? points : [last];
  const dots = dotPoints.map((p) => `<circle class="wc-dot" cx="${p.px}" cy="${p.py}" r="4"></circle>`).join("");

  el.innerHTML = `
    <svg width="${width}" height="${height}" role="img"
         aria-label="Viktutveckling, ${points.length} loggningar. Se tabellen nedan för alla värden.">
      ${grid}
      ${xLabels}
      <polyline class="wc-line" points="${points.map((p) => `${p.px},${p.py}`).join(" ")}"></polyline>
      ${dots}
      <text class="wc-end-label" x="${last.px + 8}" y="${last.py}" dominant-baseline="middle">${last.weightKg.toFixed(1)} kg</text>
      <line class="wc-crosshair" y1="${m.top}" y2="${m.top + plotH}" visibility="hidden"></line>
      <circle class="wc-dot wc-focus" r="5" visibility="hidden"></circle>
      <rect class="wc-hit" x="${m.left}" y="${m.top}" width="${plotW}" height="${plotH}"></rect>
    </svg>
    <div class="wc-tooltip" hidden><strong></strong><span></span></div>
  `;

  // Hover: hårkorset snappar till närmaste loggning i x-led.
  const svg = el.querySelector("svg");
  const crosshair = svg.querySelector(".wc-crosshair");
  const focus = svg.querySelector(".wc-focus");
  const tooltip = el.querySelector(".wc-tooltip");

  svg.querySelector(".wc-hit").addEventListener("pointermove", (e) => {
    const mouseX = e.clientX - svg.getBoundingClientRect().left;
    const p = points.reduce((best, pt) => (Math.abs(pt.px - mouseX) < Math.abs(best.px - mouseX) ? pt : best));
    crosshair.setAttribute("x1", p.px);
    crosshair.setAttribute("x2", p.px);
    crosshair.setAttribute("visibility", "visible");
    focus.setAttribute("cx", p.px);
    focus.setAttribute("cy", p.py);
    focus.setAttribute("visibility", "visible");
    tooltip.querySelector("strong").textContent = `${p.weightKg.toFixed(1)} kg`;
    tooltip.querySelector("span").textContent = formatShortDate(p.date, true);
    tooltip.hidden = false;
    // Håll tooltipen innanför grafen även vid kanterna.
    const left = Math.min(Math.max(p.px - tooltip.offsetWidth / 2, 0), width - tooltip.offsetWidth);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${Math.max(p.py - tooltip.offsetHeight - 12, 0)}px`;
  });

  svg.querySelector(".wc-hit").addEventListener("pointerleave", () => {
    crosshair.setAttribute("visibility", "hidden");
    focus.setAttribute("visibility", "hidden");
    tooltip.hidden = true;
  });
}

function renderWeightHistory(logsDesc) {
  const el = document.getElementById("weight-history");

  if (logsDesc.length === 0) {
    el.innerHTML = `<p class="empty">Inga viktloggningar ännu.</p>`;
    return;
  }

  const rows = logsDesc
    .map((log, i) => {
      const previous = logsDesc[i + 1]; // listan är nyast först
      const change = previous ? formatSignedKg(log.weightKg - previous.weightKg) : "–";
      return `
        <tbody>
          <tr>
            ${responsiveCell("Datum", log.date)}
            ${responsiveCell("Vikt", `${log.weightKg.toFixed(1)} kg`)}
            ${responsiveCell("Förändring", change)}
            ${actionCell(log.id)}
          </tr>
        </tbody>
      `;
    })
    .join("");

  el.innerHTML = `
    <div class="table-scroll">
      <table class="responsive-table">
        <thead>
          <tr>
            <th>Datum</th>
            <th>Vikt</th>
            <th>Förändring</th>
            <th></th>
          </tr>
        </thead>
        ${rows}
      </table>
    </div>
  `;

  const byId = new Map(logsDesc.map((log) => [log.id, log]));
  el.querySelectorAll(".edit-link").forEach((btn) => {
    btn.addEventListener("click", () => startEditingWeightLog(byId.get(Number(btn.dataset.id))));
  });
  el.querySelectorAll(".danger-link").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await removeWeightLog(Number(btn.dataset.id));
      await refreshWeightUI();
    });
  });
}

let lastWeightLogsAsc = [];

async function refreshWeightUI() {
  const logsDesc = await loadWeightLogs();
  lastWeightLogsAsc = logsDesc.slice().reverse();
  renderWeightSummary(lastWeightLogsAsc);
  renderWeightChart(lastWeightLogsAsc);
  renderWeightHistory(logsDesc);
}

let weightChartResizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(weightChartResizeTimer);
  weightChartResizeTimer = setTimeout(() => renderWeightChart(lastWeightLogsAsc), 150);
});

// ---------- Init ----------

resetSessionForm(); // sätter startläge: tom övningsrad, dagens datum, "styrka" synlig
resetWeightForm();

// Utan Supabase-biblioteket (t.ex. CDN:et hann inte ladda pga dåligt nät)
// finns inget att göra - HTML:ens default-läge visar redan bara
// inloggningsformuläret, så vi lämnar det så istället för att krascha.

// onAuthStateChange fyrar ett "INITIAL_SESSION"-event direkt vid start
// (med ev. redan inloggad session), och sedan "SIGNED_IN"/"SIGNED_OUT" när
// man loggar in/ut - inklusive om e-postbekräftelse är påslaget och man
// klickar på bekräftelselänken i mejlet och kommer tillbaka hit.
// "PASSWORD_RECOVERY" fyrar när man klickar på återställningslänken för
// glömt lösenord - då visas "Välj nytt lösenord"-kortet istället för att
// släppa in i appen på den tillfälliga recovery-sessionen (se
// updateAuthUI()). Det här är alltså den enda platsen vi behöver trigga
// om profil/historik ska laddas om.
supabaseClient?.auth.onAuthStateChange(async (event, session) => {
  currentUser = session ? session.user : null;

  if (event === "PASSWORD_RECOVERY") {
    inPasswordRecovery = true;
  }

  updateAuthUI();

  if (!inPasswordRecovery) {
    await refreshProfileUI();
    await refreshHistoryUI();
    await refreshWeightUI();
  }
});
