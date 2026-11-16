/* Documento offscreen: só toca um bipe local. Nenhum dado é lido ou enviado. */
(() => {
  let context = null;

  function beep() {
    try {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return;
      context = context || new AudioCtor();
      if (context.state === 'suspended') void context.resume();

      const now = context.currentTime;
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
      gain.connect(context.destination);

      const osc = context.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.setValueAtTime(1180, now + 0.12);
      osc.connect(gain);
      osc.start(now);
      osc.stop(now + 0.3);
    } catch {
      /* silêncio */
    }
  }

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message) => {
      if (!message || message.target !== 'offscreen') return false;
      if (message.kind === 'offscreen:beep') beep();
      return false;
    });
  }
})();
