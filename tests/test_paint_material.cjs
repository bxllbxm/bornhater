const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

// Only browser/GPU boundaries are stubbed. No shader test hook is shipped.
function renderer({unsupported=false,compileFailure=false,gpuError=false}={}) {
  const calls=[],events={},deleted=[];
  let lost=false,next=0;
  const gl={
    VERTEX_SHADER:1,FRAGMENT_SHADER:2,COMPILE_STATUS:3,LINK_STATUS:4,
    ARRAY_BUFFER:5,STATIC_DRAW:6,FLOAT:7,TRIANGLE_STRIP:8,TEXTURE_2D:9,
    TEXTURE0:100,TEXTURE1:101,TEXTURE2:102,TEXTURE_MIN_FILTER:10,
    TEXTURE_MAG_FILTER:11,LINEAR:12,TEXTURE_WRAP_S:13,TEXTURE_WRAP_T:14,
    CLAMP_TO_EDGE:15,RGBA:16,UNSIGNED_BYTE:17,FRAMEBUFFER:18,
    COLOR_ATTACHMENT0:19,FRAMEBUFFER_COMPLETE:20,UNPACK_FLIP_Y_WEBGL:21,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL:22,COLOR_BUFFER_BIT:23,NO_ERROR:0,
    createShader:()=>({kind:'shader',id:++next}),
    shaderSource(shader,source){calls.push({type:'shader-source',shader,source});},compileShader(){},
    getShaderParameter:()=>!compileFailure,getShaderInfoLog:()=>'',
    createProgram:()=>{calls.push({type:'program-created'});return {kind:'program',id:++next};},attachShader(){},linkProgram(){},
    getProgramParameter:()=>true,getProgramInfoLog:()=>'',getAttribLocation:()=>0,
    getUniformLocation:(p,n)=>n,createBuffer:()=>({kind:'buffer',id:++next}),
    bindBuffer(){},bufferData(){},enableVertexAttribArray(){},vertexAttribPointer(){},
    createTexture:()=>{calls.push({type:'texture-created'});return {kind:'texture',id:++next};},bindTexture(){},texParameteri(){},
    texImage2D(...args){calls.push({type:'upload',source:args[args.length-1]});},
    activeTexture(){},pixelStorei(){},createFramebuffer:()=>({kind:'framebuffer',id:++next}),
    bindFramebuffer(){},framebufferTexture2D(){},checkFramebufferStatus:()=>20,
    viewport(){},useProgram(){},uniform1i(){},uniform1f(){},uniform2f(){},
    clearColor(){},clear(){},drawArrays(){calls.push({type:'gpu-draw'});},
    getError:()=>gpuError?1282:0,isContextLost:()=>lost,
  };
  for(const kind of ['Shader','Program','Buffer','Texture','Framebuffer']) {
    gl['delete'+kind]=object=>{if(object)deleted.push(object);};
  }
  const canvas={width:1,height:1,getContext:()=>unsupported?null:gl,
    addEventListener:(name,fn)=>{events[name]=fn;},
    removeEventListener:(name)=>{delete events[name];}};
  const scratch={width:1,height:1,getContext:()=>({
    drawImage(...args){calls.push({type:'downsample',args});},
  })};
  let creates=0;
  const input={width:1800,height:1200};
  const ctx={globalAlpha:.7,globalCompositeOperation:'source-over',shadowBlur:12,
    save(){calls.push({type:'save'});},restore(){calls.push({type:'restore'});},
    setTransform(...args){calls.push({type:'transform',args});},
    clearRect(){calls.push({type:'erase'});},
    drawImage(...args){calls.push({type:'composite',args});}};
  const runtime={window:{},document:{createElement:()=>creates++===0?canvas:scratch},Float32Array,
    Math,Number,console:{warn(){}}};
  const file=path.join(__dirname,'../paint-material.js');
  if(fs.existsSync(file))vm.runInNewContext(fs.readFileSync(file,'utf8'),runtime);
  assert.equal(typeof runtime.window.WetPaintMaterial,'function','wet paint material is available');
  const material=new runtime.window.WetPaintMaterial();
  return {material,ctx,input,canvas,scratch,calls,events,deleted,gl,
    lose(){lost=true;events.webglcontextlost?.({preventDefault(){}});},
    paint:(w=900,h=600,p=.5)=>material.paint(ctx,input,w,h,p)};
}

