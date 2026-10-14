export function registerAppOffline() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const failed = () => {
    window.dispatchEvent(new CustomEvent('space-offline-error', { detail: 'No se pudo preparar la aplicación para abrirla sin conexión.' }));
  };
  void navigator.serviceWorker.register('/service-worker.js', { scope: '/' }).then(registration => {
    const check = () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => { if (worker.state === 'redundant' && !navigator.serviceWorker.controller) failed(); });
    };
    registration.addEventListener('updatefound', check);
    check();
  }).catch(failed);
}
