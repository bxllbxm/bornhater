const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourcePath = path.join(__dirname, '../gesture-rules.js');
const api = fs.existsSync(sourcePath) ? require(sourcePath) : null;
function detector() {
  assert.equal(typeof api?.Detector, 'function', 'the browser gesture detector must be available');
  return new api.Detector();
}

function fist(scale = 1, score = .95) {
  const points = Array.from({length:21}, () => ({x:.5,y:.55}));
  points[0] = {x:.5,y:.5 + .1 * scale};
  points[9] = {x:.5,y:.5 - .1 * scale};
  return {landmarks:[points],gestures:[[{categoryName:'Closed_Fist',score}]]};
}

function middleFinger() {
  const points = Array.from({length:21}, () => ({x:.5,y:.55}));
  points[0] = {x:.5,y:.8};
  points[10] = {x:.5,y:.65};
  points[11] = {x:.5,y:.45};
  points[12] = {x:.5,y:.25};
  return {landmarks:[points],gestures:[[]]};
}

function thumbsUp(score = .95) {
  const pose = fist();
  pose.gestures = [[{categoryName:'Thumb_Up',score}]];
  return pose;
}

function thumbsDown(score = .95) {
  const pose = fist();
  pose.gestures = [[{categoryName:'Thumb_Down',score}]];
  return pose;
}

function openPalm(score = .95, categoryName = 'Open_Palm') {
  const points = Array.from({length:21}, () => ({x:.5,y:.55}));
  points[0] = {x:.5,y:.8};
  for (const [index, tip] of [8,12,16,20].entries()) {
    const x = .35 + index * .1;
    points[tip - 2] = {x,y:.65};
    points[tip - 1] = {x,y:.45};
    points[tip] = {x,y:.25};
  }
  return {landmarks:[points],gestures:[[{categoryName,score}]]};
}

function twoHandHeart() {
  const hands = [-1,1].map(side => {
    const palmX = .5 + .2 * side;
    const points = Array.from({length:21}, () => ({x:palmX,y:.5}));
    points[0] = {x:palmX,y:.6};
    points[9] = {x:palmX,y:.4};
    points[6] = {x:.5 + .1 * side,y:.4};
    points[7] = {x:.5,y:.26};
    points[8] = {x:.5 + .01 * side,y:.3};
    points[4] = {x:.5 + .01 * side,y:.5};
    return points;
  });
  return {landmarks:hands,gestures:[[],[]]};
}

const neutral = () => ({landmarks:[],gestures:[]});

test('the same detector loads in Node, browser, and worker globals', () => {
  const d = detector();
  assert.equal(d.update(neutral(), 0), null);
  const source = fs.readFileSync(sourcePath, 'utf8');
  for (const context of [{window:{}},{self:{}}]) {
    vm.runInNewContext(source, context);
    assert.equal(typeof context.GestureRules.Detector, 'function');
    const instance = new context.GestureRules.Detector();
    assert.equal(instance.update(neutral(), 0), null);
  }
});

test('only an extended middle finger explodes after a 0.3 second hold', () => {
  const d = detector(), pose = middleFinger();
  assert.equal(d.update(pose, 0), null);
  assert.equal(d.update(pose, .29), null);
  assert.equal(d.update(pose, .3), 'explode');
  for (const time of [.5,1.5,3]) assert.equal(d.update(pose, time), null);
  const raisedIndex = middleFinger();
  raisedIndex.landmarks[0][6] = {x:.45,y:.65};
  raisedIndex.landmarks[0][7] = {x:.45,y:.45};
  raisedIndex.landmarks[0][8] = {x:.45,y:.25};
  const other = detector();
  for (const time of [0,.31,1.5]) assert.equal(other.update(raisedIndex, time), null);
});

test('thumbs up melts after a 0.3 second hold at 0.6 confidence', () => {
  const d = detector();
  assert.equal(d.update(thumbsUp(.59), 0), null);
  assert.equal(d.update(thumbsUp(.59), .5), null);
  assert.equal(d.update(thumbsUp(.6), .6), null);
  assert.equal(d.update(thumbsUp(.6), .89), null);
  assert.equal(d.update(thumbsUp(.6), .91), 'melt');
  assert.equal(d.update(thumbsUp(), 2), null);
});

