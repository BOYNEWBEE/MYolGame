// 霓虹打砖块的内置配乐和音效，生成后随单文件 HTML 一同运行。
export const BREAKOUT_AUDIO_SCRIPT = `
  function createArcadeAudio() {
    const enable = document.getElementById('sound-enable');
    const musicButton = document.getElementById('sound-music');
    const effectsButton = document.getElementById('sound-effects');
    const Audio = window.AudioContext || window.webkitAudioContext;
    const OfflineAudio = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    let context, effectsGain, musicBuffer, musicSource;
    let musicOn = false, effectsOn = false;

    function tone(engine, output, at, length, wave, from, to, volume) {
      const oscillator = engine.createOscillator();
      const envelope = engine.createGain();
      oscillator.type = wave;
      oscillator.frequency.setValueAtTime(from, at);
      oscillator.frequency.exponentialRampToValueAtTime(to, at + length);
      envelope.gain.setValueAtTime(0, at);
      envelope.gain.linearRampToValueAtTime(volume, at + 0.006);
      envelope.gain.exponentialRampToValueAtTime(0.001, at + length - 0.008);
      envelope.gain.linearRampToValueAtTime(0, at + length);
      oscillator.connect(envelope);
      envelope.connect(output);
      oscillator.onended = function () {
        oscillator.disconnect();
        envelope.disconnect();
      };
      oscillator.start(at);
      oscillator.stop(at + length);
    }

    function renderLoop() {
      const rate = context.sampleRate;
      const engine = new OfflineAudio(1, 32 * rate, rate);
      const out = engine.destination;
      const chords = [
        [45, 57, 60, 64, 67], [41, 57, 60, 65, 69],
        [48, 55, 60, 64, 67], [43, 55, 59, 62, 67]
      ];
      const phrases = [
        [null, 1, 2, null, 3, 2, null, 4],
        [3, null, 2, 1, null, 2, 1, null],
        [1, 2, null, 4, 3, null, 2, 3],
        [4, null, 3, 2, 1, null, null, 2]
      ];
      const hz = function (note) { return 440 * Math.pow(2, (note - 69) / 12); };
      for (let bar = 0; bar < 16; bar++) {
        const chord = chords[bar % chords.length];
        const phrase = phrases[(bar + Math.floor(bar / 4)) % phrases.length];
        for (let step = 0; step < 8; step++) {
          const at = bar * 2 + step / 4;
          if (step % 2 === 0) {
            tone(engine, out, at, 0.18, 'sine', 105, 40, 0.14);
            const bass = hz(chord[0] + (step === 6 ? 12 : 0));
            tone(engine, out, at + 0.035, 0.29, 'triangle', bass, bass, 0.15);
          }
          if (phrase[step] !== null) {
            const lead = hz(chord[phrase[step]] + (bar >= 8 ? 12 : 0));
            tone(engine, out, at, 0.19, 'triangle', lead, lead, 0.095);
            tone(engine, out, at + 0.125, 0.105, 'sine', lead, lead, 0.024);
          }
        }
      }
      return engine.startRendering();
    }

    function canPlayMusic() {
      return musicOn && !document.hidden && context.state === 'running';
    }

    function syncMusic() {
      if (!canPlayMusic()) {
        if (musicSource) {
          musicSource.stop();
          musicSource.disconnect();
          musicSource = null;
        }
        return;
      }
      if (musicSource) return;
      musicBuffer ??= Promise.resolve().then(renderLoop).catch(function () {
        musicOn = false;
        musicButton.disabled = true;
        musicButton.setAttribute('aria-pressed', 'false');
        musicButton.textContent = '音乐不可用';
        return null;
      });
      void musicBuffer.then(function (buffer) {
        if (!buffer || !canPlayMusic() || musicSource) return;
        const gain = context.createGain();
        gain.gain.value = 0.48;
        gain.connect(context.destination);
        musicSource = context.createBufferSource();
        musicSource.buffer = buffer;
        musicSource.loop = true;
        musicSource.connect(gain);
        musicSource.onended = function () { gain.disconnect(); };
        musicSource.start();
      });
    }

    enable.addEventListener('click', async function () {
      enable.disabled = true;
      try {
        if (!context) {
          context = new Audio();
          effectsGain = context.createGain();
          effectsGain.connect(context.destination);
          context.addEventListener('statechange', syncMusic);
          document.addEventListener('visibilitychange', syncMusic);
        }
        await context.resume();
        musicOn = Boolean(OfflineAudio);
        effectsOn = true;
        musicButton.disabled = !musicOn;
        if (!musicOn) musicButton.textContent = '音乐不可用';
        musicButton.setAttribute('aria-pressed', String(musicOn));
        effectsButton.setAttribute('aria-pressed', 'true');
        enable.hidden = true;
        musicButton.hidden = false;
        effectsButton.hidden = false;
        (musicOn ? musicButton : effectsButton).focus();
        syncMusic();
      } catch {
        enable.textContent = '重试开启声音';
        enable.disabled = false;
      }
    });

    if (!Audio) {
      enable.textContent = '声音不可用';
      enable.disabled = true;
    }
    musicButton.addEventListener('click', function () {
      musicOn = !musicOn;
      musicButton.setAttribute('aria-pressed', String(musicOn));
      syncMusic();
    });
    effectsButton.addEventListener('click', function () {
      effectsOn = !effectsOn;
      effectsGain.gain.value = effectsOn ? 1 : 0;
      effectsButton.setAttribute('aria-pressed', String(effectsOn));
    });

    const sounds = {
      launch: [[0, 0.11, 'triangle', 330, 650, 0.11]],
      paddle: [[0, 0.075, 'sine', 260, 390, 0.085]],
      crack: [[0, 0.09, 'triangle', 560, 290, 0.12]],
      brick: [[0, 0.11, 'triangle', 640, 960, 0.12], [0.05, 0.11, 'sine', 960, 1280, 0.07]],
      drop: [[0, 0.24, 'triangle', 410, 95, 0.16]],
      level: [
        [0, 0.14, 'triangle', 523, 523, 0.13], [0.12, 0.14, 'triangle', 659, 659, 0.13],
        [0.24, 0.14, 'triangle', 784, 784, 0.13], [0.36, 0.27, 'triangle', 1047, 1047, 0.15]
      ]
    };
    return function playEffect(name) {
      if (!effectsOn || document.hidden || context.state !== 'running') return;
      const at = context.currentTime;
      for (const [delay, length, wave, from, to, volume] of sounds[name]) {
        tone(context, effectsGain, at + delay, length, wave, from, to, volume);
      }
    };
  }
`;
