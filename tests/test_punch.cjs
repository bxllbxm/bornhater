const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Browser boundaries only: actual app.js handles recognized browser gestures and paints.
function page(reduced = false, {pendingCamera = false, pendingAudio = false} = {}) {
  let drawCalls = 0, cuts = 0, clips = 0, clock = 0, next = 1, drawn = [], offset = [0,0];
  const transforms = [];
  let liquidShapes=[], liquidPath=[], maskReads=0, rasterPieces=[], rainCopies=[], rasterizations=[];
  const frames = new Map(), handlers = {};
  const ctx = new Proxy({measureText: s => ({width: s.length * 30}),
    fillText(char) { drawCalls++; drawn.push({char,x:offset[0],y:offset[1],color:this.fillStyle,glow:this.shadowBlur}); },
    clearRect() {drawn=[];liquidShapes=[];rasterPieces=[];rainCopies=[];},
    drawImage(source,...args) {if(args.length===8)rasterPieces.push({source:args.slice(0,4),rect:args.slice(4)});
      if(args.length===4)rainCopies.push({source,rect:args,x:offset[0],y:offset[1],alpha:this.globalAlpha});},
    createLinearGradient(...axis) {return {axis,stops:[],addColorStop(at,color){this.stops.push({at,color});}};},
    beginPath() {liquidPath=[];},
    moveTo(...points) {liquidPath.push({kind:'move',points});},
    lineTo(...points) {liquidPath.push({kind:'line',points});},
    bezierCurveTo(...points) {liquidPath.push({kind:'curve',points});},
    ellipse(...points) {liquidPath.push({kind:'ellipse',points});},
    getImageData(x,y,w,h) {
      maskReads++;
      const data=new Uint8ClampedArray(w*h*4);
      for(const glyph of drawn) {
        if(!glyph.char.trim())continue;
        for(let py=Math.max(0,Math.floor(glyph.y-28));py<Math.min(h,glyph.y+28);py++) {
          for(let px=Math.max(0,Math.floor(glyph.x-10));px<Math.min(w,glyph.x+10);px++) {
            // A raster boundary fixture with a transparent slit through each glyph.
            if(Math.abs(px-glyph.x)<3 && py<glyph.y+12)continue;
            data[(py*w+px)*4+3]=255;
          }
        }
      }
      return {data,width:w,height:h};
    },
    clip() {clips++;},
    translate(x,y) {offset=[offset[0]+x,offset[1]+y];},
    fill() { if (this.globalCompositeOperation === 'destination-out') cuts++;
      else liquidShapes.push({path:liquidPath.map(command=>({...command})),color:this.fillStyle,shadow:this.shadowBlur});
    },
    save() {transforms.push([...offset]);}, restore() {offset=transforms.pop();this.globalCompositeOperation = 'source-over';},
  }, {get: (o,k) => k in o ? o[k] : () => {}});
  let pixels=[],halos=[];
  const burstCtx=new Proxy({setTransform(){},clearRect(){pixels=[];halos=[];},
    createRadialGradient(...radii){return {radii,stops:[],addColorStop(at,color){this.stops.push({at,color});}};},
    fillRect(x,y,w,h){
      if(this.fillStyle?.radii)halos.push({rect:[x,y,w,h],gradient:this.fillStyle});
      else pixels.push({x,y,w,h,color:this.fillStyle,alpha:this.globalAlpha});
    }}, {get:(o,k)=>k in o?o[k]:()=>{}});
  const ids = ['intro','game','enter-site','intro-music-toggle','burst-canvas','stage','canvas','stage-text','status','meme','text-form','text-input','hate','bgm-toggle','camera-preview','camera-overlay','gesture-label','video-background'];
  const nodes = Object.fromEntries(ids.map(id => [id, {dataset:{},style:{},hidden:false,value:'MONDAY',
    clientWidth:900,clientHeight:450,addEventListener(type, fn) { handlers[id+':'+type] = fn; },
    getContext:()=>ctx,getBoundingClientRect:()=>({left:0,top:200}),setAttribute() {},removeAttribute() {},focus(){}}]));
  nodes['burst-canvas'].getContext=()=>burstCtx;
  nodes.game.hidden=true;nodes['camera-preview'].hidden=true;
  const starts = [], trackers = [], cameraRequests = [];
  class Camera {
    constructor(options) { this.options=options; this.running=false; this.stopCalls=0; trackers.push(this); }
    start() {
      starts.push(this);
      if (!pendingCamera) { this.running=true; this.options.onState('active'); return Promise.resolve(); }
      if (this.pending && !this.pending.settled) return this.pending.promise;
      const request = {settled:false};
      request.promise = new Promise((resolve,reject) => {request.resolve=resolve;request.reject=reject;});
      this.pending=request;cameraRequests.push(request);this.options.onState('awaiting-camera');
      return request.promise;
    }
    stop() {
      this.stopCalls++;this.running=false;nodes['camera-preview'].hidden=true;this.options.onState('stopped');
      if (this.pending && !this.pending.settled) {
        this.pending.settled=true;
        const error=new Error('Camera start cancelled');error.name='AbortError';this.pending.reject(error);
      }
    }
    ready() {
      this.pending.settled=true;this.running=true;this.options.onState('active');this.pending.resolve();
    }
    fail(message) {
      const error=new Error(message);
      this.pending.settled=true;this.running=false;this.options.onState('stopped');
      this.options.onError(error);this.pending.reject(error);
    }
    frame() { nodes['camera-preview'].hidden=false;this.options.onFrame(); }
  }
  const muted=[],audioState={prepared:0,source:null,sources:0,fail:false},audioRequests=[];
  const videoState={starts:[],stops:0,instance:null};
  const window = {innerWidth:900,innerHeight:700,devicePixelRatio:1,matchMedia:()=>({matches:reduced}),
    addEventListener(type,fn) {handlers[type]=fn;},
    BrowserTracking: Camera,
    GestureVideo:class {
      constructor(options){this.options=options;this.running=false;videoState.instance=this;options.host.hidden=true;}
      start(id){this.running=true;this.options.host.hidden=false;videoState.starts.push(id);this.options.onState('playing');return Promise.resolve(true);}
      stop(){this.running=false;this.options.host.hidden=true;videoState.stops++;this.options.onState('idle');}
    },
    GestureAudio: class {
      prepare(){audioState.prepared++;if(pendingAudio){return new Promise(resolve=>audioRequests.push(resolve));}return audioState.fail ? Promise.reject(new Error('Missing audio')) : Promise.resolve();}
      play(){return true;}stopHits(){}stop(){audioState.source=null;}
      startMusic(){if(!audioState.source){audioState.source={};audioState.sources++;}return true;}
      setMusicMuted(value){muted.push(value);}
    }};
  const runtime = {window,document:{body:{dataset:{background:'plain',view:'intro'}},getElementById:id=>nodes[id],createElement(){return {width:0,height:0,getContext:()=>new Proxy({drawImage(){rasterizations.push(drawn.map(g=>({...g})));}},{get:(o,k)=>k in o?o[k]:()=>{}})};},addEventListener(type,fn){handlers[type]=fn;}},
    console:{info(){},warn(){}},WebSocket:class {constructor(){throw new Error('localhost must never be required');}},Blob,location:{protocol:'https:'},URL,
    ResizeObserver:class {constructor(fn){handlers.resize=fn;}observe(){}},
    requestAnimationFrame:fn=>{const id=next++;frames.set(id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id),
    setTimeout:()=>0,clearTimeout(){}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../app.js'),'utf8'),runtime);
  function start() {
    if (nodes.game.hidden) handlers['enter-site:click']();
    return handlers['text-form:submit']({preventDefault(){}});
  }
  function gesture(effect) {trackers[0].options.onGesture(effect);}
  function inputKey(key, options={}) {
    let prevented=false;
    handlers['text-input:keydown']?.({key,...options,preventDefault(){prevented=true;}});
    // Simulate the native form's Enter submission at the browser boundary.
    if(key==='Enter' && !prevented) handlers['text-form:submit']({preventDefault(){}});
    return prevented;
  }
  function step(ms) {clock+=ms;const batch=[...frames.values()];frames.clear();batch.forEach(fn=>fn(clock));}
  function finish() {for(let i=0;frames.size && i<400;i++){clock+=25;const batch=[...frames.values()];frames.clear();batch.forEach(fn=>fn(clock));}assert.equal(frames.size,0);}
  return {nodes,body:runtime.document.body,start,gesture,finish,step,resize:()=>handlers.resize(),
    stop:()=>handlers.keydown({key:'Escape',target:{closest(){return false;}}}),
    enter:()=>handlers['enter-site:click']?.(),introMusic:()=>handlers['intro-music-toggle:click']?.(),
    leave:()=>handlers.pagehide(),back:()=>handlers.pageshow?.({persisted:true}),audioState,inputKey,
    composing:value=>handlers['text-input:composition'+(value?'start':'end')]?.(),
    toggleMusic:()=>handlers['bgm-toggle:click'](),muted,starts,trackers,cameraRequests,videoState,audioReady:()=>audioRequests.splice(0).forEach(resolve=>resolve()),
    cameraReady:()=>trackers[0].ready(),cameraFailure:message=>trackers[0].fail(message),
    cameraFrame:()=>trackers[0].frame(),cameraError:message=>trackers[0].options.onError(new Error(message)),
    draws:()=>drawCalls,cuts:()=>cuts,clips:()=>clips,painted:()=>drawn,pixels:()=>pixels,halos:()=>halos,
    liquidShapes:()=>liquidShapes,maskReads:()=>maskReads,rasterPieces:()=>rasterPieces,rainCopies:()=>rainCopies,rasterizations:()=>rasterizations};
}

async function flushCameraPromises() {
  for(let i=0;i<8;i++)await Promise.resolve();
}

test('intro entry and empty Enter share the pending automatic camera request',async()=>{
  const p=page(false,{pendingCamera:true});
  assert.equal(p.starts.length,1);assert.equal(p.cameraRequests.length,1);
  await p.enter();p.nodes['text-input'].value='';const emptySubmit=p.start();
  assert.equal(p.starts.length,1,'pending permission/model startup must not be restarted');
  p.cameraReady();await emptySubmit;
  assert.equal(p.trackers[0].running,true);assert.equal(p.nodes.status.hidden,true);
  p.gesture('heart');assert.equal(p.nodes['gesture-label'].textContent,'love');
  assert.equal(p.nodes.stage.dataset.effectCount,undefined,'camera readiness alone does not submit text');
});

test('submitting text during automatic camera startup resets the same pending session',async()=>{
  const p=page(false,{pendingCamera:true});const submit=p.start();
  assert.equal(p.starts.length,2);assert.equal(p.cameraRequests.length,1);
  assert.equal(p.nodes['stage-text'].textContent,'MONDAY');
  p.gesture('punch');assert.equal(p.nodes.stage.dataset.effectCount,undefined);
  p.cameraReady();await submit;
  p.gesture('punch');assert.equal(p.nodes.stage.dataset.punchHits,'1');
  assert.equal(p.trackers[0].stopCalls,0);p.finish();
});

test('an aborted startup cannot stop the camera reopened after a cached navigation',async()=>{
  const p=page(false,{pendingCamera:true});
  p.leave();p.back();p.cameraReady();await flushCameraPromises();
  assert.equal(p.starts.length,2);assert.equal(p.cameraRequests.length,2);
  assert.equal(p.trackers[0].stopCalls,1,'only pagehide closes the old camera');
  assert.equal(p.trackers[0].running,true);
  assert.equal(p.nodes.stage.dataset.connection,'active');assert.equal(p.nodes.status.hidden,true);
});

test('a rejected automatic startup cannot overwrite a successful empty Enter retry',async()=>{
  const p=page(false,{pendingCamera:true});
  p.cameraFailure('Camera permission denied');
  assert.equal(p.nodes.status.textContent,'Camera permission denied');
  p.enter();p.nodes['text-input'].value='';const retry=p.start();
  p.cameraReady();await retry;await flushCameraPromises();
  assert.equal(p.starts.length,2);assert.equal(p.cameraRequests.length,2);
  assert.equal(p.trackers[0].stopCalls,1,'the prior rejection must not close the retry');
  assert.equal(p.trackers[0].running,true);assert.equal(p.nodes.status.hidden,true);
  assert.equal(p.nodes.stage.dataset.connection,'active');
});

test('Enter starts the typed text while IME confirmation waits for a separate Enter',()=>{
  const p=page();p.enter();p.nodes['text-input'].value='월요일';
  assert.equal(p.inputKey('Enter',{isComposing:true}),true);
  assert.equal(p.starts.length,1,'confirming composed Korean text must not reset the automatic camera');
  p.composing(true);p.inputKey('Enter');
  assert.equal(p.starts.length,1);
  p.composing(false);p.inputKey('Enter',{keyCode:229});
  assert.equal(p.starts.length,1,'Safari IME key code also prevents premature reset');
  p.inputKey('Enter');assert.equal(p.starts.length,2);
  assert.equal(p.nodes['stage-text'].textContent,'월요일');
  assert.equal(p.nodes['stage-text'].textContent,'월요일');
});

test('camera caption follows recognized gestures and resets for a new input',()=>{
  const p=page();p.start();
  p.gesture('explode');assert.equal(p.nodes['gesture-label'].textContent,'fxxk you');
  p.gesture('crack');assert.equal(p.nodes['gesture-label'].textContent,'punch');
  p.gesture('heart');assert.equal(p.nodes['gesture-label'].textContent,'love');
  p.gesture('punch');assert.equal(p.nodes['gesture-label'].textContent,'punch');
  p.gesture('melt');assert.equal(p.nodes['gesture-label'].textContent,'melt');
  p.gesture('explode');p.start();assert.equal(p.nodes['gesture-label'].textContent,'');
});

test('automatic camera shows pose names before text without starting effects or audio',()=>{
  const p=page();
  assert.equal(p.starts.length,1,'page load starts the camera');
  assert.equal(p.trackers[0].running,true);
  assert.equal(p.audioState.prepared,0,'camera startup does not autoplay music');
  p.cameraFrame();p.gesture('heart');p.step(200);p.finish();
  assert.equal(p.nodes['gesture-label'].textContent,'love');
  assert.equal(p.body.dataset.background,'plain');
  assert.equal(p.nodes.stage.dataset.effectCount,undefined);
  assert.equal(p.nodes.stage.dataset.sfxCount,undefined);
  assert.equal(p.pixels().length,0);
  p.enter();p.gesture('explode');
  assert.equal(p.nodes['gesture-label'].textContent,'fxxk you');
  assert.equal(p.nodes.stage.dataset.effectCount,undefined,'empty game input still has no effects');
});

test('empty input can retry a camera failure without submitting text',async()=>{
  const p=page();p.enter();await Promise.resolve();
  p.cameraError('Camera permission denied');
  assert.equal(p.nodes.status.hidden,false);
  p.nodes['text-input'].value='';await p.start();
  assert.equal(p.trackers[0].running,true);
  assert.equal(p.nodes.status.hidden,true);
  assert.equal(p.nodes.stage.dataset.effectCount,undefined);
  assert.equal(p.nodes['stage-text'].textContent,'');
});

test('Escape keeps the camera streaming while pagehide releases it and back restarts it',async()=>{
  const p=page();p.start();p.cameraFrame();p.gesture('heart');p.step(0);p.step(70);
  p.stop();p.finish();
  assert.equal(p.trackers[0].running,true);
  assert.equal(p.trackers[0].stopCalls,0);
  assert.equal(p.nodes['camera-preview'].hidden,false);
  assert.equal(p.pixels().length,0);
  assert.equal(p.nodes.stage.dataset.sfxCount,undefined,'Escape cancels the pending glitter sound');
  p.leave();
  assert.equal(p.trackers[0].running,false);
  assert.equal(p.trackers[0].stopCalls,1);
  await p.back();
  assert.equal(p.trackers[0].running,true,'returning from the back-forward cache opens the camera again');
});

test('four punches accumulate damage; the fifth leaves text shattered',()=>{
  const p=page();p.start();
  let previousSpan=0;
  for(let hit=1;hit<=4;hit++) {
    const before=p.draws();p.gesture('punch');p.finish();
    assert.equal(Number(p.nodes.stage.dataset.punchHits),hit);
    assert.equal(p.nodes.stage.dataset.destroyed,'false','the text survives the first four punches');
    assert.ok(p.draws()>before,'text still paints before the final hit');
    const shards=p.painted().filter(g=>g.char==='M');
    assert.ok(p.clips()>0,'glyphs are visibly split into actual text fragments');
    if (hit<=3) {
      const span=Math.max(...shards.map(g=>g.x))-Math.min(...shards.map(g=>g.x));
      assert.ok(span>previousSpan,'crack gaps widen with repeated hits');previousSpan=span;
    }
    if (hit===4) assert.ok(shards.length<8,'late punches remove some text fragments');
  }
  p.gesture('punch');p.finish();
  assert.equal(Number(p.nodes.stage.dataset.punchHits),5);
  assert.equal(p.nodes.stage.dataset.destroyed,'true');
  assert.equal(p.painted().length,0,'the fifth punch removes every text fragment');
  assert.equal(p.nodes['stage-text'].style.visibility,'hidden');
  const gone=p.draws();p.gesture('punch');p.finish();p.resize();p.stop();
  assert.equal(p.draws(),gone,'extra gestures, resize and stop cannot resurrect the text');
  p.start();assert.equal(Number(p.nodes.stage.dataset.punchHits),0);
  assert.equal(p.nodes['stage-text'].style.visibility,'visible');
});

test('intro entry starts shared music and shows the camera already running before typing',async()=>{
  const p=page();
  assert.equal(p.audioState.prepared,0);assert.equal(p.starts.length,1);
  p.cameraFrame();
  await p.enter();
  assert.equal(p.body.dataset.view,'game');
  assert.equal(p.nodes.intro.hidden,true);assert.equal(p.nodes.game.hidden,false);
  assert.equal(p.nodes.stage.dataset.bgm,'playing');assert.equal(p.starts.length,1);
  assert.equal(p.nodes['camera-preview'].hidden,false);
  const source=p.audioState.source;
  p.start();await Promise.resolve();p.start();await Promise.resolve();
  assert.equal(p.audioState.source,source,'HATE preserves the music position across camera restarts');
  assert.equal(p.audioState.sources,1);
  p.leave();assert.equal(p.audioState.source,null,'leaving the page stops audio');
});

test('intro play and mute stay in sync with the game and can retry a failed load',async()=>{
  const p=page();p.audioState.fail=true;
  await p.introMusic();
  assert.equal(p.nodes['intro-music-toggle'].textContent,'play');
  assert.equal(p.nodes['intro-music-toggle'].disabled,false);
  p.audioState.fail=false;await p.introMusic();
  assert.equal(p.nodes['intro-music-toggle'].textContent,'mute');
  assert.equal(p.starts.length,1);
  p.introMusic();await p.enter();
  assert.equal(p.nodes.stage.dataset.bgm,'muted');
  assert.equal(p.nodes['bgm-toggle'].textContent,'PLAY');
  p.start();await Promise.resolve();
  assert.equal(p.nodes.stage.dataset.bgm,'muted');
  assert.equal(p.audioState.sources,1);
  p.toggleMusic();assert.equal(p.nodes.stage.dataset.bgm,'playing');
});

test('fist cracks do not count as punches, and a new punch can interrupt animation',()=>{
  const p=page();p.start();p.gesture('crack');p.finish();
  assert.equal(Number(p.nodes.stage.dataset.punchHits),0);
  p.gesture('punch');p.gesture('punch');p.finish();
  assert.equal(Number(p.nodes.stage.dataset.punchHits),2);
});

test('reduced motion still applies cumulative damage and final destruction',()=>{
  const p=page(true);p.start();
  for(let i=0;i<5;i++)p.gesture('punch');
  assert.equal(Number(p.nodes.stage.dataset.punchHits),5);
  assert.equal(p.nodes.stage.dataset.destroyed,'true');
  assert.equal(p.painted().length,0,'the fifth punch removes every text fragment');
  assert.equal(p.nodes['stage-text'].style.visibility,'hidden');
});


test('fractures open gradually during the hit instead of jumping straight to the final damage',()=>{
  const p=page();p.start();p.gesture('punch');p.step(0);p.step(250);
  const span=()=>{const shards=p.painted().filter(g=>g.char==='M');return Math.max(...shards.map(g=>g.x))-Math.min(...shards.map(g=>g.x));};
  const early=span();p.finish();
  assert.ok(early>0 && span()>early,'fractures widen visibly over time');
});


test('thumbs-up melt uses the meme backdrop and green letters that sink gradually',async()=>{
  const p=page();await p.start();await p.toggleMusic();p.gesture('melt');p.step(0);
  assert.equal(p.body.dataset.background,'melt');
  assert.equal(p.nodes['gesture-label'].textContent,'melt');
  const initial=p.painted();
  assert.ok(initial.length>0);
  assert.ok(initial.every(g=>g.color==='#32c91c'));
  p.step(700);
  const flowing=p.rasterPieces();
  const top=Math.min(...flowing.map(piece=>piece.rect[1])), bottom=Math.max(...flowing.map(piece=>piece.rect[1]+piece.rect[3]));
  assert.ok((top+bottom)/2>initial[0].y,'the real letter material flows downward over time');
  assert.equal(p.nodes.stage.dataset.meltPhase,'melting');
  p.finish();
  assert.equal(p.nodes.stage.dataset.meltPhase,'complete');
  assert.equal(p.painted().length,0,'melted letters disappear into the remaining green puddle');
  assert.equal(p.trackers[0].running,true);
  assert.equal(p.nodes.stage.dataset.bgm,'muted');
  p.resize();assert.equal(p.painted().length,0,'resizing keeps the completed melt');
  p.start();assert.equal(p.body.dataset.background,'plain');
  assert.equal(p.nodes['stage-text'].style.visibility,'visible');
});

test('melting makes thick connected liquid drips with soft green volume, using a cached letter mask',()=>{
  const p=page();p.start();p.gesture('melt');p.step(0);p.step(600);
  const hanging=p.liquidShapes().filter(shape=>shape.path.filter(command=>command.kind==='curve').length>=4);
  assert.ok(hanging.length>=6,'several smooth hanging drips are attached to the letters');
  const span=shape=>{const ys=shape.path.flatMap(command=>command.points.filter((_,index)=>index%2));return Math.max(...ys)-Math.min(...ys);};
  assert.ok(hanging.some(shape=>span(shape)>35),'the liquid begins to sag into joined rounded flowing mass');
  assert.ok(hanging.some(shape=>shape.color.stops?.length>=3),'soft highlights and side shadows give the drips volume');
  assert.equal(p.maskReads(),1,'the letter alpha mask is sampled once at melt start');
  p.step(550);assert.equal(p.maskReads(),1,'animation frames reuse the letter mask');
  const later=p.liquidShapes().filter(shape=>shape.path.filter(command=>command.kind==='curve').length>=4);
  const lower=shapes=>Math.max(...shapes.flatMap(shape=>shape.path.flatMap(command=>command.points.filter((_,index)=>index%2))));
  assert.ok(lower(later)>lower(hanging),'liquid material flows continuously further downward while its parent deforms');
  p.resize();p.step(0);assert.equal(p.maskReads(),2,'resize rebuilds the mask once for the new layout');
  assert.ok(p.liquidShapes().some(shape=>shape.path.filter(command=>command.kind==='curve').length>=4),'resize preserves the current liquid deformation');
  p.finish();
});

test('wet paint sags and loses rigid letter bodies before it finishes pooling',()=>{
  const p=page();p.start();p.gesture('melt');p.step(0);p.step(700);
  const early=p.rasterPieces();
  assert.ok(early.length>0,'the letter silhouette itself must deform, rather than staying rigid above attached tubes');
  const top=pieces=>Math.min(...pieces.map(piece=>piece.rect[1]));
  const bottom=pieces=>Math.max(...pieces.map(piece=>piece.rect[1]+piece.rect[3]));
  const earlyHeight=bottom(early)-top(early);
  p.step(1900);
  const late=p.rasterPieces();
  assert.ok(late.length>0);
  assert.ok(top(late)>top(early)+60,'the parent letter material visibly drains toward the floor by 2.6 seconds');
  assert.ok(bottom(late)-top(late)<earlyHeight*.65,'rigid letters collapse into shallow liquid mass before the final frame');
  assert.equal(p.painted().length,0,'no untouched font glyph remains over the flowing paint');
  assert.equal(p.maskReads(),1,'the deformation uses the cached raster, not per-frame readback');
});

test('settled wet paint forms a deep rounded multi-lobe footprint instead of a thin ellipse',()=>{
  const p=page();p.start();p.gesture('melt');p.step(0);p.finish();
  const pool=p.liquidShapes().find(shape=>shape.path.filter(command=>command.kind==='curve').length>=8);
  assert.ok(pool,'coalesced paint has several organic rounded lobes around its perimeter');
  const xs=pool.path.flatMap(command=>command.points.filter((_,index)=>index%2===0));
  const ys=pool.path.flatMap(command=>command.points.filter((_,index)=>index%2===1));
  const spread=Math.max(...xs)-Math.min(...xs),depth=Math.max(...ys)-Math.min(...ys);
  assert.ok(depth>spread*.22,'the pooled material retains substantial rounded mass rather than flattening to a stripe');
});

test('sagging letter material stays continuous without horizontal gaps',()=>{
  const p=page();p.start();p.gesture('melt');p.step(0);p.step(1500);
  const layers=new Map();
  for(const piece of p.rasterPieces()) {
    const glyph=piece.source[0]+':'+piece.source[2];
    if(!layers.has(glyph))layers.set(glyph,[]);
    layers.get(glyph).push(piece);
  }
  assert.ok(layers.size>0);
  for(const pieces of layers.values()) {
    pieces.sort((a,b)=>a.source[1]-b.source[1]);
    for(let i=1;i<pieces.length;i++) {
      const above=pieces[i-1].rect,below=pieces[i].rect;
      assert.ok(below[1]<=above[1]+above[3]+.05,'adjacent parts of a sagging stroke must touch');
    }
  }
});

test('liquid roots blend into letters with rounded closed shoulders instead of flat pasted caps',()=>{
  const p=page();p.start();p.gesture('melt');p.step(0);p.step(1500);
  const drips=p.liquidShapes().filter(shape=>shape.path.filter(command=>command.kind==='curve').length>=4);
  assert.ok(drips.length>1);
  for(const drip of drips) {
    const beginning=drip.path.find(command=>command.kind==='move').points;
    const curves=drip.path.filter(command=>command.kind==='curve');
    assert.deepEqual(curves.at(-1).points.slice(-2),beginning,'each outline returns smoothly to its origin instead of closing with a flat edge');
  }
  assert.ok(drips.length<=13,'fewer thick roots avoid a regular row of narrow ribbons');
});

test('melt finishes as a rounded irregular glossy pool at 3.6 seconds and cancels with a new effect',()=>{
  const p=page();p.start();p.gesture('melt');p.step(0);p.step(3500);
  assert.equal(p.nodes.stage.dataset.meltPhase,'melting');
  p.step(100);assert.equal(p.nodes.stage.dataset.meltPhase,'complete');
  const pool=p.liquidShapes().find(shape=>shape.path.filter(command=>command.kind==='curve').length>=6);
  assert.ok(pool,'the remaining material has a soft uneven pooled outline');
  assert.ok(pool.color.stops?.length>=3,'a broad highlight and dark lower rim remain on the pooled material');
  assert.equal(p.painted().length,0,'no intact letter bodies remain after the melt');
  p.gesture('punch');p.finish();
  assert.equal(p.body.dataset.background,'punch');
  assert.equal(p.nodes.stage.dataset.meltPhase,'idle');
  assert.ok(p.liquidShapes().every(shape=>!shape.color.stops),'cancelled liquid cannot repaint over the punch');
});

test('melt replaces heart glitter and reduced motion keeps the green scene without animation',()=>{
  const p=page();p.start();p.gesture('heart');p.step(0);p.step(350);
  assert.ok(p.pixels().length>0);
  p.gesture('melt');p.step(0);p.finish();
  assert.equal(p.body.dataset.background,'melt');
  assert.equal(p.pixels().length,0,'cancelled heart glitter cannot paint over the new backdrop');
  p.gesture('punch');p.finish();
  assert.equal(p.body.dataset.background,'punch');
  assert.equal(p.nodes.stage.dataset.punchHits,'1');
  const calm=page(true);calm.start();calm.gesture('melt');
  assert.equal(calm.body.dataset.background,'melt');
  assert.equal(calm.nodes.stage.dataset.meltPhase,'complete');
  assert.equal(calm.painted().length,0);
  assert.equal(calm.trackers[0].running,true);
});

test('middle-finger explosion switches the backdrop immediately and HATE restores it',()=>{
  const p=page();p.start();
  assert.equal(p.body.dataset.background,'plain');
  p.gesture('punch');p.finish();
  assert.equal(p.body.dataset.background,'punch');
  p.gesture('explode');
  assert.equal(p.body.dataset.background,'explosion','background switches before the animation finishes');
  p.finish();p.stop();
  assert.equal(p.body.dataset.background,'explosion','the chosen background stays until a new HATE');
  p.start();assert.equal(p.body.dataset.background,'plain');
});

test('middle finger can change the background even after five punches',()=>{
  const p=page(true);p.start();for(let i=0;i<5;i++)p.gesture('punch');
  p.gesture('explode');assert.equal(p.body.dataset.background,'explosion');
});

test('only a punch switches to the ring backdrop and renders the damaged text in light ink',()=>{
  const p=page();p.start();p.gesture('crack');p.finish();
  assert.equal(p.body.dataset.background,'plain','a closed fist alone keeps the current background');
  p.gesture('punch');p.finish();
  assert.equal(p.body.dataset.background,'punch');
  assert.ok(p.painted().length>0);
  assert.ok(p.painted().every(g=>g.color==='#fff7ed'),'damaged glyphs remain legible on the dark ring');
  p.gesture('crack');p.finish();
  assert.equal(p.body.dataset.background,'punch','small cracks preserve the ring background');
  p.start();assert.equal(p.body.dataset.background,'plain');
});

test('a punch clears an active explosion before switching to the ring backdrop',()=>{
  const p=page();p.start();p.gesture('explode');p.step(0);p.step(200);
  assert.ok(p.pixels().length>0);
  p.gesture('punch');
  assert.equal(p.body.dataset.background,'punch');
  assert.equal(p.pixels().length,0);
  assert.equal(p.nodes['burst-canvas'].dataset.state,'idle');
  p.step(500);p.finish();
  assert.equal(p.pixels().length,0,'a cancelled explosion cannot repaint over the ring');
  p.gesture('explode');assert.equal(p.body.dataset.background,'explosion');
  p.start();assert.equal(p.body.dataset.background,'plain');
});

test('a punch still switches to the ring after five hits have shattered the text',()=>{
  const p=page(true);p.start();for(let i=0;i<5;i++)p.gesture('punch');
  p.gesture('explode');assert.ok(p.pixels().length>0);
  p.gesture('punch');
  assert.equal(p.body.dataset.background,'punch');
  assert.equal(p.pixels().length,0);
  assert.equal(p.nodes.stage.dataset.punchHits,'5','changing the background does not reset damage');
});


test('explosion fills the backdrop with fiery pixels that spread and finish fading',()=>{
  const p=page();p.start();p.gesture('explode');p.step(0);p.step(100);
  const first=p.pixels().filter(q=>q.w===q.h && q.w<40);
  assert.ok(first.length>=200,'a dense pixel burst paints across the background');
  assert.ok(first.every(q=>q.x%4===0 && q.y%4===0),'pixels stay on a crisp grid');
  const span=qs=>Math.max(...qs.map(q=>q.x))-Math.min(...qs.map(q=>q.x));
  p.step(600);const spread=p.pixels().filter(q=>q.w===q.h && q.w<40);
  assert.ok(span(spread)>span(first),'the burst spreads outwards');
  p.finish();assert.equal(p.pixels().length,0,'all fiery particles clear at the end');
  p.start();assert.equal(p.pixels().length,0,'HATE clears the background animation');
});

test('reduced motion paints a static pixel burst and HATE clears it',()=>{
  const p=page(true);p.start();p.gesture('explode');
  assert.ok(p.pixels().length>0);p.finish();
  assert.ok(p.pixels().length>0,'no continuous motion in reduced-motion mode');
  p.start();assert.equal(p.pixels().length,0);
});

test('HATE cancels an active pixel burst without a late frame repainting it',()=>{
  const p=page();p.start();p.gesture('explode');p.step(0);p.step(200);
  assert.ok(p.pixels().length>0);
  p.start();p.step(500);p.finish();
  assert.equal(p.pixels().length,0);
  assert.equal(p.body.dataset.background,'plain');
});

test('PLAY/MUTE changes only BGM while camera frames and gesture effects continue',async()=>{
  const p=page();p.start();await Promise.resolve();
  p.cameraFrame();
  assert.equal(p.nodes.stage.dataset.bgm,'playing');
  p.toggleMusic();
  assert.equal(p.nodes.stage.dataset.bgm,'muted');
  assert.equal(p.nodes['bgm-toggle'].textContent,'PLAY');
  assert.equal(p.nodes['camera-preview'].hidden,false);
  assert.equal(p.trackers[0].running,true);
  assert.equal(p.trackers[0].stopCalls,0);
  p.gesture('explode');p.step(0);p.step(100);
  assert.equal(p.nodes.stage.dataset.sfx,'explode');
  assert.ok(p.pixels().length>0);
  p.cameraFrame();
  assert.equal(p.nodes['camera-preview'].dataset.frames,'2');
  p.toggleMusic();
  assert.equal(p.nodes.stage.dataset.bgm,'playing');
  assert.equal(p.nodes['bgm-toggle'].textContent,'MUTE');
  assert.equal(p.starts.length,2);
  assert.deepEqual(p.muted.slice(-2),[true,false]);
});

test('starting a new HATE keeps the BGM mute preference',async()=>{
  const p=page();p.start();await Promise.resolve();p.toggleMusic();
  p.start();await Promise.resolve();
  assert.equal(p.nodes.stage.dataset.bgm,'muted');
  assert.equal(p.nodes['bgm-toggle'].textContent,'PLAY');
});

test('two-hand heart changes the sky to blue and makes the actual text glow before bursting',()=>{
  const p=page();p.start();p.gesture('heart');
  assert.equal(p.body.dataset.background,'heart');
  assert.equal(p.nodes.meme.hidden,true,'the old heart-symbol placeholder stays hidden');
  p.step(0);p.step(70);
  assert.equal(p.nodes.stage.dataset.heartPhase,'glow');
  assert.ok(p.painted().length>0,'the entered text is still visible before the burst');
  assert.ok(p.painted().every(g=>g.color==='#ffffff' && g.glow>0));
  assert.equal(p.pixels().length,0,'falling glitter starts at the burst, not during the glow');
  p.step(330);
  assert.equal(p.nodes.stage.dataset.heartPhase,'burst');
  assert.ok(p.pixels().length>100,'white glitter covers the full viewport');
  assert.ok(p.pixels().every(q=>q.color==='#ffffff'));
});

test('heart sparkle sound starts once at the burst and survives BGM mute',async()=>{
  const p=page();p.start();await Promise.resolve();p.toggleMusic();
  p.gesture('heart');p.step(0);p.step(149);
  assert.equal(p.nodes.stage.dataset.heartPhase,'glow');
  assert.equal(p.nodes.stage.dataset.sfxCount,undefined,'the glow stays silent');
  p.step(1);
  assert.equal(p.nodes.stage.dataset.heartPhase,'burst');
  assert.equal(p.nodes.stage.dataset.sfx,'heart');
  assert.equal(p.nodes.stage.dataset.sfxCount,'1');
  assert.equal(p.nodes.stage.dataset.bgm,'muted');
  p.step(800);p.resize();p.finish();
  assert.equal(p.nodes.stage.dataset.sfxCount,'1','animation frames and resize must not repeat the clip');
  p.gesture('heart');p.finish();
  assert.equal(p.nodes.stage.dataset.sfxCount,'2','a later heart gets its own sound');
});

test('an interrupted heart never plays a delayed sparkle sound',()=>{
  const p=page();p.start();p.gesture('heart');p.step(0);p.step(70);
  p.start();p.finish();
  assert.equal(p.nodes.stage.dataset.sfxCount,undefined);
  p.gesture('heart');p.step(0);p.step(70);p.gesture('crack');p.finish();
  assert.equal(p.nodes.stage.dataset.sfx,'crack');
  assert.equal(p.nodes.stage.dataset.sfxCount,'1','only the interrupting gesture has audio');
});

test('a reduced-motion heart plays its sparkle sound once with the static glitter',()=>{
  const p=page(true);p.start();p.gesture('heart');
  assert.equal(p.nodes.stage.dataset.heartPhase,'static');
  assert.equal(p.nodes.stage.dataset.sfx,'heart');
  assert.equal(p.nodes.stage.dataset.sfxCount,'1');
  p.resize();p.finish();
  assert.equal(p.nodes.stage.dataset.sfxCount,'1');
});

test('heart glitter falls from above and finishes without restoring the exploded text',()=>{
  const p=page();p.start();p.gesture('heart');p.step(0);p.step(700);
  const first=p.pixels();p.step(300);const second=p.pixels();
  assert.ok(first.length>100);
  // Falling glitter can be smaller than 1.3px; letter-burst sparks start at 1.3px
  // and can travel upward, so they are not valid subjects for this fall assertion.
  const particle=first.find(q=>q.w<1.3 && q.y>50 && q.y<400);
  const later=second.find(q=>q.w===particle.w && q.h===particle.h);
  assert.ok(later && later.y>particle.y,'the same glitter particle travels downwards through the sky');
  p.finish();
  assert.equal(p.nodes.stage.dataset.heartPhase,'complete');
  assert.equal(p.pixels().length,0);
  assert.equal(p.nodes['stage-text'].style.visibility,'hidden');
  assert.equal(p.body.dataset.background,'heart','the blue sky remains');
});

test('HATE and punch interrupt a heart without late glitter repainting the next scene',()=>{
  const p=page();p.start();p.gesture('heart');p.step(0);p.step(700);
  p.start();p.step(200);p.finish();
  assert.equal(p.body.dataset.background,'plain');assert.equal(p.pixels().length,0);
  assert.equal(p.nodes['stage-text'].style.visibility,'visible');
  p.gesture('heart');p.step(0);p.step(700);p.gesture('punch');p.finish();
  assert.equal(p.body.dataset.background,'punch');assert.equal(p.pixels().length,0);
  assert.equal(p.nodes.stage.dataset.punchHits,'1');
});

test('heart respects reduced motion and preserves camera and muted BGM',async()=>{
  const p=page(true);p.start();await Promise.resolve();p.toggleMusic();
  p.cameraFrame();p.gesture('heart');p.finish();
  assert.equal(p.body.dataset.background,'heart');
  assert.equal(p.nodes.stage.dataset.heartPhase,'static');
  assert.ok(p.pixels().length>100);
  assert.equal(p.nodes['camera-preview'].hidden,false);
  assert.equal(p.nodes.stage.dataset.bgm,'muted');
  assert.equal(p.trackers[0].running,true);
  p.start();assert.equal(p.pixels().length,0);
});

test('heart can change the sky after five punches without bringing back destroyed text',()=>{
  const p=page();p.start();for(let i=0;i<5;i++){p.gesture('punch');p.finish();}
  const before=p.draws();p.gesture('heart');p.step(0);p.step(700);p.finish();
  assert.equal(p.body.dataset.background,'heart');assert.equal(p.draws(),before);
  assert.equal(p.nodes.stage.dataset.punchHits,'5');
  assert.equal(p.nodes.stage.dataset.destroyed,'true');
});

test('resizing during and after a heart does not restore the burst text',()=>{
  const p=page();p.start();p.gesture('heart');p.step(0);p.step(75);p.resize();
  assert.equal(p.nodes['stage-text'].style.visibility,'hidden');p.finish();p.resize();
  assert.equal(p.nodes['stage-text'].style.visibility,'hidden');
  assert.equal(p.nodes.stage.dataset.heartPhase,'complete');
});

test('resizing a reduced-motion heart preserves its static glowing text and glitter',()=>{
  const p=page(true);p.start();p.gesture('heart');p.resize();
  assert.equal(p.nodes['stage-text'].style.visibility,'hidden');
  assert.ok(p.painted().some(g=>g.color==='#ffffff' && g.glow>0));
  assert.ok(p.pixels().length>100);p.finish();
  assert.equal(p.nodes.stage.dataset.heartPhase,'static');
});

test('heart light spreads softly behind the glowing text before the glitter blast',()=>{
  const p=page();p.start();p.gesture('heart');p.step(0);p.step(20);
  const early=p.halos().find(h=>h.gradient.radii[5]>80);
  assert.ok(early,'a broad light field is actually painted behind the text');
  assert.equal(early.gradient.stops.at(-1).color,'rgba(255,255,255,0)','the light fades to transparency at its edge');
  p.step(90);const charged=p.halos().find(h=>h.gradient.radii[5]>80);
  assert.ok(charged.gradient.radii[5]>early.gradient.radii[5],'the light spreads before the burst');
  assert.equal(p.nodes.stage.dataset.heartPhase,'glow');
});

test('heart burst turns the rasterized letters into white sparkles instead of flying whole glyphs',()=>{
  const p=page();p.start();p.gesture('heart');p.step(0);p.step(150);
  const particles=p.pixels();
  assert.equal(p.painted().length,0,'whole letters stop painting at the burst');
  assert.ok(particles.length>50,'dense sparkles begin in the letter strokes');
  assert.ok(particles.every(q=>q.color==='#ffffff' && q.x>=355 && q.x<=545 && q.y>=390 && q.y<=460),
    'the initial blast comes from the rendered word, not arbitrary sky positions');
  p.step(250);
  assert.ok(p.pixels().some(q=>q.x<330 || q.x>570),'letter sparkles spread beyond the original word');
});


test('re-entering text resets damage without stopping the active browser camera',()=>{
  const p=page();p.start();p.cameraFrame();p.gesture('punch');p.finish();
  p.nodes['text-input'].value='NEW';p.start();
  assert.equal(p.trackers[0].stopCalls,0);
  assert.equal(p.nodes['camera-preview'].hidden,false);
  assert.equal(p.nodes.stage.dataset.punchHits,'0');
  assert.equal(p.nodes['stage-text'].textContent,'NEW');
  p.leave();assert.equal(p.trackers[0].running,false);
});

test('browser camera failures show their actual cause and disable effects',()=>{
  const p=page();p.start();p.cameraError('Camera permission denied');
  assert.equal(p.nodes.status.hidden,false);
  assert.equal(p.nodes.status.textContent,'Camera permission denied');
  const before=p.draws();p.gesture('punch');p.finish();assert.equal(p.draws(),before);
  assert.equal(p.nodes.hate.disabled,false);
});

test('thumbs-down rain repeats the actual Korean text and moves copies diagonally',()=>{
  const p=page();p.nodes['text-input'].value='월요일';p.start();
  p.gesture('rain');
  assert.equal(p.body.dataset.background,'rain');
  assert.equal(p.nodes['gesture-label'].textContent,'rain');
  assert.equal(p.nodes.stage.dataset.rainPhase,'falling');
  assert.equal(p.nodes['stage-text'].style.visibility,'hidden');
  const glyphs=p.rasterizations()[0];assert.deepEqual(glyphs.map(g=>g.char),Array.from('월요일'));
  assert.ok(glyphs.every(g=>g.color==='#16200b'),'copies use legible dark ink on the white meme');
  p.step(0);p.step(650);
  const before=p.rainCopies();assert.ok(before.length>=4 && before.length<=48);
  assert.ok(new Set(before.map(copy=>copy.source)).size===1,'the actual text is cached once');
  p.step(120);const after=p.rainCopies();
  assert.ok(after[0].x>before[0].x && after[0].y>before[0].y,'wind moves text down and sideways');
  assert.equal(p.maskReads(),0,'rain never reads camera or canvas pixels per frame');
  p.finish();assert.equal(p.nodes.stage.dataset.rainPhase,'complete');
  assert.equal(p.rainCopies().length,0);assert.equal(p.nodes['stage-text'].style.visibility,'hidden');
});

test('rain preserves camera, muted BGM and the punch damage already present',async()=>{
  const p=page();await p.start();p.cameraFrame();await p.toggleMusic();
  p.gesture('punch');p.finish();const oldClips=p.clips();
  p.gesture('rain');p.step(0);p.step(900);
  assert.ok(p.clips()>oldClips,'the cached phrase retains fractured glyphs');
  assert.equal(p.nodes.stage.dataset.punchHits,'1');
  assert.equal(p.nodes.stage.dataset.bgm,'muted');
  assert.equal(p.trackers[0].running,true);assert.equal(p.trackers[0].stopCalls,0);
  assert.equal(p.nodes['camera-preview'].hidden,false);
  assert.equal(p.nodes.stage.dataset.sfx,'impact','rain does not add an unrequested sound');
});

test('rain resize keeps the elapsed motion and completion never restores the text',()=>{
  const p=page();p.start();p.gesture('rain');p.step(0);p.step(700);
  p.nodes.stage.clientWidth=700;p.nodes.stage.clientHeight=360;p.resize();
  assert.equal(p.nodes.stage.dataset.rainPhase,'falling');p.step(0);
  assert.ok(p.rainCopies().length>0,'resize retains elapsed rainfall instead of restarting');
  p.finish();p.resize();p.step(1000);
  assert.equal(p.nodes.stage.dataset.rainPhase,'complete');
  assert.equal(p.rainCopies().length,0);assert.equal(p.nodes['stage-text'].style.visibility,'hidden');
});

test('Enter and other effects cancel rain without stale frames painting again',()=>{
  for(const replacement of ['input','punch','heart','melt','explode','pagehide']) {
    const p=page();p.start();p.gesture('rain');p.step(0);p.step(650);
    assert.ok(p.rainCopies().length>0);
    if(replacement==='input'){p.nodes['text-input'].value='새 문장';p.start();}
    else if(replacement==='pagehide')p.leave();else p.gesture(replacement);
    p.step(250);p.finish();
    assert.equal(p.nodes.stage.dataset.rainPhase,'idle',replacement);
    assert.equal(p.rainCopies().length,0,replacement);
    if(replacement==='input')assert.equal(p.nodes['stage-text'].textContent,'새 문장');
  }
});

test('five punches allow the rain photo but cannot resurrect destroyed letters',()=>{
  const p=page();p.start();for(let i=0;i<5;i++){p.gesture('punch');p.finish();}
  p.gesture('rain');p.step(500);p.finish();p.resize();
  assert.equal(p.body.dataset.background,'rain');assert.equal(p.nodes.stage.dataset.destroyed,'true');
  assert.equal(p.rainCopies().length,0);assert.equal(p.painted().length,0);
  assert.equal(p.nodes['stage-text'].style.visibility,'hidden');
});

test('reduced motion rain shows a static readable arrangement and keeps it on resize',()=>{
  const p=page(true);p.start();p.gesture('rain');
  assert.equal(p.body.dataset.background,'rain');assert.equal(p.nodes.stage.dataset.rainPhase,'static');
  assert.ok(p.rainCopies().length>=3 && p.rainCopies().length<=12);
  const original=p.rainCopies().map(c=>[c.x,c.y]);p.step(1000);p.finish();
  assert.deepEqual(p.rainCopies().map(c=>[c.x,c.y]),original);
  p.resize();assert.equal(p.nodes.stage.dataset.rainPhase,'static');assert.ok(p.rainCopies().length>=3);
});

test('an open palm starts the selected video without text and preserves muted BGM and camera',async()=>{
  const p=page();await p.start();p.cameraFrame();await p.toggleMusic();
  p.gesture('video');
  assert.equal(p.body.dataset.background,'video');assert.equal(p.nodes['gesture-label'].textContent,'video');
  assert.deepEqual(p.videoState.starts,['assets/palm-background.mp4']);assert.equal(p.nodes['video-background'].hidden,false);
  assert.equal(p.nodes['stage-text'].textContent,'');assert.equal(p.nodes['stage-text'].style.visibility,'hidden');
  assert.equal(p.painted().length,0);assert.equal(p.pixels().length,0);
  assert.equal(p.nodes.stage.dataset.videoState,'playing');assert.equal(p.nodes.stage.dataset.bgm,'muted');
  assert.equal(p.trackers[0].running,true);assert.equal(p.trackers[0].stopCalls,0);
  const starts=p.videoState.starts.length;p.resize();assert.equal(p.videoState.starts.length,starts,'resize does not restart playback');
  assert.equal(p.painted().length,0);assert.equal(p.nodes['stage-text'].style.visibility,'hidden');
  await p.toggleMusic();assert.equal(p.videoState.instance.running,true,'BGM button cannot pause the video');
});

test('open palm can show the video without entering text after leaving the intro',()=>{
  const p=page();p.nodes['text-input'].value='';p.gesture('video');
  assert.equal(p.videoState.starts.length,0,'intro does not load the video');
  p.enter();p.gesture('video');assert.deepEqual(p.videoState.starts,['assets/palm-background.mp4']);
  assert.equal(p.body.dataset.background,'video');
});

test('new text, other gestures and page exit remove the video and retain ordinary effect behavior',()=>{
  for(const replacement of ['input','punch','rain','heart','melt','explode','escape','pagehide']) {
    const p=page();p.start();p.gesture('video');assert.equal(p.videoState.instance.running,true);
    if(replacement==='input')p.start();else if(replacement==='pagehide')p.leave();else if(replacement==='escape')p.stop();else p.gesture(replacement);
    assert.equal(p.videoState.instance.running,false,replacement);assert.equal(p.nodes['video-background'].hidden,true,replacement);
    p.finish();
  }
});

test('video background preserves existing cracks and never resurrects five-hit destruction',()=>{
  const p=page();p.start();p.gesture('punch');p.finish();const before=p.clips();p.gesture('video');
  assert.equal(p.clips(),before);assert.equal(p.painted().length,0);assert.equal(p.nodes.stage.dataset.punchHits,'1');
  p.gesture('crack');p.finish();assert.ok(p.clips()>before,'leaving video restores existing damage');
  for(let i=1;i<5;i++){p.gesture('punch');p.finish();}
  p.gesture('video');p.resize();
  assert.equal(p.videoState.instance.running,true);assert.equal(p.nodes.stage.dataset.destroyed,'true');
  assert.equal(p.painted().length,0);assert.equal(p.nodes['stage-text'].style.visibility,'hidden');
});

test('palm video suppresses playing BGM and restores its prior setting on exit',async()=>{
  const p=page();await p.start();await flushCameraPromises();p.cameraFrame();
  assert.equal(p.nodes.stage.dataset.bgm,'playing');const source=p.audioState.source;
  p.gesture('video');assert.equal(p.nodes.stage.dataset.bgm,'muted');assert.equal(p.muted.at(-1),true);
  assert.equal(p.nodes['bgm-toggle'].disabled,true);assert.equal(p.nodes['intro-music-toggle'].disabled,true);
  await p.toggleMusic();assert.equal(p.nodes.stage.dataset.bgm,'muted','BGM cannot be enabled under the video');
  assert.equal(p.trackers[0].running,true);assert.equal(p.audioState.source,source,'music timeline remains intact');
  p.gesture('rain');assert.equal(p.nodes.stage.dataset.bgm,'playing');assert.equal(p.muted.at(-1),false);
  assert.equal(p.nodes['bgm-toggle'].disabled,false);assert.equal(p.audioState.source,source);p.finish();
});

test('video exit respects a previously muted BGM preference',async()=>{
  const p=page();await p.start();await p.toggleMusic();p.gesture('video');await p.toggleMusic();
  p.nodes['text-input'].value='새 문장';await p.start();
  assert.equal(p.nodes.stage.dataset.bgm,'muted');assert.equal(p.muted.at(-1),true);
  assert.equal(p.nodes['bgm-toggle'].disabled,false);assert.equal(p.trackers[0].running,true);
});

test('a late audio preparation cannot enable BGM while the video is active',async()=>{
  const p=page(false,{pendingAudio:true});await p.start();p.gesture('video');
  assert.equal(p.nodes['bgm-toggle'].disabled,true);p.audioReady();await flushCameraPromises();
  assert.equal(p.nodes.stage.dataset.audio,'ready');assert.equal(p.nodes.stage.dataset.bgm,'muted');
  assert.equal(p.muted.at(-1),true);p.gesture('punch');
  assert.equal(p.nodes.stage.dataset.bgm,'playing');assert.equal(p.muted.at(-1),false);p.finish();
});

test('loading, blocked and paused video keep BGM off; true video errors release it',async()=>{
  const p=page();await p.start();await flushCameraPromises();
  for(const state of ['loading','ready','playing','paused','buffering','ended','blocked']){
    p.videoState.instance.options.onState(state);assert.equal(p.nodes.stage.dataset.bgm,'muted',state);
    assert.equal(p.nodes['bgm-toggle'].disabled,true,state);
  }
  p.videoState.instance.options.onState('error');assert.equal(p.nodes.stage.dataset.bgm,'playing');
  assert.equal(p.nodes['bgm-toggle'].disabled,false);
});

test('recovered video clears its own playback prompt while preserving camera errors',async()=>{
  const p=page();await p.start();p.gesture('video');
  const callback=p.videoState.instance.options;
  callback.onState('blocked');callback.onError('영상의 재생 버튼을 눌러주세요.');
  assert.equal(p.nodes.status.hidden,false);
  callback.onState('playing');assert.equal(p.nodes.status.hidden,true);assert.equal(p.nodes.status.textContent,'');
  callback.onState('blocked');callback.onError('영상의 재생 버튼을 눌러주세요.');
  p.nodes.status.textContent='Camera unavailable';p.nodes.status.hidden=false;
  callback.onState('playing');assert.equal(p.nodes.status.hidden,false);assert.equal(p.nodes.status.textContent,'Camera unavailable');
});

test('leaving video for a reduced-motion effect restores the input text', () => {
  const p=page(true);p.start();p.gesture('video');assert.equal(p.nodes['stage-text'].textContent,'');
  p.gesture('explode');assert.equal(p.nodes['stage-text'].textContent,'MONDAY');
  assert.equal(p.nodes['stage-text'].style.visibility,'visible');
});
