import {FilesetResolver, GestureRecognizer} from './vendor/mediapipe/vision_bundle.mjs';
import './gesture-rules.js?v=38';

let recognizer = null;
let detector = new globalThis.GestureRules.Detector();
let initialization = null;

function report(error, phase, epoch) {
  self.postMessage({type: 'error', phase, epoch,
    message: error instanceof Error ? error.message : String(error)});
}
async function initialize() {
  try {
    // A module worker needs the ES-module loader that publishes ModuleFactory.
    const fileset = await FilesetResolver.forVisionTasks(new URL('./vendor/mediapipe/wasm', import.meta.url).href, true);
    recognizer = await GestureRecognizer.createFromOptions(fileset, {
      baseOptions: {modelAssetPath: new URL('./assets/gesture_recognizer.task', import.meta.url).href, delegate: 'CPU'},
      runningMode: 'VIDEO', numHands: 2,
      minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5,
    });
    self.postMessage({type: 'ready'});
  } catch (error) {report(error, 'init');}
}
self.onmessage = event => {
  const data = event.data;
  if (data.type === 'init') {
    if (!initialization) initialization = initialize();
    return;
  }
  if (data.type === 'reset') {detector = new globalThis.GestureRules.Detector(); return;}
  if (data.type !== 'frame') return;
  try {
    if (!recognizer) throw new Error('The gesture model is not ready.');
    const result = recognizer.recognizeForVideo(data.image, data.timestamp);
    const effect = detector.update(result, data.timestamp / 1000);
    self.postMessage({type: 'result', landmarks: result.landmarks,
      effect, timestamp: data.timestamp, epoch: data.epoch,
      pose: {hands: result.landmarks.length,
        labels: result.gestures.map(hand => hand[0]?.categoryName || 'None'),
        scores: result.gestures.map(hand => Number((hand[0]?.score || 0).toFixed(2))),
        candidate: detector.candidate, locked: detector.locked}});
  } catch (error) {report(error, 'frame', data.epoch);}
  finally {data.image?.close();}
};
