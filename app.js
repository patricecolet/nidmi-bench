// BANC D'ERGONOMIE — la facade du boitier, pilotee par le VRAI core compile en wasm.
//
// La grammaire des molettes n'est pas recodee ici : libelles, roles et capuchons
// enfonces viennent de describe(), les gestes passent par turn()/push(). La hauteur
// affichee vient de resolvedNote(), les notes permises de allowedPitchClassesFor().
//
// Deux choses appartiennent a l'HOTE et vivent donc ici : le CADRAGE (zoom, fenetre de
// hauteurs) et le CLAVIER. Le clavier est la seule logique de grammaire ecrite ici :
// a terme il devrait rejoindre le core, comme les molettes avant lui, pour que le
// plugin et le firmware ne la recodent pas chacun de leur cote.

// Le wasm se charge TOUJOURS frais : un nidmi.wasm garde en cache par le navigateur,
// plus vieux que ce script, n'a pas les fonctions qu'on appelle ici.
const STAMP = Date.now();
const { default: createNidmi } = await import(`./nidmi.js?v=${STAMP}`);
const M = await createNidmi({ locateFile: (path) => `${path}?v=${STAMP}` });

// Et s'il manque quand meme quelque chose, on le dit au lieu d'un ecran noir.
const REQUIRED = ["_nidmi_curve_eval", "_nidmi_sub_step_on", "_nidmi_resolved_note", "_nidmi_key_scale", "_nidmi_allowed_pcs", "_nidmi_chord_pcs", "_nidmi_play_bar", "_nidmi_step_gate", "_nidmi_select_track", "_nidmi_note_name", "_nidmi_add_slot", "_nidmi_chord_symbol", "_nidmi_fill_active", "_nidmi_keys_describe"];
const missing = REQUIRED.filter((f) => typeof M[f] !== "function");
if (missing.length) {
  document.body.insertAdjacentHTML("afterbegin",
    `<p style="background:#400;color:#fcc;padding:12px;margin:0">nidmi.wasm is older than app.js (missing ${missing.join(", ")}). Run web/wasm/build.sh again, then reload.</p>`);
  throw new Error("stale wasm");
}
const str = (p) => M.UTF8ToString(p);
const now = () => performance.now();

// Ids de SequencerCommandId (ordre de l'enum, SequencerCommandApi.h).
const CMD = {
  SetBpm: 8, SetStep: 13, ToggleStep: 15, CopyStep: 16, ClearStep: 17, CopyRow: 18, ClearRow: 19,
  CopyBar: 20, ClearBar: 21, SetSubStep: 27, ToggleSubStep: 28, SetPatternHarmony: 33, SetPatternAccentAmount: 37,
  SetPatternSwing: 38, SetStepAccent: 42, SetStepSwing: 43, SetRowSteps: 47, SetRowHarmonyMode: 51,
  SetChordSlot: 59, SetChordProgressionLen: 60, SetRowDisplayMode: 89,
  SetNumRows: 11, SetStepSpan: 14, SetRowKind: 48, SetRowCCNumber: 49, SetRowCCInterp: 50,
  SetStepCCLock: 53, EnsureStepSubPattern: 86, SetPatternNumBars: 76, SetTrackCount: 90, SetTrackRows: 91, SetTrackChannel: 92,
  SetCurvePoint: 93, RemoveCurvePoint: 94, MoveCurvePoint: 95, ClearCurve: 96, SetCurveTolerance: 97,
  RecordCurveTurn: 98, SetFillEvery: 104, SetStepCond: 105, SetFillHeld: 103, ArmFillNextBar: 108,
};
// Un point de courbe : position en ticks (384 par mesure), valeur 14 bits, forme
// (0 palier, 1 courbe, 2 S) et tension.
const TICKS = 384;
function curvePoint(row, pos, value, shape = 1, tension = 0) {
  cmd(CMD.SetCurvePoint, { a: row, b: pos >> 8, c: pos & 255, d: value >> 8, e: value & 255, f: shape, len: tension & 255 });
}
function cmd(id, { a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, x = 0, y = 0, len = 0, f32 = 0 } = {}) {
  return M._nidmi_command(id, a, b, c, d, e, f, x, y, len, f32, now());
}

const ROLE = { Own: 0, Pushed: 1, Lent: 2, Free: 3, Absent: 4 };
const VIEW_NAMES = ["PATTERN", "ROLL", "AUTO", "HARMONY", "GLOB", "SONG", "CHART"];
// Les noms de notes viennent du core : ecrits dans l'armure de la tonalite jouee, sur
// le cycle des quintes (Eb en do mineur, D# en mi majeur).
const noteName = (n) => str(M._nidmi_note_name(n));
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];
const QUALITY = ["maj", "min", "dim", "aug", "sus2", "sus4"];
// Les modes harmoniques par ce que la row FAIT (l'ancien A est fondu dans Scale).
const MODE_NAMES = ["Scale", "Scale", "Tones", "Off", "Follow"];
// RowDisplayMode, dans l'ordre de l'enum (StepTypes.h).
const DISPLAY_NAMES = ["Steps", "Accent", "Swing", "Controller", "Notes", "Fill"];
const DM = { Steps: 0, Accent: 1, Swing: 2, Controller: 3, Notes: 4, Fill: 5 };
// La serigraphie : le role de BASE de chaque molette, le meme dans toutes les vues.
const SILK = ["ROW", "STEP", "VALUE", "VELOCITY", "LENGTH", "TEMPO"];

// --- Demo : trois instruments en do eolien, harmonie active -----------------------
//
// Une piste = un instrument = une page. Les noms viendront du profil d'appareil : ce
// sont des donnees de l'hote, pas du core.
const TRACK_NAMES = ["Bass", "Drums", "Pad"];
const trackName = (t) => TRACK_NAMES[t] || `Track ${t + 1}`;

function loadDemo() {
  M._nidmi_init();
  cmd(CMD.SetBpm, { f32: 110 });
  cmd(CMD.SetPatternHarmony, { x: 1, a: 1, b: 0 });   // do eolien
  // Une grille de huit mesures en do eolien, avec deux accords dans la mesure 6.
  // [degre, qualite (0 maj, 1 min, 2 dim), extensions, temps]
  const B7 = 128, MAJ7 = 256, B9 = 8;
  [[1, 1, B7, 4], [1, 1, B7, 4], [6, 0, MAJ7, 4], [5, 0, B7 | B9, 4],
   [4, 1, B7, 4], [2, 2, B7, 2], [5, 0, B7, 2], [1, 1, B7, 8]].forEach(([deg, q, ext, dur], i) =>
    cmd(CMD.SetChordSlot, { a: i, b: deg, c: q, d: ext & 255, len: ext >> 8, f: dur }));
  cmd(CMD.SetChordProgressionLen, { a: 8 });

  // Le decoupage d'abord : il fixe quelles rows appartiennent a quel instrument.
  cmd(CMD.SetTrackCount, { a: 3 });
  [[0, 2, 0], [1, 3, 9], [2, 2, 2]].forEach(([t, rows, ch]) => {
    cmd(CMD.SetTrackRows, { a: t, b: rows });
    cmd(CMD.SetTrackChannel, { a: t, b: ch });
  });
  const put = (row, step, note, vel, gate) => cmd(CMD.SetStep, { a: row, b: step, c: note, d: vel, e: gate });

  // BASSE (rows 0-1) : la ligne, et le filtre en COURBE — quatre points, une forme
  // chacun : un creux qui monte, une droite, un S qui redescend, un palier.
  [[0, 36], [3, 36], [6, 43], [8, 39], [11, 36], [14, 41]].forEach(([s, n]) => put(0, s, n, 110, 50));
  cmd(CMD.SetRowKind, { a: 1, b: 1 });
  cmd(CMD.SetRowCCNumber, { a: 1, b: 74 });
  curvePoint(1, 0, 20 * 128, 1, 4);
  curvePoint(1, 96, 70 * 128, 1, 0);
  curvePoint(1, 192, 115 * 128, 2, 0);
  curvePoint(1, 312, 45 * 128, 0, 0);

  // BATTERIE (rows 2-4) : kick, caisse claire, charleston. Hors harmonie : une
  // batterie transposee vers la gamme changerait d'instrument.
  [2, 3, 4].forEach((r) => cmd(CMD.SetRowHarmonyMode, { a: r, b: 3, f: 0 }));
  [0, 6, 8, 11].forEach((s) => put(2, s, 36, 120, 40));
  [4, 12].forEach((s) => put(3, s, 38, 105, 40));
  [0, 2, 4, 6, 8, 10, 12, 14].forEach((s) => put(4, s, 42, s % 4 ? 60 : 90, 20));
  // LE FILL : la caisse claire roule sur la fin de mesure, le charley se tait. Il tombe
  // tout seul sur la derniere mesure, toutes les quatre boucles — ou quand on tape PLAY.
  [[12, 70], [13, 85], [14, 100], [15, 120]].forEach(([s, v]) => {
    put(3, s, 38, v, 30);
    cmd(CMD.SetStepCond, { a: 3, b: s, c: 1 });
  });
  [12, 14].forEach((s) => cmd(CMD.SetStepCond, { a: 4, b: s, c: 2 }));
  cmd(CMD.SetFillEvery, { a: 4 });
  cmd(CMD.EnsureStepSubPattern, { a: 4, b: 14, c: 3 });   // un roulement en triolet
  [0, 1, 2].forEach((k) => cmd(CMD.SetSubStep, { a: 0, b: k, c: 42, d: 55 + 15 * k, e: 40 }));

  // NAPPE (rows 5-6) : une tenue longue, et un arpege en triolets contre la croche.
  put(5, 0, 63, 70, 90);
  cmd(CMD.SetStepSpan, { a: 5, b: 0, c: 8 });
  put(5, 8, 67, 70, 90);
  cmd(CMD.SetStepSpan, { a: 5, b: 8, c: 8 });
  cmd(CMD.SetRowSteps, { a: 6, b: 12 });
  [[0, 72], [3, 75], [6, 79], [9, 77]].forEach(([s, n]) => put(6, s, n, 70, 30));

  // Deux mesures, la seconde copiee de la premiere : Step passe de l'une a l'autre.
  cmd(CMD.SetPatternNumBars, { a: 2 });
  cmd(CMD.CopyBar, { a: 0, f: 1 });
}
loadDemo();

// --- Son --------------------------------------------------------------------------

let audio = null;
let midiOut = null;
const voices = new Map();   // "canal:note" -> { osc, gain, rel }

function ensureAudio() {
  if (!audio) audio = new AudioContext();
  if (audio.state === "suspended") audio.resume();
}
document.addEventListener("pointerdown", ensureAudio, { capture: true });
document.addEventListener("keydown", ensureAudio, { capture: true });

// Un timbre par canal : on entend quelle row joue, et la hauteur change sous Valeur.
const TIMBRE = {
  1: { type: "triangle", cut: 900, rel: 0.08, lvl: 0.5 },
  2: { type: "square", cut: 1800, rel: 0.12, lvl: 0.18 },
  3: { type: "sine", cut: 6000, rel: 0.25, lvl: 0.3 },
  4: { type: "sawtooth", cut: 2400, rel: 0.15, lvl: 0.14 },
};

