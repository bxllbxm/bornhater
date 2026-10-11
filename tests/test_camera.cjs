const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}
async function flush() { for (let n = 0; n < 8; n++) await Promise.resolve(); }
function environment() {
  const requests = [], workers = [], states = [], errors = [], gestures = [], frames = [];
  const rafs = new Map(), timers = new Map();
  let serial = 0, bitmapFactory = () => Promise.resolve({closed: false, close() {this.closed = true;}});
  const mediaRequests = [];
  const video = {hidden: true, muted: false, playsInline: false, srcObject: null,
    readyState: 2, videoWidth: 640, videoHeight: 480, paused: true,
    play() {this.paused = false; return Promise.resolve();}, pause() {this.paused = true;}};
  let clears = 0;
  const context2d = new Proxy({clearRect() {clears++;}}, {get: (o, k) => k in o ? o[k] : () => {}});
  const overlay = {hidden: true, width: 0, height: 0, getContext: () => context2d};
  class FakeWorker {
    constructor(url, options) {this.url = String(url); this.options = options; this.sent = []; this.terminated = false; workers.push(this);}
    postMessage(message, transfer) {this.sent.push({message, transfer});}
    terminate() {this.terminated = true;}
    emit(data) {this.onmessage?.({data});}
    fail() {this.onerror?.({preventDefault() {}, message: 'fixture worker failure'});}
  }
  const runtime = {console, URL, Error, Promise, Worker: FakeWorker,
    document: {baseURI: 'https://bornhater.example/', currentScript: {src: 'https://bornhater.example/camera.js?v=26'}},
    navigator: {mediaDevices: {getUserMedia(constraints) {
      requests.push(constraints); const pending = deferred(); mediaRequests.push(pending); return pending.promise;
    }}},
    requestAnimationFrame(fn) {const id = ++serial; rafs.set(id, fn); return id;},
    cancelAnimationFrame(id) {rafs.delete(id);},
    setTimeout(fn) {const id = ++serial; timers.set(id, fn); return id;},
    clearTimeout(id) {timers.delete(id);},
    createImageBitmap(video) {return bitmapFactory(video);},
  };
  runtime.window = {isSecureContext: true};
  vm.runInNewContext(fs.readFileSync(require.resolve('../camera.js'), 'utf8'), runtime);
  const camera = new runtime.window.BrowserTracking({video, overlay,
    onState: value => states.push(value), onError: error => errors.push(error),
    onGesture: effect => gestures.push(effect), onFrame: result => frames.push(result)});
  function stream() {
    const listeners = new Map();
    const tracks = [0, 1].map(() => ({stops: 0, stop() {this.stops++;},
      addEventListener(type, fn) {listeners.set(this, fn);}, removeEventListener() {listeners.delete(this);}}));
    return {getTracks: () => tracks, tracks, end() {listeners.values().next().value?.();}};
  }
  async function grant(index = mediaRequests.length - 1) {
    const source = stream(); mediaRequests[index].resolve(source); await flush(); return source;
  }
  async function step(time) {
    const batch = [...rafs.values()]; rafs.clear(); batch.forEach(fn => fn(time)); await flush();
  }
  function result(worker, effect = null, landmarks = []) {
    const latest = worker.sent.filter(item => item.message.type === 'frame').at(-1)?.message;
    worker.emit({type: 'result', effect, landmarks, timestamp: latest?.timestamp ?? 0, epoch: latest?.epoch ?? 0});
  }
  return {camera, runtime, video, overlay, requests, workers, states, errors, gestures, frames,
    rafs, timers, mediaRequests, grant, stream, step, result,
    setBitmapFactory(factory) {bitmapFactory = factory;}, clears: () => clears};
}