test('thumbs down rains after a 0.3 second hold at 0.6 confidence', () => {
  const d = detector();
  assert.equal(d.update(thumbsDown(.59), 0), null);
  assert.equal(d.update(thumbsDown(.59), .5), null);
  assert.equal(d.update(thumbsDown(.6), .6), null);
  assert.equal(d.update(thumbsDown(.6), .89), null);
  assert.equal(d.update(thumbsDown(.6), .91), 'rain');
  for (const time of [1,2,3]) assert.equal(d.update(thumbsDown(), time), null);
});

test('an open palm plays the background video after a 0.3 second hold at 0.6 confidence', () => {
  const d = detector();
  assert.equal(d.update(openPalm(.59), 0), null);
  assert.equal(d.update(openPalm(.59), .5), null);
  assert.equal(d.update(openPalm(.6), .6), null);
  assert.equal(d.update(openPalm(.6), .89), null);
  assert.equal(d.update(openPalm(.6), .91), 'video');
  for (const time of [1,2,3]) assert.equal(d.update(openPalm(), time), null);
});

test('a confidence drop restarts the open palm hold', () => {
  const d = detector();
  assert.equal(d.update(openPalm(), 0), null);
  assert.equal(d.update(openPalm(.59), .2), null);
  assert.equal(d.update(openPalm(), .31), null);
  assert.equal(d.update(openPalm(), .6), null);
  assert.equal(d.update(openPalm(), .62), 'video');
});

test('an open palm must be released and respect the effect cooldown before replaying', () => {
  const d = detector(), pose = openPalm();
  d.update(pose, 0);
  assert.equal(d.update(pose, .31), 'video');
  assert.equal(d.update(pose, 2), null, 'a held palm cannot repeat after the cooldown');

  const rearmed = detector();
  rearmed.update(pose, 0);
  assert.equal(rearmed.update(pose, .31), 'video');
  rearmed.update(neutral(), .4);
  rearmed.update(neutral(), .7);
  assert.equal(rearmed.update(pose, .71), null);
  assert.equal(rearmed.update(pose, 1.02), null, 'a released palm still respects the 1.1 second cooldown');
  assert.equal(rearmed.update(pose, 1.42), 'video');
});

test('an unrecognized open hand cannot play video and interrupts the palm hold', () => {
  const unrecognized = openPalm(.95, 'None');
  const d = detector();
  for (const time of [0,.31,1.5]) assert.equal(d.update(unrecognized, time), null);
  assert.equal(d.update(openPalm(), 2), null);
  assert.equal(d.update(unrecognized, 2.2), null);
  assert.equal(d.update(openPalm(), 2.31), null);
  assert.equal(d.update(openPalm(), 2.6), null);
  assert.equal(d.update(openPalm(), 2.62), 'video');

  const conflict = middleFinger();
  conflict.gestures = [[{categoryName:'Open_Palm',score:.95}]];
  const other = detector();
  for (const time of [0,.31,1.5]) assert.equal(other.update(conflict, time), null);
});

test('a confidence drop restarts the thumbs down hold', () => {
  const d = detector();
  assert.equal(d.update(thumbsDown(), 0), null);
  assert.equal(d.update(thumbsDown(.59), .2), null);
  assert.equal(d.update(thumbsDown(), .31), null);
  assert.equal(d.update(thumbsDown(), .6), null);
  assert.equal(d.update(thumbsDown(), .62), 'rain');
});

test('thumbs down must be released and respect the effect cooldown before raining again', () => {
  const d = detector(), pose = thumbsDown();
  d.update(pose, 0);
  assert.equal(d.update(pose, .31), 'rain');
  assert.equal(d.update(pose, 2), null, 'a held thumb cannot repeat after the cooldown');

  const rearmed = detector();
  rearmed.update(pose, 0);
  assert.equal(rearmed.update(pose, .31), 'rain');
  rearmed.update(neutral(), .4);
  rearmed.update(neutral(), .7);
  assert.equal(rearmed.update(pose, .71), null);
  assert.equal(rearmed.update(pose, 1.02), null, 'a released pose still respects the 1.1 second cooldown');
  assert.equal(rearmed.update(pose, 1.42), 'rain');
});

