// ===== $COPYCAT — a cat is stuck in the copier and it will not stop printing =====

// No CA yet — the cat is still warming up the copier. Set this when it drops.
const CA = '';
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];

const toast = document.getElementById('toast');
let toastT;
function showToast(msg) {
  toast.innerHTML = msg;
  toast.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => toast.classList.remove('show'), 2000);
}
async function copyCA() {
  if (!CA) { showToast('🖨️ SOON™ — the cat is still warming up the copier 🐱'); return; }
  try { await navigator.clipboard.writeText(CA); showToast("📋 CA COPIED! now Ctrl+V it 999,999 times. Meow."); }
  catch { showToast('🐱 just buy $COPYCAT'); }
}
document.getElementById('caCopy').addEventListener('click', copyCA);

// Fake "copy #" counter that keeps ticking
const vis = document.getElementById('visnum');
let visN = 400 + Math.floor(Math.random() * 99);
if (vis) setInterval(() => { visN += Math.floor(Math.random() * 7); vis.textContent = '#' + String(visN).padStart(6, '0'); }, 900);

// Legacy center popup that respawns when closed
const popup = document.getElementById('popup');
const popupX = document.getElementById('popupX');
function hidePopup() {
  popup.classList.add('hidden');
  setTimeout(() => { popup.classList.remove('hidden'); }, 6000 + Math.random() * 6000);
}
popupX.addEventListener('click', () => { showToast("😾 you closed the popup but the cat is STILL in the copier (and it knows where you live)"); hidePopup(); });
popup.querySelector('.popup-btn').addEventListener('click', (e) => { e.preventDefault(); copyCA(); hidePopup(); });

// ===================================================================
//  POPUP SWARM — copies everywhere, and closing one prints more
// ===================================================================
const layer = document.getElementById('popuplayer');
const MAX_POPUPS = 9;
const caBlock = CA
  ? '<span class="spop-ca" data-ca>' + CA + ' 📋</span>'
  : '<span class="spop-ca">CONTRACT: DROPPING SOON 🐱🖨️</span>';

const TEMPLATES = [
  {
    "head": "😻 CONGRATS — YOU'RE COPY #999,999!",
    "body": "The copier randomly selected <b>YOU</b> as our 999,999th printout!<br>Claim your warm, freshly-photocopied bag of <b>9 FREE LIVES</b> of $COPYCAT now.",
    "btn": "PRINT MY PRIZE 🖨️",
    "ca": false,
    "wheel": false,
    "countdown": false,
    "jitter": false,
    "v": "v1"
  },
  {
    "head": "⚠️ PAPER JAM DETECTED IN TRAY 2",
    "body": "There is a <b>very fluffy CAT</b> stuck in the rollers.<br>Please buy $COPYCAT to clear the jam. Do NOT pull the cat.",
    "btn": "CLEAR JAM 😾",
    "ca": false,
    "wheel": false,
    "countdown": false,
    "jitter": true,
    "v": "v2"
  },
  {
    "head": "🖨️ TONER CRITICALLY LOW",
    "body": "Cyan, Magenta, Yellow & <b>CAT</b> levels are dangerously low.<br>Refill now or the cat prints in sad grayscale.",
    "btn": "REFILL TONER 💰",
    "ca": false,
    "wheel": false,
    "countdown": false,
    "jitter": false,
    "v": "v3"
  },
  {
    "head": "📩 1 NEW COPY IN YOUR OUTPUT TRAY",
    "body": "The cat in the copier left you a message:<br><b>'meow. buy. meow. copy. meow.'</b>",
    "btn": "OPEN THE TRAY",
    "ca": false,
    "wheel": false,
    "countdown": false,
    "jitter": false,
    "v": "v4"
  },
  {
    "head": "🪂 FREE CATDROP INCOMING",
    "body": "Paste this into your wallet to receive <b>999,999 COPIES</b>:<br>Offer expires when the paper runs out (never).",
    "btn": "CLAIM MY COPIES",
    "ca": true,
    "wheel": false,
    "countdown": false,
    "jitter": false,
    "v": "v5"
  },
  {
    "head": "🐋 WHALE ALERT — SOMEONE COPIED THE CAT",
    "body": "<b>0xPurrrr</b> just CTRL+C'd <b>42 SOL</b> of $COPYCAT.<br>The copier is overheating. Don't let him hog all the copies.",
    "btn": "COPY THE WHALE",
    "ca": false,
    "wheel": false,
    "countdown": false,
    "jitter": false,
    "v": "v6"
  },
  {
    "head": "⏳ COPIER WARMING UP — PRESALE ENDS SOON",
    "body": "The photocopier hits operating temperature and the cat stops accepting new pages in:<br>Do NOT let the cat cool down.",
    "btn": "SECURE MY COPY",
    "ca": false,
    "wheel": false,
    "countdown": true,
    "jitter": false,
    "v": "v1"
  },
  {
    "head": "🎡 SPIN THE COLLATE-WHEEL!",
    "body": "Land on <b>DUPLEX</b> to DOUBLE your copies!<br>Everyone's a winner (the cat rigged it, the toner cartridge is not).",
    "btn": "SPIN TO COPY",
    "ca": false,
    "wheel": true,
    "countdown": false,
    "jitter": false,
    "v": "v2"
  },
  {
    "head": "🤖 SECURITY CHECK: ARE YOU A COPYCAT?",
    "body": "Prove you are not a bot.<br>Select all squares with <b>a cat wedged in a printer</b>.",
    "btn": "I AM A COPYCAT ✔️",
    "ca": false,
    "wheel": false,
    "countdown": false,
    "jitter": true,
    "v": "v3"
  },
  {
    "head": "📉 YOUR PORTFOLIO IS PRINTING IN GRAYSCALE",
    "body": "You are down bad, collated and stapled.<br>Everything you own is fading to black & white — only <b>$COPYCAT</b> is still in full color.",
    "btn": "RESTORE COLOR (APE)",
    "ca": false,
    "wheel": false,
    "countdown": false,
    "jitter": false,
    "v": "v4"
  },
  {
    "head": "🐱 THE CAT IS STARING AT YOU",
    "body": "The cat in the copier will NOT get out until you buy.<br>It has been staring for 999,999 hours. <b>It will not blink first.</b>",
    "btn": "OBEY THE CAT",
    "ca": false,
    "wheel": false,
    "countdown": false,
    "jitter": false,
    "v": "v5"
  },
  {
    "head": "📠 OFFICIAL CA — DO NOT REPLY-ALL",
    "body": "This is the ONE real cat, fresh off the glass. Every other listing is a copy of a copy of a copy.<br>Ctrl+C responsibly:",
    "btn": "COPY THE CA 📋",
    "ca": true,
    "wheel": false,
    "countdown": false,
    "jitter": false,
    "v": "v6"
  }
];

