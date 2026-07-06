/* ===================================================================
   SIMON SAYS CHALLENGE — APP LOGIC
   The core game algorithm (sequence generation, flashing, answer
   checking) is the SAME algorithm from the original prototype —
   it has only been wrapped with new features (HUD, sound, leaderboard,
   difficulty, pause, confetti) and adapted to read/write through
   small helper functions instead of bare globals.
   =================================================================== */

/* ---------------------------------------------------------------
   1. STATE
   --------------------------------------------------------------- */

let gameseq = [];
let userseq = [];

let started = false;
let paused = false;
let level = 0;
let score = 0;
let highScore = 0;
let playerName = "";

// difficulty -> flash duration in ms (lower = harder/faster)
const DIFFICULTY_SPEED = { easy: 700, medium: 450, hard: 280 };
let difficulty = "medium";

let btns = ["red", "yellow", "green", "purple"];

const STORAGE_KEYS = {
  leaderboard: "simonSays.leaderboard",
  highScore: "simonSays.highScore",
};

/* ---------------------------------------------------------------
   2. DOM REFERENCES
   --------------------------------------------------------------- */

const landingScreen   = document.getElementById("landingScreen");
const gameScreen      = document.getElementById("gameScreen");
const gameOverScreen  = document.getElementById("gameOverScreen");

const playerForm      = document.getElementById("playerForm");
const playerNameInput = document.getElementById("playerNameInput");
const nameError       = document.getElementById("nameError");
const difficultyOptions = document.getElementById("difficultyOptions");

const h2 = document.getElementById("statusHeading"); // kept as `h2` to match original variable's role

const hudPlayerName = document.getElementById("hudPlayerName");
const hudLevel       = document.getElementById("hudLevel");
const hudScore       = document.getElementById("hudScore");
const hudHighScore   = document.getElementById("hudHighScore");
const centerLevel    = document.getElementById("centerLevel");
const progressFill   = document.getElementById("progressFill");
const pauseBtn       = document.getElementById("pauseBtn");
const pauseOverlay   = document.getElementById("pauseOverlay");
const resumeBtn      = document.getElementById("resumeBtn");

const finalScore      = document.getElementById("finalScore");
const finalHighScore  = document.getElementById("finalHighScore");
const gameOverPlayer  = document.getElementById("gameOverPlayer");
const motivationText  = document.getElementById("motivationText");
const playAgainBtn    = document.getElementById("playAgainBtn");
const changePlayerBtn = document.getElementById("changePlayerBtn");

const leaderboardPanel = document.getElementById("leaderboardPanel");
const leaderboardList  = document.getElementById("leaderboardList");
const leaderboardEmpty = document.getElementById("leaderboardEmpty");
const viewLeaderboardLanding   = document.getElementById("viewLeaderboardLanding");
const viewLeaderboardGameOver  = document.getElementById("viewLeaderboardGameOver");
const closeLeaderboard = document.getElementById("closeLeaderboard");

const levelToast     = document.getElementById("levelToast");
const levelToastText = document.getElementById("levelToastText");

const themeToggle = document.getElementById("themeToggle");
const soundToggle = document.getElementById("soundToggle");

const traceLines = document.querySelectorAll(".trace");

/* ---------------------------------------------------------------
   3. SOUND EFFECTS
   Uses the Web Audio API to synthesize tones per pad rather than
   loading external audio files — keeps the project dependency-free.
   --------------------------------------------------------------- */

let audioCtx = null;
let soundOn = true;

const PAD_FREQ = { red: 220.0, yellow: 277.18, green: 329.63, purple: 392.0 };

