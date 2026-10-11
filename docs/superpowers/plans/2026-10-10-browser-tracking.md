# Browser hand tracking implementation plan

Goal: share BORN HATER without requiring TouchDesigner.

Architecture: keep effect rendering and audio in app.js; isolate browser camera lifecycle in camera.js, worker inference in tracking-worker.js, and gesture rules in gesture-rules.js. SDK 1.1.0, WASM and model files are self-hosted.

Spec: ../specs/2026-10-10-browser-tracking-design.md

1. Write failing gesture tests, port the Python Detector to JS, and verify pose hold/release/cooldown/malformed inputs.
2. Write failing camera lifecycle tests and implement stream/worker setup, fresh results, resets and cleanup including late async resources.
3. Replace localhost app integration with BrowserTracking callbacks, preserve visual/audio tests, add video/overlay markup and CSS. Verify Enter/IME, captions, restart and BGM mute.
4. Review the complete change, run all tests, serve locally and verify actual browser inference. Deploy only website runtime files/assets to existing hosting and check HTTPS resource hashes/MIME.

Review focus: denied/pending permissions, late streams after stop, repeated Enter, worker/model failure, zero-hands fresh frames, and unsupported browsers. Existing TD projects remain available as independent visual development files.

Execution authorized by the user's request to make sharing work and prior instruction to proceed without permission questions. No Git repository exists; preserve backups instead of creating unrelated repository state.

Completed: all four tasks. JavaScript 63/63 and Python 8/8 passed. Independent review found no additional important defects. Actual Chrome SDK initialization exposed the module-loader requirement; `forVisionTasks(root, true)` was fixed with a failing-then-passing real SDK/worker loader regression test. Hosting initially omitted .mjs/.wasm content types; a new .htaccess adds only MIME types. Ten deployed runtime/model/library files match local bytes over HTTPS.

Live verification: TouchDesigner processes exited; public HTTPS browser video was 640×480 and 295 fresh local inference results were observed, with BGM muted and camera continuing. Local test recorded 4,160 results and retained stream time across new Enter input. Evidence lives in td/browser-tracking-live.json, td/browser-tracking-live.jpg and td/browser-tracking-deploy-verification.json. The temporary localhost server was stopped after public verification. Other physical devices and real-pose accuracy across those devices are not yet measured.
