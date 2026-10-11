"""Run in TD Textport; only repairs the newly created hand-tracking base."""
import json
from pathlib import Path
ROOT=Path('/Users/jeongmin/Documents/Codex/2026-10-08/task/tato/td')
b=op('/project1/born_hater_handtracking_v2')
if b is None:raise RuntimeError('New hand-tracking base is missing')
m=b.op('MediaPipe');h=b.op('hand_tracking2')
s=b.op('hand_source') or b.create(selectDAT,'hand_source')
s.par.dat=m.op('hand_results')
h.inputConnectors[0].connect(s)
h.par.w=640;h.par.h=480
m.par.Webcam=op('/project1/born_hater/MediaPipe').par.Webcam.eval()
for p in m.customPars:
    if p.name.startswith('Detect'):p.val=p.name=='Detectgestures'
m.par.Generatehandgui=True
m.op('current_url').cook(force=True)
run("m=op('/project1/born_hater_handtracking_v2/MediaPipe'); m.op('current_url').cook(force=True); r=m.op('webBrowser1/webrender1'); r.par.url=m.op('current_url').text; r.par.active=True",delayFrames=2)
(ROOT/'repair-applied.json').write_text(json.dumps({'source':s.path,'inputs':[n.path for n in h.inputs],'input_text':h.op('in1').text},indent=2),encoding='utf-8')