function getAudioCtx(){
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

function playTone(freq, duration = 0.18, type = "sine"){
  if (!soundOn) return;
  try{
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch(e){ /* audio not available — fail silently */ }
}

function playPadSound(color){ playTone(PAD_FREQ[color] || 300, 0.18, "triangle"); }

function playCorrectSound(){ playTone(523.25, 0.12, "sine"); } // bright confirm

function playGameOverSound(){
  if (!soundOn) return;
  playTone(196.0, 0.5, "sawtooth");
  setTimeout(() => playTone(146.83, 0.6, "sawtooth"), 140);
}

function playLevelUpSound(){ playTone(659.25, 0.22, "square"); }

/* ---------------------------------------------------------------
   4. UTILITIES
   --------------------------------------------------------------- */

function $(id){ return document.getElementById(id); }

function switchScreen(hideEl, showEl){
  hideEl.classList.add("hidden");
  showEl.classList.remove("hidden");
  showEl.classList.add("screen-enter");
  setTimeout(() => showEl.classList.remove("screen-enter"), 450);
}

function escapeHtml(str){
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/* ---------------------------------------------------------------
   5. LANDING SCREEN — name validation, difficulty pick, start
   --------------------------------------------------------------- */

difficultyOptions.addEventListener("click", (e) => {
  const btn = e.target.closest(".difficulty-btn");
  if (!btn) return;
  difficultyOptions.querySelectorAll(".difficulty-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  difficulty = btn.dataset.difficulty;
});

playerForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = playerNameInput.value.trim();

  if (!name) {
    nameError.textContent = "Please enter a name to start the game.";
    playerNameInput.classList.add("invalid");
    playerNameInput.focus();
    return;
  }

  nameError.textContent = "";
  playerNameInput.classList.remove("invalid");
  playerName = name;
  enterGameScreen();
});

playerNameInput.addEventListener("input", () => {
  if (playerNameInput.value.trim()) {
    nameError.textContent = "";
    playerNameInput.classList.remove("invalid");
  }
});

function enterGameScreen(){
  highScore = Number(localStorage.getItem(STORAGE_KEYS.highScore)) || 0;
  hudPlayerName.textContent = playerName;
  hudHighScore.textContent = highScore;
  hudScore.textContent = "0";
  hudLevel.textContent = "0";
  centerLevel.textContent = "0";
  h2.textContent = "Press any key or tap a pad to begin";
  switchScreen(landingScreen, gameScreen);
}

/* ---------------------------------------------------------------
   6. CORE GAME LOGIC
   (Same algorithm as the original: keypress arms the game, levelup()
   pushes a random color, flashes it, btnPress() records the user's
   guess and CheckAns() validates it index-by-index.)
   --------------------------------------------------------------- */

document.addEventListener("keypress", function () {
  if (gameScreen.classList.contains("hidden") || paused) return;
  if (started == false) {
    started = true;
    levelup();
  }
});

// Optional keyboard shortcuts for the four pads (Q/W/A/S), purely additive
const KEY_TO_COLOR = { q: "red", w: "yellow", a: "purple", s: "green" };
document.addEventListener("keydown", function (e) {
  const key = e.key.toLowerCase();
  if (!(key in KEY_TO_COLOR)) return;
  if (gameScreen.classList.contains("hidden") || paused) return;
  if (started == false) { started = true; levelup(); return; }
  const btn = document.getElementById(KEY_TO_COLOR[key]);
  if (btn && !btn.disabled) handleUserPress(btn, KEY_TO_COLOR[key]);
});

function btnFlash(btn){
  btn.classList.add("flash");
  litTrace(btn.id, true);
  playPadSound(btn.id);
  const duration = DIFFICULTY_SPEED[difficulty] || 450;
  setTimeout(function(){
    btn.classList.remove("flash");
    litTrace(btn.id, false);
  }, duration);
}

function litTrace(color, on){
  const trace = document.querySelector(`.trace-${color}`);
  if (trace) trace.classList.toggle(`lit-${color}`, on);
}

function levelup() {
  userseq = [];
  level++;
  h2.innerText = `Level ${level}`;
  hudLevel.textContent = level;
  centerLevel.textContent = level;
  updateProgress();
  setPadsEnabled(false);

  // NOTE: original bug fix — Math.random()*3 only ever picked indices
  // 0-2, so "purple" could never appear. Now uses btns.length (4).
  let randinx = Math.floor(Math.random() * btns.length);
  let randcolor = btns[randinx];
  gameseq.push(randcolor);

  // Flash only the NEWEST color (not the full sequence). The player still
  // has to recall and replay every step from memory in CheckAns() —
  // only the visual playback is shortened.
  playSequence();
}

function playSequence(){
  const duration = DIFFICULTY_SPEED[difficulty] || 450;
  const newColor = gameseq[gameseq.length - 1];
  const btn = document.getElementById(newColor);

  setTimeout(() => {
    btnFlash(btn);
    setTimeout(() => setPadsEnabled(true), duration + 60);
  }, 350); // short pause before flashing so the new round feels distinct
}

function setPadsEnabled(enabled){
  allbtns.forEach(b => b.disabled = !enabled);
}

function CheckAns(idx){
  if (userseq[idx] == gameseq[idx]) {
    if (userseq.length == gameseq.length) {
      playCorrectSound();
      score = level;
      hudScore.textContent = score;
      showLevelToast(level);
      checkMilestone(level);
      setTimeout(levelup, 1000);
    }
  } else {
    const wrongBtn = document.getElementById(userseq[idx]);
    if (wrongBtn) wrongBtn.classList.add("wrong");
    playGameOverSound();
    h2.innerHTML = `Game over! Your score was <b>${level - 1 >= 0 ? score : 0}</b>`;
    setTimeout(() => endGame(), 420);
  }
}

function btnPress(){
  if (this.disabled || paused) return;

  // A tap on a pad before the round has begun arms the game,
  // same as the original keypress-to-start behavior.
  if (started == false) {
    started = true;
    levelup();
    return;
  }

  handleUserPress(this, this.getAttribute("id"));
}

function handleUserPress(btn, colorId){
  spawnRipple(btn);
  btnFlash(btn);
  userseq.push(colorId);
  CheckAns(userseq.length - 1);
}

let allbtns = document.querySelectorAll(".btn");
for (let btn of allbtns) {
  btn.addEventListener("click", btnPress);
}

function reset(){
  started = false;
  gameseq = [];
  userseq = [];
  level = 0;
}

/* ---------------------------------------------------------------
   7. RIPPLE EFFECT (click feedback on pads)
   --------------------------------------------------------------- */

function spawnRipple(btn){
  const ripple = document.createElement("span");
  ripple.classList.add("ripple");
  const size = btn.offsetWidth * 0.8;
  ripple.style.width = ripple.style.height = `${size}px`;
  ripple.style.left = `${btn.offsetWidth / 2 - size / 2}px`;
  ripple.style.top = `${btn.offsetHeight / 2 - size / 2}px`;
  btn.appendChild(ripple);
  setTimeout(() => ripple.remove(), 550);
}

/* ---------------------------------------------------------------
   8. PROGRESS INDICATOR + LEVEL-UP TOAST
   --------------------------------------------------------------- */

const MILESTONE_STEP = 5; // every 5 levels = one full progress bar + confetti

function updateProgress(){
  const pct = ((level % MILESTONE_STEP) / MILESTONE_STEP) * 100;
  progressFill.style.width = `${level > 0 && pct === 0 ? 100 : pct}%`;
}

function showLevelToast(lvl){
  levelToastText.textContent = `Level ${lvl} cleared!`;
  levelToast.classList.remove("show");
  void levelToast.offsetWidth; // restart animation
  levelToast.classList.remove("hidden");
  levelToast.classList.add("show");
  if (soundOn) playLevelUpSound();
}

function checkMilestone(lvl){
  if (lvl > 0 && lvl % MILESTONE_STEP === 0) {
    launchConfetti();
  }
}

/* ---------------------------------------------------------------
   9. PAUSE / RESUME
   --------------------------------------------------------------- */

pauseBtn.addEventListener("click", () => {
  if (!started) return;
  paused = true;
  pauseOverlay.classList.remove("hidden");
});

resumeBtn.addEventListener("click", () => {
  paused = false;
  pauseOverlay.classList.add("hidden");
});

/* ---------------------------------------------------------------
   10. GAME OVER FLOW
   --------------------------------------------------------------- */

const MOTIVATIONS = [
  "Every champion started with Level 1. Run it back!",
  "Your memory is a muscle — that was a solid rep.",
  "So close to your best. One more try?",
  "New high score energy is loading...",
  "Sequences don't stand a chance against you for long.",
];

function endGame(){
  const finalLevelScore = score;

  if (finalLevelScore > highScore) {
    highScore = finalLevelScore;
    localStorage.setItem(STORAGE_KEYS.highScore, String(highScore));
  }

  saveToLeaderboard(playerName, finalLevelScore);

  finalScore.textContent = finalLevelScore;
  finalHighScore.textContent = highScore;
  gameOverPlayer.textContent = playerName;
  motivationText.textContent = finalLevelScore > 0 && finalLevelScore === highScore
    ? "🏆 New high score! That's your best run yet."
    : MOTIVATIONS[Math.floor(Math.random() * MOTIVATIONS.length)];

  reset();
  score = 0;
  switchScreen(gameScreen, gameOverScreen);
}

playAgainBtn.addEventListener("click", () => {
  switchScreen(gameOverScreen, gameScreen);
  hudScore.textContent = "0";
  hudLevel.textContent = "0";
  centerLevel.textContent = "0";
  progressFill.style.width = "0%";
  h2.textContent = "Press any key or tap a pad to begin";
});

changePlayerBtn.addEventListener("click", () => {
  playerNameInput.value = "";
  switchScreen(gameOverScreen, landingScreen);
});

/* ---------------------------------------------------------------
   11. LEADERBOARD (Local Storage)
   --------------------------------------------------------------- */

function getLeaderboard(){
  try{
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.leaderboard)) || [];
  } catch(e){ return []; }
}

