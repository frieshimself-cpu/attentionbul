// ===== $BULLPOST site interactions =====

// Copy contract address
const caCopy = document.getElementById('caCopy');
const caText = document.getElementById('caText');
const toast = document.getElementById('toast');
let toastTimer;

caCopy.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(caText.textContent.trim());
    showToast('CA copied! 🐂');
  } catch {
    showToast('Copy failed — long-press the address');
  }
});

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
}

// Legend wallet copy buttons
document.querySelectorAll('.lw-copy').forEach((btn) =>
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(btn.dataset.wallet);
      showToast(`${btn.dataset.name}'s wallet copied! 🐋`);
    } catch {
      showToast('Copy failed — use the ↗ link instead');
    }
  })
);

// Mobile nav
const burger = document.getElementById('navBurger');
const navLinks = document.getElementById('navLinks');

burger.addEventListener('click', () => {
  const open = navLinks.classList.toggle('open');
  burger.setAttribute('aria-expanded', open);
});

navLinks.querySelectorAll('a').forEach((a) =>
  a.addEventListener('click', () => {
    navLinks.classList.remove('open');
    burger.setAttribute('aria-expanded', 'false');
  })
);

// Reveal on scroll
const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('in');
        observer.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.12 }
);

document.querySelectorAll('.reveal').forEach((el) => observer.observe(el));
