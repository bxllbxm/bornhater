/* Gesture rules over MediaPipe image landmarks. No camera or network access. */
(function (root) {
  'use strict';

  function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function extended(points, tip) {
    const a = points[tip - 2], b = points[tip - 1], c = points[tip];
    const vx = a.x - b.x, vy = a.y - b.y;
    const wx = c.x - b.x, wy = c.y - b.y;
    const denominator = Math.hypot(vx, vy) * Math.hypot(wx, wy);
    return denominator > .00001 && (vx * wx + vy * wy) / denominator < -.7 &&
      distance(c, points[0]) > distance(a, points[0]) * 1.12;
  }

  function validHand(points) {
    return Array.isArray(points) && points.length === 21 && Array.from(points).every(point =>
      point && typeof point === 'object' && !Array.isArray(point) &&
      Number.isFinite(point.x) && Number.isFinite(point.y));
  }

  class Detector {
    constructor() {
      this.candidate = null;
      this.since = 0;
      this.locked = false;
      this.lastEffect = null;
      this.neutral_since = null;
      this.cooldown = 0;
      this.fist = null;
      this.fist_since = null;
      this.fist_cracked = false;
    }

    update(result, now) {
      if (!result || typeof result !== 'object' || Array.isArray(result) || !Number.isFinite(now)) return null;
      let hands = result.landmarks === undefined ? [] : result.landmarks;
      if (!Array.isArray(hands) || hands.length > 2) return null;
      hands = hands.filter(validHand);
      const candidates = [];
      const gestures = Array.isArray(result.gestures) ? result.gestures : [];
      let heldFist = false;

      for (let index = 0; index < hands.length; index++) {
        const points = hands[index];
        const shape = Object.fromEntries([8,12,16,20].map(tip => [tip, extended(points, tip)]));
        if (shape[12] && ![8,16,20].some(tip => shape[tip])) candidates.push('explode');

        const category = Array.isArray(gestures[index]) ? gestures[index][0] : null;
        const label = category && Number.isFinite(category.score) && category.score >= .6 ? category.categoryName : '';
        if (label === 'Thumb_Up') candidates.push('melt');
        if (label === 'Thumb_Down') candidates.push('rain');
        if (label === 'Open_Palm') candidates.push('video');
        if (label === 'Closed_Fist' && hands.length === 1) {
          heldFist = true;
          const size = distance(points[0], points[9]);
          const center = [(points[0].x + points[9].x) / 2, (points[0].y + points[9].y) / 2];
          if (this.fist === null) {
            this.fist = [now, size, center];
          } else {
            const [at, baseline] = this.fist;
            const elapsed = now - at;
            if (.08 < elapsed && elapsed < .65 && baseline > .015 && size > baseline * 1.28) {
              candidates.push('punch');
            } else if (elapsed > .65) {
              this.fist = [now, size, center];
            }
          }
        } else {
          this.fist = null;
        }
      }

      if (heldFist) {
        if (this.fist_since === null) this.fist_since = now;
      } else {
        this.fist = null;
        this.fist_since = null;
        this.fist_cracked = false;
      }

      if (hands.length === 2) {
        const [a,b] = hands;
        const scale = (distance(a[0], a[9]) + distance(b[0], b[9])) / 2;
        // Two bent index fingers meet above the paired thumbs; wrists stay apart.
        if (scale > .015 && distance(a[8], b[8]) < scale * .65 &&
          distance(a[4], b[4]) < scale * .65 &&
          (a[4].y + b[4].y) / 2 - (a[8].y + b[8].y) / 2 > scale * .3 &&
          distance(a[0], b[0]) > scale * 1.1 && !extended(a, 8) && !extended(b, 8)) {
          candidates.push('heart');
        }
      }

      // Both open palms agree on the same action; different actions still conflict.
      const effect = candidates.length && candidates.every(value => value === 'video') ? 'video' :
        candidates.length === 1 ? candidates[0] : null;
      // A held fist cannot rearm a punch until it has been released.
      const neutral = candidates.length === 0 && this.fist === null;
      if (neutral) {
        if (this.neutral_since === null) this.neutral_since = now;
        if (now - this.neutral_since > .25) this.locked = false;
      } else {
        this.neutral_since = null;
      }
      if (effect !== this.candidate) {
        this.candidate = effect;
        this.since = now;
      }
      // An open palm switches to video after another action without requiring a hidden neutral pose.
      const canTrigger = !this.locked || (effect === 'video' && this.lastEffect !== 'video');
      if (effect && canTrigger && now >= this.cooldown && (effect === 'punch' || now - this.since >= .3)) {
        this.locked = true;
        this.lastEffect = effect;
        this.cooldown = now + 1.1;
        if (effect === 'punch') this.fist_cracked = true;
        return effect;
      }
      // Closing a fist chips the text once without blocking its forward punch.
      if (effect === null && heldFist && !this.locked && !this.fist_cracked && now - this.fist_since >= .3) {
        this.fist_cracked = true;
        return 'crack';
      }
      return null;
    }
  }

  const api = {Detector};
  root.GestureRules = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis);
