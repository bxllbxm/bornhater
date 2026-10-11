"""Reload the website bridge inside the existing BORN HATER project."""
import json
from pathlib import Path

ROOT = Path('/Users/jeongmin/Documents/Codex/2026-10-08/task/tato/td')
b = op('/project1/born_hater')
m = op('/project1/born_hater_handtracking_v2/MediaPipe')
if b is None or m is None:
    raise RuntimeError('Open BORN_HATER_WEB.toe before updating the bridge')
b.op('engine').module.stop()
b.store('tracking_source', m.path)
m.par.Generatehandgui = True
m.op('webserver1_callbacks').text = (ROOT/'mediapipe_callbacks.py').read_text()
for name, filename in [('engine', 'engine.py'), ('site_server_callbacks', 'site_callbacks.py')]:
    b.op(name).text = (ROOT/filename).read_text()
s = b.op('site_server')
s.par.callbacks = b.op('site_server_callbacks')
s.par.localaddress = '127.0.0.1'
s.par.port = 9983
s.par.active = True
b.op('engine').module.stop()
r = m.op('webBrowser1/webrender1')
(ROOT/'preview-installed.json').write_text(json.dumps({
    'project': str(Path(project.folder)/project.name),
    'source': m.path,
    'preview_top': r.path,
    'resolution': [r.width, r.height],
    'errors': [b.errors(recurse=True), m.parent().errors(recurse=True)],
    'image_api': r.saveByteArray.__doc__,
}, indent=2))
print('BORN HATER tracking preview and fist cracks ready')
