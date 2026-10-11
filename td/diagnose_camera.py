import json, time
from pathlib import Path
root=Path('/Users/jeongmin/Documents/Codex/2026-10-08/task/tato/td')
b=op('/project1/born_hater');e=b.op('engine').module;m=e.tracking();r=m.op('webBrowser1/webrender1')
revision=m.fetch('born_hater_frame',0)
try:data=json.loads(m.op('hand_results').text)
except (ValueError,TypeError):data={}
info={
 'project':str(Path(project.folder)/project.name),'play':me.time.play,
 'basePlay':b.time.play,'trackingPlay':m.time.play,'tracking':m.path,
 'trackingSource':b.fetch('tracking_source',None),
 'engine':{'client':str(e.client),'ready':e.ready,'lastFrame':e.last_frame,'began':e.began,'elapsed':time.monotonic()-e.began,'previewPending':e.preview_pending},
 'trackingRevision':revision,'revisionAge':time.monotonic()-revision if revision else None,
 'resultKeys':list(data),'handCount':len(data.get('gestureResults',{}).get('landmarks',[])),
 'resultLength':len(m.op('hand_results').text),'currentUrl':m.op('current_url').text,
 'render':{'path':r.path,'active':r.par.active.eval(),'url':r.par.url.eval(),'width':r.width,'height':r.height,'errors':r.errors(),'parameters':[p.name for p in r.pars()]},
 'custom':{p.name:str(p.eval()) for p in m.customPars if p.name=='Webcam' or p.name.startswith('Detect')},
 'baseErrors':b.errors(recurse=True),'trackingErrors':m.errors(recurse=True),
 'mpServers':[{'path':n.path,'active':n.par.active.eval(),'port':n.par.port.eval()} for n in m.children if 'webserver' in n.opType.lower()],
 'children':[(n.path,n.opType) for n in m.children],
 'siteServer':{'active':b.op('site_server').par.active.eval(),'port':b.op('site_server').par.port.eval()},
 'callbackMatch':m.op('webServer1_callbacks').text==(root/'mediapipe_callbacks.py').read_text() if m.op('webServer1_callbacks') else None,
}
(root/'camera-diagnostic.json').write_text(json.dumps(info,indent=2,default=str))
print('Camera diagnostic saved')
