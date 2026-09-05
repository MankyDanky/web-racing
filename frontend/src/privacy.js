// Analytics are third-party telemetry: they only load after explicit,
// remembered consent (GDPR-friendly). Replaces the old unconditional
// inject() snippet in index.html / game.html.

const KEY = 'racez.analytics-consent';

function consentState() {
  try { return localStorage.getItem(KEY); } catch (e) { return null; }
}

async function loadAnalytics() {
  try {
    const { inject } = await import('@vercel/analytics');
    inject();
  } catch (e) {
    console.warn('Analytics unavailable', e);
  }
}

export function initPrivacy() {
  if (consentState() === 'yes') { loadAnalytics(); return; }
  if (consentState() === 'no') return;

  const bar = document.createElement('div');
  Object.assign(bar.style, {
    position: 'fixed', bottom: '12px', left: '50%', transform: 'translateX(-50%)',
    zIndex: 3000, background: 'rgba(10,12,20,0.92)', color: '#e8ecff',
    borderRadius: '12px', padding: '12px 16px', display: 'flex', gap: '12px',
    alignItems: 'center', fontFamily: "'Exo 2', sans-serif", fontSize: '13px',
    boxShadow: '0 8px 30px rgba(0,0,0,0.6)', maxWidth: '90vw',
  });
  const text = document.createElement('span');
  text.textContent = 'This site can use anonymous usage analytics. Allow?';
  const yes = document.createElement('button');
  yes.id = 'privacy-yes';
  yes.textContent = 'Allow';
  const no = document.createElement('button');
  no.id = 'privacy-no';
  no.textContent = 'No thanks';
  for (const b of [yes, no]) {
    b.style.cssText = 'padding:6px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.3);background:rgba(255,255,255,.12);color:#fff;cursor:pointer;';
  }
  yes.addEventListener('click', () => {
    try { localStorage.setItem(KEY, 'yes'); } catch (e) { /* ignore */ }
    bar.remove();
    loadAnalytics();
  });
  no.addEventListener('click', () => {
    try { localStorage.setItem(KEY, 'no'); } catch (e) { /* ignore */ }
    bar.remove();
  });
  bar.append(text, yes, no);
  document.body.appendChild(bar);
}

initPrivacy();
