# BORN HATER browser hand tracking

The shared HTTPS site must work on visitors' computers without TouchDesigner, a local server, or software installation. Keep the current intro, Enter input, camera placement, gesture captions, effects, and BGM-only mute.

Replace the required localhost WebSocket with browser getUserMedia and a self-hosted MediaPipe Gesture Recognizer. Enter requests video only. The browser displays a mirrored live video with green hand landmarks; recognition runs in a module worker so effects can animate. Camera frames and landmarks stay on the visitor's device. No analytics or uploads are added.

Port the existing gesture rules unchanged: middle finger explosion, held fist crack, forward fist punch, two-hand heart, and thumbs-down melt. A fresh result with no hands still proves the camera is working. Re-entering text resets gesture state and damage without reopening an active camera. Intro and music buttons do not start the camera; mute affects BGM only. Escape/page exit release video tracks and the worker.

Use same-origin, pinned SDK/WASM/model files. Report permission denial, missing/busy camera, insecure HTTP, model load failure and camera interruption accurately. Support modern browsers with getUserMedia, module Worker, WebAssembly, and createImageBitmap; physical gesture accuracy across devices remains a real-user calibration concern.

Verification: gesture and lifecycle regression tests, existing visual/audio tests, resource delivery/MIME checks, and an HTTPS browser session with TouchDesigner closed. Do not claim other physical devices were tested unless observed.
