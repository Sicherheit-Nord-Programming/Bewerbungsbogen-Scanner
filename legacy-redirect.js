(() => {
  const legacyHosts = new Set([
    'sicherheit-nord-programming.github.io',
    'sicherheit-nord-ausweisscan.firebaseapp.com',
  ]);
  const firebaseUrl = 'https://sicherheit-nord-ausweisscan.web.app/';

  if (!legacyHosts.has(window.location.hostname.toLowerCase())) {
    return;
  }

  window.__SN_SCANNER_REDIRECTING__ = true;
  const destination = new URL(firebaseUrl);
  destination.search = window.location.search;
  destination.hash = window.location.hash;
  window.location.replace(destination.href);
})();
