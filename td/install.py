from pathlib import Path
ROOT=Path('/Users/jeongmin/Documents/Codex/2026-10-08/task/tato/td')
b=op('/project1/born_hater')
m=op('/project1/born_hater_handtracking_v2/MediaPipe')
if b is None or m is None:raise RuntimeError('Open BORN_HATER_WEB.toe first')
b.store('tracking_source',m.path)
for name,file in [('engine','engine.py'),('site_server_callbacks','site_callbacks.py')]:
    node=b.op(name) or b.create(textDAT,name)
    node.text=(ROOT/file).read_text(encoding='utf-8')
m.op('webserver1_callbacks').text=(ROOT/'mediapipe_callbacks.py').read_text(encoding='utf-8')
s=b.op('site_server');s.par.callbacks=b.op('site_server_callbacks');s.par.port=9983;s.par.localaddress='127.0.0.1';s.par.active=True
e=b.op('poll') or b.create(executeDAT,'poll')
e.text="def onFrameStart(frame):\n    parent().op('engine').module.tick()\n    return\n"
e.par.framestart=True;e.par.active=True
b.op('engine').module.stop()
print('BORN HATER local server: http://localhost:9983')
