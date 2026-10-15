(() => {
  if (window.__SN_SCANNER_REDIRECTING__ || !window.location.hash) return;

  Object.defineProperty(window, '__SN_SCANNER_BOOTSTRAP_HASH__', {
    value: window.location.hash,
    writable: true,
    configurable: true,
  });
  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}${window.location.search}`,
  );
})();