// Canal 10 : une batterie de synthese, assez pour reconnaitre kick, caisse et charley.
let noiseBuf = null;
function drum(note, vel) {
  const t = audio.currentTime, out = audio.createGain();
  out.gain.value = 0.6 * vel / 127;
  out.connect(audio.destination);
  if (note <= 36) {
    const o = audio.createOscillator(), e = audio.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    e.gain.setValueAtTime(1, t); e.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(e).connect(out); o.start(t); o.stop(t + 0.32);
    return;
  }
  if (!noiseBuf) {
    noiseBuf = audio.createBuffer(1, audio.sampleRate / 2, audio.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const hat = note >= 42, src = audio.createBufferSource(), f = audio.createBiquadFilter(), e = audio.createGain();
  src.buffer = noiseBuf;
  f.type = hat ? "highpass" : "bandpass"; f.frequency.value = hat ? 7000 : 1800;
  const len = hat ? 0.05 : 0.16;
  e.gain.setValueAtTime(hat ? 0.5 : 1, t); e.gain.exponentialRampToValueAtTime(0.001, t + len);
  src.connect(f).connect(e).connect(out); src.start(t); src.stop(t + len + 0.02);
}

function noteOn(ch, note, vel) {
  if (midiOut) { midiOut.send([0x90 | (ch - 1), note, vel]); return; }
  if (!audio) return;
  if (ch === 10) { drum(note, vel); return; }
  noteOff(ch, note);
  const t = audio.currentTime, tb = TIMBRE[ch] || TIMBRE[3];
  const osc = audio.createOscillator(), filt = audio.createBiquadFilter(), gain = audio.createGain();
  osc.type = tb.type;
  osc.frequency.value = 440 * Math.pow(2, (note - 69) / 12);
  filt.type = "lowpass"; filt.frequency.value = tb.cut;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(tb.lvl * vel / 127, t + 0.005);
  osc.connect(filt).connect(gain).connect(audio.destination);
  osc.start(t);
  voices.set(ch + ":" + note, { osc, gain, rel: tb.rel });
}

function noteOff(ch, note) {
  if (midiOut) { midiOut.send([0x80 | (ch - 1), note, 0]); return; }
  const v = voices.get(ch + ":" + note);
  if (!v || !audio) return;
  const t = audio.currentTime;
  v.gain.gain.cancelScheduledValues(t);
  v.gain.gain.setValueAtTime(v.gain.gain.value, t);
  v.gain.gain.linearRampToValueAtTime(0, t + v.rel);
  v.osc.stop(t + v.rel + 0.02);
  voices.delete(ch + ":" + note);
}

// Le clic d'un cran : un retour qu'on n'a pas sur une souris, et qu'on aura sur l'EC11.
let clickBuf = null;
function detentClick() {
  if (!audio || !document.getElementById("clicks").checked) return;
  if (!clickBuf) {
    clickBuf = audio.createBuffer(1, 96, audio.sampleRate);
    const d = clickBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
  }
  const src = audio.createBufferSource(), g = audio.createGain();
  src.buffer = clickBuf; g.gain.value = 0.15;
  src.connect(g).connect(audio.destination);
  src.start();
}

// --- Horloge et evenements ----------------------------------------------------

function drainEvents() {
  const n = M._nidmi_event_count();
  for (let i = 0; i < n; i++) {
    const ev = M._nidmi_event(i);
    const type = ev >>> 24, ch = (ev >> 16) & 255, d1 = (ev >> 8) & 255, d2 = ev & 255;
    if (type === 0) noteOn(ch, d1, d2);
    else if (type === 1) noteOff(ch, d1);
    else if (type === 2 && midiOut) midiOut.send([0xB0 | (ch - 1), d1, d2]);
  }
  M._nidmi_clear_events();
}

// Le ClockDriver sur-echantillonne lui-meme a 0,5 ms : 4 ms ici suffisent.
setInterval(() => { M._nidmi_tick(now()); drainEvents(); }, 4);

// --- Etat de l'hote : cadrage, REC, retours visuels --------------------------------

const host = {
  vRows: 0,          // rows visibles dans PATTERN (0 = toutes)
  hZoom: 1,          // fraction de mesure visible = 1 / hZoom (1, 2, 4)
  vSpan: 24,         // demi-tons visibles dans le roll
  rollBottom: 48,    // note la plus basse visible ; suit la note editee
  rec: "off",       // "off" | "grid" (saisie) | "live" (enregistrement temps reel)
  recHeld: false, recUsed: false,
  held: null,        // pas maintenu au clavier : { edited }
  touched: new Array(6).fill(0),   // dernier geste par molette (ms)
  hover: new Array(6).fill(false),
  toast: "", toastUntil: 0,
};
const isShift = () => document.getElementById("b-shift").classList.contains("on");
const rowFamily = () => M._nidmi_view() <= 2;
function toast(text) { host.toast = text; host.toastUntil = now() + 1400; }

// Le CADRAGE appartient a l'hote : le core nomme la molette et laisse sa valeur vide.
const H_ZOOMS = [1, 2, 4], V_SPANS = [12, 24, 36, 48], V_ROWS = [0, 8, 6, 4, 3, 2];
function hostTurn(slot, d) {
  if (!rowFamily() || !isShift()) return;
  if (slot === 0) {
    const i = Math.max(0, Math.min(V_ROWS.length - 1, V_ROWS.indexOf(host.vRows) + d));
    host.vRows = V_ROWS[i];
  } else if (slot === 1) {
    const i = Math.max(0, Math.min(H_ZOOMS.length - 1, H_ZOOMS.indexOf(host.hZoom) + d));
    host.hZoom = H_ZOOMS[i];
  } else if (slot === 2) {
    const i = Math.max(0, Math.min(V_SPANS.length - 1, V_SPANS.indexOf(host.vSpan) - d));
    host.vSpan = V_SPANS[i];
  }
}
function hostValue(slot) {
  if (!rowFamily() || !isShift()) return "";
  if (slot === 0) return host.vRows ? `${host.vRows} rows` : "all rows";
  if (slot === 1) return host.hZoom === 1 ? "1 bar" : `1/${host.hZoom} bar`;
  if (slot === 2) return `${host.vSpan / 12} oct.`;
  return "";
}

// --- Gestes des molettes -----------------------------------------------------------

const knobEls = [];

// L'ACCELERATION : tournee vite, une molette compte plusieurs crans par cran. Mesuree
// a l'ecart entre deux crans, comme le firmware le fera sur l'EC11. Pas sur Row : ses
// plages sont courtes, et on y vise une row precise. Le push est deja pris : c'est la
// seule facon de traverser vite huit mesures de pas.
const ACCEL_SLOTS = [1, 2, 5];
const lastDetent = new Array(6).fill(0);
function accelerate(slot, d) {
  const t = now(), dt = t - lastDetent[slot];
  lastDetent[slot] = t;
  if (!ACCEL_SLOTS.includes(slot) || isShift()) return d;
  return dt < 35 ? d * 4 : dt < 70 ? d * 2 : d;
}

function turn(slot, d) {
  if (!d) return;
  d = accelerate(slot, d);
  if (host.held) host.held.edited = true;   // pas maintenu + molette : on edite CE pas
  if (M._nidmi_host_owns(slot)) hostTurn(slot, d);
  else { M._nidmi_turn(slot, d, now()); drainEvents(); }
  host.touched[slot] = now();
  knobEls[slot].spin(d);
  detentClick();
}

function push(slot) {
  M._nidmi_push(slot, now());
  drainEvents();
  host.touched[slot] = now();
  knobEls[slot].flash();
}

// SHIFT a deux sources : le BOUTON, qui reste enfonce d'un clic a l'autre comme le
// capuchon d'une molette (une souris n'a qu'un doigt pour tenir SHIFT et cliquer une
// touche), et la touche Maj, momentanee. Il est actif tant que l'une le tient.
const shiftSrc = { latched: false, held: false };
function applyShift() {
  const on = shiftSrc.latched || shiftSrc.held;
  document.getElementById("b-shift").classList.toggle("on", on);
  M._nidmi_set_shift(on ? 1 : 0);
}
function setShift(on) { shiftSrc.held = on; applyShift(); }

// --- L'encodeur virtuel -----------------------------------------------------------

const DETENT_DEG = 15;   // 24 crans par tour, comme le PEC11R-4220F-S0024 de la BOM
const SLOT_KEYS = [["q", "a"], ["w", "s"], ["e", "d"], ["r", "f"], ["t", "g"], ["y", "h"]];

function makeKnob(slot) {
  const el = document.createElement("div");
  el.className = "knob";
  const ticks = Array.from({ length: 24 }, (_, i) => {
    const a = (i * DETENT_DEG - 90) * Math.PI / 180;
    return `<line x1="${42 + 36 * Math.cos(a)}" y1="${42 + 36 * Math.sin(a)}" x2="${42 + 40 * Math.cos(a)}" y2="${42 + 40 * Math.sin(a)}" stroke="#4a5058" stroke-width="1.5"/>`;
  }).join("");
  el.innerHTML = `<svg class="ring" viewBox="0 0 84 84">${ticks}</svg><div class="body"></div>
    <button class="cap" id="cap-${slot}" aria-label="Push ${SILK[slot]} knob"></button>
    <div class="key">${SLOT_KEYS[slot][0].toUpperCase()}/${SLOT_KEYS[slot][1].toUpperCase()} · ${slot + 1}</div>
    <div class="silk">${SILK[slot]}</div>`;
  const body = el.querySelector(".body"), cap = el.querySelector(".cap");
  let angle = 0, acc = 0, last = null, wheelAcc = 0;

  const pointerAngle = (e) => {
    const r = el.getBoundingClientRect();
    return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180 / Math.PI;
  };

  // Glisser EN CERCLE : le geste d'une vraie molette. L'angle a l'ecran croit dans le
  // sens horaire, donc horaire = +1.
  el.addEventListener("pointerdown", (e) => {
    if (e.target === cap) return;
    el.setPointerCapture(e.pointerId);
    last = pointerAngle(e); acc = 0;
  });
  el.addEventListener("pointermove", (e) => {
    if (last === null) return;
    const a = pointerAngle(e);
    let da = a - last;
    if (da > 180) da -= 360;
    if (da < -180) da += 360;
    last = a; acc += da;
    while (acc >= DETENT_DEG) { acc -= DETENT_DEG; turn(slot, +1); }
    while (acc <= -DETENT_DEG) { acc += DETENT_DEG; turn(slot, -1); }
  });
  const release = () => { last = null; };
  el.addEventListener("pointerup", release);
  el.addEventListener("pointercancel", release);
  el.addEventListener("pointerenter", () => { host.hover[slot] = true; });
  el.addEventListener("pointerleave", () => { host.hover[slot] = false; });

  // Defilement : trackpad ou molette de souris. Vers le haut = horaire.
  el.addEventListener("wheel", (e) => {
    e.preventDefault();
    wheelAcc += e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
    while (wheelAcc <= -30) { wheelAcc += 30; turn(slot, +1); }
    while (wheelAcc >= 30) { wheelAcc -= 30; turn(slot, -1); }
  }, { passive: false });

  cap.addEventListener("click", () => push(slot));

  knobEls[slot] = {
    el, cap,
    spin(d) { angle += d * DETENT_DEG; body.style.transform = `rotate(${angle}deg)`; },
    flash() { cap.classList.add("flash"); setTimeout(() => cap.classList.remove("flash"), 90); },
  };
  return el;
}

const kl = document.getElementById("kl"), kr = document.getElementById("kr");
for (let s = 0; s < 6; s++) (s < 3 ? kl : kr).appendChild(makeKnob(s));

// --- Boutons de vue, transport, SHIFT, REC ----------------------------------------

function goView(v) { M._nidmi_set_view(v); }
document.getElementById("b-row").onclick = () => {
  // ⇧ROW fait tourner le MODE D'AFFICHAGE de la row : ce que ses cases encodent, et
  // ce que la touche edite en saisie. Choix du banc, a valider.
  if (isShift() && rowFamily()) {
    const r = M._nidmi_cur_row();
    if (M._nidmi_row_kind(r) === 1) { toast("A lane always shows its curve"); return; }
    // Le contour d'un P-lock a disparu avec les P-locks : les courbes sont des lanes.
    let next = (M._nidmi_row_display(r) + 1) % DISPLAY_NAMES.length;
    if (next === DM.Controller) next = DM.Notes;
    cmd(CMD.SetRowDisplayMode, { a: r, b: next });
    toast(`R${r - M._nidmi_track_first_row(M._nidmi_cur_track()) + 1}: display ${DISPLAY_NAMES[next]}`);
    return;
  }
  // Re-appui = bascule Pattern ↔ Roll. AUTO n'est plus une vue : une lane, ou le
  // contour d'un P-lock, s'affiche dans PATTERN en mode Controleur.
  goView(M._nidmi_view() === 0 ? 1 : 0);
};
// HARMONY : l'edition, puis la GRILLE plein ecran pour suivre a vue, puis l'edition.
document.getElementById("b-harmony").onclick = () => goView(M._nidmi_view() === 3 ? 6 : 3);
// Ouvrir directement une vue et une piste : 127.0.0.1:8765/#roll, #harmonie, #piste2,
// #roll-piste3.
const START_VIEW = { pattern: 0, roll: 1, harmonie: 3, harmony: 3, chart: 6 }[location.hash.slice(1).split("-")[0]];
if (START_VIEW !== undefined) goView(START_VIEW);
const START_TRACK = /piste(\d+)/.exec(location.hash);
if (START_TRACK) M._nidmi_select_track(Number(START_TRACK[1]) - 1);
document.getElementById("b-projet").onclick = () => goView(M._nidmi_view() === 4 ? 5 : 4);
// REC comme chez Elektron : un appui = saisie dans la grille (lecture ou non) ;
// REC + PLAY ensemble = enregistrement live ; STOP sort du live.
function stopTransport() {
  stopFill();
  M._nidmi_stop();
  if (host.rec === "live") host.rec = "off";
}
// PLAY, comme le bouton FILL d'Elektron une fois la lecture lancee (STOP arrete) :
//   arrete           lance la lecture
//   en lecture       tenu  = FILL tant qu'on tient, d'un doigt, a la volee
//                    tape  = FILL sur la mesure suivante
//   REC tenu         enregistrement live (REC garde la priorite)
const playHold = { down: false, held: false, timer: 0 };
function playDown() {
  if (host.recHeld) {
    host.recUsed = true; host.rec = "live";
    if (!M._nidmi_is_playing()) M._nidmi_play(now());
    return;
  }
  if (!M._nidmi_is_playing()) { M._nidmi_play(now()); return; }
  Object.assign(playHold, { down: true, held: false });
  playHold.timer = setTimeout(() => { playHold.held = true; cmd(CMD.SetFillHeld, { x: 1 }); }, 220);
}
function playUp() {
  if (!playHold.down) return;
  playHold.down = false;
  clearTimeout(playHold.timer);
  if (playHold.held) cmd(CMD.SetFillHeld, { x: 0 });
  else { cmd(CMD.ArmFillNextBar); toast("Fill: next bar"); }
}
function recDown() { host.recHeld = true; host.recUsed = false; }
function recUp() {
  if (!host.recHeld) return;
  host.recHeld = false;
  if (!host.recUsed) host.rec = host.rec === "off" ? "grid" : "off";
}
// Une souris n'a qu'un doigt : ⇧ + REC fait office de REC + PLAY.
function recLive() { host.rec = "live"; if (!M._nidmi_is_playing()) M._nidmi_play(now()); }
function stopFill() { if (playHold.down) { playHold.down = false; clearTimeout(playHold.timer); cmd(CMD.SetFillHeld, { x: 0 }); } }
const playBtn = document.getElementById("b-play");
playBtn.addEventListener("pointerdown", (e) => { playBtn.setPointerCapture(e.pointerId); playDown(); });
["pointerup", "pointercancel"].forEach((t) => playBtn.addEventListener(t, playUp));
document.getElementById("b-stop").onclick = stopTransport;
const recBtn = document.getElementById("b-rec");
recBtn.addEventListener("pointerdown", (e) => { if (isShift()) { recLive(); return; } recBtn.setPointerCapture(e.pointerId); recDown(); });
recBtn.addEventListener("pointerup", recUp);
recBtn.addEventListener("pointercancel", recUp);

const shiftBtn = document.getElementById("b-shift");
shiftBtn.addEventListener("click", () => { shiftSrc.latched = !shiftSrc.latched; applyShift(); });

// --- Le clavier 27 touches : REC DECIDE, la vue precise -----------------------------
//
//   REC eteint     le clavier JOUE l'instrument de la piste courante, dans toutes les vues.
//   REC (grille)   PATTERN, AUTO : blanches = les PAS, qui editent ce que la grille
//                  montre ; maintenir un pas et tourner une molette edite CE pas.
//                  Noires = presse-papier.
//                  ROLL : la touche ECRIT sa note au curseur, puis le curseur avance.
//                  ⇧ + noires = presse-papier.
//                  HARMONIE : degres, qualites, mesure ; noires = extensions.
//   REC + PLAY     LIVE : joue et enregistre au pas en cours de lecture.
//
// C'est la grammaire d'Elektron. nidmi-seq-vst a la regle REC sans l'exception du
// ROLL ni la distinction grille / live : a reconcilier, idealement dans le core.

const BLACK_LEFT = [0, 1, 3, 4, 5, 7, 8, 10, 11, 12, 14];
const EXT_BITS = [1 << 7, 1 << 8, 1 << 9, 1 << 10, 1 << 0, 1 << 1, 1 << 2, 1 << 3, 1 << 4, 1 << 5, 1 << 6];
const EXT_NAMES = ["b7", "7", "b5", "#5", "9", "11", "13", "b9", "#9", "#11", "b13"];

function keyMode() {
  // HARMONY et la grille : le clavier d'ACCORDS, qu'on joue (sans REC) ou qu'on ecrive.
  if (M._nidmi_view() === 3 || M._nidmi_view() === 6) return "harmony";
  if (host.rec === "off") return "play";
  if (host.rec === "live") return "live";
  const v = M._nidmi_view();
  if (v === 0 || v === 2) return "steps";
  if (v === 1) return "notes";
  if (v === 3 || v === 6) return "harmony";
  return "play";
}

// Clavier diatonique : 16 blanches = 16 degres consecutifs de la gamme que le moteur
// UTILISE (tonalite effective du pattern) ; celle du projet quand l'harmonie est coupee.
// Sinon taper mi en do mineur ecrirait un mi que la lecture jouerait mi bemol.
// La regle vit dans le core (keys::whiteMidi) : le firmware ne la recode pas.
const whiteMidi = (i) => M._nidmi_white_midi(i);
const blackMidi = (k) => M._nidmi_black_midi(k);

// Un pas existant garde sa velocite et sa duree : la touche ne change que la hauteur.
function writeStep(row, step, bar, midi) {
  const p = M._nidmi_step(row, bar, step);
  const vel = p & 1 ? (p >> 16) & 255 : 100;
  const gate = p & 1 ? M._nidmi_step_gate(row, bar, step) : 80;
  cmd(CMD.SetStep, { a: row, b: step, c: midi, d: vel, e: gate, f: bar });
  return Math.max(1, (p >>> 24) & 255);   // span : ou tombe le pas suivant
}

// La touche passe par l'harmonie, comme le moteur : en do mineur, la noire do# joue do.
// Sans ca le clavier faisait entendre des notes que la lecture ne jouerait jamais.
// Dans un sous-pas on garde la note brute : en mode relatif, c'est un decalage.
// Une row en FOLLOW s'ecrit par rapport a la tonique : on ecrit la touche telle quelle,
// et on entend sa transposition vers l'accord en cours (keyNote).
function writtenNote(midi) {
  if (M._nidmi_cur_sub() < 0 && M._nidmi_row_mode(M._nidmi_cur_row(), M._nidmi_cur_bar()) === 4) return midi;
  return keyNote(midi);
}

function keyNote(midi) {
  if (M._nidmi_cur_sub() >= 0 && M._nidmi_view() <= 2) return midi;
  return M._nidmi_resolved_note(M._nidmi_cur_row(), M._nidmi_cur_bar(), midi);
}

// REC eteint : la touche joue l'instrument de la row, rien n'est ecrit.
function playKey(midi) {
  const ch = M._nidmi_row_channel(M._nidmi_cur_row()) + 1, n = keyNote(midi);
  noteOn(ch, n, 100);
  return () => noteOff(ch, n);
}

// LIVE : ce qu'on joue decide, pas ce qu'on regardait — la note tombe sur le pas EN
// COURS de la row.
function liveKey(midi) {
  const release = playKey(midi), row = M._nidmi_cur_row();
  if (M._nidmi_view() <= 2 && M._nidmi_row_kind(row) !== 1 && M._nidmi_is_playing()) {
    const live = M._nidmi_playhead(row), n = M._nidmi_row_steps(row);
    if (live !== 255 && live < n) writeStep(row, live, M._nidmi_play_bar_row(row), writtenNote(midi));
  }
  return release;
}

// ROLL sous REC : la touche ECRIT sa note au curseur, la fait entendre, puis le
// curseur avance.
function writeNoteKey(midi) {
  const row = M._nidmi_cur_row();
  if (M._nidmi_row_kind(row) === 1) return null;   // une lane n'a pas de hauteur
  const release = playKey(midi);
  const bar = M._nidmi_cur_bar(), cur = M._nidmi_cur_step(), sub = M._nidmi_cur_sub();
  let advance = 1;
  if (sub >= 0) {   // entre dans un pas : la note va au SOUS-pas
    const idx = M._nidmi_step_sub(row, bar, cur);
    if (idx !== 255) cmd(CMD.SetSubStep, { a: idx, b: sub, c: midi, d: 100, e: 80 });
  } else {
    advance = writeStep(row, cur, bar, writtenNote(midi));   // ce qu'on entend, ou sa source en Follow
  }
  // L'avance passe par la molette Pas elle-meme : le core borne, et sait s'il faut
  // avancer d'un pas ou d'un sous-pas.
  moveCursor(advance);
  return release;
}

// Deplacer le curseur, c'est tourner `Pas`. Sauf dans le contexte de la row, ou `Pas`
// porte le N : on n'y touche pas, sous peine de changer la longueur de la row.
function moveCursor(delta) {
  if (!delta || M._nidmi_ctx() === 0) return;
  M._nidmi_turn(1, delta, now());
  host.touched[1] = now();
}

// Le presse-papier. Un re-appui sur la MEME cible elargit le grain : pas -> row -> mesure.
const SCOPES = ["step", "row", "bar"];
const clip = { valid: false, row: 0, step: 0, bar: 0, cut: false, scope: 0, lastKey: -1, lastTarget: "" };
function advanceScope(key) {
  const target = `${M._nidmi_cur_row()}:${M._nidmi_cur_step()}:${M._nidmi_cur_bar()}`;
  const scope = clip.lastKey === key && clip.lastTarget === target ? (clip.lastScope + 1) % 3 : 0;
  clip.lastKey = key; clip.lastTarget = target; clip.lastScope = scope;
  return scope;
}
function clearScoped(scope, row, step, bar) {
  if (scope === 2) cmd(CMD.ClearBar, { f: bar });
  else if (scope === 1) cmd(CMD.ClearRow, { a: row, f: bar });
  else cmd(CMD.ClearStep, { a: row, b: step, f: bar });
}
function clipboardKey(k) {
  const row = M._nidmi_cur_row(), step = M._nidmi_cur_step(), bar = M._nidmi_cur_bar();
  if (k === 7) {
    const scope = advanceScope(7);
    Object.assign(clip, { valid: true, row, step, bar, cut: isShift(), scope });
    toast(`${isShift() ? "Cut" : "Copy"}: ${SCOPES[scope]}`);
  } else if (k === 8) {
    if (!clip.valid) { toast("Clipboard empty"); return; }
    if (clip.scope === 2) cmd(CMD.CopyBar, { a: clip.bar, f: bar });
    else if (clip.scope === 1) cmd(CMD.CopyRow, { a: clip.row, b: clip.bar, c: row, f: bar });
    else cmd(CMD.CopyStep, { a: clip.row, b: clip.step, c: row, d: step, e: clip.bar, f: bar });
    if (clip.cut) { clearScoped(clip.scope, clip.row, clip.step, clip.bar); clip.valid = false; }
    clip.lastKey = 8;
    toast(`Pasted: ${SCOPES[clip.scope]}`);
  } else if (k === 10) {
    const scope = advanceScope(10);
    clearScoped(scope, row, step, bar);
    toast(`Cleared: ${SCOPES[scope]}`);
  }
}

// En saisie, la touche edite CE QUE LA GRILLE MONTRE (mode d'affichage de la row), et
// pointe le curseur sur son pas : maintenue, elle laisse les molettes editer CE pas.
// Comme chez Elektron, un pas deja actif ne s'eteint qu'au RELACHER, et seulement si
// aucune molette n'a tourne entre-temps — sinon le maintenir pour l'editer l'effacerait.
function pressStep(i) {
  const row = M._nidmi_cur_row(), bar = M._nidmi_cur_bar(), cur = M._nidmi_cur_step();
  if (M._nidmi_cur_sub() >= 0) {   // entre dans un pas : la touche vise le SOUS-pas
    const sub = M._nidmi_step_sub(row, bar, cur);
    if (sub === 255 || i >= M._nidmi_sub_len(sub)) return null;
    moveCursor(i - M._nidmi_cur_sub());
    cmd(CMD.ToggleSubStep, { a: sub, b: i });
    return null;
  }
  const step = Math.floor(cur / 16) * 16 + i;
  if (step >= M._nidmi_row_steps(row)) return null;
  moveCursor(step - cur);
  if (M._nidmi_row_kind(row) === 1) return pressCurveStep(row, bar, step);
  const p = M._nidmi_step(row, bar, step), mode = M._nidmi_row_display(row);
  if (mode === DM.Fill) {
    // always -> fill -> not fill -> always
    cmd(CMD.SetStepCond, { a: row, b: step, c: (((p >> 4) & 3) + 1) % 3, f: bar });
    return null;
  }
  if (mode === 1) {
    const on = !(p & 2);
    cmd(CMD.SetStepAccent, { a: row, b: step, x: on ? 1 : 0, f: bar });
    if (on && M._nidmi_accent_amount() === 0) cmd(CMD.SetPatternAccentAmount, { a: 40 });   // sinon inaudible
    return null;
  }
  if (mode === 2) {
    const on = !(p & 8);
    cmd(CMD.SetStepSwing, { a: row, b: step, x: on ? 1 : 0, f: bar });
    if (on && !M._nidmi_pattern_swings()) cmd(CMD.SetPatternSwing, { a: 58, x: 1 });   // pourcentage dans a
    return null;
  }
  const wasOn = !!(p & 1);
  if (!wasOn) cmd(CMD.ToggleStep, { a: row, b: step, f: bar });
  const held = { edited: false };
  host.held = held;
  return () => {
    if (host.held === held) host.held = null;
    if (wasOn && !held.edited) cmd(CMD.ToggleStep, { a: row, b: step, f: bar });
  };
}

// Sur une COURBE, la touche du pas pose un point la ou la courbe passe (rien ne saute),
// ou retire celui qui y est — au relacher, et seulement si aucune molette n'a tourne :
// maintenir la touche pour regler le point ne doit pas l'effacer.
function pressCurveStep(row, bar, step) {
  const idx = M._nidmi_curve_point_on_step(row, bar, step);
  if (idx < 0) {
    const pos = bar * TICKS + Math.floor(step * TICKS / M._nidmi_row_steps(row));
    const v = Math.round(M._nidmi_curve_eval(row, pos) / 128) * 128;
    curvePoint(row, pos, v);
  }
  const held = { edited: false };
  host.held = held;
  return () => {
    if (host.held === held) host.held = null;
    if (idx >= 0 && !held.edited) {
      const now = M._nidmi_curve_point_on_step(row, bar, step);
      if (now >= 0) cmd(CMD.RemoveCurvePoint, { a: row, b: now });
    }
  };
}

// LE CLAVIER D'ACCORDS (keys::chordFromKeys) : la main gauche choisit le DEGRE (blanches
// 1-7), la droite la COULEUR (blanches 8-16 : maj min dim sus4 7 maj7 9 11 13) et les
// ALTERATIONS (noires). On les tient dans n'importe quel ordre. Sans REC, la piste joue
// l'accord ; avec REC, il s'ecrit dans le slot sous le curseur, qui avance : on tape une
// grille accord apres accord.
const chordKeys = { whites: 0, blacks: 0, degree: 0, slot: -1, notes: [], ch: 1 };
function syncHeld() { M._nidmi_set_held(chordKeys.whites, chordKeys.blacks); }
function chordColors() { return chordKeys.whites >> 7; }
function chordSound(on) {
  chordKeys.notes.forEach((n) => noteOff(chordKeys.ch, n));
  chordKeys.notes = [];
  if (!on || !chordKeys.degree) return;
  const count = M._nidmi_chord_build(chordKeys.degree, chordColors(), chordKeys.blacks);
  chordKeys.ch = M._nidmi_row_channel(M._nidmi_cur_row()) + 1;
  for (let i = 0; i < count; i++) { const n = M._nidmi_chord_built_note(i); noteOn(chordKeys.ch, n, 90); chordKeys.notes.push(n); }
}
// L'accord tenu change (une couleur arrive) : on le rejoue, ou on le reecrit.
function chordRefresh() {
  if (!chordKeys.degree) return;
  if (host.rec === "grid") {
    M._nidmi_chord_build(chordKeys.degree, chordColors(), chordKeys.blacks);
    M._nidmi_chord_write(chordKeys.slot, now());
  } else chordSound(true);
}
// Une souris n'a qu'un doigt : dans le banc, COULEURS et ALTERATIONS se verrouillent d'un
// clic et se liberent d'un autre, comme SHIFT. Sur le boitier, on les tiendra.
function harmonyWhite(i) {
  if (i >= 7) { chordKeys.whites ^= 1 << i; syncHeld(); chordRefresh(); return null; }
  chordKeys.whites |= 1 << i; syncHeld();
  if (i < 7) {
    chordKeys.degree = i + 1;
    if (host.rec === "grid") {
      const cur = M._nidmi_cur_slot();
      chordKeys.slot = cur;
      M._nidmi_chord_build(chordKeys.degree, chordColors(), chordKeys.blacks);
      M._nidmi_chord_write(cur, now());
      chordSound(true); setTimeout(() => chordSound(false), 250);   // l'entendre en l'ecrivant
      M._nidmi_set_slot(cur + 1);
    } else chordSound(true);
  } else chordRefresh();
  return () => {
    chordKeys.whites &= ~(1 << i); syncHeld();
    if (i < 7 && chordKeys.degree === i + 1) { if (host.rec !== "grid") chordSound(false); chordKeys.degree = 0; }
  };
}
function harmonyBlack(k) {
  if (k >= 9) return null;
  chordKeys.blacks ^= 1 << k; syncHeld();
  chordRefresh();
  return null;
}

// ⇧ + blanche N = la PISTE N, dans toutes les vues et tous les modes : changer
// d'instrument est le meme geste partout.
function selectTrackKey(i) {
  if (M._nidmi_select_track(i)) toast(`Track ${i + 1} · ${trackName(i)}`);
  else toast(`No track ${i + 1}`);
}

function pressWhite(i) {
  if (isShift()) { selectTrackKey(i); return null; }
  switch (keyMode()) {
    case "play":    return playKey(whiteMidi(i));
    case "live":    return liveKey(whiteMidi(i));
    case "notes":   return writeNoteKey(whiteMidi(i));
    case "steps":   return pressStep(i);
    case "harmony": return harmonyWhite(i);
  }
  return null;
}
function pressBlack(k) {
  // Une noire sans note chromatique entre ses deux blanches est muette (keys::kNoNote).
  const muted = blackMidi(k) === 255;
  switch (keyMode()) {
    case "play":    return muted ? null : playKey(blackMidi(k));
    case "live":    return muted ? null : liveKey(blackMidi(k));
    case "notes":   // ROLL : les noires sont des alterations, ⇧ donne le presse-papier
      if (isShift()) { clipboardKey(k); return null; }
      return muted ? null : writeNoteKey(blackMidi(k));
    case "steps":   clipboardKey(k); return null;
    case "harmony": return harmonyBlack(k);
  }
  return null;
}

const keysEl = document.getElementById("keys");
const whiteKeys = [], blackKeys = [];
function bindKey(el, press) {
  let release = null;
  el.addEventListener("pointerdown", (e) => {
    el.setPointerCapture(e.pointerId);
    el.classList.add("down");
    release = press();
  });
  const up = () => { el.classList.remove("down"); if (release) release(); release = null; };
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
}
for (let i = 0; i < 16; i++) {
  const k = document.createElement("div");
  k.className = "wk";
  k.innerHTML = "<span></span>";
  bindKey(k, () => pressWhite(i));
  keysEl.appendChild(k);
  whiteKeys.push(k);
}
for (let k = 0; k < 11; k++) {
  const b = document.createElement("div");
  b.className = "bk";
  b.innerHTML = "<span></span>";
  bindKey(b, () => pressBlack(k));
  keysEl.appendChild(b);
  blackKeys.push(b);
}
function placeBlackKeys() {
  const w = keysEl.clientWidth / 16;
  blackKeys.forEach((b, k) => {
    b.style.left = `${(BLACK_LEFT[k] + 1) * w - w * 0.32}px`;
    b.style.width = `${w * 0.64}px`;
  });
}
placeBlackKeys();
addEventListener("resize", placeBlackKeys);

// LES HUIT OLED du boitier, 0,96" 128x64 SSD1306, une par paire de blanches : la noire
// entre les deux au milieu, celle de la frontiere au bord droit. Monochrome, a leur vraie
// definition, agrandies sans lissage : on juge la lisibilite avant de souder.
//
// LE TEMPS DU BUS EST SIMULE. On dessine ce que l'ecran DEVRAIT montrer, puis seules les
// pages modifiees (8 bandes de 128 x 8 pixels) partent sur le bus I2C partage, derriere
// le PCA9548A, a son debit reel : 9 bits par octet, 128 octets par page, quelques octets
// d'adressage, un octet pour changer de canal. Ce qu'on VOIT est ce qui est arrive.
const oled = { screens: [], rate: 400000, load: 0, queue: [], busUs: 0 };
(function makeOleds() {
  const host = document.getElementById("oleds");
  if (!host) return;
  for (let s = 0; s < 8; s++) {
    const shown = document.createElement("canvas");
    shown.width = 128; shown.height = 64;
    host.appendChild(shown);
    const want = document.createElement("canvas");
    want.width = 128; want.height = 64;
    const sctx = shown.getContext("2d");
    sctx.fillStyle = "#000"; sctx.fillRect(0, 0, 128, 64);
    oled.screens.push({ shown: sctx, want: want.getContext("2d", { willReadFrequently: true }),
                        sent: new Uint8Array(128 * 64), pending: new Set() });
  }
  const sel = document.getElementById("oled-bus");
  if (sel) sel.onchange = () => { oled.rate = Number(sel.value); };
})();
function oledText(o, text, x, y, align, size, inverted) {
  o.font = `bold ${size}px ui-monospace, Menlo, monospace`;
  let t = text;
  while (t.length > 1 && o.measureText(t).width > 60) t = t.slice(0, -1);
  const w = o.measureText(t).width, x0 = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
  if (inverted) { o.fillStyle = "#fff"; o.fillRect(Math.floor(x0) - 2, y - size + 1, Math.ceil(w) + 4, size + 2); }
  o.fillStyle = inverted ? "#000" : "#fff";
  o.fillText(t, x0, y);
}
// Une touche enfoncee, ou relachee depuis moins de 150 ms.
function pressedRecently(el) {
  if (!el) return false;
  if (el.classList.contains("down")) { el._downAt = now(); return true; }
  return now() - (el._downAt || -1e9) < 150;
}

// Ce que chaque ecran DEVRAIT montrer.
function drawOleds(white, black) {
  oled.screens.forEach((sc, s) => {
    const o = sc.want;
    o.fillStyle = "#000"; o.fillRect(0, 0, 128, 64);
    for (let j = 0; j < 2; j++) {
      const k = white[2 * s + j], cx = 32 + 64 * j;
      // Une touche ENFONCEE inverse toute sa moitie d'ecran, et le reste au moins 150 ms :
      // on voit la note qui sort sous le doigt, meme sur un appui bref.
      const down = pressedRecently(whiteKeys[2 * s + j]);
      if (k.label) oledText(o, k.label, cx, 54, "center", 14, k.lit);
      if (down) {   // inverser toute la moitie : fond blanc, texte noir
        o.globalCompositeOperation = "difference"; o.fillStyle = "#fff";
        o.fillRect(64 * j + 1, 33, 62, 31);
        o.globalCompositeOperation = "source-over";
      }
      // Curseur : deux crochets ; tete de lecture : une barre pleine sous la touche.
      o.fillStyle = "#fff";
      if (k.cur) { o.fillRect(cx - 28, 38, 2, 20); o.fillRect(cx + 26, 38, 2, 20); }
      // Sur une note, la tete passe en HAUT, loin du nom ; sur un pas, sous son numero.
      if (k.head) o.fillRect(cx - 30, k.kind === KIND.Note ? 0 : 60, 60, k.kind === KIND.Note ? 3 : 4);
    }
    BLACK_LEFT.forEach((w, b) => {
      if (w !== 2 * s && w !== 2 * s + 1 || !black[b].label) return;
      oledText(o, black[b].label, w === 2 * s ? 64 : 126, 18, w === 2 * s ? "center" : "right", 11,
               black[b].lit || pressedRecently(blackKeys[b]));
    });
    o.fillStyle = "#333"; o.fillRect(0, 31, 128, 1);
    // Ce qui differe de ce que l'ecran a recu : les pages a envoyer.
    const img = o.getImageData(0, 0, 128, 64).data;
    for (let page = 0; page < 8; page++) {
      let dirty = false;
      for (let y = page * 8; y < page * 8 + 8 && !dirty; y++)
        for (let x = 0; x < 128; x++) {
          const on = img[(y * 128 + x) * 4] > 100 ? 1 : 0;
          if (on !== sc.sent[y * 128 + x]) { dirty = true; break; }
        }
      if (dirty && !sc.pending.has(page)) { sc.pending.add(page); oled.queue.push([s, page]); }
    }
  });
}
// Le bus : autant d'octets que le debit en laisse passer depuis la derniere image.
let oledLast = 0, oledLastScreen = -1, oledBusyUs = 0, oledWindowUs = 0;
function pumpOleds() {
  const t = now(), dtUs = oledLast ? Math.min(100000, (t - oledLast) * 1000) : 0;
  oledLast = t;
  let budgetUs = dtUs + oled.busUs;
  const usPerByte = 9e6 / oled.rate;
  while (oled.queue.length) {
    const [s, page] = oled.queue[0];
    const bytes = 128 + 7 + (s !== oledLastScreen ? 2 : 0);   // donnees + adressage + canal
    const cost = bytes * usPerByte;
    if (cost > budgetUs) break;
    budgetUs -= cost; oledBusyUs += cost;
    oled.queue.shift();
    oledLastScreen = s;
    const sc = oled.screens[s];
    sc.pending.delete(page);
    const img = sc.want.getImageData(0, page * 8, 128, 8);
    for (let i = 0; i < 128 * 8; i++) {
      const on = img.data[i * 4] > 100 ? 1 : 0;
      sc.sent[page * 8 * 128 + i] = on;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = on ? 235 : 0;
      img.data[i * 4 + 3] = 255;
    }
    sc.shown.putImageData(img, 0, page * 8);
  }
  oled.busUs = oled.queue.length ? budgetUs : 0;   // le reste du budget attend la suite
  oledWindowUs += dtUs;
  if (oledWindowUs >= 500000) { oled.load = oledBusyUs / oledWindowUs; oledBusyUs = 0; oledWindowUs = 0; }
}

// Les LIBELLES viennent du core (keys::describe) : ce que les huit ecrans du boitier
// afficheront. Une piste prend le nom que lui donne l'hote (le profil d'appareil).
const KIND = { None: 0, Note: 1, Step: 2, Substep: 3, Track: 4, Degree: 5, Quality: 6, Bar: 7, Clipboard: 8, Extension: 9 };
function keyInfo(black, i) {
  const f = M._nidmi_key_flags(black ? 1 : 0, i), kind = (f >> 4) & 15, value = f >> 8;
  const label = kind === KIND.Track ? trackName(value) : str(M._nidmi_key_label(black ? 1 : 0, i));
  return { label, lit: !!(f & 1), cur: !!(f & 2), head: !!(f & 4), kind };
}
function keyLabels() {
  const mode = keyMode(), sh = isShift();
  const inSub = M._nidmi_cur_sub() >= 0;
  M._nidmi_keys_describe();
  const white = whiteKeys.map((_, i) => keyInfo(false, i)), black = blackKeys.map((_, k) => keyInfo(true, k));
  // Les LED sous les touches sont en option : sans elles, tout passe par les OLED.
  const leds = document.getElementById("key-leds")?.checked;
  whiteKeys.forEach((k, i) => {
    k.querySelector("span").textContent = white[i].label;
    k.classList.toggle("lit", !!leds && white[i].lit);
    k.classList.toggle("cur", !!leds && white[i].cur);
    k.classList.toggle("head", !!leds && white[i].head);
  });
  blackKeys.forEach((b, k) => {
    b.querySelector("span").textContent = black[k].kind === KIND.Note ? "" : black[k].label;
    b.classList.toggle("fn", black[k].kind === KIND.Clipboard || black[k].kind === KIND.Extension);
  });
  drawOleds(white, black);
  pumpOleds();
  const text = {
    play: "<b>PLAY</b> the track's instrument · REC = edit what the view shows · ⇧REC (or Enter + Space) = live",
    live: "<b>LIVE</b> — plays and records at the current step · STOP to leave",
    steps: inSub ? "<b>REC · SUBSTEPS</b> — white keys = substeps · black keys = clipboard"
      : "<b>REC · STEPS</b> — white key = step · hold it and turn a knob to edit that step · black keys = clipboard",
    notes: "<b>REC · NOTES</b> — the key writes its note at the cursor, which then advances · ⇧ + black keys = clipboard",
    harmony: host.rec === "grid"
      ? "<b>REC · CHORDS</b> — a degree writes its chord at the cursor, which advances · hold colours (8-16) and alterations (black) with it"
      : "<b>CHORDS</b> — left hand: degrees · right hand: colours (maj min dim sus4 7 maj7 9 11 13) · black keys: alterations and 6",
  }[mode];
  document.getElementById("keymode").innerHTML = "Keyboard: " + (sh ? "<b>⇧</b> white keys = tracks · " : "") + text
    + ` <span class="busload">· OLED bus ${Math.round(oled.load * 100)} %${oled.queue.length ? ` · ${oled.queue.length} pages waiting` : ""}</span>`;
}

// --- Clavier de l'ordinateur ------------------------------------------------------

addEventListener("keydown", (e) => {
  if (e.target.tagName === "SELECT" || e.target.tagName === "INPUT") return;
  if (e.key === "Shift") { setShift(true); return; }
  if (e.code === "Space") { e.preventDefault(); if (!e.repeat) playDown(); return; }
  if (e.key === "Escape") { stopTransport(); return; }
  if (e.key === "Enter") { e.preventDefault(); if (!e.repeat) recDown(); return; }
  if (e.repeat && e.code.startsWith("Digit")) return;
  const k = e.key.toLowerCase();
  const n = Number(e.code.replace("Digit", ""));
  if (e.code.startsWith("Digit") && n >= 1 && n <= 6) { push(n - 1); return; }
  SLOT_KEYS.forEach(([up, down], s) => {
    if (k === up) turn(s, +1);
    else if (k === down) turn(s, -1);
  });
});
addEventListener("keyup", (e) => {
  if (e.key === "Shift") setShift(false);
  if (e.key === "Enter") recUp();
  if (e.code === "Space") playUp();
});
addEventListener("blur", () => setShift(false));

// --- Web MIDI : sortie vers un synthe, entree pour les molettes du XIAO -----------

const outSel = document.getElementById("midi-out");
const inStatus = document.getElementById("midi-in-status");
if (navigator.requestMIDIAccess) {
  navigator.requestMIDIAccess().then((access) => {
    const refresh = () => {
      const cur = outSel.value;
      outSel.length = 1;
      for (const o of access.outputs.values()) outSel.add(new Option(o.name, o.id));
      outSel.value = [...outSel.options].some((o) => o.value === cur) ? cur : "";
      const ins = [...access.inputs.values()];
      ins.forEach((i) => { i.onmidimessage = onMidiIn; });
      inStatus.textContent = ins.some((i) => /nidmi knobs/i.test(i.name)) ? "Hardware knobs: connected" : "";
    };
    outSel.onchange = () => {
      [...voices.keys()].forEach((key) => { const [c, n] = key.split(":"); noteOff(+c, +n); });
      midiOut = outSel.value ? access.outputs.get(outSel.value) : null;
    };
    access.onstatechange = refresh;
    refresh();
  }).catch(() => { inStatus.textContent = "Web MIDI denied"; });
}

// Protocole du firmware nidmi_knobs, canal 16 : CC 20-25 crans (64 ± d),
// CC 30-35 appuis, CC 36 SHIFT.
function onMidiIn(msg) {
  const [st, cc, v] = msg.data;
  if ((st & 0xF0) !== 0xB0 || (st & 0x0F) !== 15) return;
  if (cc >= 20 && cc <= 25) turn(cc - 20, v - 64);
  else if (cc >= 30 && cc <= 35 && v > 0) push(cc - 30);
  else if (cc === 36) setShift(v > 0);
}

// --- L'ecran ----------------------------------------------------------------------

const canvas = document.getElementById("screen");
const g = canvas.getContext("2d");
let W = 480, H = 320;
const DPR = 2;
function setRes(value) {
  [W, H] = value.split("x").map(Number);
  canvas.width = W * DPR; canvas.height = H * DPR;
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
}
document.getElementById("res").onchange = (e) => setRes(e.target.value);
setRes("480x320");
const layoutSel = document.getElementById("layout");

const C = {
  bg: "#06080a", off: "#1b2025", text: "#d9dee3", muted: "#7c858e",
  own: "#d9dee3", pushed: "#5fd07a", lent: "#f0a43a", free: "#59616a", accent: "#5fb7c0",
  over: "#ff4d6a", amber: "#f0a43a", swing: "#b48ef0",
};
const ROLE_COLOR = [C.own, C.pushed, C.lent, C.free, C.free];
const HEAD_H = 20, BAND_H = 54;
const FONT = (px, bold) => `${bold ? "bold " : ""}${px}px ui-monospace, Menlo, monospace`;

// OU VONT LES LIBELLES. Les molettes sont 3 a gauche et 3 a droite de l'ecran : un
// bandeau de six cases en bas oblige a traduire « 4e case = premiere molette de
// droite ». En colonnes, chaque libelle fait face a sa molette.
function geometry() {
  if (layoutSel.value === "band") {
    const cw = (W - 8) / 6;
    return {
      content: { x: 0, y: HEAD_H, w: W, h: H - HEAD_H - BAND_H },
      cells: [0, 1, 2, 3, 4, 5].map((i) => ({ x: i * cw + (i >= 3 ? 8 : 0), y: H - BAND_H, w: cw, h: BAND_H, side: 0 })),
    };
  }
  const colW = W >= 800 ? 118 : 78, ch = (H - HEAD_H) / 3;
  return {
    content: { x: colW, y: HEAD_H, w: W - 2 * colW, h: H - HEAD_H },
    cells: [0, 1, 2, 3, 4, 5].map((i) => ({
      x: i < 3 ? 0 : W - colW, y: HEAD_H + (i % 3) * ch, w: colW, h: ch, side: i < 3 ? -1 : 1,
    })),
  };
}

// Ecrit `text` dans `maxW`. Un libelle qui deborde perd d'abord un ou deux points de
// corps — c'est ce que l'ecran du boitier fera ; s'il deborde encore, il est tronque et
// le banc le SIGNALE, c'est precisement ce qu'il doit faire voir.
function fitText(text, x, y, maxW, color) {
  g.fillStyle = color;
  const base = g.font, m = /(\d+)px/.exec(base), px = m ? Number(m[1]) : 12;
  for (let k = 0; k <= 2 && g.measureText(text).width > maxW; k++) g.font = base.replace(`${px}px`, `${px - k - 1}px`);
  if (g.measureText(text).width <= maxW) { g.fillText(text, x, y); g.font = base; return; }
  g.font = base;
  let t = text;
  while (t.length && g.measureText(t + "…").width > maxW) t = t.slice(0, -1);
  g.fillText(t + "…", x, y);
  g.fillStyle = C.over;
  g.fillRect(x + maxW - 2, y - 9, 2, 11);
}

function drawCell(k, cell, i) {
  const age = now() - host.touched[i];
  const hot = age < 900, hover = host.hover[i];
  const { x, y, w, h, side } = cell;
  g.fillStyle = k.role === ROLE.Pushed ? "#12301b" : k.role === ROLE.Lent ? "#33240c" : hot ? "#1c2630" : "#0f1317";
  g.fillRect(x + 1, y + 1, w - 2, h - 2);
  if (k.role === ROLE.Pushed || k.role === ROLE.Lent) {
    g.fillStyle = ROLE_COLOR[k.role];
    if (side) g.fillRect(side < 0 ? x + 1 : x + w - 3, y + 1, 2, h - 2);
    else g.fillRect(x + 1, y + 1, w - 2, 2);
  }
  // Le geste en cours s'allume : on voit tout de suite QUELLE case la main bouge.
  if (hot || hover) {
    g.strokeStyle = hot ? C.accent : "#3a4650";
    g.lineWidth = hot ? 2 : 1;
    g.strokeRect(x + 2, y + 2, w - 4, h - 4);
  }
  // Une fleche vers la molette, du cote ou elle se trouve.
  if (side) {
    const ax = side < 0 ? x + 4 : x + w - 4, ay = y + h / 2;
    g.fillStyle = hot ? C.accent : "#2e363e";
    g.beginPath(); g.moveTo(ax, ay); g.lineTo(ax - side * 5, ay - 5); g.lineTo(ax - side * 5, ay + 5); g.fill();
  }
  if (k.depth) {
    g.fillStyle = C.accent;
    g.beginPath(); g.arc(side < 0 ? x + w - 8 : x + 10, y + 10, 2.5, 0, 7); g.fill();
  }
  const pad = side ? 10 : 5, tx = side < 0 ? x + pad : x + pad + (side > 0 ? 6 : 0), maxW = w - pad * 2 - 6;
  const value = k.hostOwns ? hostValue(i) || k.value || "—" : k.value;
  const nameColor = k.role === ROLE.Absent ? C.free : ROLE_COLOR[k.role];
  const valColor = k.role === ROLE.Free || k.role === ROLE.Absent ? C.free : C.text;
  if (side) {
    const cy = y + h / 2;
    g.font = FONT(11, true); fitText(k.name, tx, cy - 6, maxW, nameColor);
    g.font = FONT(hot ? 14 : 12, hot); fitText(value, tx, cy + 12, maxW, valColor);
  } else {
    g.font = FONT(11, true); fitText(k.name, tx, y + 20, maxW, nameColor);
    g.font = FONT(12); fitText(value, tx, y + 38, maxW, valColor);
  }
}

function drawHeader() {
  const v = M._nidmi_view();
  g.fillStyle = "#0b0e11";
  g.fillRect(0, 0, W, HEAD_H);
  g.font = FONT(11, true);
  g.fillStyle = C.accent;
  g.fillText(VIEW_NAMES[v], 6, 14);
  g.font = FONT(11);
  let info;
  if (now() < host.toastUntil) { g.fillStyle = C.amber; info = host.toast; }
  else {
    g.fillStyle = C.muted;
    const t = M._nidmi_cur_track(), localRow = M._nidmi_cur_row() - M._nidmi_track_first_row(t) + 1;
    const parts = [`T${t + 1} ${trackName(t)}`, M._nidmi_add_slot() ? "R+" : `R${localRow}`, `bar ${M._nidmi_cur_bar() + 1}/${M._nidmi_num_bars()}`, `${Math.round(M._nidmi_bpm())} BPM`];
    if (v <= 2 && M._nidmi_cur_sub() >= 0) parts.splice(2, 0, `in step ${M._nidmi_cur_step() + 1}`);
    info = parts.join(" · ");
  }
  g.fillText(info, 76, 14);
  let rx = W - 14;
  g.fillStyle = M._nidmi_is_playing() ? C.pushed : C.muted;
  g.fillText(M._nidmi_is_playing() ? "▶" : "■", rx, 14);
  if (host.rec !== "off") {
    const live = host.rec === "live";
    rx -= live ? 36 : 30;
    g.fillStyle = live && Math.floor(now() / 300) % 2 ? "#5a1d1a" : "#ff5a4f";
    g.fillText(live ? "LIVE" : "REC", rx, 14);
  }
  if (isShift()) { rx -= 14; g.fillStyle = C.lent; g.fillText("⇧", rx, 14); }
  // FILL : allume pendant le fill, clignote quand il est arme pour la mesure suivante.
  const fillOn = M._nidmi_fill_active(), fillArmed = M._nidmi_fill_armed();
  if (fillOn || fillArmed) {
    rx -= 36;
    g.fillStyle = fillOn ? C.amber : Math.floor(now() / 250) % 2 ? "#5a3d10" : C.amber;
    g.fillText("FILL", rx, 14);
  }
}

// La fenetre de temps : 1/hZoom de mesure, paginee pour contenir le curseur.
function timeWindow() {
  const n = M._nidmi_row_steps(M._nidmi_cur_row());
  const frac = n ? M._nidmi_cur_step() / n : 0;
  const t0 = Math.floor(frac * host.hZoom) / host.hZoom;
  return { t0, t1: t0 + 1 / host.hZoom };
}

// Les pas qu'un pas anterieur recouvre par son span : le moteur ne les joue pas
// (stepCoveredByOwner). Ils gardent leur contenu, l'ecran doit donc les montrer tus.
function coveredSteps(r, bar, n) {
  const covered = new Array(n).fill(false);
  for (let s = 0; s < n; s++) {
    if (covered[s]) continue;
    const p = M._nidmi_step(r, bar, s);
    if (!(p & 1)) continue;
    const span = Math.max(1, Math.min((p >>> 24) & 255, n - s));
    for (let k = 1; k < span; k++) covered[s + k] = true;
  }
  return covered;
}

// UNE CASE CODE TROIS CHOSES, ET RIEN D'AUTRE : la duree (largeur), la velocite
// (luminosite), et les sous-pas (son contenu). Plus un seul repere, le bord bas : ce pas
// porte des P-locks. Tout le reste — accent, swing, hauteur, contour d'un controleur —
// passe par le MODE D'AFFICHAGE de la row (« le mode change ce que la case encode »),
// par la colonne de la row, ou par les molettes. C'est ce qui empeche la case de se
// recharger a chaque fonction ajoutee.
const PC_HUE = (pc) => `hsl(${(pc * 30 + 190) % 360}, 55%, 58%)`;

// UNE COURBE : echantillonnee le long de la fenetre, ses points poses dessus. Le point
// du pas sous le curseur est cerne : c'est lui que Valeur, Forme et Position reglent.
function drawCurve(r, x0, y, w, h, bar, t0, span, curStep, n) {
  const loop = M._nidmi_curve_loop(), count = M._nidmi_curve_count(r);
  const yOf = (v) => y + h - 3 - (h - 6) * v / 16383;
  const posOf = (frac) => Math.min(loop - 1, Math.round((bar + frac) * TICKS));
  g.beginPath();
  for (let px = 0; px <= w; px += 2) {
    const v = M._nidmi_curve_eval(r, posOf(t0 + span * px / w));
    if (px === 0) g.moveTo(x0 + px, yOf(v)); else g.lineTo(x0 + px, yOf(v));
  }
  g.lineTo(x0 + w, y + h - 2); g.lineTo(x0, y + h - 2); g.closePath();
  g.fillStyle = "rgba(95, 183, 192, 0.16)"; g.fill();
  g.beginPath();
  for (let px = 0; px <= w; px += 2) {
    const v = M._nidmi_curve_eval(r, posOf(t0 + span * px / w));
    if (px === 0) g.moveTo(x0 + px, yOf(v)); else g.lineTo(x0 + px, yOf(v));
  }
  g.strokeStyle = M._nidmi_curve_recording(r) ? "#ff5a4f" : C.accent; g.lineWidth = 1.5; g.stroke();
  const sel = curStep >= 0 ? M._nidmi_curve_point_on_step(r, bar, curStep) : -1;
  for (let i = 0; i < count; i++) {
    const frac = M._nidmi_curve_pos(r, i) / TICKS - bar;
    if (frac < t0 - 1e-9 || frac >= t0 + span) continue;
    const px = x0 + (frac - t0) / span * w, py = yOf(M._nidmi_curve_value(r, i));
    g.fillStyle = M._nidmi_curve_form(r, i) === -10 ? C.amber : C.text;
    g.beginPath(); g.arc(px, py, 2.6, 0, 7); g.fill();
    if (i === sel) { g.strokeStyle = C.text; g.lineWidth = 1.2; g.beginPath(); g.arc(px, py, 5, 0, 7); g.stroke(); }
  }
  if (!count) { g.fillStyle = C.muted; g.font = FONT(9); g.fillText("empty curve: Value adds a point", x0 + 6, y + h / 2 + 3); }
}

// La page d'UNE piste : seules ses rows, numerotees depuis 1.
function drawRows(area) {
  const track = M._nidmi_cur_track(), all = M._nidmi_track_rows(track), bar = M._nidmi_cur_bar();
  // ⇧Row cadre les rows visibles : la fenetre suit la row du curseur.
  const shown = host.vRows ? Math.min(host.vRows, all) : all;
  const curLocal = M._nidmi_cur_row() - M._nidmi_track_first_row(track);
  const skip = Math.max(0, Math.min(all - shown, curLocal - shown + 1));
  const first = M._nidmi_track_first_row(track) + skip, rows = shown;
  const adding = M._nidmi_add_slot();
  const labelW = 30, top = area.y + 4, gw = area.w - labelW - 4;
  const rowH = Math.min(40, (area.h - 8) / (rows + (adding ? 1 : 0)));
  const curRow = M._nidmi_cur_row(), curStep = M._nidmi_cur_step(), playing = M._nidmi_is_playing();
  const harm = M._nidmi_harmony_active();
  const { t0, t1 } = timeWindow(), span = t1 - t0;
  const right = area.x + area.w;
  for (let i = 0; i < rows; i++) {
    const r = first + i;
    const y = top + i * rowH, isCur = r === curRow && !adding, n = M._nidmi_row_steps(r), cw = gw / (n * span), dm = M._nidmi_row_display(r);
    const lane = M._nidmi_row_kind(r) === 1;
    const head = playing ? M._nidmi_playhead(r) : 255;
    const durational = !lane && dm !== DM.Accent && dm !== DM.Swing;   // le recouvrement est une affaire de duree
    const covered = durational ? coveredSteps(r, bar, n) : new Array(n).fill(false);
    const xOf = (s) => area.x + labelW + (s / n - t0) / span * gw;
    const visible = (s) => s / n >= t0 - 1e-9 && s / n < t1 - 1e-9;

    // La colonne de la row : son nom, et ce qui decide de ce qu'elle joue.
    g.font = FONT(10, isCur);
    g.fillStyle = isCur ? C.accent : C.muted;
    g.fillText(`R${skip + i + 1}`, area.x + 4, y + rowH / 2 - 1);
    g.font = FONT(9);
    g.fillStyle = C.muted;
    const sub2 = lane ? `cc${M._nidmi_row_cc(r)}` : harm ? MODE_NAMES[M._nidmi_row_mode(r, bar)] : "";
    if (sub2) g.fillText(sub2, area.x + 4, y + rowH / 2 + 10);

    // 1. Le fond de toutes les cases d'abord.
    for (let s = 0; s < n; s++) {
      if (!visible(s)) continue;
      g.fillStyle = C.off;
      g.fillRect(xOf(s) + 1, y + 1, cw - 2, rowH - 2);
    }

    // 2. Le contenu, selon ce que le mode encode. Une lane montre TOUJOURS sa courbe.
    if (lane) {
      drawCurve(r, area.x + labelW, y, gw, rowH, bar, t0, span, isCur ? curStep : -1, n);
    } else {
      for (let s = 0; s < n; s++) {
        const p = M._nidmi_step(r, bar, s);
        if (!(p & 1) || covered[s]) continue;
        const accent = p & 2, swing = p & 8, vel = (p >> 16) & 255;
        if (dm === DM.Fill) {
          // QUAND le pas joue : ambre = seulement en fill, gris barre = jamais en fill.
          if (!visible(s)) continue;
          const cond = (p >> 4) & 3, x = xOf(s);
          g.fillStyle = cond === 1 ? C.amber : cond === 2 ? "#3a4048" : "rgba(95, 183, 192, 0.22)";
          g.fillRect(x + 1, y + 1, cw - 2, rowH - 2);
          if (cond === 2) { g.strokeStyle = "#7c858e"; g.lineWidth = 1; g.beginPath(); g.moveTo(x + 3, y + rowH - 3); g.lineTo(x + cw - 3, y + 3); g.stroke(); }
          continue;
        }
        if (dm === DM.Accent || dm === DM.Swing) {
          // Un accent n'est pas long, il est fort : pas de duree dans ces modes.
          if (!visible(s)) continue;
          const lit = dm === DM.Accent ? accent : swing;
          g.fillStyle = lit ? (dm === DM.Accent ? C.amber : C.swing) : "rgba(95, 183, 192, 0.22)";
          g.fillRect(xOf(s) + 1, y + 1, cw - 2, rowH - 2);
          continue;
        }
        const stepSpan = Math.max(1, Math.min((p >>> 24) & 255, n - s));
        if (!visible(s) && !(s / n < t0 && (s + stepSpan) / n > t0)) continue;
        const sub = M._nidmi_step_sub(r, bar, s), hasSub = (p & 4) && sub !== 255 && !M._nidmi_sub_bypassed(sub) && M._nidmi_sub_len(sub) > 0;
        const x0 = xOf(s);
        const a = 0.35 + 0.65 * vel / 127;
        if (hasSub) {
          // Le sub s'etale sur le span du pas hote : ses sous-pas EN SONT le contenu.
          const x = Math.max(x0, area.x + labelW), xe = Math.min(x0 + cw * stepSpan, right);
          const m = M._nidmi_sub_len(sub), mw = (cw * stepSpan) / m;
          g.fillStyle = "#0d1114"; g.fillRect(x + 1, y + 1, xe - x - 1, rowH - 2);
          for (let k = 0; k < m; k++) {
            const bx = x0 + k * mw;
            if (bx + mw < x || bx > xe) continue;
            g.fillStyle = M._nidmi_sub_step_on(sub, k) ? `rgba(95, 183, 192, ${a})` : "#20272d";
            g.fillRect(Math.max(bx, x) + 1.5, y + 3, Math.min(mw, xe - bx) - 3, rowH - 6);
          }
          continue;
        }
        // La DUREE REELLE : span pas entiers, puis le gate sur le dernier.
        const gate = M._nidmi_step_gate(r, bar, s);
        const end = x0 + cw * (stepSpan - 1) + cw * gate / 100;
        const x = Math.max(x0, area.x + labelW), w = Math.max(3, Math.min(end, right) - x);
        if (dm === DM.Notes && !lane) {
          g.fillStyle = PC_HUE(M._nidmi_resolved_note(r, bar, (p >> 8) & 255) % 12);
          g.globalAlpha = a;
        } else {
          g.fillStyle = `rgba(95, 183, 192, ${a})`;
        }
        g.fillRect(x + 1, y + 1, w - 1, rowH - 2);
        g.globalAlpha = 1;
      }
    }

    // 4. Un pas actif recouvert est TU : contour pointille, il revient si on raccourcit.
    for (let s = 0; s < n; s++) {
      if (!covered[s] || !visible(s) || !(M._nidmi_step(r, bar, s) & 1)) continue;
      g.setLineDash([2, 2]); g.strokeStyle = "rgba(217, 222, 227, 0.55)"; g.lineWidth = 1;
      g.strokeRect(xOf(s) + 3.5, y + 3.5, cw - 7, rowH - 7);
      g.setLineDash([]);
    }
    // 5. Tete de lecture et curseur, au-dessus de tout.
    for (let s = 0; s < n; s++) {
      if (!visible(s)) continue;
      const x = xOf(s);
      if (s === head) { g.fillStyle = "rgba(255, 106, 95, 0.35)"; g.fillRect(x + 1, y + 1, cw - 2, rowH - 2); }
      if (isCur && s === curStep) {
        g.strokeStyle = C.text; g.lineWidth = 1.5;
        g.strokeRect(x + 1.5, y + 1.5, cw - 3, rowH - 3);
      }
    }
  }
  // La case « + » : une ligne d'ajout sous la derniere row de la piste.
  if (adding) {
    const y = top + rows * rowH;
    g.setLineDash([3, 3]); g.strokeStyle = C.text; g.lineWidth = 1;
    g.strokeRect(area.x + labelW + 1.5, y + 2.5, gw - 3, rowH - 5); g.setLineDash([]);
    g.font = FONT(10, true); g.fillStyle = C.accent; g.fillText("R+", area.x + 4, y + rowH / 2 + 3);
    g.font = FONT(10); g.fillStyle = C.muted;
    g.fillText("Value: + add · − remove last (if empty)", area.x + labelW + 10, y + rowH / 2 + 3);
  }
}

// LE ROLL. La hauteur dessinee est la note JOUEE (resolvedNote), pas la note ecrite ;
// la teinte vient des classes que le moteur permet a cette row.
function drawRoll(area) {
  const r = M._nidmi_cur_row(), bar = M._nidmi_cur_bar(), n = M._nidmi_row_steps(r);
  if (M._nidmi_row_kind(r) === 1) {
    g.fillStyle = C.muted; g.font = FONT(12); g.textAlign = "center";
    g.fillText("lane: edit its curve in PATTERN", area.x + area.w / 2, area.y + area.h / 2);
    g.textAlign = "left";
    return;
  }
  const gutter = 22, velH = 22;
  const gx = area.x + gutter, gw = area.w - gutter - 2, gy = area.y + 3, gh = area.h - velH - 8;
  const curStep = M._nidmi_cur_step();

  // L'octave se DEDUIT : la fenetre suit la note editee, avec hysteresis (on ne recale
  // que quand elle sort, sinon la vue sauterait a chaque cran).
  const edited = M._nidmi_resolved_note(r, bar, (M._nidmi_step(r, bar, curStep) >> 8) & 255);
  if (edited < host.rollBottom) host.rollBottom = Math.max(0, edited - 2);
  if (edited >= host.rollBottom + host.vSpan) host.rollBottom = Math.min(127 - host.vSpan, edited - host.vSpan + 3);
  const bottom = host.rollBottom, span = host.vSpan, laneH = gh / span;
  const laneY = (p) => gy + gh - (p - bottom + 1) * laneH;

  const harm = M._nidmi_harmony_active();
  const allowed = M._nidmi_allowed_pcs(r, bar), chord = M._nidmi_chord_pcs(), keyRoot = M._nidmi_key_root();
  for (let p = bottom; p < bottom + span; p++) {
    const pc = p % 12, y = laneY(p), black = [1, 3, 6, 8, 10].includes(pc);
    if (harm) {
      // Gamme en gris, tonique un cran au-dessus, accord en vert par-dessus.
      g.fillStyle = "#07090b"; g.fillRect(gx, y, gw, laneH);
      if (allowed >> pc & 1) { g.fillStyle = pc === keyRoot ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.07)"; g.fillRect(gx, y, gw, laneH); }
      if (chord >> pc & 1) { g.fillStyle = "rgba(95,208,122,0.16)"; g.fillRect(gx, y, gw, laneH); }
    } else {
      g.fillStyle = black ? "#0a0d10" : "#121619"; g.fillRect(gx, y, gw, laneH);
    }
    // Clavier vertical dans la gouttiere : les noires plus courtes, du cote oppose.
    g.fillStyle = black ? "#151719" : "#9aa49e";
    g.fillRect(area.x + (black ? 0 : 0), y + 0.5, black ? gutter * 0.62 : gutter - 2, laneH - 1);
    if (pc === 0) {
      g.fillStyle = "#2a3238"; g.fillRect(gx, y + laneH - 1, gw, 1);
      if (laneH >= 7) { g.fillStyle = "#1a1d20"; g.font = FONT(8); g.fillText(`${Math.floor(p / 12) - 1}`, area.x + gutter - 10, y + laneH - 1); }
    }
  }

  const { t0, t1 } = timeWindow(), tspan = t1 - t0;
  const cw = gw / (n * tspan), playing = M._nidmi_is_playing(), head = playing ? M._nidmi_playhead(r) : 255;
  const covered = coveredSteps(r, bar, n);
  for (let s = 0; s < n; s++) {
    const fs = s / n;
    if (fs < t0 - 1e-9 || fs >= t1 - 1e-9) continue;
    const x = gx + (fs - t0) / tspan * gw;
    if (s === head) { g.fillStyle = "rgba(255,106,95,0.18)"; g.fillRect(x, gy, cw, gh); }
    if (s === curStep) { g.fillStyle = "rgba(95,183,192,0.10)"; g.fillRect(x, gy, cw, gh + velH + 4); }
    g.fillStyle = "#1a1f24"; g.fillRect(x, gy, 1, gh);
    const p = M._nidmi_step(r, bar, s);
    if (!(p & 1) || covered[s]) continue;   // recouvert par une note longue : tu
    const written = (p >> 8) & 255, vel = (p >> 16) & 255, gate = M._nidmi_step_gate(r, bar, s);
    const stepSpan = Math.max(1, Math.min((p >>> 24) & 255, n - s));
    const played = M._nidmi_resolved_note(r, bar, written);
    const w = Math.max(3, Math.min(cw * (stepSpan - 1) + cw * gate / 100, gx + gw - x) - 1);
    if (played >= bottom && played < bottom + span) {
      g.fillStyle = `rgba(95,183,192,${0.45 + 0.55 * vel / 127})`;
      g.fillRect(x + 1, laneY(played) + 0.5, w, laneH - 1);
      if (s === curStep) { g.strokeStyle = C.text; g.lineWidth = 1.5; g.strokeRect(x + 1, laneY(played) + 0.5, w, laneH - 1); }
      if (p & 4) { g.fillStyle = C.text; g.fillRect(x + w - 3, laneY(played) + 1, 2, laneH - 2); }
    }
    // L'harmonie a deplace la note : la hauteur ECRITE reste visible en pointille.
    if (played !== written && written >= bottom && written < bottom + span) {
      g.setLineDash([2, 2]); g.strokeStyle = "#6c7a80"; g.lineWidth = 1;
      g.strokeRect(x + 1.5, laneY(written) + 1, w - 1, laneH - 2);
      g.setLineDash([]);
    }
    const vy = gy + gh + 4, vh = velH * vel / 127;
    g.fillStyle = s === curStep ? C.text : "#3f6d73";
    g.fillRect(x + cw / 2 - 1.5, vy + velH - vh, 3, vh);
  }
}

function drawHarmony(area) {
  const len = M._nidmi_chord_len(), playing = M._nidmi_chord_playing(), cur = M._nidmi_cur_slot();
  const lane = M._nidmi_cur_lane();
  g.font = FONT(11, true);
  g.fillStyle = lane === 0 ? C.accent : C.muted;
  g.fillText("CHORDS", area.x + 8, area.y + 18);
  g.fillStyle = lane === 1 ? C.accent : C.muted;
  g.fillText("KEY", area.x + 90, area.y + 18);
  if (lane === 1) {
    g.font = FONT(11); g.fillStyle = C.muted;
    g.fillText("key lane: not drawn yet", area.x + 8, area.y + 44);
    return;
  }
  const chipW = 58, chipH = 44, perRow = Math.max(1, Math.floor((area.w - 8) / (chipW + 6)));
  for (let i = 0; i <= Math.min(len, 31); i++) {
    const x = area.x + 8 + (i % perRow) * (chipW + 6), y = area.y + 30 + Math.floor(i / perRow) * (chipH + 6);
    if (i === len) {   // le slot d'AJOUT
      g.strokeStyle = i === cur ? C.text : "#2e363e"; g.setLineDash([3, 3]);
      g.strokeRect(x + 0.5, y + 0.5, chipW, chipH); g.setLineDash([]);
      g.fillStyle = C.muted; g.font = FONT(14); g.fillText("+", x + chipW / 2 - 4, y + chipH / 2 + 5);
      continue;
    }
    const c = M._nidmi_chord(i), dur = M._nidmi_chord_extra(i) & 255;
    g.fillStyle = i === playing && M._nidmi_is_playing() ? "#1e3d27" : "#141a1f";
    g.fillRect(x, y, chipW, chipH);
    if (i === cur) { g.strokeStyle = C.text; g.lineWidth = 1.5; g.strokeRect(x + 0.75, y + 0.75, chipW - 1.5, chipH - 1.5); }
    // L'accord comme sur une grille, son degre dessous, sa duree.
    g.font = FONT(13, true);
    fitText(str(M._nidmi_chord_symbol(i, 0)), x + 5, y + 18, chipW - 8, C.text);
    g.font = FONT(10);
    fitText(str(M._nidmi_chord_symbol(i, 1)), x + 5, y + 31, chipW - 8, C.muted);
    g.fillStyle = C.muted; g.fillText(`${dur} b`, x + 5, y + 41);
  }
}

// LA GRILLE plein ecran : suivre une progression a vue, comme une grille de jazz.
// Quatre mesures par ligne ; la ligne en cours en haut, les suivantes dessous pour lire
// en avance. Deux accords dans une mesure : la case est coupee en diagonale. Une mesure
// qui repete la precedente : %. ⇧ montre les degres.
const chartHost = { lastNav: -1e9, lastBar: -1 };
function drawChart() {
  const bars = M._nidmi_chart_bars(), bpb = M._nidmi_chart_bpb(), degrees = isShift();
  const playing = M._nidmi_is_playing();
  const total = bars * bpb;
  const playBar = playing && total ? Math.floor((M._nidmi_prog_beat() % total) / bpb) : -1;
  const cursor = M._nidmi_chart_bar();
  if (cursor !== chartHost.lastBar) { chartHost.lastBar = cursor; chartHost.lastNav = now(); }
  // On suit la lecture, sauf si la main vient de naviguer.
  const focus = playBar >= 0 && now() - chartHost.lastNav > 3000 ? playBar : cursor;

  g.fillStyle = "#0b0e11"; g.fillRect(0, 0, W, HEAD_H);
  g.font = FONT(11, true); g.fillStyle = C.accent; g.fillText("CHART", 6, 14);
  g.font = FONT(11); g.fillStyle = now() < host.toastUntil ? C.amber : C.muted;
  g.fillText(now() < host.toastUntil ? host.toast
    : `${Math.round(M._nidmi_bpm())} BPM · bar ${bars ? focus + 1 : 0}/${bars}${degrees ? " · degrees" : ""}`, 62, 14);
  g.fillStyle = playing ? C.pushed : C.muted;
  g.fillText(playing ? "▶" : "■", W - 14, 14);
  if (!bars) {
    g.fillStyle = C.muted; g.font = FONT(13); g.textAlign = "center";
    g.fillText("No chord progression — add chords in HARMONY", W / 2, H / 2);
    g.textAlign = "left";
    return;
  }

  // Les accords, en temps.
  const n = M._nidmi_chord_len(), chords = [];
  for (let i = 0; i < n; i++) {
    const s = M._nidmi_chord_start(i), d = M._nidmi_chord_extra(i) & 255;
    chords.push({ s, e: s + d, i, sym: str(M._nidmi_chord_symbol(i, degrees ? 1 : 0)) });
  }
  const segs = (b) => chords.filter((c) => c.s < (b + 1) * bpb && c.e > b * bpb);
  // Les changements de tonalite, places sur leur mesure.
  const keys = new Map();
  for (let i = 0, beat = 0; i < M._nidmi_key_len(); i++) {
    const k = M._nidmi_key_slot(i), root = k & 15, sc = (k >> 4) & 15;
    keys.set(Math.floor(beat / bpb), `${str(M._nidmi_pitch_name(root, root, sc))} ${str(M._nidmi_scale_name(sc))}`);
    beat += k >> 8;
  }

  const LINES = 4, lines = Math.ceil(bars / 4), pad = 6;
  const top = Math.max(0, Math.min(Math.floor(focus / 4), lines - LINES));
  const lineH = (H - HEAD_H - pad) / LINES, boxW = (W - 2 * pad) / 4;
  for (let li = 0; li < LINES && top + li < lines; li++) {
    for (let k = 0; k < 4; k++) {
      const b = (top + li) * 4 + k;
      if (b >= bars) continue;
      const x = pad + k * boxW, y = HEAD_H + pad / 2 + li * lineH;
      g.fillStyle = b === playBar ? "#1e3d27" : "#11161b";
      g.fillRect(x + 1, y + 1, boxW - 2, lineH - 2);
      g.strokeStyle = "#2b333b"; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, boxW - 1, lineH - 1);
      if (b === cursor && now() - chartHost.lastNav < 3000) {
        g.strokeStyle = C.text; g.lineWidth = 2; g.strokeRect(x + 2, y + 2, boxW - 4, lineH - 4);
      }
      g.font = FONT(9); g.fillStyle = "#4f5962"; g.fillText(String(b + 1), x + 4, y + 11);
      if (keys.has(b)) { g.fillStyle = C.amber; g.fillText(keys.get(b), x + 22, y + 11); }

      const here = segs(b), prev = b > 0 ? segs(b - 1) : [];
      const same = b > 0 && here.length === prev.length && here.every((c, j) => c.sym === prev[j].sym);
      g.fillStyle = C.text; g.textAlign = "center";
      if (same) {
        g.font = FONT(22, true); g.fillStyle = C.muted; g.fillText("%", x + boxW / 2, y + lineH / 2 + 8);
      } else if (here.length === 1) {
        g.font = FONT(22, true); fitCentered(here[0].sym, x + boxW / 2, y + lineH / 2 + 8, boxW - 10);
      } else if (here.length === 2) {
        g.strokeStyle = "#3a434c"; g.lineWidth = 1;
        g.beginPath(); g.moveTo(x + 6, y + lineH - 6); g.lineTo(x + boxW - 6, y + 6); g.stroke();
        g.font = FONT(16, true);
        g.textAlign = "left"; fitCentered(here[0].sym, x + 8, y + lineH * 0.38, boxW * 0.6, "left");
        g.textAlign = "right"; fitCentered(here[1].sym, x + boxW - 8, y + lineH * 0.82, boxW * 0.6, "right");
      } else {
        // Plus de deux accords : chacun a sa part de la mesure, en temps.
        g.font = FONT(11, true);
        here.forEach((c) => {
          const a = Math.max(c.s, b * bpb) - b * bpb, z = Math.min(c.e, (b + 1) * bpb) - b * bpb;
          fitCentered(c.sym, x + boxW * (a + z) / 2 / bpb, y + lineH / 2 + 4, boxW * (z - a) / bpb - 4);
        });
      }
      g.textAlign = "left";
    }
  }
}
// Un symbole d'accord trop large perd quelques points de corps, sans etre tronque.
function fitCentered(text, x, y, maxW, align = "center") {
  const base = g.font, m = /(\d+)px/.exec(base), px = m ? Number(m[1]) : 12;
  for (let k = 0; k < 8 && g.measureText(text).width > maxW; k++) g.font = base.replace(`${px}px`, `${px - k - 1}px`);
  g.textAlign = align;
  g.fillText(text, x, y);
  g.font = base;
}

function drawPlaceholder(area, view) {
  g.fillStyle = C.muted; g.font = FONT(12); g.textAlign = "center";
  g.fillText(`${VIEW_NAMES[view]}: screen not drawn yet`, area.x + area.w / 2, area.y + area.h / 2 - 10);
  g.fillText("the knobs are live", area.x + area.w / 2, area.y + area.h / 2 + 10);
  g.textAlign = "left";
}

// Un plantage du dessin s'ecrit SUR l'ecran : sans ca il reste noir, sans un mot.
function frame() {
  try {
    drawFrame();
  } catch (err) {
    console.error(err);
    g.fillStyle = "#200"; g.fillRect(0, 0, W, H);
    g.fillStyle = "#ff6a6a"; g.font = FONT(11);
    String(err.stack || err).split("\n").slice(0, 8).forEach((l, i) => g.fillText(l.slice(0, 90), 8, 20 + i * 15));
  }
  requestAnimationFrame(frame);
}

function drawFrame() {
  // REC + PLAY : sur une lane, Valeur enregistre le geste au lieu d'editer un point.
  M._nidmi_set_rec({ off: 0, grid: 1, live: 2 }[host.rec]);
  M._nidmi_describe();
  const knobs = [];
  for (let i = 0; i < 6; i++) {
    knobs.push({
      name: str(M._nidmi_knob_name(i)), value: str(M._nidmi_knob_value(i)),
      role: M._nidmi_knob_role(i), depth: M._nidmi_knob_depth(i), hostOwns: M._nidmi_host_owns(i),
    });
  }
  const view = M._nidmi_view(), geo = geometry();

  g.fillStyle = C.bg;
  g.fillRect(0, 0, W, H);
  if (view === 6) { drawChart(); finishFrame(knobs, view); return; }
  drawHeader();
  g.save();
  g.beginPath(); g.rect(geo.content.x, geo.content.y, geo.content.w, geo.content.h); g.clip();
  if (view === 1) drawRoll(geo.content);
  else if (view <= 2) drawRows(geo.content);
  else if (view === 3) drawHarmony(geo.content);
  else drawPlaceholder(geo.content, view);
  g.restore();
  knobs.forEach((k, i) => drawCell(k, geo.cells[i], i));
  finishFrame(knobs, view);
}

function finishFrame(knobs, view) {
  // Les capuchons LISENT l'etat du core : enfonce = contexte ouvert, ou entre dans
  // le pas pour `Pas`. Un etat local divergerait des qu'un contexte se ferme seul.
  const inSub = view <= 2 && M._nidmi_cur_sub() >= 0;
  knobs.forEach((k, i) => {
    const ke = knobEls[i];
    ke.cap.classList.toggle("latched", k.role === ROLE.Pushed || (i === 1 && inSub));
    ke.el.classList.toggle("lent", k.role === ROLE.Lent);
    ke.el.classList.toggle("absent", k.role === ROLE.Absent);
    ke.el.title = `${k.name} ${k.value}`;
  });

  document.getElementById("b-play").classList.toggle("on", !!M._nidmi_is_playing());
  document.getElementById("b-rec").classList.toggle("on", host.rec !== "off");
  document.getElementById("b-rec").classList.toggle("blink", host.rec === "live");
  document.getElementById("b-row").classList.toggle("on", view <= 2);
  document.getElementById("b-harmony").classList.toggle("on", view === 3 || view === 6);
  document.getElementById("b-projet").classList.toggle("on", view === 4 || view === 5);
  keyLabels();
}
requestAnimationFrame(frame);
