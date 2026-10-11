import importlib.util
import json
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent if '__file__' in globals() else Path(project.folder)
spec=importlib.util.spec_from_file_location('born_hater_gestures', ROOT / 'gestures.py')
rules=importlib.util.module_from_spec(spec);spec.loader.exec_module(rules)
client=None
detector=rules.Detector()
last=''
last_frame=0
began=0
ready=False
preview_pending=False
preview_at=0
preview_failed=False

def tracking():
    return op(me.parent().fetch('tracking_source',me.parent().path+'/MediaPipe'))

def send(message):
    if client is not None:me.parent().op('site_server').webSocketSendText(client,json.dumps(message))

def ack_preview(peer):
    global preview_pending
    if peer==client:preview_pending=False

def send_preview(now):
    global preview_pending,preview_at,preview_failed
    if client is None or not ready or preview_failed or preview_pending or now-preview_at<.125:return
    try:
        # This TOP already contains MediaPipe's tracking overlay. Keep frames in memory.
        image=tracking().op('webBrowser1/webrender1').saveByteArray('.jpg',quality=.65)
        me.parent().op('site_server').webSocketSendBinary(client,image)
        preview_pending=True;preview_at=now
        me.parent().store('preview_sent_at',now)
        me.parent().store('preview_frames',me.parent().fetch('preview_frames',0)+1)
    except Exception as error:
        preview_failed=True
        me.parent().store('preview_error',str(error))
        send({'type':'preview-error','message':'추적 화면을 보내지 못했어요. TouchDesigner 연결을 확인해주세요.'})

def start(server,peer,text):
    global client,detector,last,began,ready,last_frame,preview_pending,preview_at,preview_failed
    if client is not None and client!=peer:
        server.webSocketSendText(peer,json.dumps({'type':'error','message':'다른 창에서 카메라를 사용 중이에요.'}));return
    if not isinstance(text,str) or not text.strip() or len(text)>80:return
    client=peer;detector=rules.Detector();last='';began=time.monotonic();ready=False;last_frame=0
    preview_pending=False;preview_at=0;preview_failed=False
    me.parent().store('preview_frames',0);me.parent().store('preview_error',None)
    m=tracking();r=m.op('webBrowser1/webrender1')
    r.par.url=m.op('current_url').text
    r.par.active=True
    # Clear earlier camera results: startup acknowledgement requires a new frame.
    m.op('hand_results').text=''

def stop(peer=None):
    global client,ready,last,preview_pending
    if peer is not None and peer!=client:return
    r=tracking().op('webBrowser1/webrender1')
    r.par.url='about:blank';r.par.active=False
    client=None;ready=False;last='';preview_pending=False

def tick():
    global last,last_frame,ready
    if client is None:return
    now=time.monotonic()
    source=tracking().op('hand_results')
    # The DAT revision changes even if no hand is in the frame.
    revision=tracking().fetch('born_hater_frame',0)
    if revision==last_frame:
        if now-began>12 and not ready:
            send({'type':'error','message':'카메라를 시작하지 못했어요. TouchDesigner 카메라 권한을 확인해주세요.'});stop()
        return
    last_frame=revision
    try:data=json.loads(source.text)
    except (ValueError,TypeError):return
    if 'gestureResults' not in data:return
    if not ready:
        ready=True;send({'type':'started'})
    send_preview(now)
    result=detector.update(data['gestureResults'],now)
    if result:
        me.parent().store('last_real_gesture',{'effect':result,'at':now})
        send({'type':'gesture','effect':result})
