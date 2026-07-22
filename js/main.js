// ===== $COMMUNITY — we hold it up together =====

// Contract address.
const CA = 'Auus1PRGeERF2HzDYx2cN3RFw5EvKu8zq5gZBSLmpump';

const $ = (s) => document.querySelector(s);

// toast helper
const toast = $('#toast');
let toastT;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => toast.classList.remove('show'), 1900);
}

// copy the contract address
$('#caBtn').addEventListener('click', async () => {
  if (!CA) { showToast('Contract drops soon 🤝'); return; }
  try { await navigator.clipboard.writeText(CA); showToast('Contract copied ✓'); }
  catch { showToast(CA); }
});

// "coming soon" links (chart / socials before launch)
document.querySelectorAll('[data-soon]').forEach((a) =>
  a.addEventListener('click', (e) => { e.preventDefault(); showToast('Coming soon 🤝'); })
);

// sticky nav shadow on scroll
const nav = $('#nav');
const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 8);
onScroll();
window.addEventListener('scroll', onScroll, { passive: true });

// mobile menu
const links = $('#navLinks');
$('#navToggle').addEventListener('click', () => links.classList.toggle('open'));
links.addEventListener('click', (e) => { if (e.target.tagName === 'A') links.classList.remove('open'); });

// scroll-reveal
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }
}, { threshold: 0.14, rootMargin: '0px 0px -8% 0px' });
document.querySelectorAll('.reveal').forEach((el) => io.observe(el));

// footer year
const y = $('#year');
if (y) y.textContent = new Date().getFullYear();

// keep the CA pill text in sync if a real CA is set
if (CA) {
  const c = $('#caText');
  if (c) c.textContent = CA;
}