function place(el) {
  const w = el.offsetWidth || 300, h = el.offsetHeight || 200;
  const maxL = Math.max(50, window.innerWidth - w - 50);
  const maxT = Math.max(52, window.innerHeight - h - 60);
  el.style.left = rand(44, maxL) + 'px';
  el.style.top = rand(48, maxT) + 'px';
  el.style.setProperty('--rr', rand(-7, 7).toFixed(1) + 'deg');
}

function spawnPopup(t) {
  if (layer.children.length >= MAX_POPUPS) return;
  t = t || pick(TEMPLATES);
  const el = document.createElement('div');
  el.className = 'spop ' + t.v + (t.jitter ? ' j' : '');
  el.innerHTML =
    '<button class="spop-x" aria-label="close">✕</button>' +
    '<div class="spop-head">' + t.head + '</div>' +
    (t.wheel ? '<div class="spinwheel"></div>' : '') +
    (t.countdown ? '<div class="countdown" data-cd>00:00:0' + Math.ceil(rand(3, 9)) + '</div>' : '') +
    '<div class="spop-body">' + t.body + '</div>' +
    (t.ca ? caBlock : '') +
    '<span class="spop-btn">' + t.btn + '</span>' +
    '<div class="spop-tiny">(not real. not financial advice. it is a photo of a cat in a printer. do not lick the toner.)</div>';
  layer.appendChild(el);
  place(el);

  const cd = el.querySelector('[data-cd]');
  if (cd) {
    let s = parseInt(cd.textContent.split(':').pop(), 10) || 5;
    const iv = setInterval(() => {
      s = s <= 0 ? Math.ceil(rand(3, 9)) : s - 1;
      cd.textContent = '00:00:0' + Math.min(9, s);
    }, 1000);
    el._iv = iv;
  }

  const kill = (multiply) => {
    if (el._iv) clearInterval(el._iv);
    el.remove();
    if (multiply) {
      const n = Math.random() < 0.5 ? 2 : 1;
      for (let i = 0; i < n; i++) setTimeout(spawnPopup, rand(120, 500));
    }
  };
  el.querySelector('.spop-x').addEventListener('click', () => { showToast("😾 you closed the popup but the cat is STILL in the copier (and it knows where you live)"); kill(true); });
  el.querySelector('.spop-btn').addEventListener('click', () => { copyCA(); kill(false); setTimeout(spawnPopup, rand(300, 900)); });
  const caEl = el.querySelector('[data-ca]');
  if (caEl) caEl.addEventListener('click', copyCA);
}