test('camera is visible while models load, and an empty-hand fresh result completes startup', async () => {
  const p = environment(); const starting = p.camera.start();
  const source = await p.grant(); const worker = p.workers[0];
  assert.equal(p.video.srcObject, source); assert.equal(p.video.hidden, false);
  assert.equal(p.video.muted, true); assert.equal(p.video.playsInline, true);
  assert.equal(p.states.includes('active'), false);
  assert.equal(p.requests[0].audio, false); assert.equal(p.requests[0].video.facingMode, 'user');
  assert.equal(worker.options.type, 'module'); assert.match(worker.url, /tracking-worker\.js/);
  worker.emit({type: 'ready'}); await p.step(100); await p.step(200);
  assert.equal(worker.sent.filter(item => item.message.type === 'frame').length, 1, 'inference cannot queue up frames');
  p.result(worker); await starting;
  assert.equal(p.states.at(-1), 'active'); assert.equal(p.frames.length, 1);
  assert.equal(p.camera.running, true); assert.equal(p.timers.size, 0);
  p.camera.stop();
  assert.ok(source.tracks.every(track => track.stops === 1)); assert.equal(worker.terminated, true);
  assert.equal(p.video.srcObject, null); assert.equal(p.video.hidden, true); assert.equal(p.overlay.hidden, true);
  assert.equal(p.camera.running, false); assert.equal(p.rafs.size, 0); assert.equal(p.states.at(-1), 'stopped');
});

test('stopping a pending permission request disposes its late stream without disturbing a new session', async () => {
  const p = environment(); const first = p.camera.start();
  const aborted = assert.rejects(first, {name: 'AbortError'}); p.camera.stop(); await aborted;
  const second = p.camera.start(); const fresh = await p.grant(1);
  const late = await p.grant(0);
  assert.ok(late.tracks.every(track => track.stops === 1));
  assert.equal(p.video.srcObject, fresh); assert.equal(p.workers.length, 1);
  const worker = p.workers[0]; worker.emit({type: 'ready'}); await p.step(100); p.result(worker); await second;
  assert.equal(p.errors.length, 0); p.camera.stop();
});

test('a new text resets the detector without reopening the camera and ignores the previous inference', async () => {
  const p = environment(); const first = p.camera.start(); await p.grant();
  const worker = p.workers[0]; worker.emit({type: 'ready'}); await p.step(100); p.result(worker); await first;
  await p.step(200); const stale = worker.sent.at(-1).message;
  const restarting = p.camera.start();
  assert.equal(p.requests.length, 1); assert.equal(worker.sent.at(-1).message.type, 'reset');
  worker.emit({type: 'result', landmarks: [], effect: 'explode', timestamp: stale.timestamp, epoch: stale.epoch});
  assert.equal(p.gestures.length, 0, 'old text results must not explode newly submitted text');
  await p.step(300); p.result(worker, 'punch'); await restarting;
  assert.deepEqual(p.gestures, ['punch']); p.camera.stop();
});

test('a bitmap that resolves after stop is closed and never sent to the terminated worker', async () => {
  const p = environment(); const pendingBitmap = deferred(); p.setBitmapFactory(() => pendingBitmap.promise);
  const starting = p.camera.start(); await p.grant();
  const worker = p.workers[0]; worker.emit({type: 'ready'}); await p.step(100);
  const aborted = assert.rejects(starting, {name: 'AbortError'}); p.camera.stop(); await aborted;
  const bitmap = {closed: false, close() {this.closed = true;}}; pendingBitmap.resolve(bitmap); await flush();
  assert.equal(bitmap.closed, true); assert.equal(worker.sent.filter(item => item.message.type === 'frame').length, 0);
});

test('permission, model, worker and startup timeout failures report useful errors and release resources', async t => {
  await t.test('permission denial', async () => {
    const p = environment(); const start = p.camera.start();
    const denied = new Error('denied'); denied.name = 'NotAllowedError';
    p.mediaRequests[0].reject(denied); await assert.rejects(start, /권한/);
    assert.equal(p.errors.length, 1); assert.equal(p.workers.length, 0); assert.equal(p.camera.running, false);
    assert.doesNotMatch(p.errors[0].message, /TouchDesigner/);
  });
  for (const failure of ['model', 'worker', 'timeout']) await t.test(failure, async () => {
    const p = environment(); const start = p.camera.start(); const source = await p.grant(); const worker = p.workers[0];
    if (failure === 'model') worker.emit({type: 'error', phase: 'init', message: 'fixture model failure'});
    else if (failure === 'worker') worker.fail();
    else [...p.timers.values()][0]();
    await assert.rejects(start);
    assert.equal(p.errors.length, 1); assert.equal(worker.terminated, true);
    assert.ok(source.tracks.every(track => track.stops === 1)); assert.equal(p.timers.size, 0); assert.equal(p.rafs.size, 0);
  });
});

