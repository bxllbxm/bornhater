/* A hidden GPU material pass for the existing connected Canvas2D melt mask. */
(() => {
  'use strict';

  const vertex = `
    attribute vec2 aPosition;
    varying vec2 vUv;
    void main() {
      vUv = (aPosition + 1.0) * 0.5;
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }`;

  const blur = `
    precision mediump float;
    varying vec2 vUv;
    uniform sampler2D uSource;
    uniform vec2 uStep;
    uniform float uAlpha;
    float mask(vec2 uv) {
      vec4 value = texture2D(uSource, uv);
      return mix(value.r, value.a, uAlpha);
    }
    void main() {
      float h = mask(vUv) * 0.227027;
      h += (mask(vUv + uStep) + mask(vUv - uStep)) * 0.194595;
      h += (mask(vUv + uStep * 2.0) + mask(vUv - uStep * 2.0)) * 0.121622;
      h += (mask(vUv + uStep * 3.0) + mask(vUv - uStep * 3.0)) * 0.054054;
      h += (mask(vUv + uStep * 4.0) + mask(vUv - uStep * 4.0)) * 0.016216;
      gl_FragColor = vec4(h, h, h, 1.0);
    }`;

  const surface = `
    precision mediump float;
    varying vec2 vUv;
    uniform sampler2D uSource;
    uniform sampler2D uHeight;
    uniform vec2 uPixel;
    uniform vec2 uSize;
    uniform float uProgress;
    float heightAt(vec2 uv) { return texture2D(uHeight, uv).r; }
    void main() {
      float ink = texture2D(uSource, vUv).a;
      float contactMask = heightAt(vUv + vec2(0.0, uPixel.y * 3.5));
      // Most of the viewport is empty. Preserve even faint antialiasing and the
      // entire shadow, but avoid normals and reflections for exactly clear pixels.
      if (ink <= 0.0 && contactMask <= 0.0) {
        gl_FragColor = vec4(0.0);
        return;
      }
      float alpha = smoothstep(0.025, 0.58, ink) * min(1.0, ink * 1.4);
      float h = heightAt(vUv);
      vec2 p = vec2(vUv.x, 1.0 - vUv.y) * uSize;

      // The blurred continuous mask gives every neck and puddle a rounded lip.
      float dx = heightAt(vUv + vec2(uPixel.x, 0.0)) - heightAt(vUv - vec2(uPixel.x, 0.0));
      float dy = heightAt(vUv + vec2(0.0, uPixel.y)) - heightAt(vUv - vec2(0.0, uPixel.y));
      vec2 slope = vec2(dx, dy) * 16.0;
      float body = smoothstep(0.22, 0.85, h);
      float time = uProgress * 1.7;
      slope.x += body * (0.18 * sin(p.x * 0.052 + sin(p.y * 0.047) + time)
        + 0.06 * sin(p.x * 0.019 - p.y * 0.055));
      slope.y += body * (0.17 * sin(p.y * 0.062 + p.x * 0.021 - time)
        + 0.08 * sin(p.x * 0.033 + p.y * 0.028));
      vec3 normal = normalize(vec3(-slope.x, -slope.y, 1.0));
      vec3 light = normalize(vec3(-0.44, 0.64, 0.72));
      vec3 view = normalize(vec3(0.0, -0.10, 1.0));
      float diffuse = max(0.0, dot(normal, light));
      vec3 green = vec3(0.196078, 0.788235, 0.109804);
      vec3 color = green * (0.42 + 0.63 * diffuse);
      color *= 0.76 + 0.24 * smoothstep(0.03, 0.42, h);

      // Glossy paint reflects curved, uneven strips of a bright room overhead.
      vec3 reflected = reflect(-view, normal);
      float curve = 0.065 * sin(p.x * 0.026 + reflected.x * 1.4)
        + 0.025 * sin(p.x * 0.079 + p.y * 0.028);
      float reflectionA = (reflected.y - 0.37 - curve) / 0.042;
      float reflectionB = (reflected.y - 0.12 + curve * 0.72) / 0.024;
      float windowA = exp(-reflectionA * reflectionA);
      float windowB = exp(-reflectionB * reflectionB);
      float broken = 0.38 + 0.62 * smoothstep(-0.38, 0.52,
        sin(p.x * 0.092 + p.y * 0.018) + 0.45 * sin(p.x * 0.037));
      float room = (windowA * 0.86 + windowB * 0.48) * broken;
      float specular = pow(max(0.0, dot(normal, normalize(light + view))), 66.0);
      float fresnel = pow(1.0 - max(0.0, dot(normal, view)), 3.0);
      color = mix(color, vec3(0.96, 1.0, 0.95), min(0.90, room + specular * 0.72));
      color += vec3(0.18, 0.23, 0.15) * fresnel;

      // A short contact shadow sits beneath the rounded paint without an outline.
      float shadow = clamp(contactMask * 0.42 * (1.0 - alpha), 0.0, 0.32);
      float outAlpha = alpha + shadow * (1.0 - alpha);
      vec3 outColor = (color * alpha + vec3(0.018, 0.045, 0.009)
        * shadow * (1.0 - alpha)) / max(0.0001, outAlpha);
      gl_FragColor = vec4(outColor, outAlpha);
    }`;

  class WetPaintMaterial {
    constructor() {
      this.canvas = null;
      this.gl = null;
      this.snapshot = null;
      this.snapshotContext = null;
      this.resources = null;
      this.unavailable = false;
      this.disposed = false;
      this.lost = false;
      this.onLost = event => { event.preventDefault?.(); this.lost = true; };
    }

    initialize() {
      if (this.resources) return true;
      if (this.unavailable || this.disposed || this.lost) return false;
      try {
        this.canvas = document.createElement('canvas');
        this.gl = this.canvas.getContext('webgl', {
          alpha:true, antialias:false, depth:false, stencil:false,
          premultipliedAlpha:false, preserveDrawingBuffer:false,
          powerPreference:'low-power',
        });
        if (!this.gl) { console.warn('[BORN HATER paint] WebGL unavailable'); this.unavailable = true; return false; }
        this.snapshot = document.createElement('canvas');
        this.snapshotContext = this.snapshot.getContext('2d', {alpha:true});
        if (!this.snapshotContext) throw new Error('No material snapshot');
        const gl = this.gl;
        this.canvas.addEventListener('webglcontextlost', this.onLost);
        const r = this.resources = {shaders:[], programs:[], textures:[], framebuffers:[], buffer:null};
        const program = fragment => {
          const handle = gl.createProgram();
          if (!handle) throw new Error('No material program');
          r.programs.push(handle);
          for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
            const shader = gl.createShader(type);
            if (!shader) throw new Error('No material shader');
            r.shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('Material shader compilation failed: ' + gl.getShaderInfoLog(shader));
            gl.attachShader(handle, shader);
          }
          gl.linkProgram(handle);
          if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) throw new Error('Material linking failed: ' + gl.getProgramInfoLog(handle));
          const uniforms = {};
          for (const name of ['uSource','uHeight','uStep','uAlpha','uPixel','uSize','uProgress']) {
            uniforms[name] = gl.getUniformLocation(handle, name);
          }
          return {handle, uniforms, position:gl.getAttribLocation(handle, 'aPosition')};
        };
        r.blur = program(blur); r.surface = program(surface);
        r.buffer = gl.createBuffer();
        if (!r.buffer) throw new Error('No material buffer');
        gl.bindBuffer(gl.ARRAY_BUFFER, r.buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
        for (let i = 0; i < 3; i++) {
          const texture = gl.createTexture();
          if (!texture) throw new Error('No material texture');
          r.textures.push(texture); gl.bindTexture(gl.TEXTURE_2D, texture);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          if (i > 0) {
            const framebuffer = gl.createFramebuffer();
            if (!framebuffer) throw new Error('No material framebuffer');
            r.framebuffers.push(framebuffer);
          }
        }
        r.width = 0; r.height = 0;
        return true;
      } catch (error) {
        console.warn('[BORN HATER paint]', error.message);
        this.release(); this.unavailable = true;
        return false;
      }
    }

    release() {
      if (!this.gl || !this.resources) return;
      const gl = this.gl, r = this.resources;
      for (const object of r.shaders) gl.deleteShader(object);
      for (const object of r.programs) gl.deleteProgram(object);
      for (const object of r.textures) gl.deleteTexture(object);
      for (const object of r.framebuffers) gl.deleteFramebuffer(object);
      if (r.buffer) gl.deleteBuffer(r.buffer);
      this.resources = null;
    }

    paint(ctx, sourceCanvas, cssWidth, cssHeight, progress) {
      if (!ctx || !sourceCanvas || !sourceCanvas.width || !sourceCanvas.height
        || !Number.isFinite(cssWidth) || !Number.isFinite(cssHeight)
        || cssWidth <= 0 || cssHeight <= 0 || this.disposed || this.lost) return false;
      if (!this.initialize()) return false;
      const gl = this.gl, r = this.resources;
      if (gl.isContextLost()) { this.lost = true; return false; }
      try {
        const scale = Math.min(1, 800 / cssWidth, 600 / cssHeight);
        const width = Math.max(1, Math.floor(cssWidth * scale));
        const height = Math.max(1, Math.floor(cssHeight * scale));
        if (r.width !== width || r.height !== height) {
          this.canvas.width = width; this.canvas.height = height;
          this.snapshot.width = width; this.snapshot.height = height;
          for (let i = 0; i < 2; i++) {
            gl.bindTexture(gl.TEXTURE_2D, r.textures[i + 1]);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            gl.bindFramebuffer(gl.FRAMEBUFFER, r.framebuffers[i]);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, r.textures[i + 1], 0);
            if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
              throw new Error('Incomplete material target');
            }
          }
          r.width = width; r.height = height;
        }
        // A bounded GPU-backed 2D snapshot avoids uploading a full viewport at DPR 2.
        // This draw also captures the current image before that canvas is overwritten.
        this.snapshotContext.globalCompositeOperation = 'copy';
        this.snapshotContext.drawImage(sourceCanvas, 0, 0, width, height);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, r.textures[0]);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.snapshot);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.viewport(0, 0, width, height);
        gl.bindBuffer(gl.ARRAY_BUFFER, r.buffer);
        const use = shader => {
          gl.useProgram(shader.handle); gl.enableVertexAttribArray(shader.position);
          gl.vertexAttribPointer(shader.position, 2, gl.FLOAT, false, 0, 0);
        };
        use(r.blur); gl.uniform1i(r.blur.uniforms.uSource, 0);
        for (let i = 0; i < 2; i++) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, r.framebuffers[i]);
          gl.bindTexture(gl.TEXTURE_2D, r.textures[i]);
          gl.uniform1f(r.blur.uniforms.uAlpha, i === 0 ? 1 : 0);
          // About 4 CSS pixels per sample: enough height to round a thick lip.
          gl.uniform2f(r.blur.uniforms.uStep, i === 0 ? 4 / cssWidth : 0, i === 1 ? 4 / cssHeight : 0);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null); use(r.surface);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, r.textures[0]);
        gl.uniform1i(r.surface.uniforms.uSource, 0);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, r.textures[2]);
        gl.uniform1i(r.surface.uniforms.uHeight, 1);
        gl.uniform2f(r.surface.uniforms.uPixel, 1 / width, 1 / height);
        gl.uniform2f(r.surface.uniforms.uSize, cssWidth, cssHeight);
        gl.uniform1f(r.surface.uniforms.uProgress, Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        const gpuError = gl.getError();
        if (gl.isContextLost() || gpuError !== gl.NO_ERROR) {
          console.warn('[BORN HATER paint] GPU drawing failed', gpuError); return false;
        }
        ctx.save();
        try {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'copy';
          ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
          ctx.drawImage(this.canvas, 0, 0, sourceCanvas.width, sourceCanvas.height);
        } finally { ctx.restore(); }
        return true;
      } catch (error) {
        console.warn('[BORN HATER paint]', error.message);
        this.release(); this.unavailable = true;
        return false;
      }
    }

    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      this.canvas?.removeEventListener('webglcontextlost', this.onLost);
      this.release(); this.gl = null; this.canvas = null;
      this.snapshot = null; this.snapshotContext = null;
    }
  }

  window.WetPaintMaterial = WetPaintMaterial;
})();