for (let i = 0; i < 3; i++) setTimeout(spawnPopup, 600 + i * 700);
setInterval(() => { if (layer.children.length < MAX_POPUPS) spawnPopup(); }, 1900);

// ===================================================================
//  CORNER "just copied" notifications
// ===================================================================
const notifLayer = document.getElementById('notiflayer');
const NAMES = ["toner_gawd", "0xPurrrr", "CtrlV_Chad", "meowntain", "xerox_xerxes", "fax_machine_broke", "duplex_daddy", "collate_king", "9livesape", "printnpray", "staplerhands", "reply_all_regret", "TonerTina", "copyKitty420", "WifHatWhiskers", "PrinterGoBrr"];
const NOTE_TEMPLATES = ["🐱 <b>{n}</b> just copied <b>{a} SOL</b> of $COPYCAT", "🖨️ <b>{n}</b> smashed CTRL+V for <b>{a} SOL</b> — copier going brrr", "📄 <b>{n}</b> just printed <b>{a} SOL</b> of fresh COPIES", "🐾 <b>{n}</b> cleared a paper jam and aped <b>{a} SOL</b>", "😾 <b>{n}</b> refuses to get out of the copier ({a} SOL deep)", "📋 <b>{n}</b> pasted <b>{a} SOL</b> straight into the litter box", "⚡ <b>{n}</b> just spawned a whole NEW COPY (+{a} SOL)", "✅ <b>{n}</b> replied-all with <b>{a} SOL</b> (do not do this)"];
function popNotif() {
  if (notifLayer.children.length > 4) return;
  const el = document.createElement('div');
  el.className = 'notif';
  const name = pick(NAMES), amt = (rand(0.3, 42)).toFixed(1);
  el.innerHTML = pick(NOTE_TEMPLATES).replace('{n}', name).replace('{a}', amt);
  notifLayer.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, 4200);
}
setInterval(popNotif, 2600);
setTimeout(popNotif, 1500);

// ===================================================================
//  Scattered stickers
// ===================================================================
const PHRASES = ["COPYING… 100%", "PAPER JAM = BULLISH", "TONER LOW BUY HIGH", "CTRL+C 🐱", "CTRL+V 🖨️", "MEOW", "999,999 COPIES", "HE COPYC 🐾", "NO CAP ALL CAT", "PLEASE WAIT", "GET OUT OF THE COPIER", "COLLATE THE BAGS", "REPLY-ALL", "PC LOAD LETTER", "9 LIVES 9000X", "SAME CAT, NEW PAIR", "DO NOT SCALE TO FIT", "PASTE ME PLZ 🥺", "REAL PHOTO, REAL CAT", "😾 JAMMED (still bullish)"];
const stickerLayer = document.getElementById('stickers');
const STCLS = ['st-a','st-b','st-c','st-d','st-e'];
for (let i = 0; i < 24; i++) {
  const s = document.createElement('div');
  s.className = 'sticker ' + pick(STCLS);
  s.textContent = pick(PHRASES);
  const rot = rand(-14, 14);
  s.style.top = rand(6, 92) + '%';
  s.style.left = rand(2, 90) + '%';
  s.style.setProperty('--r', rot + 'deg');
  s.style.transform = 'rotate(' + rot + 'deg)';
  s.style.animationDelay = rand(0, 2) + 's';
  s.style.fontSize = rand(11, 18).toFixed(0) + 'px';
  stickerLayer.appendChild(s);
}

// Confetti: paper + paws + cats raining out of the copier
const EMOJI = ["📄", "🐱", "🐾", "🖨️", "😾", "📠", "📋", "🐈", "✂️", "📎", "😻"];
function drop() {
  const e = document.createElement('div');
  e.textContent = pick(EMOJI);
  e.style.cssText = 'position:fixed;z-index:50;top:-40px;pointer-events:none;font-size:' + rand(18, 34).toFixed(0) + 'px;left:' + rand(0, 100) + 'vw;transition:transform 5s linear,opacity 5s;';
  document.body.appendChild(e);
  requestAnimationFrame(() => { e.style.transform = 'translateY(110vh) rotate(' + rand(-360, 360) + 'deg)'; e.style.opacity = '0'; });
  setTimeout(() => e.remove(), 5200);
}
setInterval(drop, 450);

// Title screams into the tab
const base = document.title;
let flip = false;
setInterval(() => { document.title = (flip = !flip) ? "😾 PAPER JAM — (1) NEW COPY!! CTRL+V NOW 🖨️" : base; }, 900);
