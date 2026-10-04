// Chupi Gualy como app instalable desde el navegador (sin APK, sin Google Play Protect) y sin internet.
// En Android (Chrome/Edge/Samsung Internet) sale «Instalar en este dispositivo»; en iPhone y iPad, cómo añadirla a la pantalla de inicio.
(() => {
  'use strict';
  if (window.Capacitor) return; // dentro de la app de Android no hace falta
  const secure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (secure && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (!/^https?:$/.test(location.protocol)) return; // abierta desde un archivo: no se puede instalar
  const standalone = matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone;
  if (standalone) return;

  const start = document.querySelector('#start .panel');
  if (!start) return;
  const slot = document.getElementById('vrHint') || document.getElementById('playBtn');
  let deferred = null, btn = null, note = null;
  const place = el => { (document.getElementById('vrHint') || document.getElementById('vrBtn') || document.getElementById('playBtn')).insertAdjacentElement('afterend', el); };
  function show() {
    if (btn) return;
    btn = document.createElement('button'); btn.className = 'btn'; btn.id = 'installBtn'; btn.textContent = '📲 Instalar en este dispositivo';
    btn.style.cssText = 'font-size:18px;padding:8px 20px;margin-top:6px';
    btn.addEventListener('click', async () => {
      if (!deferred) return;
      deferred.prompt();
      try { await deferred.userChoice; } catch (e) {}
      deferred = null; btn.remove(); btn = null;
    });
    place(btn);
  }
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; show(); });
  addEventListener('appinstalled', () => { if (btn) { btn.remove(); btn = null; } });
  // iPhone y iPad no avisan: se explica a mano
  if (/iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent)) {
    note = document.createElement('p'); note.className = 'keys'; note.id = 'installNote';
    note.textContent = 'Para tenerla como app: pulsa Compartir y «Añadir a pantalla de inicio».';
    place(note);
  }
})();