function saveToLeaderboard(name, finalScoreValue){
  if (finalScoreValue <= 0) return;
  const board = getLeaderboard();
  board.push({ name, score: finalScoreValue, ts: Date.now() });
  board.sort((a, b) => b.score - a.score);
  const top10 = board.slice(0, 10);
  localStorage.setItem(STORAGE_KEYS.leaderboard, JSON.stringify(top10));
}

function renderLeaderboard(){
  const board = getLeaderboard();
  leaderboardList.innerHTML = "";

  if (board.length === 0) {
    leaderboardEmpty.classList.remove("hidden");
    return;
  }
  leaderboardEmpty.classList.add("hidden");

  board.forEach((entry, i) => {
    const li = document.createElement("li");
    const isCurrent = entry.name === playerName && entry.score === score;
    li.className = "leaderboard-item" + (isCurrent ? " is-current" : "");
    li.innerHTML = `
      <span class="lb-rank">${i + 1}</span>
      <span class="lb-name">${escapeHtml(entry.name)}</span>
      <span class="lb-score">${entry.score}</span>
    `;
    leaderboardList.appendChild(li);
  });
}

function openLeaderboard(){
  renderLeaderboard();
  leaderboardPanel.classList.remove("hidden");
}
function closeLeaderboardPanel(){
  leaderboardPanel.classList.add("hidden");
}