test('wet surface snapshots the connected alpha before atomically replacing the input',()=>{
  const r=renderer();assert.equal(r.paint(),true);
  const capture=r.calls.findIndex(call=>call.type==='downsample'&&call.args[0]===r.input);
  const upload=r.calls.findIndex(call=>call.type==='upload'&&call.source===r.scratch);
  const composite=r.calls.findIndex(call=>call.type==='composite');
  assert.ok(capture>=0&&upload>capture&&composite>upload,'the source is captured before destination changes');
  assert.equal(r.calls.some(call=>call.type==='erase'),false,'the working melt is never cleared');
  assert.deepEqual(r.calls[composite].args.slice(1),[0,0,1800,1200]);
  assert.equal(r.calls[r.calls.length-1].type,'restore');
});

test('repeated frames reuse shader programs and texture resources',()=>{
  const r=renderer();assert.equal(r.paint(),true);
  const allocations=r.calls.filter(call=>call.type.endsWith('-created')).length;
  r.paint(900,600,.75);r.paint(900,600,1);
  assert.equal(r.calls.filter(call=>call.type==='composite').length,3);
  // Resource deletion is a public lifetime boundary: frames must not churn GPU objects.
  assert.equal(r.deleted.filter(object=>object.kind==='program'||object.kind==='texture').length,0);
  assert.equal(r.calls.filter(call=>call.type.endsWith('-created')).length,allocations);
});

test('wide and tall canvases resize within bounded GPU dimensions',()=>{
  const r=renderer();assert.equal(r.paint(3600,1600),true);
  assert.ok(r.canvas.width<=800&&r.canvas.height<=600);
  assert.equal(r.paint(500,2400),true);
  assert.ok(r.canvas.width<=800&&r.canvas.height<=600);
  assert.ok(r.canvas.height>r.canvas.width,'portrait output is not stretched into a wide buffer');
});

test('DPR source images are downsampled before uploading to the GPU',()=>{
  const r=renderer();r.input.width=7200;r.input.height=4800;
  assert.equal(r.paint(3600,2400),true);
  const uploaded=r.calls.find(call=>call.type==='upload'&&call.source===r.scratch);
  assert.ok(uploaded,'a bounded snapshot is uploaded');
  assert.ok(uploaded.source.width<=800&&uploaded.source.height<=600);
});

test('an unavailable GPU leaves the original melt untouched',()=>{
  const r=renderer({unsupported:true});assert.equal(r.paint(),false);
  assert.equal(r.calls.length,0);assert.equal(r.paint(),false);
});

test('shader compilation or GPU draw failure keeps the working Canvas2D fallback',()=>{
  for(const options of [{compileFailure:true},{gpuError:true}]) {
    const r=renderer(options);assert.equal(r.paint(),false);
    assert.equal(r.calls.some(call=>['erase','composite'].includes(call.type)),false);
  }
});

test('context loss disables compositing without removing the existing melt',()=>{
  const r=renderer();assert.equal(r.paint(),true);r.calls.length=0;r.lose();
  assert.equal(r.paint(),false);assert.equal(r.calls.length,0);
});

test('dispose frees GPU resources exactly once and cannot be reopened accidentally',()=>{
  const r=renderer();assert.equal(r.paint(),true);r.material.dispose();
  for(const kind of ['program','shader','texture','buffer','framebuffer']) {
    assert.ok(r.deleted.some(object=>object.kind===kind),kind+' objects are freed');
  }
  const count=r.deleted.length;r.material.dispose();assert.equal(r.deleted.length,count);
  r.calls.length=0;assert.equal(r.paint(),false);assert.equal(r.calls.length,0);
  assert.equal(Object.keys(r.events).length,0,'context listeners do not outlive the material');
});

test('zero-size and missing source frames fail harmlessly',()=>{
  const r=renderer();assert.equal(r.paint(0,500),false);
  assert.equal(r.material.paint(r.ctx,null,900,600,.5),false);
  assert.equal(r.calls.length,0);
});

test('empty pixels bypass expensive shading while tiny ink and contact shadows remain',()=>{
  const r=renderer();assert.equal(r.paint(),true);
  // Inspect the actual shader passed to WebGL, then execute only its scalar guard.
  // This detects an over-broad optimisation that would clip antialiasing or soft shadows.
  const shader=r.calls.find(call=>call.type==='shader-source'&&call.source.includes('vec3 reflected')).source;
  const guard=/if\s*\(([^)]*)\)\s*\{\s*gl_FragColor\s*=\s*vec4\(0\.0\);\s*return;\s*\}/.exec(shader);
  assert.ok(guard,'the empty-pixel branch exists');
  assert.ok(guard.index<shader.indexOf('float dx ='),'empty pixels skip height gradients and reflections');
  assert.ok(shader.indexOf('float contactMask =')<guard.index,'the contact shadow is checked before skipping');
  for(const [ink,contactMask,skip] of [[0,0,true],[1e-7,0,false],[0,1e-7,false],[1,0,false]]) {
    assert.equal(vm.runInNewContext(guard[1],{ink,contactMask}),skip);
  }
});
