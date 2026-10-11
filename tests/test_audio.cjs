const assert = require('node:assert/strict');
const test = require('node:test');
const GestureAudio = require('../audio.js');

function runtime(options = {}) {
  const sources = [], levels = [], decodedClips = [];
  class Context {
    constructor() { this.state = 'suspended'; this.destination = {}; }
    resume() { this.state = 'running'; return Promise.resolve(); }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
    decodeAudioData(bytes) {
      assert.equal(bytes.byteLength, 3);
      const clip = new Uint8Array(bytes)[0]; decodedClips.push(clip);
      return Promise.resolve({duration: 1.5, clip});
    }
    createBufferSource() {
      const source = {connect() {}, disconnect() { this.disconnected = true; }, start() { this.started = true; }, stop() { this.stopped = true; }};
      sources.push(source); return source;
    }
    createGain() {
      const gain = {gain: {}, connect() {}, disconnect() { this.disconnected = true; }};
      levels.push(gain); return gain;
    }
  }
  let fetches = 0;
  const audio = new GestureAudio({Context, fetchFile: async url => {
    const clips = {'assets/punch.mp3': 1, 'assets/explode.mp3': 2, 'assets/bgm.mp3': 3, 'assets/sparkle.mp3': 4};
    assert.ok(url in clips, `Unexpected audio URL: ${url}`);
    fetches++; return {ok: true, arrayBuffer: async () => new Uint8Array([clips[url],2,3]).buffer};
  }, ...options});
  return {audio, sources, levels, Context, decodedClips, fetches: () => fetches};
}

test('HATE prepares all three effect clips once and a running audio context', async () => {
  const r = runtime();
  assert.equal(r.audio.play('impact'), false);
  await Promise.all([r.audio.prepare(), r.audio.prepare()]); await r.audio.prepare();
  assert.equal(r.fetches(), 3);
  assert.deepEqual(r.decodedClips.sort(), [1, 2, 4]);
  assert.equal(r.audio.context.state, 'running');
  assert.equal(r.sources.length, 0);
});

test('punch interrupts the quieter crack sound; other effects do not play it', async () => {
  const r = runtime(); await r.audio.prepare();
  assert.equal(r.audio.play('crack'), true);
  assert.equal(r.audio.play('impact'), true);
  assert.equal(r.sources[0].stopped, true);
  assert.ok(r.levels[0].gain.value < r.levels[1].gain.value);
  assert.equal(r.sources[1].started, true);
  assert.equal(r.audio.play('bounce'), false);
  assert.equal(r.sources.length, 2);
  r.audio.stop();
  assert.equal(r.sources[1].stopped, true);
});

test('a missing audio file can be retried', async () => {
  const r = runtime(); const validFetch = r.audio.fetchFile;
  r.audio.fetchFile = async () => ({ok: false});
  await assert.rejects(r.audio.prepare());
  r.audio.fetchFile = validFetch;
  await r.audio.prepare();
  assert.equal(r.audio.play('impact'), true);
});

test('configured music loops quietly and continues through punches', async () => {
  const r = runtime({bgmUrl: 'assets/bgm.mp3'});
  await r.audio.prepare();
  assert.equal(r.fetches(), 4);
  assert.equal(r.audio.startMusic(), true);
  assert.equal(r.sources[0].loop, true);
  assert.ok(r.levels[0].gain.value < .3);
  r.audio.play('impact');
  assert.notEqual(r.sources[0].stopped, true);
  assert.equal(r.sources[1].started, true);
  assert.ok(r.levels[1].gain.value < r.levels[0].gain.value);
  r.audio.stop();
  assert.equal(r.sources[0].stopped, true);
  assert.equal(r.sources[1].stopped, true);
});

test('missing music configuration keeps the current page silent between effects', async () => {
  const r = runtime(); await r.audio.prepare();
  assert.equal(r.audio.startMusic(), false);
  assert.equal(r.fetches(), 3);
});

test('explosion uses its own clip below music volume and leaves music playing', async () => {
  const r = runtime({bgmUrl: 'assets/bgm.mp3'});
  await r.audio.prepare();
  r.audio.startMusic();
  assert.equal(r.audio.play('explode'), true);
  assert.equal(r.sources[1].buffer, r.audio.explosionBuffer);
  assert.notEqual(r.sources[1].buffer, r.audio.buffer);
  assert.ok(r.levels[1].gain.value < r.levels[0].gain.value);
  assert.notEqual(r.sources[0].stopped, true);
  assert.equal(r.sources[1].started, true);
  r.audio.stop();
  assert.equal(r.sources[1].stopped, true);
});

