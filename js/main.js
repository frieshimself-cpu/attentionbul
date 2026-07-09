// ===== $AdCoin — the coin that advertises itself. half spam, half ads. =====

// No CA yet — the ad slot is reserved. Set this when it drops.
const CA = '2VmGNcGtY5yeNsWQs1ZFDmw3FUpvvSfvDBPjCu6Ppump';
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
  if (!CA) { showToast('📢 SOON™ — the ad slot is reserved, CA dropping shortly 🖱️'); return; }
  try { await navigator.clipboard.writeText(CA); showToast("📋 CA COPIED! now paste it into every group chat. that's an ad. 📢"); }
  catch { showToast('📢 just buy $AdCoin'); }
}
document.getElementById('caCopy').addEventListener('click', copyCA);

const vis = document.getElementById('visnum');
let visN = 400 + Math.floor(Math.random() * 99);
if (vis) setInterval(() => { visN += Math.floor(Math.random() * 7); vis.textContent = '#' + String(visN).padStart(6, '0'); }, 900);

const popup = document.getElementById('popup');
const popupX = document.getElementById('popupX');
function hidePopup() {
  popup.classList.add('hidden');
  setTimeout(() => { popup.classList.remove('hidden'); }, 6000 + Math.random() * 6000);
}
popupX.addEventListener('click', () => { showToast("🚫 you closed the ad but the ad did not close you. buy $AdCoin."); hidePopup(); });
popup.querySelector('.popup-btn').addEventListener('click', (e) => { e.preventDefault(); copyCA(); hidePopup(); });

// ===================================================================
//  AD POPUP SWARM — ads everywhere, and closing one serves more
// ===================================================================
const layer = document.getElementById('popuplayer');
const MAX_POPUPS = 9;
const caBlock = CA
  ? '<span class="spop-ca" data-ca>' + CA + ' 📋</span>'
  : '<span class="spop-ca">CONTRACT: AD SLOT RESERVED — DROPPING SOON 📢</span>';