test('a camera that ends after startup stops inference and reports the interruption', async () => {
  const p = environment(); const start = p.camera.start(); const source = await p.grant();
  const worker = p.workers[0]; worker.emit({type: 'ready'}); await p.step(100); p.result(worker); await start;
  source.end(); assert.equal(p.camera.running, false); assert.equal(p.errors.length, 1);
  assert.equal(worker.terminated, true); assert.equal(p.video.hidden, true); assert.equal(p.rafs.size, 0);
});

test('an insecure page fails before requesting camera access', async () => {
  const p = environment(); p.runtime.window.isSecureContext = false;
  await assert.rejects(p.camera.start(), /HTTPS/);
  assert.equal(p.requests.length, 0); assert.equal(p.workers.length, 0); assert.equal(p.errors.length, 1);
});

test('worker initializes the module-compatible WASM loader and closes images on success or recognition failure', async () => {
  const sdk = await import('../vendor/mediapipe/vision_bundle.mjs');
  const originalCreate = sdk.GestureRecognizer.createFromOptions;
  const oldSelf = globalThis.self, oldFactory = globalThis.ModuleFactory, oldDebug = globalThis.custom_dbg;
  const messages = [], initialized = deferred();
  let failRecognition = false, receivedOptions;
  globalThis.self = {postMessage(message) {messages.push(message); initialized.resolve();}};
  sdk.GestureRecognizer.createFromOptions = async (fileset, options) => {
    // The shipped SDK's default classic loader does not expose ModuleFactory in a module worker.
    assert.match(fileset.wasmLoaderPath, /vision_wasm_module_internal\.js$/);
    assert.match(fileset.wasmBinaryPath, /vision_wasm_module_internal\.wasm$/);
    const loader = await import(fileset.wasmLoaderPath);
    assert.equal(typeof loader.default, 'function');
    assert.equal(globalThis.ModuleFactory, loader.default, 'the module loader exposes the factory the SDK requires');
    receivedOptions = options;
    return {recognizeForVideo(image, timestamp) {
      assert.equal(timestamp, 123);
      if (failRecognition) throw new Error('fixture recognition failure');
      return {landmarks: [], gestures: []};
    }};
  };
  try {
    await import('../tracking-worker.js');
    globalThis.self.onmessage({data: {type: 'init', epoch: 0}});
    await initialized.promise;
    assert.equal(messages[0].type, 'ready', messages[0].message);
    assert.equal(receivedOptions.baseOptions.delegate, 'CPU');
    assert.equal(receivedOptions.runningMode, 'VIDEO'); assert.equal(receivedOptions.numHands, 2);
    for (const failure of [false, true]) {
      failRecognition = failure;
      const image = {closed: 0, close() {this.closed++;}};
      globalThis.self.onmessage({data: {type: 'frame', image, timestamp: 123, epoch: 0}});
      assert.equal(image.closed, 1);
      assert.equal(messages.at(-1).type, failure ? 'error' : 'result');
      if (failure) assert.equal(messages.at(-1).phase, 'frame');
      else assert.deepEqual(messages.at(-1).landmarks, []);
    }
  } finally {
    sdk.GestureRecognizer.createFromOptions = originalCreate;
    if (oldSelf === undefined) delete globalThis.self; else globalThis.self = oldSelf;
    if (oldFactory === undefined) delete globalThis.ModuleFactory; else globalThis.ModuleFactory = oldFactory;
    if (oldDebug === undefined) delete globalThis.custom_dbg; else globalThis.custom_dbg = oldDebug;
  }
});
