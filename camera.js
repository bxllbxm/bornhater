(() => {
  'use strict';
  const scriptURL = new URL(document.currentScript?.src || 'camera.js', document.baseURI);
  const workerURL = new URL('./tracking-worker.js', scriptURL);
  workerURL.search = scriptURL.search;
  const connections = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],
    [5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],
    [13,17],[0,17],[17,18],[18,19],[19,20]];
  const noOp = () => {};
  const startupLimit = 45000;
  function aborted() {
    const error = new Error('카메라 시작이 취소됐어요.');
    error.name = 'AbortError';
    return error;
  }
  function cameraError(error) {
    if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
      return new Error('카메라 권한이 차단됐어요. 주소창에서 카메라를 허용한 뒤 Enter를 다시 눌러주세요.');
    }
    if (error?.name === 'NotFoundError' || error?.name === 'OverconstrainedError') {
      return new Error('사용할 카메라를 찾을 수 없어요. 카메라 연결을 확인한 뒤 Enter를 다시 눌러주세요.');
    }
    if (error?.name === 'NotReadableError' || error?.name === 'AbortError') {
      return new Error('카메라를 열 수 없어요. 다른 앱에서 카메라를 사용 중인지 확인한 뒤 Enter를 다시 눌러주세요.');
    }
    return new Error('카메라를 시작하지 못했어요. 브라우저의 카메라 설정을 확인한 뒤 Enter를 다시 눌러주세요.');
  }

  class BrowserTracking {
    constructor({video, overlay, onGesture = noOp, onState = noOp, onError = noOp, onFrame = noOp}) {
      this.video = video;
      this.overlay = overlay;
      this.onGesture = onGesture;
      this.onState = onState;
      this.onError = onError;
      this.onFrame = onFrame;
      this.session = null;
      this.generation = 0;
    }
    get running() {return Boolean(this.session && !this.session.closed && this.session.stream);}
    start() {
      const current = this.session;
      if (current && !current.closed) {
        current.epoch++;
        current.hasResult = false;
        if (current.settled) this._promise(current);
        this._armTimeout(current);
        current.worker?.postMessage({type: 'reset', epoch: current.epoch});
        this._clearOverlay();
        this.onState(current.stream ? 'loading' : 'awaiting-camera');
        return current.promise;
      }
      if (window.isSecureContext === false || !navigator.mediaDevices?.getUserMedia) {
        const error = new Error('카메라는 HTTPS 주소에서 사용할 수 있어요. HTTPS로 다시 열어주세요.');
        this.onError(error);
        return Promise.reject(error);
      }
      if (typeof Worker !== 'function' || typeof createImageBitmap !== 'function') {
        const error = new Error('이 브라우저에서 손 추적을 시작할 수 없어요. 최신 Chrome, Edge 또는 Safari로 열어주세요.');
        this.onError(error);
        return Promise.reject(error);
      }
      const session = {generation: ++this.generation, closed: false, stream: null, worker: null,
        ready: false, hasResult: false, epoch: 0, inFlight: false,
        lastTimestamp: -Infinity, raf: null, timer: null, trackHandlers: []};
      this.session = session;
      this._promise(session);
      this._armTimeout(session);
      this.onState('awaiting-camera');
      this._open(session);
      return session.promise;
    }
    stop() {
      const session = this.session;
      this.session = null;
      this.generation++;
      if (session) {
        this._release(session);
        if (!session.settled) {session.settled = true; session.reject(aborted());}
      }
      this.onState('stopped');
    }
    _promise(session) {
      session.settled = false;
      session.promise = new Promise((resolve, reject) => {session.resolve = resolve; session.reject = reject;});
    }
    _current(session) {
      return this.session === session && !session.closed && session.generation === this.generation;
    }
    _armTimeout(session) {
      clearTimeout(session.timer);
      session.timer = setTimeout(() => this._fail(session, new Error(
        session.stream
          ? '손 추적 데이터를 받지 못했어요. 페이지를 새로고침한 뒤 Enter를 다시 눌러주세요.'
          : '카메라 시작이 오래 걸리고 있어요. 카메라 권한을 확인한 뒤 Enter를 다시 눌러주세요.'
      )), startupLimit);
    }
    async _open(session) {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({audio: false,
          video: {facingMode: 'user', width: {ideal: 640}, height: {ideal: 480}}});
        if (!this._current(session)) {stream.getTracks().forEach(track => track.stop()); return;}
        session.stream = stream;
        for (const track of stream.getTracks()) {
          const ended = () => this._fail(session, new Error('카메라 연결이 끊겼어요. Enter를 다시 눌러주세요.'));
          track.addEventListener('ended', ended);
          session.trackHandlers.push([track, ended]);
        }
        this.video.muted = true;
        this.video.playsInline = true;
        this.video.srcObject = stream;
        await this.video.play();
        if (!this._current(session)) return;
        this.video.hidden = false;
        this.overlay.hidden = false;
        this.onState('loading');
      } catch (error) {
        if (this._current(session)) this._fail(session, cameraError(error));
        return;
      }
      try {
        session.worker = new Worker(workerURL, {type: 'module'});
        session.worker.onmessage = event => this._message(session, event.data);
        session.worker.onerror = event => {
          event.preventDefault?.();
          this._fail(session, new Error('손 추적 프로그램을 불러오지 못했어요. 페이지를 새로고침한 뒤 다시 시작해주세요.'));
        };
        session.worker.onmessageerror = () => this._fail(session,
          new Error('손 추적 데이터를 읽지 못했어요. Enter를 다시 눌러주세요.'));
        session.worker.postMessage({type: 'init', epoch: session.epoch});
        this._schedule(session);
      } catch (error) {
        this._fail(session, new Error('손 추적 프로그램을 시작하지 못했어요. 페이지를 새로고침한 뒤 다시 시작해주세요.'));
      }
    }
    _schedule(session) {
      if (!this._current(session)) return;
      session.raf = requestAnimationFrame(timestamp => {
        session.raf = null;
        if (!this._current(session)) return;
        this._schedule(session);
        if (session.ready && !session.inFlight && this.video.readyState >= 2 &&
            timestamp - session.lastTimestamp >= 1000 / 18) {
          session.inFlight = true;
          session.lastTimestamp = timestamp;
          this._frame(session, timestamp, session.epoch);
        }
      });
    }
    async _frame(session, timestamp, epoch) {
      let image;
      try {
        image = await createImageBitmap(this.video);
        if (!this._current(session) || epoch !== session.epoch) {
          image.close();
          session.inFlight = false;
          return;
        }
        session.worker.postMessage({type: 'frame', image, timestamp, epoch}, [image]);
      } catch (error) {
        image?.close();
        if (this._current(session)) this._fail(session,
          new Error('카메라 영상을 읽지 못했어요. Enter를 다시 눌러주세요.'));
      }
    }
    _message(session, data) {
      if (!this._current(session) || !data) return;
      if (data.type === 'ready') {session.ready = true; return;}
      if (data.type === 'error') {
        if (data.phase === 'frame' && data.epoch !== session.epoch) {session.inFlight = false; return;}
        console.warn('[BORN HATER tracking]', data.phase, data.message || 'Unknown worker error');
        this._fail(session, new Error(data.phase === 'init'
          ? '손 추적 모델을 불러오지 못했어요. 인터넷 연결을 확인한 뒤 페이지를 새로고침해주세요.'
          : '손 추적이 중단됐어요. Enter를 다시 눌러주세요.'));
        return;
      }
      if (data.type !== 'result') return;
      session.inFlight = false;
      if (data.epoch !== session.epoch || !Array.isArray(data.landmarks)) return;
      this._drawLandmarks(data.landmarks);
      if (!session.hasResult) {
        session.hasResult = true;
        clearTimeout(session.timer);
        session.timer = null;
        this.onState('active');
        if (!session.settled) {session.settled = true; session.resolve(this);}
      }
      this.onFrame(data);
      if (data.effect) this.onGesture(data.effect);
    }
    _clearOverlay() {
      const context = this.overlay.getContext('2d');
      context?.clearRect(0, 0, this.overlay.width, this.overlay.height);
    }
    _drawLandmarks(hands) {
      const width = this.video.videoWidth || 640, height = this.video.videoHeight || 480;
      if (this.overlay.width !== width) this.overlay.width = width;
      if (this.overlay.height !== height) this.overlay.height = height;
      const context = this.overlay.getContext('2d');
      if (!context) return;
      context.clearRect(0, 0, width, height);
      context.strokeStyle = '#99cd00'; context.fillStyle = '#99cd00'; context.lineWidth = 2;
      for (const hand of hands) {
        if (!Array.isArray(hand) || hand.length !== 21) continue;
        context.beginPath();
        for (const [a, b] of connections) {
          context.moveTo(hand[a].x * width, hand[a].y * height);
          context.lineTo(hand[b].x * width, hand[b].y * height);
        }
        context.stroke();
        for (const point of hand) {
          context.beginPath(); context.arc(point.x * width, point.y * height, 3, 0, Math.PI * 2); context.fill();
        }
      }
    }
    _fail(session, error) {
      if (!this._current(session)) return;
      this.session = null;
      this.generation++;
      this._release(session);
      if (!session.settled) {session.settled = true; session.reject(error);}
      this.onState('stopped');
      this.onError(error);
    }
    _release(session) {
      session.closed = true;
      cancelAnimationFrame(session.raf);
      clearTimeout(session.timer);
      for (const [track, ended] of session.trackHandlers) track.removeEventListener('ended', ended);
      session.trackHandlers = [];
      session.worker?.terminate();
      session.stream?.getTracks().forEach(track => track.stop());
      if (this.video.srcObject === session.stream) {
        this.video.pause();
        this.video.srcObject = null;
      }
      this.video.hidden = true;
      this.overlay.hidden = true;
      this._clearOverlay();
    }
  }
  window.BrowserTracking = BrowserTracking;
})();
