const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../video-background.js'), 'utf8');
const CLIP = 'assets/palm-background.mp4';

function runtime({playError = null, playWithoutPromise = false, synchronousPlayError = null} = {}) {
  const timers = new Map(), videos = [], states = [], errors = [], creations = [];
  let nextTimer = 0;
  class Element {
    constructor(tagName) {
      this.tagName = tagName.toUpperCase(); this.children = []; this.listeners = new Map();
      this.hidden = false; this.attributes = new Map(); this.commands = [];
      this.muted = true; this.volume = 0; this.src = ''; this.readyState = 0;
    }
    replaceChildren(...children) {
      this.children.forEach(child => { child.parentNode = null; });
      this.children = children; children.forEach(child => { child.parentNode = this; });
    }
    addEventListener(name, callback) { this.listeners.set(name, [...(this.listeners.get(name) || []), callback]); }
    removeEventListener(name, callback) { this.listeners.set(name, (this.listeners.get(name) || []).filter(fn => fn !== callback)); }
    emit(name) { (this.listeners.get(name) || []).slice().forEach(fn => fn({target: this})); }
    setAttribute(name, value) { this.attributes.set(name, value); }
    removeAttribute(name) { this.attributes.delete(name); if (name === 'src') this.src = ''; }
    load() { this.commands.push('load'); }
    play() {
      this.commands.push('play');
      if (synchronousPlayError) throw synchronousPlayError;
      if (playError) return Promise.reject(playError);
      if (playWithoutPromise) return;
      return new Promise((resolve, reject) => { this.resolvePlay = resolve; this.rejectPlay = reject; });
    }
    pause() { this.commands.push('pause'); this.emit('pause'); }
  }
  const host = new Element('div'); host.hidden = true;
  const document = {createElement: name => {
    creations.push(name); const element = new Element(name);
    if (name === 'video') videos.push(element); return element;
  }};
  const window = {
    document,
    setTimeout: (fn, delay) => { const id = ++nextTimer; timers.set(id, {fn, delay}); return id; },
    clearTimeout: id => timers.delete(id),
  };
  vm.runInNewContext(source, {window});
  const video = new window.GestureVideo({host, onState: state => states.push(state), onError: message => errors.push(message)});
  return {
    host, video, videos, states, errors, creations, timers,
    async flush() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); },
    expire() { const current = [...timers.values()]; timers.clear(); current.forEach(timer => timer.fn()); },
  };
}

test('constructing the local video helper creates no media or external API request', () => {
  const r = runtime(); assert.deepEqual(r.creations, []);
  assert.equal(r.video.running, false); assert.equal(r.host.hidden, true);
});

test('a palm starts the local clip audibly with native controls, inline playback and looping', async () => {
  const r = runtime(), pending = r.video.start(CLIP);
  assert.equal(r.video.running, true); assert.equal(r.host.hidden, false);
  assert.deepEqual(r.creations, ['video']); const clip = r.videos[0];
  assert.equal(clip.src, CLIP); assert.equal(clip.muted, false); assert.equal(clip.volume, 1);
  assert.equal(clip.loop, true); assert.equal(clip.playsInline, true); assert.equal(clip.controls, true);
  assert.equal(clip.preload, 'auto'); assert.equal(clip.autoplay, false);
  assert.deepEqual(clip.commands, ['load', 'play']);
  clip.resolvePlay(); await r.flush(); assert.equal(await pending, true);
  assert.equal(r.states.at(-1), 'playing'); assert.equal(r.timers.size, 0); r.video.stop();
});

test('media readiness and playback events report state while keeping the player active', async () => {
  const r = runtime(), pending = r.video.start(CLIP), clip = r.videos[0];
  clip.emit('canplay'); assert.equal(await pending, true); assert.equal(r.states.at(-1), 'ready');
  clip.emit('playing'); assert.equal(r.states.at(-1), 'playing');
  clip.emit('waiting'); assert.equal(r.states.at(-1), 'buffering');
  clip.emit('pause'); assert.equal(r.states.at(-1), 'paused');
  clip.emit('ended'); assert.equal(r.states.at(-1), 'ended'); assert.equal(r.video.running, true);
  clip.resolvePlay(); await r.flush(); r.video.stop();
});

test('autoplay denial keeps audible native controls and provides a play button prompt', async () => {
  const r = runtime({playError: {name: 'NotAllowedError'}}), pending = r.video.start(CLIP);
  await r.flush(); assert.equal(await pending, true);
  assert.equal(r.video.running, true); assert.equal(r.host.hidden, false);
  assert.equal(r.videos[0].controls, true); assert.equal(r.videos[0].muted, false);
  assert.equal(r.states.at(-1), 'blocked'); assert.match(r.errors[0], /영상의 재생 버튼/);
  assert.equal(r.states.includes('error'), false);
  r.expire(); assert.equal(r.video.running, true);
  r.videos[0].emit('canplay'); assert.equal(r.states.at(-1), 'blocked');
  r.videos[0].emit('playing'); assert.equal(r.states.at(-1), 'playing'); r.video.stop();
});

test('a synchronous autoplay denial also keeps the native controls available', async () => {
  const r = runtime({synchronousPlayError: {name: 'NotAllowedError'}});
  const pending = r.video.start(CLIP); assert.equal(await pending, true);
  assert.equal(r.states.at(-1), 'blocked'); assert.equal(r.host.hidden, false); r.video.stop();
});