test('switching thumb direction restarts the hold and keeps up melt separate from down rain', () => {
  for (const [first, second, effect] of [
    [thumbsDown(), thumbsUp(), 'melt'],
    [thumbsUp(), thumbsDown(), 'rain'],
  ]) {
    const d = detector();
    assert.equal(d.update(first, 0), null);
    assert.equal(d.update(second, .2), null);
    assert.equal(d.update(second, .31), null, 'the first direction does not count toward the second hold');
    assert.equal(d.update(second, .51), effect);
    assert.equal(d.update(first, 2), null, 'switching direction cannot bypass the release requirement');
  }
});

test('thumbs up must be released before melting a new text again', () => {
  const d = detector(), pose = thumbsUp();
  d.update(pose, 0);
  assert.equal(d.update(pose, .31), 'melt');
  assert.equal(d.update(pose, 2), null);
  d.update(neutral(), 2.1);
  d.update(neutral(), 2.4);
  assert.equal(d.update(pose, 2.5), null);
  assert.equal(d.update(pose, 2.81), 'melt');
});

test('neutral release takes over 0.25 seconds and the effect cooldown lasts 1.1 seconds', () => {
  const d = detector(), pose = middleFinger();
  d.update(pose, 0);
  assert.equal(d.update(pose, .3), 'explode');
  d.update(neutral(), .4);
  d.update(neutral(), .65);
  d.update(pose, .66);
  assert.equal(d.update(pose, 1.5), null, 'exactly 0.25 seconds of neutral does not unlock');
  d.update(neutral(), 1.6);
  d.update(neutral(), 1.86);
  assert.equal(d.update(pose, 1.87), null);
  assert.equal(d.update(pose, 2.18), 'explode');

  const cooldown = detector();
  cooldown.update(pose, 0);
  assert.equal(cooldown.update(pose, .31), 'explode');
  cooldown.update(neutral(), .4);
  cooldown.update(neutral(), .7);
  cooldown.update(pose, .71);
  assert.equal(cooldown.update(pose, 1.02), null);
  assert.equal(cooldown.update(pose, 1.42), 'explode');
});

test('a held fist cracks once and requires release before another crack', () => {
  const d = detector();
  assert.equal(d.update(fist(), 0), null);
  assert.equal(d.update(fist(), .15), null);
  assert.equal(d.update(fist(), .35), 'crack');
  for (const time of [.5,.8,1.5,2.5]) assert.equal(d.update(fist(), time), null);
  d.update(neutral(), 3);
  d.update(neutral(), 3.3);
  assert.equal(d.update(fist(), 3.4), null);
  assert.equal(d.update(fist(), 3.75), 'crack');
});

test('a fist crack leaves the forward punch available but a held punch cannot repeat', () => {
  const d = detector();
  d.update(fist(), 0);
  assert.equal(d.update(fist(), .35), 'crack');
  assert.equal(d.update(fist(1.4), .45), 'punch');
  for (const time of [.55,1.6,2,3]) assert.equal(d.update(fist(1.5), time), null);
  d.update(neutral(), 3.1);
  d.update(neutral(), 3.4);
  assert.equal(d.update(fist(), 3.5), null);
  assert.equal(d.update(fist(1.4), 3.65), 'punch');
});

test('a punch requires over 28 percent enlargement between 0.08 and 0.65 seconds', () => {
  const tooSoon = detector();
  tooSoon.update(fist(), 0);
  assert.equal(tooSoon.update(fist(1.4), .08), null);
  assert.equal(tooSoon.update(fist(1.4), .081), 'punch');

  const tooSmall = detector();
  tooSmall.update(fist(), 0);
  assert.equal(tooSmall.update(fist(1.279), .15), null);
  assert.equal(tooSmall.update(fist(1.281), .16), 'punch');

  const tooLate = detector();
  tooLate.update(fist(), 0);
  assert.equal(tooLate.update(fist(1.4), .65), 'crack');
  assert.equal(tooLate.update(fist(1.5), .66), null, 'old palm size baseline expires');
  assert.equal(tooLate.update(fist(2), .8), 'punch', 'a new baseline allows a fresh forward movement');

  const tiny = detector();
  tiny.update(fist(.05), 0);
  assert.equal(tiny.update(fist(.2), .15), null, 'tiny image landmarks do not count as a punch');
});

