// Service worker registration; reloads once when a new version takes over.
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return; // first install: nothing stale to replace
    reloaded = true;
    location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* e.g. insecure context: app still works online */ });
  });
}
