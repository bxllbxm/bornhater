'use strict';
(() => {
  class GestureAudio {
    constructor({Context = window.AudioContext || window.webkitAudioContext, fetchFile = window.fetch.bind(window), bgmUrl = null} = {}) {
      this.Context = Context; this.fetchFile = fetchFile;
      this.context = null; this.buffer = null; this.loading = null; this.playing = new Set();
      this.explosionBuffer = null; this.explosionLoading = null;
      this.heartBuffer = null; this.heartLoading = null;
      this.bgmUrl = bgmUrl; this.musicBuffer = null; this.musicLoading = null; this.musicSource = null;
      this.musicGain = null; this.musicMuted = false;
    }
    prepare() {
      try {
        if (!this.context) this.context = new this.Context();
        const resumed = this.context.resume();
        if (!this.buffer && !this.loading) {
          this.loading = this.fetchFile('assets/punch.mp3').then(response => {
            if (!response.ok) throw new Error('Punch audio unavailable');
            return response.arrayBuffer();
          }).then(bytes => this.context.decodeAudioData(bytes)).then(buffer => {
            this.buffer = buffer;
          }).finally(() => { this.loading = null; });
        }
        if (this.bgmUrl && !this.musicBuffer && !this.musicLoading) {
          this.musicLoading = this.fetchFile(this.bgmUrl).then(response => {
            if (!response.ok) throw new Error('Background music unavailable');
            return response.arrayBuffer();
          }).then(bytes => this.context.decodeAudioData(bytes)).then(buffer => {
            this.musicBuffer = buffer;
          }).finally(() => { this.musicLoading = null; });
        }
        if (!this.explosionBuffer && !this.explosionLoading) {
          this.explosionLoading = this.fetchFile('assets/explode.mp3').then(response => {
            if (!response.ok) throw new Error('Explosion audio unavailable');
            return response.arrayBuffer();
          }).then(bytes => this.context.decodeAudioData(bytes)).then(buffer => {
            this.explosionBuffer = buffer;
          }).finally(() => { this.explosionLoading = null; });
        }
        if (!this.heartBuffer && !this.heartLoading) {
          this.heartLoading = this.fetchFile('assets/sparkle.mp3').then(response => {
            if (!response.ok) throw new Error('Heart sparkle audio unavailable');
            return response.arrayBuffer();
          }).then(bytes => this.context.decodeAudioData(bytes)).then(buffer => {
            this.heartBuffer = buffer;
          }).finally(() => { this.heartLoading = null; });
        }
        return Promise.all([resumed, this.loading, this.musicLoading, this.explosionLoading, this.heartLoading]);
      } catch (error) { return Promise.reject(error); }
    }
    play(effect) {
      const levels = {impact: .07, crack: .03, explode: .07, heart: .07};
      const buffer = effect === 'heart' ? this.heartBuffer : effect === 'explode' ? this.explosionBuffer : this.buffer;
      if (!(effect in levels) || !buffer || this.context.state !== 'running') return false;
      this.stopHits();
      const source = this.context.createBufferSource(), gain = this.context.createGain();
      source.buffer = buffer; gain.gain.value = levels[effect];
      source.connect(gain); gain.connect(this.context.destination);
      source.onended = () => { this.playing.delete(source); source.disconnect(); gain.disconnect(); };
      this.playing.add(source); source.start();
      return true;
    }
    startMusic() {
      if (!this.musicBuffer || this.context.state !== 'running') return false;
      if (this.musicSource) return true;
      const source = this.context.createBufferSource(), gain = this.context.createGain();
      source.buffer = this.musicBuffer; source.loop = true; gain.gain.value = this.musicMuted ? 0 : .18;
      source.connect(gain); gain.connect(this.context.destination);
      source.onended = () => {
        if (this.musicSource === source) { this.musicSource = null; this.musicGain = null; }
        source.disconnect(); gain.disconnect();
      };
      this.musicSource = source; this.musicGain = gain; source.start(); return true;
    }
    setMusicMuted(muted) {
      this.musicMuted = Boolean(muted);
      if (this.musicGain) this.musicGain.gain.value = this.musicMuted ? 0 : .18;
      return this.musicMuted;
    }
    stopHits() {
      for (const source of this.playing) source.stop();
      this.playing.clear();
    }
    stop() {
      this.stopHits();
      const music = this.musicSource;
      this.musicSource = null; this.musicGain = null;
      if (music) music.stop();
    }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = GestureAudio;
  else window.GestureAudio = GestureAudio;
})();