test('heart uses the sparkle clip at quiet effect gain and leaves muted music running', async () => {
  const r = runtime({bgmUrl: 'assets/bgm.mp3'});
  assert.equal(r.audio.play('heart'), false);
  await r.audio.prepare();
  r.audio.startMusic(); r.audio.setMusicMuted(true);
  assert.equal(r.audio.play('heart'), true);
  const music = r.sources[0], heart = r.sources[1];
  assert.equal(heart.buffer.clip, 4);
  assert.equal(heart.buffer, r.audio.heartBuffer);
  assert.notEqual(heart.buffer, r.audio.buffer);
  assert.notEqual(heart.buffer, r.audio.explosionBuffer);
  assert.equal(r.levels[1].gain.value, .07);
  assert.equal(r.levels[0].gain.value, 0);
  assert.equal(heart.started, true);
  assert.notEqual(music.stopped, true);
  r.audio.setMusicMuted(false);
  assert.ok(r.levels[1].gain.value < r.levels[0].gain.value);
  r.audio.stopHits();
  assert.equal(heart.stopped, true);
  assert.equal(r.audio.playing.size, 0);
  assert.notEqual(music.stopped, true);
  heart.onended();
  assert.equal(heart.disconnected, true);
  assert.equal(r.levels[1].disconnected, true);
  r.audio.play('heart'); r.audio.stop();
  assert.equal(r.sources[2].stopped, true);
  assert.equal(music.stopped, true);
});

test('a missing sparkle clip retries without fetching successful effect clips again', async () => {
  const r = runtime(); const validFetch = r.audio.fetchFile;
  let sparkleAttempts = 0;
  r.audio.fetchFile = async url => {
    if (url === 'assets/sparkle.mp3' && ++sparkleAttempts === 1) return {ok: false};
    return validFetch(url);
  };
  await assert.rejects(r.audio.prepare(), /sparkle|heart/i);
  assert.equal(r.audio.play('heart'), false);
  await r.audio.prepare();
  assert.equal(sparkleAttempts, 2);
  assert.equal(r.fetches(), 3);
  assert.equal(r.audio.play('heart'), true);
  assert.equal(r.sources[0].buffer.clip, 4);
});

test('a sparkle decode failure is retried and successful buffers remain cached', async () => {
  const r = runtime(); const decode = r.Context.prototype.decodeAudioData;
  let sparkleDecodes = 0;
  r.Context.prototype.decodeAudioData = function(bytes) {
    if (new Uint8Array(bytes)[0] === 4 && ++sparkleDecodes === 1) return Promise.reject(new Error('Sparkle decode failed'));
    return decode.call(this, bytes);
  };
  await assert.rejects(r.audio.prepare(), /Sparkle decode failed/);
  assert.equal(r.audio.play('heart'), false);
  await r.audio.prepare();
  assert.equal(sparkleDecodes, 2);
  assert.equal(r.fetches(), 4);
  assert.deepEqual(r.decodedClips.sort(), [1, 2, 4]);
  assert.equal(r.audio.play('heart'), true);
});

test('mute and play change only music gain while preserving its position and active effects', async () => {
  const r = runtime({bgmUrl: 'assets/bgm.mp3'});
  await r.audio.prepare();
  r.audio.startMusic(); r.audio.play('impact');
  const music = r.sources[0], impact = r.sources[1], musicGain = r.levels[0];
  assert.equal(r.audio.musicMuted, false);
  r.audio.setMusicMuted(true);
  assert.equal(r.audio.musicMuted, true);
  assert.equal(musicGain.gain.value, 0);
  assert.equal(r.audio.musicSource, music);
  assert.notEqual(music.stopped, true);
  assert.notEqual(impact.stopped, true);
  assert.equal(r.levels[1].gain.value, .07);
  r.audio.setMusicMuted(false);
  assert.equal(r.audio.musicMuted, false);
  assert.equal(musicGain.gain.value, .18);
  assert.equal(r.sources.length, 2);
  assert.equal(r.audio.musicSource, music);
  assert.notEqual(music.stopped, true);
});

test('mute preference survives prepare and full stop, and applies to a later music source', async () => {
  const r = runtime({bgmUrl: 'assets/bgm.mp3'});
  r.audio.setMusicMuted(true);
  await r.audio.prepare(); r.audio.startMusic();
  assert.equal(r.levels[0].gain.value, 0);
  r.audio.stop();
  assert.equal(r.sources[0].stopped, true);
  assert.equal(r.audio.musicSource, null);
  assert.equal(r.audio.musicGain, null);
  assert.equal(r.audio.musicMuted, true);
  await r.audio.prepare(); r.audio.startMusic();
  assert.equal(r.sources.length, 2);
  assert.equal(r.levels[1].gain.value, 0);
  r.audio.setMusicMuted(false);
  assert.equal(r.levels[1].gain.value, .18);
});

test('a stopped music source ending later cannot clear the new source or its gain', async () => {
  const r = runtime({bgmUrl: 'assets/bgm.mp3'});
  await r.audio.prepare(); r.audio.startMusic();
  const oldMusic = r.sources[0];
  r.audio.stop(); r.audio.startMusic();
  const newMusic = r.sources[1], newGain = r.levels[1];
  oldMusic.onended();
  assert.equal(r.audio.musicSource, newMusic);
  assert.equal(r.audio.musicGain, newGain);
  r.audio.setMusicMuted(true);
  assert.equal(newGain.gain.value, 0);
  newMusic.onended();
  assert.equal(r.audio.musicSource, null);
  assert.equal(r.audio.musicGain, null);
});