const TEMPLATES = [
  {
    "head": "🎉 YOU'RE THE 1,000,000th VISITOR!",
    "body": "Our ad targeting selected <b>YOU</b>.<br>Claim your <b>1,000,000 $AdCoin</b> in free ad-credits now.",
    "btn": "CLAIM MY ADS 📢",
    "ca": false,
    "wheel": false,
    "countdown": false,
    "jitter": false,
    "v": "v1"
  },
  {
    "head": "🚨 YOUR CHART HAS NO ADS",
    "body": "Your portfolio is running <b>UNsponsored</b>.<br>This is embarrassing. Fix it immediately.",
    "btn": "SPONSOR ME 📢",
    "ca": false,
    "wheel": false,
    "countdown": false,
    "jitter": true,
    "v": "v2"
  },
  {
    "head": "🍪 THIS SITE USES 999 COOKIES",
    "body": "By staying you agree to be advertised at, forever, by <b>$AdCoin</b>.",
    "btn": "ACCEPT ALL &amp; BUY",
    "ca": false,
    "wheel": false,
    "countdown": false,
    "jitter": false,
    "v": "v3"
  },
  {
    "head": "📩 1 NEW AD IN YOUR INBOX",
    "body": "<b>ser…</b><br>'your wallet qualifies for <b>premium ad placement</b> 👀 act now'",
    "btn": "OPEN AD",
    "ca": false,
    "wheel": false,
    "countdown": false,
    "jitter": false,
    "v": "v4"
  },
  {
    "head": "🪂 FREE AD CREDITS",
    "body": "Paste the CA to claim <b>999,999 $AdCoin ad impressions</b>:<br>Offer expires never (it's an ad).",
    "btn": "CLAIM CREDITS",
    "ca": true,
    "wheel": false,
    "countdown": false,
    "jitter": false,
    "v": "v5"
  },
  {
    "head": "🐋 WHALE ALERT — SOMEONE BOUGHT AD SPACE",
    "body": "<b>0xBanner</b> just bought <b>42 SOL</b> of $AdCoin ad space.<br>Don't let him own the whole billboard.",
    "btn": "OUTBID THE WHALE",
    "ca": false,
    "wheel": false,
    "countdown": false,
    "jitter": false,
    "v": "v6"
  },
  {
    "head": "⏳ YOUR AD SLOT EXPIRES SOON",
    "body": "This premium trending slot resets in:<br>Do NOT lose your placement.",
    "btn": "LOCK MY SLOT",
    "ca": false,
    "wheel": false,
    "countdown": true,
    "jitter": false,
    "v": "v1"
  },
  {
    "head": "🎡 SPIN THE AD-ROULETTE!",
    "body": "Land on <b>TRENDING #1</b> to boost your bags!<br>Everyone's a winner (you're the product).",
    "btn": "SPIN TO ADVERTISE",
    "ca": false,
    "wheel": true,
    "countdown": false,
    "jitter": false,
    "v": "v2"
  },
  {
    "head": "🤖 ARE YOU AN AD-BLOCKER?",
    "body": "Prove you love ads.<br>Select all charts with <b>a $AdCoin banner</b>.",
    "btn": "I ❤️ ADS",
    "ca": false,
    "wheel": false,
    "countdown": false,
    "jitter": true,
    "v": "v3"
  },
  {
    "head": "📉 YOUR COIN ISN'T TRENDING",
    "body": "You are down bad <b>AND</b> off the trending list.<br>Only $AdCoin fixes both.",
    "btn": "BUY TRENDING (APE)",
    "ca": false,
    "wheel": false,
    "countdown": false,
    "jitter": false,
    "v": "v4"
  },
  {
    "head": "👀 3.7 BILLION IMPRESSIONS SERVED",
    "body": "$AdCoin is on every chart, every group, every timeline.<br>Join the ad network or get <b>advertised AT</b>.",
    "btn": "JOIN THE NETWORK",
    "ca": false,
    "wheel": false,
    "countdown": false,
    "jitter": false,
    "v": "v5"
  },
  {
    "head": "📢 OFFICIAL CA — SKIP THIS AD in 5…4…",
    "body": "This is the ONE real $AdCoin. Every other listing is unsponsored spam.<br>Copy responsibly:",
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
    '<div class="spop-tiny">(not real. not financial advice. it is a paid advertisement. do not click.)</div>';
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
  el.querySelector('.spop-x').addEventListener('click', () => { showToast("🚫 you closed the ad but the ad did not close you. buy $AdCoin."); kill(true); });
  el.querySelector('.spop-btn').addEventListener('click', () => { copyCA(); kill(false); setTimeout(spawnPopup, rand(300, 900)); });
  const caEl = el.querySelector('[data-ca]');
  if (caEl) caEl.addEventListener('click', copyCA);
}

for (let i = 0; i < 3; i++) setTimeout(spawnPopup, 600 + i * 700);
setInterval(() => { if (layer.children.length < MAX_POPUPS) spawnPopup(); }, 1900);

// ===================================================================
//  CORNER "just bought ad space" notifications
// ===================================================================
const notifLayer = document.getElementById('notiflayer');
const NAMES = ["0xBanner", "cpm_chad", "trending_tina", "popup_pete", "sponsored_sam", "dexscreener_dan", "impression_ian", "clickbait_carl", "adsense_amy", "billboard_bob", "skip_ad_steve", "native_ad_nina", "retarget_rick", "pixel_pat", "sponsored.sol", "adblock_andy"];
const NOTE_TEMPLATES = ["📢 <b>{n}</b> just bought <b>{a} SOL</b> of ad space", "📈 <b>{n}</b> boosted $AdCoin to trending with <b>{a} SOL</b>", "🖱️ <b>{n}</b> clicked the ad and aped <b>{a} SOL</b>", "💸 <b>{n}</b> bought a <b>{a} SOL</b> Dexscreener banner", "🚀 <b>{n}</b> paid <b>{a} SOL</b> to skip the ad (bought instead)", "📺 <b>{n}</b> just went full-screen with <b>{a} SOL</b>", "🔁 <b>{n}</b> retargeted <b>{a} SOL</b> back into $AdCoin", "⭐ <b>{n}</b> sponsored the trenches (+{a} SOL)"];
function popNotif() {
  if (notifLayer.children.length > 4) return;
  const el = document.createElement('div');
  el.className = 'notif';
  const name = pick(NAMES), amt = (rand(0.3, 42)).toFixed(1);
  el.innerHTML = pick(NOTE_TEMPLATES).replaceAll('{n}', name).replaceAll('{a}', amt);
  notifLayer.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, 4200);
}
setInterval(popNotif, 2600);
setTimeout(popNotif, 1500);

// ===================================================================
//  Scattered ad stickers
// ===================================================================
const PHRASES = ["YOUR AD HERE", "SPONSORED 📢", "CLICK HERE 👆", "AS SEEN ON EVERY CHART", "50% SPAM 50% ADS", "TRENDING #1", "SKIP AD ▶", "BUY = IMPRESSIONS", "NOW ON DEXSCREENER", "AD-FUNDED PUMP", "1000X CPM", "NO AD-BLOCK 🚫", "POP-UP APPROVED", "BANNER SZN", "LIMITED AD SLOTS", "GET ADVERTISED AT", "DOUBLE YOUR REACH", "SPONSORED BY YOU", "ADS = LIQUIDITY", "MORE ADS 📢"];
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

// Confetti: ads raining down
const EMOJI = ["📢", "📣", "📈", "💸", "🖱️", "⭐", "🔥", "💰", "📺", "🪧", "✨"];
function drop() {
  const e = document.createElement('div');
  e.textContent = pick(EMOJI);
  e.style.cssText = 'position:fixed;z-index:50;top:-40px;pointer-events:none;font-size:' + rand(18, 34).toFixed(0) + 'px;left:' + rand(0, 100) + 'vw;transition:transform 5s linear,opacity 5s;';
  document.body.appendChild(e);
  requestAnimationFrame(() => { e.style.transform = 'translateY(110vh) rotate(' + rand(-360, 360) + 'deg)'; e.style.opacity = '0'; });
  setTimeout(() => e.remove(), 5200);
}
setInterval(drop, 450);

const base = document.title;
let flip = false;
setInterval(() => { document.title = (flip = !flip) ? "📢 (1) NEW AD — BUY $AdCoin NOW 🖱️" : base; }, 900);
