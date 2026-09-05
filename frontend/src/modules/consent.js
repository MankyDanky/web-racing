// Privacy consent banner + gated analytics (#50).
//
// The old game injected @vercel/analytics (third-party JS) on every page load
// with no notice. For GDPR compliance we now:
//   1. Show a consent banner the first time.
//   2. Only load analytics AFTER the user opts in.
//   3. Remember the choice in localStorage.
//
// Analytics loading is opt-in and only happens if VITE_ANALYTICS is enabled at
// build time, so self-hosters get zero third-party JS by default.

const CONSENT_KEY = 'racezAnalyticsConsent';

function analyticsEnabledInBuild() {
  try {
    return import.meta.env && import.meta.env.VITE_ANALYTICS === 'true';
  } catch (e) {
    return false;
  }
}

async function loadAnalytics() {
  if (!analyticsEnabledInBuild()) return;
  try {
    const mod = await import('https://esm.sh/@vercel/analytics');
    if (mod && typeof mod.inject === 'function') mod.inject();
  } catch (e) {
    // Analytics is best-effort; never break the game over it.
  }
}

function showBanner() {
  const banner = document.createElement('div');
  banner.id = 'consent-banner';
  Object.assign(banner.style, {
    position: 'fixed', bottom: '0', left: '0', right: '0', zIndex: '4000',
    background: 'rgba(0,0,0,0.9)', color: '#fff', padding: '14px 20px',
    fontFamily: "'Poppins', sans-serif", fontSize: '14px', display: 'flex',
    alignItems: 'center', justifyContent: 'center', gap: '14px', flexWrap: 'wrap',
  });

  const text = document.createElement('span');
  text.style.maxWidth = '620px';
  text.innerHTML = 'We use privacy-friendly analytics to understand gameplay. ' +
    'We never sell your data. You can decline and still play fully. ' +
    '<a href="#" id="privacy-link" style="color:#4dc9ff;">Privacy note</a>.';

  const accept = document.createElement('button');
  accept.textContent = 'Accept';
  const decline = document.createElement('button');
  decline.textContent = 'Decline';
  [accept, decline].forEach((b, i) => {
    Object.assign(b.style, {
      padding: '8px 20px', borderRadius: '5px', cursor: 'pointer', fontWeight: '700',
      border: 'none', background: i === 0 ? '#ff0080' : '#444', color: '#fff',
    });
  });

  accept.addEventListener('click', () => {
    localStorage.setItem(CONSENT_KEY, 'granted');
    banner.remove();
    loadAnalytics();
  });
  decline.addEventListener('click', () => {
    localStorage.setItem(CONSENT_KEY, 'denied');
    banner.remove();
  });

  banner.appendChild(text);
  banner.appendChild(accept);
  banner.appendChild(decline);
  document.body.appendChild(banner);

  document.getElementById('privacy-link').addEventListener('click', (e) => {
    e.preventDefault();
    alert(
      'Privacy note\n\n' +
      'Racez.io is peer-to-peer: gameplay data (car positions, race progress) ' +
      'is exchanged directly between players and is never stored on our servers. ' +
      'The backend only maps a temporary 6-character party code to a peer id, ' +
      'which expires automatically.\n\n' +
      'If you accept analytics, an anonymous page-view ping is sent to help us ' +
      'improve the game. Declining disables all third-party scripts.'
    );
  });
}

function initConsent() {
  // Nothing to consent to if analytics is compiled out.
  if (!analyticsEnabledInBuild()) return;
  const choice = localStorage.getItem(CONSENT_KEY);
  if (choice === 'granted') { loadAnalytics(); return; }
  if (choice === 'denied') return;
  showBanner();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initConsent);
} else {
  initConsent();
}