viewLeaderboardLanding.addEventListener("click", openLeaderboard);
viewLeaderboardGameOver.addEventListener("click", openLeaderboard);
closeLeaderboard.addEventListener("click", closeLeaderboardPanel);
leaderboardPanel.addEventListener("click", (e) => {
  if (e.target === leaderboardPanel) closeLeaderboardPanel();
});

/* ---------------------------------------------------------------
   12. THEME + SOUND TOGGLES
   --------------------------------------------------------------- */

themeToggle.addEventListener("click", () => {
  document.body.classList.toggle("theme-light");
  localStorage.setItem("simonSays.theme", document.body.classList.contains("theme-light") ? "light" : "dark");
});

soundToggle.addEventListener("click", () => {
  soundOn = !soundOn;
  document.body.classList.toggle("sound-off", !soundOn);
});

// Restore saved theme preference
(function restoreTheme(){
  const saved = localStorage.getItem("simonSays.theme");
  if (saved === "light") document.body.classList.add("theme-light");
})();

/* ---------------------------------------------------------------
   13. CONFETTI (milestone celebration, lightweight canvas particles)
   --------------------------------------------------------------- */

const confettiCanvas = document.getElementById("confettiCanvas");
const ctx2d = confettiCanvas.getContext("2d");
let confettiParticles = [];
let confettiRAF = null;

function resizeConfettiCanvas(){
  confettiCanvas.width = window.innerWidth;
  confettiCanvas.height = window.innerHeight;
}
window.addEventListener("resize", resizeConfettiCanvas);
resizeConfettiCanvas();

const CONFETTI_COLORS = ["#FF3B5C", "#FFC93B", "#2EE6A8", "#A855F7", "#3BD6FF"];

function launchConfetti(){
  const count = 90;
  for (let i = 0; i < count; i++){
    confettiParticles.push({
      x: confettiCanvas.width / 2 + (Math.random() - 0.5) * 200,
      y: confettiCanvas.height * 0.25,
      vx: (Math.random() - 0.5) * 8,
      vy: Math.random() * -6 - 4,
      size: Math.random() * 7 + 4,
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      rotation: Math.random() * 360,
      vr: (Math.random() - 0.5) * 14,
      gravity: 0.18 + Math.random() * 0.08,
      life: 0,
      maxLife: 110 + Math.random() * 40,
    });
  }
  if (!confettiRAF) confettiTick();
}

function confettiTick(){
  ctx2d.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
  confettiParticles.forEach(p => {
    p.vy += p.gravity;
    p.x += p.vx;
    p.y += p.vy;
    p.rotation += p.vr;
    p.life++;

    ctx2d.save();
    ctx2d.globalAlpha = Math.max(0, 1 - p.life / p.maxLife);
    ctx2d.translate(p.x, p.y);
    ctx2d.rotate((p.rotation * Math.PI) / 180);
    ctx2d.fillStyle = p.color;
    ctx2d.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
    ctx2d.restore();
  });

  confettiParticles = confettiParticles.filter(p => p.life < p.maxLife && p.y < confettiCanvas.height + 40);

  if (confettiParticles.length > 0) {
    confettiRAF = requestAnimationFrame(confettiTick);
  } else {
    ctx2d.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    confettiRAF = null;
  }
}