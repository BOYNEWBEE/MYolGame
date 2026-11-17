// 游戏和试听共用的内置配乐。霓虹打砖块还可启用独立音效。
export const SOUND_CONTROLS_STYLE = `
  .sound-controls { display: flex; flex: none; align-items: center; gap: 6px; }
  .sound-controls button {
    min-height: 44px; padding: 0 10px; border-radius: 8px; cursor: pointer;
    font-family: inherit; font-size: 12px; font-weight: 600;
    border: 1px solid var(--sound-border); color: var(--sound-text); background: var(--sound-panel);
  }
  .sound-controls button[aria-pressed="true"] { color: var(--sound-bg); background: var(--sound-accent); }
  .sound-controls button:disabled { cursor: default; opacity: 0.65; }
  .sound-controls button:focus-visible { outline: 2px solid var(--sound-accent); outline-offset: 2px; }
`;

export function soundControls(music: boolean, effects: boolean, preview = false): string {
  return `<div class="sound-controls" role="group" aria-label="${preview ? '配乐试听' : '游戏声音'}">
    <button type="button" id="sound-enable">${preview ? '试听配乐' : '开启声音'}</button>
    ${music ? `<button type="button" id="sound-music" aria-pressed="false" hidden>${preview ? '试听配乐' : '音乐'}</button>` : ''}
    ${effects ? '<button type="button" id="sound-effects" aria-pressed="false" hidden>音效</button>' : ''}
  </div>`;
}

export const ARCADE_AUDIO_SCRIPT = `
  function createArcadeAudio(trackId, rawStyle) {
    const style = Object.assign({
      bpm: 120, progression: 'minor', transpose: 0,
      leadWave: 'triangle', bassWave: 'triangle', kickWave: 'sine',
      density: 1, swing: 0, octave: 0, seed: 1
    }, rawStyle || {});
    const enable = document.getElementById('sound-enable');
    const musicButton = document.getElementById('sound-music');
    const effectsButton = document.getElementById('sound-effects');
    const track = trackId ? document.getElementById(trackId) : null;
    const Audio = window.AudioContext || window.webkitAudioContext;
    const OfflineAudio = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const bandEdges = [35, 100, 125, 155, 185, 225, 275, 335, 405, 490, 590, 725, 895, 1200];
    const bands = new Uint8Array(bandEdges.length - 1);
    let context, effectsGain, musicBuffer, musicSource, musicGain, musicAnalyser, mediaSource, frequencyData;
    let musicOn = false, effectsOn = false;

    if (track) {
      track.addEventListener('error', function () {
        musicOn = false;
        if (musicButton) {
          musicButton.disabled = true;
          musicButton.setAttribute('aria-pressed', 'false');
          musicButton.textContent = 'AI 配乐不可用';
        }
      });
    }

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
      const chords = {
        minor: [[45, 57, 60, 64, 67], [41, 57, 60, 65, 69], [48, 55, 60, 64, 67], [43, 55, 59, 62, 67]],
        major: [[48, 60, 64, 67, 72], [43, 55, 59, 62, 67], [45, 57, 61, 64, 69], [41, 53, 57, 60, 65]],
        dorian: [[45, 57, 60, 64, 67], [48, 60, 64, 67, 72], [43, 55, 59, 62, 67], [41, 53, 57, 60, 65]],
        suspended: [[45, 57, 62, 64, 67], [43, 55, 60, 62, 67], [48, 60, 65, 67, 72], [41, 53, 58, 60, 65]]
      };
      const progression = chords[style.progression] || chords.minor;
      const phrases = [
        [null, 1, 2, null, 3, 2, null, 4],
        [3, null, 2, 1, null, 2, 1, null],
        [1, 2, null, 4, 3, null, 2, 3],
        [4, null, 3, 2, 1, null, null, 2]
      ];
      const hz = function (note) { return 440 * Math.pow(2, (note - 69) / 12); };
      const stepDur = 30 / style.bpm;
      const barDur = stepDur * 8;
      const bars = 16;
      const engine = new OfflineAudio(1, Math.ceil(bars * barDur * rate), rate);
      const out = engine.destination;
      let randomState = (style.seed * 2654435761) >>> 0;
      function random() {
        randomState = (randomState * 1664525 + 1013904223) >>> 0;
        return randomState / 4294967296;
      }
      for (let bar = 0; bar < bars; bar++) {
        const chord = progression[bar % progression.length];
        const phrase = phrases[(bar + Math.floor(bar / 4)) % phrases.length];
        for (let s = 0; s < 8; s++) {
          const at = bar * barDur + s * stepDur + (s % 2 === 1 ? style.swing * stepDur : 0);
          if (s % 2 === 0) {
            tone(engine, out, at, 0.18, style.kickWave, 105, 40, 0.14);
            const bass = hz(chord[0] + style.transpose + (s === 6 ? 12 : 0));
            tone(engine, out, at + 0.035, 0.29, style.bassWave, bass, bass, 0.15);
          }
          if (phrase[s] !== null && (style.density >= 1 || s === 0 || random() < style.density)) {
            const lead = hz(chord[phrase[s]] + style.transpose + style.octave * 12 + (bar >= 8 ? 12 : 0));
            tone(engine, out, at, 0.19, style.leadWave, lead, lead, 0.095);
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
        if (track && !track.paused) track.pause();
        if (musicSource) {
          musicSource.stop();
          musicSource.disconnect();
          musicSource = null;
        }
        return;
      }
      if (track) {
        if (!mediaSource) {
          mediaSource = context.createMediaElementSource(track);
          musicGain = context.createGain();
          musicGain.gain.value = 0.48;
          mediaSource.connect(musicGain);
          musicGain.connect(musicAnalyser);
        }
        if (track.paused) {
          const playing = track.play();
          if (playing && playing.catch) playing.catch(function () {});
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
        gain.connect(musicAnalyser);
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
          if (effectsButton) {
            effectsGain = context.createGain();
            effectsGain.connect(context.destination);
          }
          if (musicButton) {
            musicAnalyser = context.createAnalyser();
            musicAnalyser.fftSize = 2048;
            musicAnalyser.minDecibels = -84;
            musicAnalyser.maxDecibels = -33;
            musicAnalyser.smoothingTimeConstant = 0.66;
            musicAnalyser.connect(context.destination);
            frequencyData = new Uint8Array(musicAnalyser.frequencyBinCount);
          }
          context.addEventListener('statechange', syncMusic);
          document.addEventListener('visibilitychange', syncMusic);
        }
        await context.resume();
        musicOn = Boolean(musicButton && (track || OfflineAudio));
        effectsOn = Boolean(effectsButton);
        if (musicButton) {
          musicButton.disabled = !musicOn;
          if (!musicOn) musicButton.textContent = '音乐不可用';
          musicButton.setAttribute('aria-pressed', String(musicOn));
          musicButton.hidden = false;
        }
        if (effectsButton) {
          effectsButton.setAttribute('aria-pressed', 'true');
          effectsButton.hidden = false;
        }
        enable.hidden = true;
        (musicOn ? musicButton : effectsButton)?.focus();
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
    musicButton?.addEventListener('click', function () {
      musicOn = !musicOn;
      musicButton.setAttribute('aria-pressed', String(musicOn));
      syncMusic();
    });
    effectsButton?.addEventListener('click', function () {
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
    function playEffect(name) {
      if (!effectsOn || document.hidden || context.state !== 'running') return;
      const at = context.currentTime;
      for (const [delay, length, wave, from, to, volume] of sounds[name]) {
        tone(context, effectsGain, at + delay, length, wave, from, to, volume);
      }
    }

    function readMusicBands() {
      if (!musicAnalyser || (!musicSource && (!track || track.paused)) || !canPlayMusic()) return null;
      musicAnalyser.getByteFrequencyData(frequencyData);
      const binWidth = context.sampleRate / musicAnalyser.fftSize;
      for (let band = 0; band < bands.length; band++) {
        const first = Math.ceil(bandEdges[band] / binWidth);
        const end = Math.max(first + 1, Math.ceil(bandEdges[band + 1] / binWidth));
        let peak = 0;
        for (let bin = first; bin < end; bin++) {
          peak = Math.max(peak, frequencyData[bin]);
        }
        bands[band] = peak;
      }
      return bands;
    }

    return { playEffect, readMusicBands, bandCount: bands.length };
  }
`;

