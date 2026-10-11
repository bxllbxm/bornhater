import json
from pathlib import Path
ROOT=Path('/Users/jeongmin/Documents/Codex/2026-10-08/task/tato/td')
b=op('/project1/born_hater_handtracking_v2')
if b is None:
    b=op('/project1').create(baseCOMP,'born_hater_handtracking_v2')
    b.nodeX=500;b.nodeY=-300
    h=b.loadTox(str(ROOT/'vendor/hand_tracking.tox'))
else:
    h=b.children[0]
(ROOT/'rebuild-inspection.json').write_text(json.dumps({'base':b.path,'children':[(n.path,n.opType) for n in b.findChildren()],'params':[(p.name,str(p.eval())) for p in h.customPars],'errors':[(n.path,n.errors()) for n in b.findChildren() if n.errors()]},indent=2),encoding='utf-8')
