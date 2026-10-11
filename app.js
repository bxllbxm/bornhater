'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const stage = $('stage'), canvas = $('canvas'), ctx = canvas.getContext('2d');
  const textNode = $('stage-text'), status = $('status');
  const gestureLabel = $('gesture-label'), textInput = $('text-input');
  let composing = false;
  const reduced = { checked: window.matchMedia('(prefers-reduced-motion: reduce)').matches };
  let text = '', frame = 0, generation = 0, punchHits = 0, damageView = 0, meltProgress = null, meltScene = null;
  let rainElapsed = null, rainScene = null;
  const hitsToBreak = 5;
  // Spread the original fracture range over the hits before the final shatter.
  const damageForHits = hits => Math.min(hits, hitsToBreak - 1) * 9 / (hitsToBreak - 1);
  const ink = () => document.body.dataset.background === 'rain' ? '#16200b' : document.body.dataset.background === 'melt' ? '#32c91c' : document.body.dataset.background === 'heart' ? '#ffffff' : '#fff7ed';
  let width = 0, height = 0, wetPaintMaterial = null;
  // User-supplied music plays locally through the site audio context.
  const BGM_URL = 'assets/bgm.mp3';
  const audio = new window.GestureAudio({bgmUrl: BGM_URL});
  let videoMusicSuppressed = false, videoStatusMessage = null;
  const videoBackdrop = new window.GestureVideo({
    host:$('video-background'),
    onState(state) {
      stage.dataset.videoState = state;
      suppressMusicForVideo(!['idle','error'].includes(state));
      if (['loading','playing','idle'].includes(state) && videoStatusMessage) {
        if (status.textContent === videoStatusMessage) { status.hidden = true; status.textContent = ''; }
        videoStatusMessage = null;
      }
    },
    onError(message) { videoStatusMessage = message; status.hidden = false; status.textContent = message; }
  });
  const burstCanvas = $('burst-canvas'), burstCtx = burstCanvas.getContext('2d');
  let burstFrame = 0, burstToken = 0, burstWidth = 0, burstHeight = 0;
  let heartSoundPlayed = false;
  function resizeBurst() {
    burstWidth = window.innerWidth; burstHeight = window.innerHeight;
    const ratio = Math.min(window.devicePixelRatio || 1,1.5);
    burstCanvas.width = Math.round(burstWidth*ratio); burstCanvas.height = Math.round(burstHeight*ratio);
    burstCtx.setTransform(ratio,0,0,ratio,0,0);
  }
  function stopBurst() {
    burstToken++; cancelAnimationFrame(burstFrame); burstFrame = 0;
    burstCtx.clearRect(0,0,burstWidth,burstHeight); burstCanvas.dataset.state = 'idle';
    if (burstCanvas.dataset.effect === 'heart') stage.dataset.heartPhase = 'idle';
    burstCanvas.dataset.effect = '';
  }
  function startBurst() {
    stopBurst(); resizeBurst(); document.body.dataset.background = 'explosion';
    burstCanvas.dataset.effect = 'explode';
    const token = burstToken, count = burstWidth < 600 ? 340 : 560;
    const palette = ['#fff7b1','#ffd05a','#ff8b22','#ff4b17','#a82a12'];
    const particles = Array.from({length:count},(_,i) => {
      const angle = Math.random()*Math.PI*2, speed = (130+Math.random()*530)*Math.min(burstWidth/900,1.4);
      const plume = i%4===0;
      return {x:burstWidth*.5+(Math.random()-.5)*65,y:burstHeight*.68+(Math.random()-.5)*45,
        vx:plume ? (Math.random()-.5)*100 : Math.cos(angle)*speed,
        vy:plume ? -280-Math.random()*450 : Math.sin(angle)*speed*.75-180,
        size:8+Math.floor(Math.random()*5)*4,life:2.4+Math.random()*2.2,color:i%3};
    });
    function paint(time) {
      burstCtx.clearRect(0,0,burstWidth,burstHeight);
      const travel = (1-Math.exp(-time*.55))/.55;
      for (const p of particles) {
        if (time>=p.life) continue;
        const fade = Math.min(1,(p.life-time)/1.2);
        const x = Math.round((p.x+p.vx*travel)/4)*4;
        const y = Math.round((p.y+p.vy*travel+100*time*time)/4)*4;
        const size = Math.max(4,Math.round(p.size*(1-time/p.life*.65)/4)*4);
        burstCtx.globalAlpha = fade;
        burstCtx.fillStyle = palette[Math.min(4,p.color+Math.floor(time*.65))];
        burstCtx.fillRect(x,y,size,size);
        if (time>.25) {
          burstCtx.globalAlpha = fade*.2; burstCtx.fillStyle = '#ff5b17';
          burstCtx.fillRect(x,y+size,size,Math.max(4,size/2));
        }
      }
      burstCtx.globalAlpha = 1;
    }
    if (reduced.checked) { paint(.6); burstCanvas.dataset.state = 'static'; return; }
    let began;
    burstCanvas.dataset.state = 'playing';
    function tick(now) {
      if (token!==burstToken) return;
      if (began===undefined) began=now;
      const time=(now-began)/1000; paint(time);
      if (time<4.6) burstFrame=requestAnimationFrame(tick);
      else {burstFrame=0;burstCtx.clearRect(0,0,burstWidth,burstHeight);burstCanvas.dataset.state='complete';}
    }
    burstFrame=requestAnimationFrame(tick);
  }
  function startHeart(items) {
    stopBurst(); resizeBurst(); document.body.dataset.background = 'heart';
    textNode.style.visibility = 'hidden';
    const token = burstToken, glowTime = items.length ? .15 : 0, endTime = glowTime + 7;
    function playBurstSound() {
      if (heartSoundPlayed) return;
      heartSoundPlayed = true;
      sound('heart');
    }
    burstCanvas.dataset.effect = 'heart'; burstCanvas.dataset.state = 'playing';
    const box=stage.getBoundingClientRect(), centerX=box.left+width/2, centerY=box.top+height/2;
    const textWidth=items.length ? Math.max(...items.map(p=>p.x+p.w/2))-Math.min(...items.map(p=>p.x-p.w/2)) : 160;
    const lightRadius=Math.min(burstWidth*.44,Math.max(175,textWidth*.8));
    // Read the actual letter alpha mask, including damage already caused by punches.
    const points=[];
    if (items.length && !reduced.checked) {
      ctx.clearRect(0,0,width,height);ctx.shadowBlur=0;
      items.forEach(item=>drawGlyph(item));
      const mask=ctx.getImageData(0,0,canvas.width,canvas.height), ratio=canvas.width/width;
      const stride=Math.max(3,Math.round(3*ratio));
      for(let y=0;y<mask.height;y+=stride) for(let x=0;x<mask.width;x+=stride) {
        if(mask.data[(y*mask.width+x)*4+3]>120) points.push({x:box.left+x/ratio,y:box.top+y/ratio});
      }
      ctx.clearRect(0,0,width,height);
    }
    const limit=burstWidth<600 ? 700 : 1200, count=Math.min(limit,points.length);
    const sparks=Array.from({length:count},(_,i)=>{
      const p=points[Math.floor(i*points.length/count)], angle=Math.atan2(p.y-centerY,p.x-centerX)+(Math.random()-.5)*1.8;
      const speed=420+Math.random()*850;
      return {...p,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed*.75-170,
        size:1.3+Math.random()*2.7,phase:Math.random()*Math.PI*2,star:i%7===0,life:2.6+Math.random()*1.4};
    });
    stage.dataset.heartParticles=String(sparks.length);
    const glitter = Array.from({length:burstWidth<600 ? 420 : 760},(_,i)=>({
      x:Math.random()*burstWidth,y:(Math.random()*1.2-.3)*burstHeight,
      speed:100+Math.random()*180,size:i%9===0 ? 4+Math.random()*6 : .8+Math.random()*2.2,
      sway:8+Math.random()*25,phase:Math.random()*Math.PI*2,star:i%9===0
    }));
    function star(x,y,size) {
      burstCtx.beginPath();
      burstCtx.moveTo(x,y-size);burstCtx.lineTo(x+size*.14,y-size*.14);
      burstCtx.lineTo(x+size,y);burstCtx.lineTo(x+size*.14,y+size*.14);
      burstCtx.lineTo(x,y+size);burstCtx.lineTo(x-size*.14,y+size*.14);
      burstCtx.lineTo(x-size,y);burstCtx.lineTo(x-size*.14,y-size*.14);
      burstCtx.closePath();burstCtx.fill();
    }
    function light(charge,time,flash=0) {
      const radius=lightRadius*(1.05+charge*.65)+flash*160;
      const breath=.98+.02*Math.sin(time*1.3);
      // Smooth light falloff across the canvas, with no outlined shape or ray geometry.
      function bloom(size,strength) {
        const gradient=burstCtx.createRadialGradient(centerX,centerY,0,centerX,centerY,size);
        for(const [at,falloff] of [[0,1],[.12,.87],[.25,.55],[.42,.19],[.62,.045],[.82,.008],[1,0]]) {
          gradient.addColorStop(at,`rgba(255,255,255,${Math.min(1,strength*falloff)})`);
        }
        burstCtx.fillStyle=gradient;
        burstCtx.fillRect(0,0,burstWidth,burstHeight);
      }
      burstCtx.save();burstCtx.globalCompositeOperation='screen';
      bloom(radius,(.18+charge*.26+flash*.28)*breath);
      bloom(radius*.42,(.38+charge*.5+flash*.35)*breath);
      burstCtx.restore();
    }
    function paintSparks(time) {
      const travel=(1-Math.exp(-time*2.2))/2.2;
      burstCtx.fillStyle='#ffffff';
      for(const p of sparks) {
        if(time>=p.life)continue;
        const x=p.x+p.vx*travel, y=p.y+p.vy*travel+120*time*time;
        const shine=.45+.55*Math.sin(time*9+p.phase)**2;
        burstCtx.globalAlpha=Math.min(1,(p.life-time)/.9)*shine;
        burstCtx.shadowColor='#ffffff';burstCtx.shadowBlur=p.star ? 18 : 0;
        burstCtx.fillRect(x,y,p.size,p.size);
        if(p.star)star(x,y,p.size*(2+shine*2));
      }
      burstCtx.shadowBlur=0;burstCtx.globalAlpha=1;
    }
    function paintGlitter(time, staticView = false) {
      if(time<=0 && !staticView)return;
      const fade = Math.min(1,time/.6,Math.max(0,(7-time)/1.3));
      burstCtx.fillStyle = '#ffffff'; burstCtx.strokeStyle = '#ffffff';
      for (const p of glitter) {
        const x = p.x + Math.sin(time*.8+p.phase)*p.sway;
        const y = staticView ? (p.y+burstHeight)%burstHeight : p.y+p.speed*time;
        if (y < -20 || y > burstHeight+20) continue;
        const shine = .4+.6*Math.pow(Math.sin(time*2.1+p.phase),2);
        burstCtx.globalAlpha = (staticView ? .8 : fade)*shine;
        burstCtx.shadowColor = '#ffffff'; burstCtx.shadowBlur = p.star ? 12 : 0;
        burstCtx.fillRect(x,y,p.star ? 1.5 : p.size,p.star ? 1.5 : p.size);
        if (p.star) {
          const size = p.size*(.7+shine*.5);
          star(x,y,size);
        }
      }
      burstCtx.shadowBlur=0;burstCtx.globalAlpha=1;
    }
    if (reduced.checked) {
      playBurstSound();
      light(.8,0);
      ctx.shadowColor='#ffffff';ctx.shadowBlur=24;
      items.forEach(item=>drawGlyph(item));ctx.shadowBlur=0;
      paintGlitter(2.2,true);stage.dataset.heartPhase='static';burstCanvas.dataset.state='static';return;
    }
    let began;
    function tick(now) {
      if (token!==burstToken) return;
      if (began===undefined) began=now;
      const time=(now-began)/1000;
      ctx.clearRect(0,0,width,height);burstCtx.clearRect(0,0,burstWidth,burstHeight);
      if (time<glowTime) {
        stage.dataset.heartPhase='glow';
        const charge=Math.min(1,time/glowTime);
        light(charge,time);
        ctx.shadowColor='#ffffff';ctx.shadowBlur=24+64*charge;
        items.forEach(item=>drawGlyph(item,item.x,item.y,0,1,.8+.2*Math.sin(time*5)**2));
        ctx.shadowBlur=0;
      } else {
        playBurstSound();
        const fallTime=time-glowTime;
        stage.dataset.heartPhase=fallTime<1.15 ? 'burst' : 'falling';
        if(fallTime<1.15)light(Math.max(0,1-fallTime/1.15),time,Math.max(0,1-fallTime/.55));
        paintSparks(fallTime);
        paintGlitter(fallTime-.15);
      }
      if (time<endTime) burstFrame=requestAnimationFrame(tick);
      else {burstFrame=0;burstCtx.clearRect(0,0,burstWidth,burstHeight);ctx.clearRect(0,0,width,height);
        stage.dataset.heartPhase='complete';burstCanvas.dataset.state='complete';}
    }
    burstFrame=requestAnimationFrame(tick);
  }
  window.addEventListener('resize',resizeBurst);
  resizeBurst();
  function sound(effect) {
    if (audio.play(effect)) {
      stage.dataset.sfx = effect;
      stage.dataset.sfxCount = String(Number(stage.dataset.sfxCount || 0) + 1);
    }
  }
  function stopEffects() {
    generation++; cancelAnimationFrame(frame); frame = 0;
    meltProgress = null; meltScene = null; stage.dataset.meltPhase = 'idle'; stage.dataset.meltMaterial = 'idle';
    rainElapsed = null; rainScene = null; stage.dataset.rainPhase = 'idle';
    ctx.clearRect(0, 0, width, height);
    textNode.style.visibility = 'visible'; textNode.className = '';
    $('meme').hidden = true;
  }
  function restore(message = '다시 준비됐어요. 같은 문장으로 계속 놀아보세요.') {
    stopEffects(); textNode.textContent = text;
    if (punchHits > 0) paintDamage();
  }
  function resize() {
    width = stage.clientWidth; height = stage.clientHeight;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    if (videoBackdrop.running) {
      ctx.clearRect(0, 0, width, height); textNode.style.visibility = 'hidden'; return;
    }
    if (rainElapsed !== null) { startRain(rainElapsed); return; }
    if (meltProgress !== null) { startMelt(meltProgress); return; }
    if (burstCanvas.dataset.effect === 'heart') {
      const complete = burstCanvas.dataset.state === 'complete';
      stopEffects(); textNode.style.visibility = 'hidden';
      if (!complete) startHeart(punchHits >= hitsToBreak ? [] : layout());
      return;
    }
    restore('화면에 맞췄어요. 효과를 다시 눌러보세요.');
  }
  function layout() {
    const glyphs = Array.from(text);
    let size = Math.min(100, width * .095);
    size = Math.max(28, size);
    let rows;
    do {
      ctx.font = `900 ${size}px Arial, "Apple SD Gothic Neo", sans-serif`;
      rows = [''];
      for (const glyph of glyphs) {
        const last = rows.length - 1;
        if (ctx.measureText(rows[last] + glyph).width > width - 64 && rows[last]) rows.push(glyph);
        else rows[last] += glyph;
      }
      if (rows.length * size * 1.2 <= height - 125 || size <= 16) break;
      size -= 2;
    } while (true);
    textNode.style.fontSize = `${size}px`;
    const items = [];
    rows.forEach((row, index) => {
      let x = (width - ctx.measureText(row).width) / 2;
      const y = height / 2 + (index - (rows.length - 1) / 2) * size * 1.2;
      for (const char of Array.from(row)) {
        const w = ctx.measureText(char).width;
        items.push({ char, x: x + w / 2, y, w, size }); x += w;
      }
    });
    return items;
  }
  function drawGlyph(item, x = item.x, y = item.y, rotation = 0, scaleY = 1, alpha = 1, shatter = 0) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rotation); ctx.scale(1, scaleY);
    ctx.globalAlpha = alpha; ctx.fillStyle = ink(); ctx.font = `900 ${item.size}px Arial, "Apple SD Gothic Neo", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (damageView <= 0 || !item.char.trim()) ctx.fillText(item.char, 0, 0);
    else {
      // Each polygon carries a real portion of the letter. Widen the same
      // fractures on every hit, then let selected fragments drop away.
      const seed = item.char.codePointAt(0), w = item.w, h = item.size;
      const center = [-w * .08 + (seed % 3) * w * .04, h * .04];
      const edge = [[-.56*w,-.62*h],[-.12*w,-.62*h],[.56*w,-.62*h],[.56*w,0],
        [.56*w,.64*h],[.08*w,.64*h],[-.56*w,.64*h],[-.56*w,-.08*h]];
      for (let i = 0; i < edge.length; i++) {
        const a = edge[i], b = edge[(i+1)%edge.length];
        const opening = Math.max(0, damageView - ((i+seed)%3)*.65);
        const gap = h * (.009*opening + .0012*opening*opening);
        const dx = ((a[0]+b[0])/2-center[0])/w, dy = ((a[1]+b[1])/2-center[1])/h;
        const fall = (i+seed)%3 === 0 ? Math.max(0, damageView - (6+(i+seed)%4)) : 0;
        if (fall >= 1) continue;
        ctx.save();
        ctx.translate(dx*gap*2 + dx*shatter*h*6, dy*gap*2 + fall*fall*h*2.4 + dy*shatter*h*4 + shatter*shatter*height*.65);
        ctx.rotate((i%2 ? 1 : -1)*(opening*.004 + fall*.5 + shatter*2));
        ctx.globalAlpha = alpha * (1-fall) * (1-shatter);
        ctx.beginPath(); ctx.moveTo(...center);
        // A small kink makes fractures look like breaks rather than a grid.
        ctx.lineTo((center[0]+a[0])*.5 + w*.025, (center[1]+a[1])*.5);
        ctx.lineTo(...a); ctx.lineTo(...b);
        ctx.lineTo((center[0]+b[0])*.5 + w*.025, (center[1]+b[1])*.5);
        ctx.closePath(); ctx.clip(); ctx.fillText(item.char,0,0); ctx.restore();
      }
    }
    ctx.restore();
  }
  function paintDamage() {
    damageView = damageForHits(punchHits);
    textNode.style.visibility = 'hidden';
    ctx.clearRect(0, 0, width, height);
    if (punchHits < hitsToBreak) layout().forEach(item => drawGlyph(item));
  }
  function animate(duration, paint, done) {
    const token = generation; let start;
    function tick(now) {
      if (token !== generation) return;
      if (start === undefined) start = now;
      const seconds = Math.min((now - start) / 1000, duration);
      ctx.clearRect(0, 0, width, height); paint(seconds, seconds / duration);
      if (seconds < duration) frame = requestAnimationFrame(tick);
      else { frame = 0; done(); }
    }
    frame = requestAnimationFrame(tick);
  }
  function prepareRainScene() {
    const items = layout(), padding = 14;
    const left = Math.max(0, Math.min(...items.map(item => item.x - item.w / 2)) - padding);
    const right = Math.min(width, Math.max(...items.map(item => item.x + item.w / 2)) + padding);
    const top = Math.max(0, Math.min(...items.map(item => item.y - item.size * .72)) - padding);
    const bottom = Math.min(height, Math.max(...items.map(item => item.y + item.size * .72)) + padding);
    const sourceWidth = Math.max(1, right - left), sourceHeight = Math.max(1, bottom - top);
    const ratio = canvas.width / Math.max(1, width), raster = document.createElement('canvas');
    raster.width = Math.max(1, Math.ceil(sourceWidth * ratio));
    raster.height = Math.max(1, Math.ceil(sourceHeight * ratio));
    ctx.clearRect(0, 0, width, height); ctx.shadowBlur = 0;
    items.forEach(item => drawGlyph(item));
    // A single cached phrase retains Korean glyphs, wrapping and existing cracks.
    raster.getContext('2d').drawImage(canvas, left * ratio, top * ratio, raster.width, raster.height,
      0, 0, raster.width, raster.height);
    ctx.clearRect(0, 0, width, height);
    const count = width < 600 ? 24 : 44;
    const copyWidth = Math.min(sourceWidth * .58, width * .24, 240);
    const copies = Array.from({length:count}, (_, index) => {
      const size = .65 + Math.random() * .65;
      const w = copyWidth * size, h = w * sourceHeight / sourceWidth;
      return {w, h, seed:index === 0 ? .08 : Math.random() * 1.15 - .18,
        delay:index / count * 1.3, life:1.35 + Math.random() * .7,
        alpha:.52 + Math.random() * .43, angle:.28 + Math.random() * .14};
    });
    return {raster, copies};
  }
  function paintRain(time, staticView = false) {
    if (!rainScene) return;
    const copies = staticView ? rainScene.copies.slice(0, 8) : rainScene.copies;
    copies.forEach((copy, index) => {
      let x, y;
      if (staticView) {
        x = width * (.13 + index % 4 * .24);
        y = height * (.27 + Math.floor(index / 4) * .40);
      } else {
        const elapsed = time - copy.delay;
        if (elapsed < 0) return;
        const cycle = Math.floor(elapsed / copy.life);
        if (copy.delay + cycle * copy.life > 4.8) return;
        const age = elapsed - cycle * copy.life;
        const vy = (height + copy.h * 2) / copy.life;
        x = ((copy.seed + cycle * .173) % 1.15) * width + age * vy * .48;
        y = -copy.h + age * vy;
        if (x < -copy.w || x > width + copy.w || y > height + copy.h) return;
      }
      ctx.save(); ctx.translate(x, y); ctx.rotate(copy.angle);
      ctx.globalAlpha = copy.alpha;
      ctx.drawImage(rainScene.raster, -copy.w / 2, -copy.h / 2, copy.w, copy.h);
      ctx.restore();
    });
  }
  function startRain(elapsed = 0) {
    stopEffects(); textNode.style.visibility = 'hidden'; rainElapsed = elapsed;
    if (punchHits >= hitsToBreak || elapsed >= 6.9) {
      stage.dataset.rainPhase = 'complete'; return;
    }
    rainScene = prepareRainScene();
    if (reduced.checked) { paintRain(0, true); stage.dataset.rainPhase = 'static'; return; }
    stage.dataset.rainPhase = 'falling';
    animate(6.9 - elapsed, time => {
      rainElapsed = elapsed + time; paintRain(rainElapsed);
    }, () => {
      ctx.clearRect(0, 0, width, height);
      rainElapsed = 6.9; stage.dataset.rainPhase = 'complete';
    });
  }
  function prepareMeltScene(readMask) {
    const items = layout(), roots = [], glyphs = [];
    let raster = null, ratio = 1;
    if (readMask && items.length) {
      // Cache the real damaged letter silhouette once. Every subsequent frame
      // deforms this raster; it does not redraw rigid font bodies or read pixels.
      ctx.shadowBlur = 0;
      items.forEach(item => drawGlyph(item));
      const mask = ctx.getImageData(0, 0, canvas.width, canvas.height);
      ratio = canvas.width / width;
      raster = document.createElement('canvas');
      raster.width = canvas.width; raster.height = canvas.height;
      raster.getContext('2d').drawImage(canvas, 0, 0);
      items.forEach((item, index) => {
        if (!item.char.trim()) return;
        const left = Math.max(0, Math.floor((item.x - item.w * .52) * ratio));
        const right = Math.min(mask.width, Math.ceil((item.x + item.w * .52) * ratio));
        const top = Math.max(0, Math.floor((item.y - item.size * .7) * ratio));
        const bottom = Math.min(mask.height - 1, Math.ceil((item.y + item.size * .7) * ratio));
        let minX = right, maxX = left, minY = bottom, maxY = top;
        for (let y = top; y <= bottom; y++) for (let x = left; x < right; x++) {
          if (mask.data[(y * mask.width + x) * 4 + 3] < 100) continue;
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        }
        if (maxX < minX || maxY < minY) return;
        glyphs[index] = {left:minX / ratio, top:minY / ratio,
          width:(maxX - minX + 1) / ratio, height:(maxY - minY + 1) / ratio};
        const seed = item.char.codePointAt(0) + index * 5;
        const rootCount = item.w > item.size * .42 && seed % 3 !== 0 ? 2 : 1;
        for (let column = 0; column < rootCount; column++) {
          const start = Math.floor(minX + (maxX - minX + 1) * column / rootCount);
          const end = Math.ceil(minX + (maxX - minX + 1) * (column + 1) / rootCount);
          let sumX = 0, sumY = 0, count = 0;
          for (let x = start; x < end; x++) for (let y = maxY; y >= Math.max(minY, item.y * ratio); y--) {
            if (mask.data[(y * mask.width + x) * 4 + 3] < 100) continue;
            sumX += x / ratio; sumY += y / ratio; count++; break;
          }
          const variation = (seed + column * 11) % 13 / 12;
          if (count) roots.push({index, dx:sumX / count - item.x, dy:sumY / count - item.y,
            radius:Math.max(3, Math.min(item.size * .20, count / ratio * (.46 + variation * .19))),
            flow:.30 + variation * .58, delay:variation * .10,
            bend:(variation - .5) * 2});
        }
      });
      ctx.clearRect(0, 0, width, height);
    }
    const extent = items.length ? Math.max(...items.map(item => Math.abs(item.x - width / 2) + item.w / 2)) : width * .2;
    return {items, roots, glyphs, raster, ratio,
      poolWidth:Math.min(width * .36, Math.max(72, extent * 1.18)),
      poolDepth:Math.min(height * .135, Math.max(24, extent * .33))};
  }
  function liquidGradient(x, y, radius, bottom) {
    const gradient = ctx.createLinearGradient(x - radius, y, x + radius, bottom);
    gradient.addColorStop(0, '#83eb56');
    gradient.addColorStop(.25, '#57d933');
    gradient.addColorStop(.57, '#32c91c');
    gradient.addColorStop(1, '#208511');
    return gradient;
  }
  function paintMeltMask(progress) {
    const scene = meltScene;
    if (!scene) return;
    const clamp = value => Math.max(0, Math.min(1, value));
    const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
    const floor = height - Math.max(60, scene.poolDepth * 1.62);
    const bodies = scene.items.map((item, index) => {
      const phase = clamp((progress - (index % 4) * .018) / .946);
      const drain = smooth((phase - .22) / .66), fall = smooth((phase - .08) / .82);
      const squeeze = 1 - drain * .91;
      return {phase, drain, y:item.y + (floor - item.y) * fall,
        stretch:(1 + Math.sin(phase * Math.PI) * .15) * squeeze,
        spread:1 + drain * .72, alpha:clamp((.95 - phase) / .10)};
    });
    ctx.save(); ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    // Arrival and coalescence grow a substantial irregular footprint. Its height
    // remains visible after the letters drain, rather than becoming a flat stripe.
    const pooling = smooth((progress - .15) / .80);
    if (pooling > 0) {
      const spread = .13 + .87 * Math.pow(pooling, .62), x = width / 2;
      const w = scene.poolWidth * spread, h = scene.poolDepth * (.24 + .76 * Math.pow(pooling, .65));
      const y = floor + h * .20;
      const perimeter = [[-1,0],[-.93,-.67],[-.61,-.84],[-.45,-1.23],[-.10,-1.02],
        [.12,-.77],[.43,-1.09],[.80,-.76],[1.05,-.18],[.94,.52],
        [.58,.59],[.40,1.14],[.04,.90],[-.27,.61],[-.63,1.09],[-.97,.60]];
      const wobble = Math.sin(progress * Math.PI) * .035;
      const points = perimeter.map(([px,py],index) => [x + px * w,
        y + (py + Math.sin(index * 2.3) * wobble) * h]);
      ctx.globalAlpha = Math.min(1, pooling * 13);
      ctx.fillStyle = liquidGradient(x - w * .2, y - h, w, y + h);
      ctx.beginPath(); ctx.moveTo(...points[0]);
      for (let index = 0; index < points.length; index++) {
        const previous = points[(index + points.length - 1) % points.length], current = points[index];
        const next = points[(index + 1) % points.length], after = points[(index + 2) % points.length];
        ctx.bezierCurveTo(current[0] + (next[0] - previous[0]) / 6, current[1] + (next[1] - previous[1]) / 6,
          next[0] - (after[0] - current[0]) / 6, next[1] - (after[1] - current[1]) / 6, ...next);
      }
      ctx.closePath(); ctx.fill();
    }
    // Different horizontal layers sag and widen by different amounts. The real
    // glyph holes and existing fractures survive early, then soften and collapse
    // as the paint is progressively transported into the joined lower mass.
    scene.items.forEach((item, index) => {
      const body = bodies[index], glyph = scene.glyphs[index];
      if (body.alpha <= 0 || !item.char.trim()) return;
      if (progress <= .015 || !glyph || !scene.raster) {
        if (progress < .95) drawGlyph(item, item.x, body.y, 0, body.stretch, body.alpha);
        return;
      }
      ctx.save(); ctx.globalAlpha = body.alpha;
      // The material height pass rounds the joined surface; filtering every
      // narrow raster band separately creates an expensive GPU layer per band.
      ctx.filter = 'none';
      const band = Math.max(2, Math.min(4, glyph.height / 18));
      const relativeTop = glyph.top - item.y;
      for (let row = 0; row < glyph.height; row += band) {
        const rowHeight = Math.min(band + .45, glyph.height - row);
        const q = row / glyph.height;
        const sag = Math.pow(q, 1.7) * item.size * Math.sin(body.phase * Math.PI) * .20;
        const nextQ = Math.min(1, (row + rowHeight) / glyph.height);
        const nextSag = Math.pow(nextQ, 1.7) * item.size * Math.sin(body.phase * Math.PI) * .20;
        const swell = body.spread + Math.sin(q * Math.PI) * body.drain * .16;
        const drift = Math.sin(index * 2.1 + q * 2.4) * body.drain * glyph.width * .11;
        const destinationWidth = glyph.width * swell;
        const x = item.x + (glyph.left - item.x) * swell + drift;
        const y = body.y + (relativeTop + row) * body.stretch + sag;
        ctx.drawImage(scene.raster, glyph.left * scene.ratio, (glyph.top + row) * scene.ratio,
          glyph.width * scene.ratio, rowHeight * scene.ratio,
          x, y, destinationWidth, Math.max(.5, rowHeight * body.stretch + nextSag - sag + .55));
      }
      ctx.restore();
    });
    // Uneven heavy streams remain joined to the deforming lower strokes. The
    // necks thicken as their parent drains and finally merge into the wet pool.
    for (const root of scene.roots) {
      const body = bodies[root.index], amount = clamp((body.phase - root.delay - .025) / .90);
      if (amount <= 0 || body.phase >= .98) continue;
      const item = scene.items[root.index];
      const radius = root.radius * (.65 + Math.sin(amount * Math.PI) * .48 + body.drain * .85);
      const x = item.x + root.dx * body.spread + root.bend * radius * Math.sin(amount * Math.PI) * .72;
      const bulb = radius * (1.04 + body.drain * .25);
      const top = Math.min(floor - 1, body.y + root.dy * body.stretch - radius * .40);
      const end = Math.min(floor + scene.poolDepth * .30, top + Math.max(0, floor - top) * Math.pow(amount, root.flow));
      const neck = radius * (.58 + body.drain * .53), shoulder = top + Math.min(radius * 1.4, (end - top) * .48);
      const lean = root.bend * radius * .54 * Math.sin(amount * Math.PI);
      ctx.globalAlpha = Math.min(body.alpha + body.drain, 1) * Math.min(1, amount * 14);
      ctx.fillStyle = liquidGradient(x, top, bulb, end + bulb);
      const beginning = [x - radius * .72, top - radius * .32];
      ctx.beginPath(); ctx.moveTo(...beginning);
      ctx.bezierCurveTo(x - radius * .81, top + radius * .19, x - neck, top + radius * .65, x - neck, shoulder);
      ctx.bezierCurveTo(x - neck + lean, shoulder + (end - shoulder) * .42, x - bulb + lean, end - bulb * .45, x - bulb + lean, end);
      ctx.bezierCurveTo(x - bulb + lean, end + bulb * .74, x - bulb * .40 + lean, end + bulb, x + lean, end + bulb);
      ctx.bezierCurveTo(x + bulb * .71 + lean, end + bulb, x + bulb + lean, end + bulb * .62, x + bulb + lean, end);
      ctx.bezierCurveTo(x + bulb + lean, end - bulb * .42, x + neck + lean, shoulder + (end - shoulder) * .46, x + neck, shoulder);
      ctx.bezierCurveTo(x + neck, top + radius * .64, x + radius * .82, top + radius * .18, x + radius * .72, top - radius * .32);
      ctx.bezierCurveTo(x + radius * .44, top - radius * .65, x - radius * .44, top - radius * .65, ...beginning);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
  function paintMelt(progress) {
    paintMeltMask(progress);
    if (!wetPaintMaterial && window.WetPaintMaterial) wetPaintMaterial = new window.WetPaintMaterial();
    stage.dataset.meltMaterial = wetPaintMaterial?.paint(ctx, canvas, width, height, progress) ? 'wet-paint' : 'canvas';
  }
  function startMelt(progress = 0) {
    stopEffects(); textNode.style.visibility = 'hidden'; meltProgress = progress;
    meltScene = prepareMeltScene(progress < 1);
    stage.dataset.meltPhase = progress >= 1 ? 'complete' : 'melting';
    if (progress >= 1) { paintMelt(1); return; }
    animate(3.6 * (1 - progress), (_, elapsed) => {
      meltProgress = progress + (1 - progress) * elapsed;
      paintMelt(meltProgress);
    }, () => {
      meltProgress = 1; stage.dataset.meltPhase = 'complete';
      ctx.clearRect(0, 0, width, height); paintMelt(1);
    });
  }
  function debris(items) {
    return items.flatMap(item => Array.from({ length: 5 }, () => ({
      x: item.x, y: item.y, vx: (Math.random() - .5) * 560,
      vy: -80 - Math.random() * 340, angle: Math.random() * Math.PI,
      size: Math.max(3, item.size * (.04 + Math.random() * .09))
    })));
  }
  function drawDebris(parts, time, fade) {
    for (const p of parts) {
      ctx.save(); ctx.globalAlpha = fade; ctx.translate(p.x + p.vx * time, p.y + p.vy * time + 260 * time * time);
      ctx.rotate(p.angle + time * 5); ctx.fillStyle = ink(); ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 1.8); ctx.restore();
    }
  }
  const names = { explode: '폭발', punch: '펀치', crack: '작은 균열', heart: '양손 하트', melt: '녹아내림', rain:'텍스트 비', video:'영상 배경' };
  const gestureLabels = {explode:'fxxk you',punch:'punch',crack:'punch',heart:'love',melt:'melt',rain:'rain',video:'video'};
  function trigger(effect) {
    if (!names[effect]) return;
    gestureLabel.textContent = gestureLabels[effect] || '';
    stage.dataset.effect = effect;
    stage.dataset.effectCount = String(Number(stage.dataset.effectCount || 0) + 1);
    console.info('[BORN HATER gesture]', effect);
    if (effect === 'video') {
      stopBurst(); stopEffects(); document.body.dataset.background = 'video';
      textNode.textContent = ''; textNode.style.visibility = 'hidden';
      videoBackdrop.start('assets/palm-background.mp4'); return;
    }
    videoBackdrop.stop(); textNode.textContent = text;
    if (effect === 'explode') startBurst();
    if (effect === 'punch') { stopBurst(); document.body.dataset.background = 'punch'; }
    if (effect === 'melt') { stopBurst(); document.body.dataset.background = 'melt'; }
    if (effect === 'rain') {
      stopBurst(); document.body.dataset.background = 'rain';
      damageView = damageForHits(punchHits); startRain(); return;
    }
    if (effect === 'heart') {
      heartSoundPlayed = false;
      stopEffects();damageView=damageForHits(punchHits);
      startHeart(punchHits>=hitsToBreak ? [] : layout());return;
    }
    if (burstCanvas.dataset.effect === 'heart') stopBurst();
    if (punchHits >= hitsToBreak) { if (effect === 'punch') sound('impact'); return; }
    const previousDamage = damageView;
    if (effect === 'punch') {
      punchHits++; stage.dataset.punchHits = String(punchHits);
      stage.dataset.destroyed = String(punchHits === hitsToBreak);
    }
    if (effect !== 'punch') damageView = damageForHits(punchHits);
    stopEffects();
    const items = layout();
    if (effect === 'melt') { sound('melt'); startMelt(reduced.checked ? 1 : 0); return; }
    if (reduced.checked && (effect === 'punch' || punchHits > 0)) {
      sound(effect === 'punch' ? 'impact' : effect); paintDamage(); return;
    }
    if (reduced.checked) {
      textNode.className = `result-${effect}`; sound(effect === 'punch' ? 'impact' : effect); return;
    }
    textNode.style.visibility = 'hidden';
    if (effect === 'explode') {
      sound('explode'); const parts = debris(items);
      animate(1.25, (time, progress) => {
        if (time < .1) items.forEach(item => drawGlyph(item, item.x + Math.sin(time * 140) * 2, item.y));
        else drawDebris(parts, time - .1, Math.max(0, 1 - progress));
      }, () => {});
    } else if (effect === 'crack') {
      sound('crack');
      const chipped = items.filter((item, index) => index % 3 === 0 && item.char.trim());
      const parts = debris(chipped).map(part => ({ ...part, vx: part.vx * .25, vy: part.vy * .2, size: part.size * .7 }));
      const paintCracks = () => {
        items.forEach(item => drawGlyph(item));
        ctx.save();ctx.globalCompositeOperation='destination-out';
        for (const item of chipped) {
          const x = item.x, y = item.y, s = item.size;
          ctx.fillStyle = '#f6f3e9'; ctx.beginPath();
          ctx.moveTo(x - item.w * .3, y - s * .2);
          ctx.lineTo(x + item.w * .1, y + s * .02);
          ctx.lineTo(x + item.w * .32, y - s * .23);
          ctx.lineTo(x + item.w * .17, y - s * .1);
          ctx.lineTo(x - item.w * .3, y - s * .16);
          ctx.closePath(); ctx.fill();
          ctx.strokeStyle = '#f6f3e9'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(x + item.w * .1, y);
          ctx.lineTo(x - item.w * .08, y + s * .16);
          ctx.lineTo(x + item.w * .16, y + s * .35); ctx.stroke();
        }
        ctx.restore();
      };
      animate(.65, (time, progress) => { paintCracks(); drawDebris(parts, time, 1 - progress); }, paintCracks);
    } else if (effect === 'punch') {
      sound('impact');
      const centerX = width / 2, centerY = height / 2;
      const radius = Math.max(...items.map(i => Math.abs(i.x - centerX) + i.w / 2), 1);
      const halfHeight = Math.max(...items.map(i => Math.abs(i.y - centerY) + i.size / 2), 1);
      const travelX = Math.max(4, centerX - radius - 20), travelY = Math.max(4, centerY - halfHeight - 45);
      const direction = Math.random() < .5 ? -1 : 1;
      let x = centerX, y = centerY, vx = direction * 760, vy = -430, last = 0, parts, shattered = false;
      const chips = debris(items.filter(i => i.char.trim())).map(p => ({...p, vx:p.vx*.3, vy:p.vy*.3, size:p.size*.55}));
      const finalHit = punchHits === hitsToBreak, flightTime = .45;
      animate(finalHit ? 1.5 : 1.15, (time, progress) => {
        const delta = Math.min(time - last, .04); last = time;
        // Damage unfolds during the impact, so the new fracture is visible.
        damageView = previousDamage + (damageForHits(punchHits)-previousDamage)*Math.min(1,time/1.05);
        if (time < .12) {
          ctx.fillStyle = `rgba(255,96,44,${(.12-time)*1.8})`; ctx.fillRect(0,0,width,height);
        }
        if (time <= flightTime) {
          x += vx*delta; y += vy*delta; vx *= Math.exp(-delta*1.2); vy *= Math.exp(-delta*1.2);
          if (Math.abs(x-centerX)>=travelX) {x=centerX+Math.sign(x-centerX)*travelX;vx*=-1;}
          if (Math.abs(y-centerY)>=travelY) {y=centerY+Math.sign(y-centerY)*travelY;vy*=-1;}
        }
        const settle = finalHit ? 1 : Math.max(0,1-(time-flightTime)/.5);
        const burst = finalHit ? Math.max(0,(time-flightTime)/(1.5-flightTime)) : 0;
        items.forEach(item => drawGlyph(item,item.x+(x-centerX)*settle,item.y+(y-centerY)*settle,
          Math.sin(time*13)*.08*settle,1,1,burst));
        if (!finalHit) drawDebris(chips,time,Math.max(0,1-progress));
      }, paintDamage);
    }
  }
  let session = 0, active = false, cameraPreparation = null;
  const preview = $('camera-preview');
  const musicButton = $('bgm-toggle');
  const introMusicButton = $('intro-music-toggle');
  let musicMuted = false, musicReady = false, musicLoading = false, musicPreparation = null, musicGeneration = 0;
  function suppressMusicForVideo(suppressed) {
    if (videoMusicSuppressed === suppressed) return;
    videoMusicSuppressed = suppressed;
    stage.dataset.bgmSuppressed = String(suppressed);
    audio.setMusicMuted(musicMuted || videoMusicSuppressed);
    updateMusicButton();
  }
  function updateMusicButton() {
    const effectiveMute = musicMuted || videoMusicSuppressed;
    const playing = musicReady && !effectiveMute;
    musicButton.textContent = playing ? 'MUTE' : 'PLAY';
    introMusicButton.textContent = playing ? 'mute' : 'play';
    for (const button of [musicButton,introMusicButton]) {
      button.setAttribute('aria-label', playing ? 'Mute background music' : 'Play background music');
      button.disabled = musicLoading || videoMusicSuppressed;
    }
    musicButton.hidden = false;
    stage.dataset.bgm = musicReady ? (effectiveMute ? 'muted' : 'playing') : 'stopped';
  }
  function prepareMusic() {
    if (musicPreparation) return musicPreparation;
    const request = musicGeneration;
    musicLoading = true; stage.dataset.audio = 'loading'; updateMusicButton();
    const preparation = audio.prepare().then(() => {
      if (request !== musicGeneration) return false;
      audio.setMusicMuted(musicMuted || videoMusicSuppressed); musicReady = audio.startMusic(); musicLoading = false;
      stage.dataset.audio = musicReady ? 'ready' : 'error'; updateMusicButton();
      return musicReady;
    }).catch(error => {
      if (request !== musicGeneration) return false;
      musicLoading = false; stage.dataset.audio = 'error'; updateMusicButton();
      console.warn('[BORN HATER audio]', error.message); return false;
    }).finally(() => { if (musicPreparation === preparation) musicPreparation = null; });
    musicPreparation = preparation; return preparation;
  }
  function toggleMusic() {
    if (videoMusicSuppressed) return;
    if (musicLoading) return musicPreparation;
    if (!musicReady) { musicMuted = false; return prepareMusic(); }
    musicMuted = !musicMuted; audio.setMusicMuted(musicMuted); updateMusicButton();
  }
  function stopMusic() {
    musicGeneration++; musicPreparation = null; musicLoading = false;
    audio.stop(); musicReady = false; updateMusicButton();
  }
  const record = state => { stage.dataset.connection = state; console.info('[BORN HATER connection]', state); };
  const showError = message => { status.hidden = false; status.textContent = message; };
  const tracker = new window.BrowserTracking({
    video: preview, overlay: $('camera-overlay'),
    onGesture(effect) {
      if (!active || !names[effect]) return;
      gestureLabel.textContent = gestureLabels[effect] || '';
      if ((text || effect === 'video') && document.body.dataset.view === 'game') trigger(effect);
    },
    onFrame(data = {}) {
      if (data.pose) {
        preview.dataset.hands = String(data.pose.hands);
        preview.dataset.labels = data.pose.labels.join(',');
        preview.dataset.scores = data.pose.scores.join(',');
        preview.dataset.candidate = data.pose.candidate || '';
        preview.dataset.locked = String(data.pose.locked);
      }
      preview.dataset.source = 'browser';
      preview.dataset.frames = String(Number(preview.dataset.frames || 0) + 1);
    },
    onState(state) {
      record(state);
      if (state === 'active') {
        active = true; $('hate').disabled = false; status.hidden = true;
      } else if (state === 'stopped') active = false;
      else {
        active = false;
        status.hidden = false;
        status.textContent = state === 'loading' ? '손 추적을 준비하고 있어요.' : '브라우저에서 카메라 접근을 허용해주세요.';
      }
    },
    onError(error) {
      closeCamera(); record('error'); showError(error.message);
    }
  });
  function closeCamera() {
    active = false; session++; cameraPreparation = null;
    audio.stopHits(); stopBurst(); tracker.stop();
    gestureLabel.textContent = '';
    $('hate').disabled = false;
  }
  function ensureCamera(reset = false) {
    if (!reset && (active || cameraPreparation)) return cameraPreparation;
    const current = ++session;
    let startup;
    try { startup = tracker.start(); }
    catch (error) { startup = Promise.reject(error); }
    const preparation = Promise.resolve(startup).catch(error => {
      if (current !== session) return;
      closeCamera(); record('error');
      showError(error.message || '카메라를 시작하지 못했어요. Enter를 눌러 다시 시도해주세요.');
    }).finally(() => {
      if (cameraPreparation === preparation) cameraPreparation = null;
    });
    cameraPreparation = preparation;
    return preparation;
  }
  $('enter-site').addEventListener('click', () => {
    $('intro').hidden = true; $('game').hidden = false; document.body.dataset.view = 'game';
    resize(); layout(); $('text-input').focus();
    ensureCamera();
    if (preview.srcObject && preview.paused) preview.play().catch(() => {});
    return prepareMusic();
  });
  introMusicButton.addEventListener('click', toggleMusic);
  textInput.addEventListener('compositionstart', () => { composing = true; });
  textInput.addEventListener('compositionend', () => { composing = false; });
  textInput.addEventListener('keydown', event => {
    if (event.key === 'Enter' && (composing || event.isComposing || event.keyCode === 229)) event.preventDefault();
  });
  $('text-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (composing || event.isComposing) return;
    const value = $('text-input').value.trim();
    if (!value) { $('text-input').focus(); return ensureCamera(); }
    videoBackdrop.stop();
    document.body.dataset.background = 'plain';
    // A new sentence resets effects and gesture state while an active camera keeps streaming.
    audio.stopHits(); stopBurst(); gestureLabel.textContent = '';
    punchHits = 0; damageView = 0; stage.dataset.punchHits = '0'; stage.dataset.destroyed = 'false';
    text = Array.from(value).slice(0,80).join(''); restore(); layout();
    prepareMusic();
    return ensureCamera(true);
  });
  musicButton.addEventListener('click', toggleMusic);
  document.addEventListener('keydown', event => {
    if (event.isComposing || event.target.closest('input,textarea')) return;
    if (event.key === 'Escape') { videoBackdrop.stop(); stopBurst(); gestureLabel.textContent = ''; stopMusic(); restore(); layout(); }
  });
  new ResizeObserver(() => { resize(); layout(); }).observe(stage);
  window.addEventListener('pagehide', () => {
    videoBackdrop.stop(); closeCamera(); stopMusic(); stopEffects();
    wetPaintMaterial?.dispose(); wetPaintMaterial = null;
  });
  window.addEventListener('pageshow', event => { if (event.persisted) ensureCamera(); });
  updateMusicButton(); resize(); layout(); ensureCamera();
})();