test('a low confidence fist does not crack or punch', () => {
  const d = detector();
  d.update(fist(1,.4), 0);
  assert.equal(d.update(fist(1.4,.4), .15), null);
  assert.equal(d.update(fist(1,.4), .5), null);
});

test('a two-hand heart holds for 0.3 seconds and fires once', () => {
  const d = detector(), pose = twoHandHeart();
  assert.equal(d.update(pose, 0), null);
  assert.equal(d.update(pose, .29), null);
  assert.equal(d.update(pose, .31), 'heart');
  for (const time of [.5,1.5,3]) assert.equal(d.update(pose, time), null);
});

test('a released two-hand heart rearms after the cooldown', () => {
  const d = detector(), pose = twoHandHeart();
  d.update(pose, 0);
  assert.equal(d.update(pose, .31), 'heart');
  d.update(neutral(), .4);
  d.update(neutral(), .7);
  assert.equal(d.update(pose, .71), null);
  assert.equal(d.update(pose, 1.02), null);
  assert.equal(d.update(pose, 1.42), 'heart');
  assert.equal(d.update(pose, 2.5), null);
});

test('one hand, separated heart tips, and inverted hearts are rejected', () => {
  const single = twoHandHeart();
  single.landmarks = single.landmarks.slice(0,1);
  single.gestures = single.gestures.slice(0,1);
  const separatedIndex = twoHandHeart();
  separatedIndex.landmarks[1][8].x = .8;
  const separatedThumb = twoHandHeart();
  separatedThumb.landmarks[1][4].x = .8;
  const inverted = twoHandHeart();
  inverted.landmarks.forEach(points => {points[4].y = .2;});
  for (const pose of [single,separatedIndex,separatedThumb,inverted]) {
    const d = detector();
    for (const time of [0,.31,1.5]) assert.equal(d.update(pose, time), null);
  }
});

test('conflicting recognized poses cannot trigger an arbitrary effect', () => {
  const pose = middleFinger();
  pose.gestures = [[{categoryName:'Thumb_Up',score:.95}]];
  const d = detector();
  for (const time of [0,.31,1.5]) assert.equal(d.update(pose, time), null);
});

test('malformed result payloads and invalid landmark coordinates never emit an effect', () => {
  const invalidPoint = middleFinger();
  invalidPoint.landmarks[0][4].x = Infinity;
  const stringPoint = middleFinger();
  stringPoint.landmarks[0][4].y = '0.5';
  const short = middleFinger();
  short.landmarks[0].pop();
  const tooMany = twoHandHeart();
  tooMany.landmarks.push(tooMany.landmarks[0]);
  for (const result of [null,undefined,42,'x',[],{}, {landmarks:{}}, {landmarks:[null]},
    invalidPoint,stringPoint,short,tooMany,{landmarks:[Array(21).fill(null)]}]) {
    const d = detector();
    for (const time of [0,.31,1.5]) assert.equal(d.update(result, time), null);
  }
  for (const gestures of [null,{},[null],[[null]],[[{categoryName:'Closed_Fist',score:'0.95'}]]]) {
    const d = detector(), result = fist();
    result.gestures = gestures;
    for (const time of [0,.31,1.5]) assert.equal(d.update(result, time), null);
  }
});

 test('two open palms agree on one video trigger instead of cancelling each other', () => {
  const one = openPalm(), two = {landmarks:[one.landmarks[0],one.landmarks[0]],gestures:[one.gestures[0],one.gestures[0]]};
  const d=detector();assert.equal(d.update(two,0),null);assert.equal(d.update(two,.31),'video');
  assert.equal(d.update(two,2),null);
  const conflict={landmarks:two.landmarks,gestures:[one.gestures[0],[{categoryName:'Thumb_Up',score:.95}]]};
  const other=detector();assert.equal(other.update(conflict,0),null);assert.equal(other.update(conflict,.31),null);
});

test('switching from an already fired gesture to an open palm starts video without lowering the hand', () => {
  for(const earlier of [thumbsUp(),thumbsDown(),middleFinger()]) {
    const d=detector();d.update(earlier,0);assert.ok(d.update(earlier,.31));
    assert.equal(d.update(openPalm(),.4),null);assert.equal(d.update(openPalm(),.71),null,'cooldown still applies');
    assert.equal(d.update(openPalm(),1.42),'video');assert.equal(d.update(openPalm(),3),null,'held palm does not repeat');
  }
});