test('stop settles pending play and releases media without delayed events altering state', async () => {
  const r = runtime(), pending = r.video.start(CLIP), clip = r.videos[0];
  const captured = [...clip.listeners.values()].flat(); r.video.stop();
  assert.equal(await pending, false); assert.equal(r.video.running, false); assert.equal(r.host.hidden, true);
  assert.equal(r.host.children.length, 0); assert.equal(clip.src, '');
  assert.deepEqual(clip.commands, ['load', 'play', 'pause', 'load']);
  const stateCount = r.states.length;
  captured.forEach(handler => handler({target: clip})); clip.resolvePlay(); await r.flush();
  assert.equal(r.states.length, stateCount); assert.deepEqual(r.errors, []);
});

test('a rejected old play promise cannot affect a restarted clip', async () => {
  const r = runtime(), old = r.video.start(CLIP), oldClip = r.videos[0];
  r.video.stop(); assert.equal(await old, false);
  const pending = r.video.start('assets/another.mp4'), clip = r.videos[1];
  oldClip.rejectPlay({name: 'NotAllowedError'}); await r.flush();
  assert.deepEqual(r.errors, []); assert.equal(r.states.at(-1), 'loading');
  clip.resolvePlay(); await r.flush(); assert.equal(await pending, true);
  assert.equal(r.states.at(-1), 'playing'); r.video.stop();
});

test('an active source reuses its request and a changed source releases the previous media', async () => {
  const r = runtime(), first = r.video.start(CLIP);
  assert.equal(r.video.start(CLIP), first); assert.equal(r.videos.length, 1);
  r.videos[0].resolvePlay(); await r.flush(); assert.equal(await first, true);
  assert.equal(await r.video.start(CLIP), true); assert.equal(r.videos.length, 1);
  const second = r.video.start('assets/another.mp4');
  assert.equal(r.videos[0].src, ''); assert.equal(r.videos[0].commands.includes('pause'), true);
  assert.equal(r.videos.length, 2); r.videos[1].resolvePlay(); await r.flush();
  assert.equal(await second, true); r.video.stop();
});

test('a media loading timeout releases the clip and permits a fresh retry', async () => {
  const r = runtime(), first = r.video.start(CLIP), oldClip = r.videos[0]; r.expire();
  assert.equal(await first, false); assert.match(r.errors[0], /시간|응답/);
  assert.equal(r.video.running, false); assert.equal(r.host.hidden, true); assert.equal(oldClip.src, '');
  const retry = r.video.start(CLIP), clip = r.videos[1];
  oldClip.resolvePlay(); await r.flush(); assert.equal(r.states.at(-1), 'loading');
  clip.resolvePlay(); await r.flush(); assert.equal(await retry, true); r.video.stop();
});

test('native file and decoding failures provide Korean reasons and allow retry', async t => {
  for (const [code, message] of [[1, /중단/], [2, /불러오지|연결/], [3, /해석|재생/], [4, /지원|재생/]]) {
    await t.test(`MediaError ${code}`, async () => {
      const r = runtime(), first = r.video.start(CLIP), clip = r.videos[0];
      clip.error = {code}; clip.emit('error'); assert.equal(await first, false);
      assert.match(r.errors[0], message); assert.equal(r.video.running, false);
      assert.equal(r.host.hidden, true); assert.equal(r.states.at(-1), 'error');
      const retry = r.video.start(CLIP), newClip = r.videos[1];
      newClip.resolvePlay(); await r.flush(); assert.equal(await retry, true); r.video.stop();
    });
  }
});

test('a late decode failure closes media after a successful start', async () => {
  const r = runtime(), pending = r.video.start(CLIP), clip = r.videos[0];
  clip.resolvePlay(); await r.flush(); assert.equal(await pending, true);
  clip.error = {code: 3}; clip.emit('error'); assert.equal(r.video.running, false);
  assert.equal(r.states.at(-1), 'error'); assert.equal(r.host.children.length, 0);
});

test('a native pause abort stays active instead of reporting a load failure', async () => {
  const r = runtime({playError: {name: 'AbortError'}}), pending = r.video.start(CLIP);
  await r.flush(); assert.equal(await pending, true); assert.equal(r.states.at(-1), 'paused');
  assert.equal(r.video.running, true); assert.deepEqual(r.errors, []); r.video.stop();
});

test('a real play failure releases media and reports a readable error', async () => {
  const r = runtime({playError: {name: 'NotSupportedError'}}), pending = r.video.start(CLIP);
  await r.flush(); assert.equal(await pending, false); assert.equal(r.video.running, false);
  assert.equal(r.host.hidden, true); assert.match(r.errors[0], /지원|재생/);
});

test('browsers with no play promise settle through native events', async () => {
  const r = runtime({playWithoutPromise: true}), pending = r.video.start(CLIP);
  r.videos[0].emit('playing'); assert.equal(await pending, true);
  assert.equal(r.video.running, true); r.video.stop();
});

test('an empty source fails without creating media', async () => {
  const r = runtime(); assert.equal(await r.video.start(''), false);
  assert.deepEqual(r.creations, []); assert.equal(r.video.running, false);
  assert.match(r.errors[0], /주소|파일/);
});
