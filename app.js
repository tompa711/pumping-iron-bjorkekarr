// ===================================================================
// Träningslogg – all data sparas i webbläsarens localStorage.
// Det finns ingen server: allt som lagras stannar på den här datorn,
// i den här webbläsaren. Rensar man webbläsarens data försvinner loggen.
// ===================================================================

const PROFILE_KEY = "traningslogg_profile";
const SESSIONS_KEY = "traningslogg_sessions";

// Antagande för kaloriberäkningen: styrketräning med måttlig-hög
// intensitet motsvarar ungefär MET 5.0 (MET = "Metabolic Equivalent of
// Task", ett standardmått för hur ansträngande en aktivitet är).
// Formeln nedan (kcal/min = MET * 3.5 * kroppsvikt(kg) / 200) är en
// vedertagen tumregelsformel, inte en exakt mätning.
const MET_STRENGTH_TRAINING = 5.0;

// ---------- Hjälpfunktioner: läsa/skriva localStorage ----------

function loadProfile() {
  const raw = localStorage.getItem(PROFILE_KEY);
  return raw ? JSON.parse(raw) : null;
}

function saveProfile(profile) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

function loadSessions() {
  const raw = localStorage.getItem(SESSIONS_KEY);
  return raw ? JSON.parse(raw) : [];
}

function saveSessions(sessions) {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
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

function computeCaloriesBurned(durationMin, weightKg) {
  const kcalPerMin = (MET_STRENGTH_TRAINING * 3.5 * weightKg) / 200;
  return Math.round(kcalPerMin * durationMin);
}

// ---------- Profil: rendering & events ----------

function renderProfileStats() {
  const profile = loadProfile();
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

function fillProfileForm() {
  const profile = loadProfile();
  if (!profile) return;
  document.getElementById("profile-name").value = profile.name || "";
  document.getElementById("profile-weight").value = profile.weightKg || "";
  document.getElementById("profile-height").value = profile.heightCm || "";
}

document.getElementById("profile-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const profile = {
    name: document.getElementById("profile-name").value.trim(),
    weightKg: parseFloat(document.getElementById("profile-weight").value),
    heightCm: parseFloat(document.getElementById("profile-height").value),
  };
  saveProfile(profile);
  renderProfileStats();
  renderHistory(); // kalorier per pass beror på profilens vikt
});

// ---------- Nytt pass: dynamiska övningsrader ----------

function addExerciseRow() {
  const container = document.getElementById("exercise-rows");
  const row = document.createElement("div");
  row.className = "exercise-row";
  row.innerHTML = `
    <label>
      Övning
      <input type="text" class="ex-name" placeholder="T.ex. Bänkpress" required>
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
  container.appendChild(row);
}

document.getElementById("add-exercise-row").addEventListener("click", addExerciseRow);

// ---------- Spara pass ----------

document.getElementById("session-form").addEventListener("submit", (e) => {
  e.preventDefault();

  const date = document.getElementById("session-date").value;
  const durationMin = parseFloat(document.getElementById("session-duration").value);

  const exercises = [];
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

  const sessions = loadSessions();
  sessions.push({
    id: Date.now(),
    date,
    durationMin,
    exercises,
  });
  saveSessions(sessions);

  e.target.reset();
  document.getElementById("exercise-rows").innerHTML = "";
  addExerciseRow();

  renderHistory();
});

// ---------- Historik: rendering ----------

function deleteSession(id) {
  const sessions = loadSessions().filter((s) => s.id !== id);
  saveSessions(sessions);
  renderHistory();
}

function renderHistory() {
  const el = document.getElementById("history");
  const sessions = loadSessions().slice().sort((a, b) => (a.date < b.date ? 1 : -1));
  const profile = loadProfile();

  if (sessions.length === 0) {
    el.innerHTML = `<p class="empty">Inga pass loggade ännu.</p>`;
    return;
  }

  const rows = sessions
    .map((s) => {
      const exList = s.exercises
        .map((ex) => `<li>${ex.name}: ${ex.weight} kg × ${ex.reps} reps</li>`)
        .join("");

      let calories = "–";
      if (profile && profile.weightKg) {
        calories = `${computeCaloriesBurned(s.durationMin, profile.weightKg)} kcal`;
      }

      return `
        <tr>
          <td>${s.date}</td>
          <td>${s.durationMin} min</td>
          <td><ul class="ex-list">${exList}</ul></td>
          <td>${calories}</td>
          <td><button class="danger-link" data-id="${s.id}">Ta bort</button></td>
        </tr>
      `;
    })
    .join("");

  el.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Datum</th>
          <th>Längd</th>
          <th>Övningar</th>
          <th>Kalorier (uppskattat)</th>
          <th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  el.querySelectorAll(".danger-link").forEach((btn) => {
    btn.addEventListener("click", () => deleteSession(Number(btn.dataset.id)));
  });
}

// ---------- Init ----------

fillProfileForm();
renderProfileStats();
addExerciseRow(); // starta med en tom övningsrad
renderHistory();
document.getElementById("session-date").valueAsDate = new Date();
