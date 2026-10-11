import json, time
from pathlib import Path
root=Path('/Users/jeongmin/Documents/Codex/2026-10-08/task/tato/td')
m=op('/project1/born_hater/engine').module.tracking()
start=m.fetch('camera_probe_started',time.monotonic())
text=m.op('hand_results').text
try:result=json.loads(text)
except (ValueError,TypeError):result={}
records=m.fetch('camera_probe_records',[])
records.append({'elapsed':time.monotonic()-start,'resultLength':len(text),'keys':list(result),'revision':m.fetch('born_hater_frame',0),'active':m.op('webBrowser1/webrender1').par.active.eval()})
m.store('camera_probe_records',records)
(root/'camera-start-timing.json').write_text(json.dumps(records,indent=2))
if 'gestureResults' in result or time.monotonic()-start>45:
    (root/'camera-start-render.png').write_bytes(m.op('webBrowser1/webrender1').saveByteArray('.png'))
else:
    run("exec(open('/Users/jeongmin/Documents/Codex/2026-10-08/task/tato/td/poll_camera_start.py').read())",delayFrames=30)
