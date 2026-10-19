// ============================================================
// BVLOG — PWA INSTALL + OFFLINE SUPPORT
// ============================================================

let deferredPwaInstallPrompt = null;

function isPwaInstalled() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

function canInstallPwa() {
  return Boolean(deferredPwaInstallPrompt) && !isPwaInstalled();
}

async function installPwa() {
  if (deferredPwaInstallPrompt) {
    deferredPwaInstallPrompt.prompt();
    const choice = await deferredPwaInstallPrompt.userChoice;
    deferredPwaInstallPrompt = null;
    window.dispatchEvent(new CustomEvent('bvlog-pwa-install-state-changed', {
      detail: { accepted: choice.outcome === 'accepted' },
    }));
    return choice.outcome === 'accepted';
  }

  alert(
    'To install BVlog: on iPhone or iPad, open this site in Safari, tap Share, then Add to Home Screen. On a computer or Android device, use the browser menu and choose Install or Add to Home Screen.',
  );
  return false;
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredPwaInstallPrompt = event;
  window.dispatchEvent(new CustomEvent('bvlog-pwa-install-available'));
});

window.addEventListener('appinstalled', () => {
  deferredPwaInstallPrompt = null;
  window.dispatchEvent(new CustomEvent('bvlog-pwa-install-state-changed', {
    detail: { accepted: true },
  }));
});

if ('serviceWorker' in navigator && window.location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js', { scope: './' })
      .catch((error) => console.warn('BVlog service worker registration failed:', error));
  });
}
