// ===== $SPAM — maximum spam =====

// Copy CA
const toast = document.getElementById('toast');
let toastT;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => toast.classList.remove('show'), 1800);
}
document.getElementById('caCopy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(document.getElementById('caText').textContent.trim());
    showToast('COPIED!!! NOW BUY!!! 🥫');
  } catch { showToast('JUST BUY $SPAM 🥫'); }
});

// Random visitor number that keeps ticking (fake)
const vis = document.getElementById('visnum');
let visN = 400 + Math.floor(Math.random() * 99);
if (vis) setInterval(() => { visN += Math.floor(Math.random() * 7); vis.textContent = '#' + String(visN).padStart(6, '0'); }, 900);

// Popup that respawns when you close it (spam!)
const popup = document.getElementById('popup');
const popupX = document.getElementById('popupX');
function hidePopup() {
  popup.classList.add('hidden');
  setTimeout(() => { popup.classList.remove('hidden'); }, 6000 + Math.random() * 6000);
}
popupX.addEventListener('click', hidePopup);
popup.querySelector('.popup-btn').addEventListener('click', (e) => { e.preventDefault(); showToast('CLAIM = BUY $SPAM 🚀'); hidePopup(); });

// Scatter a swarm of extra stickers
const PHRASES = [
  '🚀 1000X', 'BUY NOW!!!', 'DON\'T FADE', 'FREE $SPAM', 'APE IN 🦍', 'LP LOCKED 🔒',
  'MOON 🌙', 'BASED DEV', 'LAST CHANCE', 'NGMI IF U MISS', 'SPAM IT 🥫', '100% SAFU',
  'CLICK HERE 👉', 'HODL 💎', 'PUMP IT 🔥', 'WAGMI', 'DEGEN SZN', 'SEND IT 🚀',
];
const COLORS = ['#ff2e63', '#7c3aed', '#059669', '#2563eb', '#d97706', '#db2777', '#0891b2', '#ca8a04'];
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];

const layer = document.getElementById('stickers');
for (let i = 0; i < 26; i++) {
  const s = document.createElement('div');
  s.className = 'sticker';
  s.textContent = pick(PHRASES);
  const rot = rand(-14, 14);
  s.style.top = rand(6, 92) + '%';
  s.style.left = rand(2, 90) + '%';
  s.style.background = pick(COLORS);
  s.style.setProperty('--r', rot + 'deg');
  s.style.transform = 'rotate(' + rot + 'deg)';
  s.style.animationDelay = rand(0, 2) + 's';
  s.style.fontSize = rand(11, 18).toFixed(0) + 'px';
  layer.appendChild(s);
}

// Emoji confetti rain
const EMOJI = ['🥫', '🚀', '🔥', '💰', '🌙', '💎', '🦍', '📈', '🤑', '💸'];
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
setInterval(() => { document.title = (flip = !flip) ? '🚨 BUY $SPAM NOW 🚨' : base; }, 900);
