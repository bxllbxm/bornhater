'use strict';
(() => {
  const LOAD_TIMEOUT = 15000;
  const BLOCKED_MESSAGE = '영상의 재생 버튼을 눌러주세요. 브라우저가 소리 있는 자동 재생을 막았어요.';

  function mediaError(code) {
    if (code === 1) return '영상 불러오기가 중단되었어요. 다시 손바닥을 보여주세요.';
    if (code === 2) return '영상 파일을 불러오지 못했어요. 인터넷 연결을 확인하고 다시 손바닥을 보여주세요.';
    if (code === 3) return '영상 파일을 해석하지 못해 재생할 수 없어요.';
    if (code === 4) return '이 브라우저에서 지원하지 않는 영상 파일이에요.';
    return '영상을 재생하지 못했어요. 다시 손바닥을 보여주세요.';
  }

  class GestureVideo {
    constructor({host, onState = () => {}, onError = () => {}}) {
      this.host = host; this.onState = onState; this.onError = onError;
      this._generation = 0; this._requested = false; this._video = null;
      this._source = null; this._startPromise = null; this._resolveStart = null;
      this._readyTimer = null; this._listeners = []; this._state = 'idle';
    }

    get running() { return this._requested; }

    start(src) {
      if (this._requested && this._source === src) return this._startPromise;
      this.stop();
      if (typeof src !== 'string' || !src.trim()) {
        this.onState('error'); this.onError('영상 파일의 주소가 올바르지 않아요.');
        return Promise.resolve(false);
      }
      this._requested = true; this._source = src; this.host.hidden = false;
      const generation = this._generation;
      const request = new Promise(resolve => { this._resolveStart = resolve; });
      this._startPromise = request;
      try {
        const video = window.document.createElement('video'); this._video = video;
        video.loop = true; video.playsInline = true; video.controls = true;
        video.muted = false; video.volume = 1; video.autoplay = false; video.preload = 'auto';
        video.setAttribute('playsinline', '');
        const listen = (name, handler) => {
          const guarded = () => { if (this._current(generation)) handler(); };
          video.addEventListener(name, guarded); this._listeners.push([name, guarded]);
        };
        const ready = () => {
          if (this._state === 'loading' || this._state === 'buffering') {
            if (!this._emit(generation, 'ready')) return;
          }
          if (!this._current(generation)) return;
          this._clearTimer(); this._finish(true);
        };
        const playing = () => {
          this._clearTimer();
          if (this._emit(generation, 'playing')) this._finish(true);
        };
        listen('loadeddata', ready); listen('canplay', ready);
        listen('playing', playing);
        listen('pause', () => { if (this._emit(generation, 'paused')) this._finish(true); });
        listen('ended', () => { if (this._emit(generation, 'ended')) this._finish(true); });
        const buffering = () => { if (this._state !== 'blocked') this._emit(generation, 'buffering'); };
        listen('waiting', buffering); listen('stalled', buffering);
        listen('error', () => this._fail(generation, mediaError(video.error?.code)));
        this.host.replaceChildren(video);
        this._readyTimer = window.setTimeout(() => {
          this._fail(generation, '영상의 응답 시간이 길어지고 있어요. 다시 손바닥을 보여주세요.');
        }, LOAD_TIMEOUT);
        if (!this._emit(generation, 'loading')) return request;
        video.src = src; video.load();
        if (!this._current(generation)) return request;
        try {
          const attempt = video.play();
          if (attempt && typeof attempt.then === 'function') {
            attempt.then(() => {
              if (this._current(generation)) playing();
            }, error => this._playFailed(generation, error));
          }
        } catch (error) { this._playFailed(generation, error); }
      } catch (error) { this._fail(generation, mediaError()); }
      return request;
    }

    _current(generation) { return this._requested && this._generation === generation; }

    _emit(generation, state) {
      if (!this._current(generation)) return false;
      this._state = state; this.onState(state);
      return this._current(generation);
    }

    _playFailed(generation, error) {
      if (!this._current(generation)) return;
      if (error?.name === 'NotAllowedError') {
        this._clearTimer();
        if (!this._emit(generation, 'blocked')) return;
        this._finish(true); this.onError(BLOCKED_MESSAGE);
      } else if (error?.name === 'AbortError') {
        // Native pause can abort a pending play request while its controls stay usable.
        this._clearTimer();
        if (this._emit(generation, 'paused')) this._finish(true);
      } else this._fail(generation, mediaError(error?.name === 'NotSupportedError' ? 4 : this._video?.error?.code));
    }

    _finish(result) {
      const resolve = this._resolveStart; this._resolveStart = null;
      if (resolve) resolve(result);
    }

    _clearTimer() { window.clearTimeout(this._readyTimer); this._readyTimer = null; }

    _fail(generation, message) {
      if (!this._current(generation)) return;
      this.stop(); this._state = 'error'; this.onState('error'); this.onError(message);
    }

    stop() {
      const wasRunning = this._requested;
      this._generation++; this._requested = false;
      this._clearTimer(); this._finish(false);
      const video = this._video; this._video = null;
      if (video) {
        for (const [name, handler] of this._listeners) video.removeEventListener(name, handler);
        try { video.pause(); } catch (error) {}
        video.removeAttribute('src');
        try { video.load(); } catch (error) {}
      }
      this._listeners = []; this.host.replaceChildren(); this.host.hidden = true;
      this._source = null; this._startPromise = null; this._state = 'idle';
      if (wasRunning) this.onState('idle');
    }
  }
  window.GestureVideo = GestureVideo;
})();
