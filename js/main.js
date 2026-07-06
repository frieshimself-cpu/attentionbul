// ===== $SPAM — maximum spam =====

const CA = '5Vz9Jj6yF7f523wg9UKyT1imQd3wv15orecPkwyKpump';
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// Copy CA
const toast = document.getElementById('toast');
let toastT;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => toast.classList.remove('show'), 1800);
}
async function copyCA() {
  try { await navigator.clipboard.writeText(CA); showToast('CA COPIED!!! NOW BUY!!! 🥫'); }
  catch { showToast('JUST BUY $SPAM 🥫'); }
}
document.getElementById('caCopy').addEventListener('click', copyCA);

// Random visitor number that keeps ticking (fake)
const vis = document.getElementById('visnum');
let visN = 400 + Math.floor(Math.random() * 99);
if (vis) setInterval(() => { visN += Math.floor(Math.random() * 7); vis.textContent = '#' + String(visN).padStart(6, '0'); }, 900);

// Legacy center popup that respawns when you close it (spam!)
const popup = document.getElementById('popup');
const popupX = document.getElementById('popupX');
function hidePopup() {
  popup.classList.add('hidden');
  setTimeout(() => { popup.classList.remove('hidden'); }, 6000 + Math.random() * 6000);
}
popupX.addEventListener('click', hidePopup);
popup.querySelector('.popup-btn').addEventListener('click', (e) => { e.preventDefault(); showToast('CLAIM = BUY $SPAM 🚀'); hidePopup(); });

// ===================================================================
//  SPAM POPUP SWARM — popups everywhere, and closing one spawns more
// ===================================================================
const layer = document.getElementById('popuplayer');
const MAX_POPUPS = 9;               // cap so the browser survives
const caBlock = `<span class="spop-ca" data-ca>${CA} 📋</span>`;

// each template: variant class, head, body html, button text
const TEMPLATES = [
  { v: 'v1', head: '🎉 YOU WON!!! 🎉', body: 'You are visitor <b>#' + (100000 + Math.floor(rand(0,899999))) + '</b>!<br>You just won <b>1,000,000 $SPAM</b> 🥫', btn: 'CLAIM NOW!!!' },
  { v: 'v2', head: '🚨 VIRUS DETECTED 🚨', body: 'Your wallet is <b>NOT holding $SPAM</b>.<br>This is a critical condition. The only known cure:', btn: '🧯 BUY $SPAM TO FIX', ca: true, jitter: true },
  { v: 'v3', head: '💌 1 NEW MESSAGE', body: '<b>ser…</b><br>"have you bought $SPAM yet?? 👀 everyone is aping rn"', btn: 'REPLY: YES 🚀' },
  { v: 'v4', head: '🪂 AIRDROP UNLOCKED', body: 'Paste the CA to claim your <b>FREE $SPAM</b> airdrop 🎁', btn: '💰 CLAIM AIRDROP', ca: true },
  { v: 'v5', head: '🐋 WHALE ALERT', body: 'Someone just <b>100x\'d</b> on $SPAM.<br>Don\'t be the exit liquidity.', btn: '🦍 APE NOW' },
  { v: 'v6', head: '⏰ PRESALE ENDING', body: 'Only <b>0.0000001%</b> of $SPAM left at this price (fake). HURRY!!!', btn: '🔥 BUY BEFORE IT\'S GONE', countdown: true },
  { v: 'v1', head: '🎰 SPIN TO WIN', body: 'Everybody wins!!! (the prize is $SPAM)', btn: '🎡 SPIN & BUY', wheel: true },
  { v: 'v3', head: '🤖 CAPTCHA', body: 'Prove you\'re not poor to continue.<br>Check the box:', btn: '✅ I AM BUYING $SPAM' },
  { v: 'v2', head: '📉 PORTFOLIO ALERT', body: 'Your portfolio is down bad because it has <b>0 $SPAM</b>.<br>Analysts recommend: buy $SPAM.', btn: '📈 FIX MY BAGS' },
  { v: 'v4', head: '👀 3 DEGENS NEARBY', body: 'Hot degens in your area are aping <b>$SPAM</b> right now 🥵', btn: '🔗 CONNECT WALLET' },
  { v: 'v5', head: '📢 CA DROP', body: 'This is the <b>official $SPAM CA</b>. Copy it. Buy it. Spam it.', btn: '🥫 I COPIED IT', ca: true },
  { v: 'v6', head: '💸 FREE MONEY', body: 'Click below to receive <b>nothing</b> — but you\'ll probably buy $SPAM anyway.', btn: '🤑 GIMME' },
];