export const MUSIC_PREVIEW_HTML = `<!doctype html>
<html lang="zh-CN">
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'">
<title>霓虹街机配乐试听</title>
<style>
  body {
    --sound-bg: #0b1023; --sound-panel: #171d39; --sound-text: #eaf6ff;
    --sound-accent: #6ee7ff; --sound-border: #6ee7ff66;
    display: flex; align-items: center; gap: 12px;
    height: 60px; margin: 0; padding: 0 8px;
    background: var(--sound-bg); font-family: system-ui, sans-serif;
  }
  canvas { display: block; width: 100%; min-width: 0; height: 36px; }
  ${SOUND_CONTROLS_STYLE}
  #sound-music[aria-pressed="true"]::after { content: ' · 播放中'; }
</style>
<body>
${soundControls(true, false, true)}
<canvas width="260" height="36" aria-hidden="true"></canvas>
<script>
${ARCADE_AUDIO_SCRIPT}
const preview = createArcadeAudio();
const canvas = document.querySelector('canvas');
const ctx = canvas.getContext('2d');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
function draw() {
  const levels = reduceMotion.matches ? null : preview.readMusicBands();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < preview.bandCount; i++) {
    const level = levels ? levels[i] / 255 : 0;
    const height = 3 + 33 * level * level;
    ctx.fillStyle = i % 2 ? '#ff76db' : '#6ee7ff';
    ctx.fillRect(i * 20, canvas.height - height, 14, height);
  }
  requestAnimationFrame(draw);
}
draw();
</script>
</body>
</html>`;
