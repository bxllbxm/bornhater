import json
from pathlib import Path

ROOT = Path('/Users/jeongmin/Documents/Codex/2026-10-08/task/tato')

def onHTTPRequest(dat, request, response):
    name=request['uri'].split('?')[0].lstrip('/') or 'index.html'
    allowed={'index.html':'text/html; charset=utf-8','style.css':'text/css; charset=utf-8','intro.css':'text/css; charset=utf-8','game.css':'text/css; charset=utf-8','app.js':'application/javascript; charset=utf-8','audio.js':'application/javascript; charset=utf-8','assets/punch.mp3':'audio/mpeg','assets/bgm.mp3':'audio/mpeg','assets/explode.mp3':'audio/mpeg','assets/boxing-ring.jpg':'image/jpeg','assets/boxing-ring-game.png':'image/png','assets/intro-default.jpg':'image/jpeg','assets/intro-hover.jpg':'image/jpeg'}
    if name not in allowed or not (ROOT/name).is_file():
        response.update(statusCode=404,statusReason='Not Found',data='')
    else:
        response.update(statusCode=200,statusReason='OK',data=(ROOT/name).read_bytes())
        response['content-type']=allowed[name]
        response['cache-control']='no-store'
    return response

def onWebSocketOpen(dat,client,uri):
    return

def onWebSocketReceiveText(dat,client,data):
    if len(data)>1024:return
    try: message=json.loads(data)
    except (ValueError,TypeError):return
    engine=dat.parent().op('engine').module
    if message.get('type')=='start':engine.start(dat,client,message.get('text',''))
    elif message.get('type')=='stop':engine.stop(client)
    elif message.get('type')=='frame-ack':engine.ack_preview(client)

def onWebSocketClose(dat,client):
    dat.parent().op('engine').module.stop(client)

def onWebSocketReceivePing(dat,client,data):
    dat.webSocketSendPong(client,data=data)

def onServerStop(dat):
    dat.parent().op('engine').module.stop()