function place(el) {
  // random spot, kept off the very edges + away from the fixed marquees
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
    '<div class="spop-tiny">(not real. not financial advice. just buy $SPAM.)</div>';
  layer.appendChild(el);
  place(el);

  // countdown ticker
  const cd = el.querySelector('[data-cd]');
  if (cd) {
    let s = parseInt(cd.textContent.split(':').pop(), 10) || 5;
    const iv = setInterval(() => {
      s = s <= 0 ? Math.ceil(rand(3, 9)) : s - 1; // never actually ends
      cd.textContent = '00:00:0' + Math.min(9, s);
    }, 1000);
    el._iv = iv;
  }

  // closing spawns 1–2 MORE (spam multiplies), plus a respawn later
  const kill = (multiply) => {
    if (el._iv) clearInterval(el._iv);
    el.remove();
    if (multiply) {
      const n = Math.random() < 0.5 ? 2 : 1;
      for (let i = 0; i < n; i++) setTimeout(spawnPopup, rand(120, 500));
    }
  };
  el.querySelector('.spop-x').addEventListener('click', () => { showToast('YOU CAN\'T ESCAPE $SPAM 🥫'); kill(true); });
  el.querySelector('.spop-btn').addEventListener('click', () => { copyCA(); kill(false); setTimeout(spawnPopup, rand(300, 900)); });
  const caEl = el.querySelector('[data-ca]');
  if (caEl) caEl.addEventListener('click', copyCA);
}

// seed a few immediately, then keep the swarm topped up forever
for (let i = 0; i < 3; i++) setTimeout(spawnPopup, 600 + i * 700);
setInterval(() => { if (layer.children.length < MAX_POPUPS) spawnPopup(); }, 1900);

// ===================================================================
//  CORNER "just bought" notifications
// ===================================================================
const notifLayer = document.getElementById('notiflayer');
const NAMES = ['0xW3n', 'degenmike', 'ansem_fan', 'trench_gary', 'soon.sol', 'exit_liquidity', 'pumpchad', 'jeetslayer', 'gm_gn', 'bagholder99', 'wifhat', 'liquidated_larry', 'spamlord', 'notafinancialadvisor'];
const NOTES = [
  (n, a) => `🐋 <b>${n}</b> just bought <b>${a} SOL</b> of $SPAM`,
  (n, a) => `🚀 <b>${n}</b> aped <b>${a} SOL</b> — up only`,
  (n, a) => `🔥 <b>${n}</b> just market-bought <b>${a} SOL</b>`,
  (n) => `💎 <b>${n}</b> set $SPAM as their entire personality`,
  (n, a) => `📈 <b>${n}</b> added <b>${a} SOL</b> to the bag`,
  (n) => `🥫 <b>${n}</b> is spamming the trenches with $SPAM`,
];
function popNotif() {
  if (notifLayer.children.length > 4) return;
  const el = document.createElement('div');
  el.className = 'notif';
  const name = pick(NAMES), amt = (rand(0.3, 42)).toFixed(1);
  el.innerHTML = pick(NOTES)(name, amt);
  notifLayer.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, 4200);
}
setInterval(popNotif, 2600);
setTimeout(popNotif, 1500);

// ===================================================================
//  Scattered stickers (unchanged)
// ===================================================================
const PHRASES = [
  '🚀 1000X', 'BUY NOW!!!', 'DON\'T FADE', 'FREE $SPAM', 'APE IN 🦍', 'LP LOCKED 🔒',
  'MOON 🌙', 'BASED DEV', 'LAST CHANCE', 'NGMI IF U MISS', 'SPAM IT 🥫', '100% SAFU',
  'CLICK HERE 👉', 'HODL 💎', 'PUMP IT 🔥', 'WAGMI', 'DEGEN SZN', 'SEND IT 🚀',
];
const COLORS = ['#ff2e63', '#7c3aed', '#059669', '#2563eb', '#d97706', '#db2777', '#0891b2', '#ca8a04'];
const stickerLayer = document.getElementById('stickers');
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
  stickerLayer.appendChild(s);
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
