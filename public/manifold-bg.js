// manifold-bg.js — pure vanilla WebGL2.  Schwarz-D / gyroid wireframe,
// raymarched, reactive to mouse + scroll + router sliders.  No deps.
// Palette: cyan, green, purple, gold.  PHI-tuned proportions.
(function () {
  'use strict';

  // Host-based portal redirect:
  // dimensionalprogramming.com should go straight to the IDE.
  // Works across most portfolio pages because they load manifold-bg.js.
  (function () {
    try {
      const h = (window.location.hostname || '').toLowerCase();
      if (h === 'dimensionalprogramming.com' || h === 'www.dimensionalprogramming.com') {
        const p = window.location.pathname || '/';
        if (!p.startsWith('/manifold-ide')) window.location.replace('/manifold-ide/');
      }
    } catch (_) { /* no-op */ }
  })();

  const PHI = 1.6180339887;
  const canvas = document.getElementById('spiral-bg');
  if (!canvas) return;
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: false });
  if (!gl) return;

  // Shared state — routing.html (and anything else) can mutate this live.
  const state = window.__manifold = window.__manifold || {
    complexity: 0.42, stakes: 0.30, context: 0.50,
    mouseX: 0.5, mouseY: 0.5, scroll: 0
  };
  state.update = function (patch) { Object.assign(state, patch); };

  const VS = `#version 300 es
  in vec2 a_pos; out vec2 v_uv;
  void main(){ v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`;

  const FS = `#version 300 es
  precision highp float;
  in vec2 v_uv; out vec4 outColor;
  uniform vec2  u_res;
  uniform float u_time;
  uniform vec2  u_mouse;
  uniform float u_complexity, u_stakes, u_context, u_scroll;

  const float PI = 3.14159265359;

  // Triply-periodic minimal-surface fields ---------------------------------
  float schwarzD(vec3 p){
    return sin(p.x)*sin(p.y)*sin(p.z)
         + sin(p.x)*cos(p.y)*cos(p.z)
         + cos(p.x)*sin(p.y)*cos(p.z)
         + cos(p.x)*cos(p.y)*sin(p.z);
  }
  float gyroid(vec3 p){
    return sin(p.x)*cos(p.y) + sin(p.y)*cos(p.z) + sin(p.z)*cos(p.x);
  }
  // u_stakes morphs Schwarz-D -> Gyroid -> back.  Both are triply-periodic.
  float field(vec3 p){ return mix(schwarzD(p), gyroid(p), u_stakes); }

  // Palette: cyan -> green -> purple -> gold, cyclic. -----------------------
  vec3 palette(float t){
    vec3 cyan   = vec3(0.05, 0.92, 1.00);
    vec3 green  = vec3(0.00, 0.96, 0.60);
    vec3 purple = vec3(0.69, 0.46, 1.00);
    vec3 gold   = vec3(1.00, 0.82, 0.36);
    float k = fract(t) * 4.0;
    int i = int(floor(k));
    float f = fract(k);
    vec3 a = (i==0)?cyan  :(i==1)?green :(i==2)?purple:gold;
    vec3 b = (i==0)?green :(i==1)?purple:(i==2)?gold  :cyan;
    return mix(a, b, smoothstep(0.0, 1.0, f));
  }

  mat3 rotY(float a){ float c=cos(a), s=sin(a); return mat3(c,0.,-s, 0.,1.,0., s,0.,c); }
  mat3 rotX(float a){ float c=cos(a), s=sin(a); return mat3(1.,0.,0., 0.,c,-s, 0.,s,c); }

  void main(){
    vec2 uv = (v_uv * 2.0 - 1.0);
    uv.x *= u_res.x / u_res.y;

    // Camera: orbit + parallax from mouse, slow drift from time.
    float yaw   = (u_mouse.x - 0.5) * PI * 0.9 + u_time * 0.07;
    float pitch = (u_mouse.y - 0.5) * PI * 0.45 + sin(u_time*0.11) * 0.18;
    mat3 R = rotY(yaw) * rotX(pitch);

    vec3 ro = R * vec3(0.0, 0.0, -3.2);
    vec3 rd = normalize(R * vec3(uv, 1.6));

    // Frequency = lattice density.  Complexity tightens the weave.
    float freq = mix(0.55, 1.35, u_complexity);

    // Raymarch detecting zero-crossings of the field == wireframe edges.
    float t = 0.0;
    vec3 col = vec3(0.0);
    float prevF = field(ro * freq);
    float hits = 0.0;
    const int STEPS = 56;
    for (int i = 0; i < STEPS; i++){
      vec3 p = ro + rd * t;
      float F = field(p * freq);
      if (sign(F) != sign(prevF)) {
        float depth   = clamp(1.0 - t/7.0, 0.0, 1.0);
        float shade   = pow(depth, 1.0 / 1.6180339887);  // PHI falloff
        float palT    = depth * 0.62 + u_time * 0.045 + u_context * 0.6;
        vec3  c       = palette(palT);
        // Edge brightness biased by |gradient|, approximated by step size.
        float edge    = 0.55 + 0.45 * (1.0 - abs(F) / (abs(F - prevF) + 1e-4));
        col += c * shade * edge * 0.42;
        hits += 1.0;
        if (hits > 6.0) break;       // depth-stop: never over-stack
      }
      prevF = F;
      t += 0.135;
      if (t > 7.6) break;
    }

    // Subtle nebula tint behind the lattice — keeps text panels readable.
    vec3 bg = mix(vec3(0.025, 0.025, 0.06), vec3(0.06, 0.03, 0.10),
                  smoothstep(-1.0, 1.0, uv.y));
    col = bg + col;

    // Vignette: 1.0 at center, falloff to PHI^-2 at corners.
    float vig = smoothstep(1.4, 0.25, length(uv));
    col *= mix(0.382, 1.0, vig);

    outColor = vec4(col, 1.0);
  }`;

  // Boilerplate: compile, link, fullscreen quad, RAF loop. ------------------
  function sh(type, src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s);
    if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s)); return s; }
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if(!gl.getProgramParameter(prog, gl.LINK_STATUS)) console.error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);

  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  const vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'a_pos');
  gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const u = {
    res:        gl.getUniformLocation(prog, 'u_res'),
    time:       gl.getUniformLocation(prog, 'u_time'),
    mouse:      gl.getUniformLocation(prog, 'u_mouse'),
    complexity: gl.getUniformLocation(prog, 'u_complexity'),
    stakes:     gl.getUniformLocation(prog, 'u_stakes'),
    context:    gl.getUniformLocation(prog, 'u_context'),
    scroll:     gl.getUniformLocation(prog, 'u_scroll'),
  };

  function resize(){
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width  = Math.floor(window.innerWidth  * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width  = window.innerWidth  + 'px';
    canvas.style.height = window.innerHeight + 'px';
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  resize();
  addEventListener('resize', resize);
  addEventListener('mousemove', e => {
    state.mouseX += ((e.clientX / window.innerWidth)  - state.mouseX) * 0.08;
    state.mouseY += ((e.clientY / window.innerHeight) - state.mouseY) * 0.08;
  }, { passive: true });
  addEventListener('scroll', () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    state.scroll = max > 0 ? window.scrollY / max : 0;
  }, { passive: true });

  const t0 = performance.now();
  function frame(){
    const t = (performance.now() - t0) / 1000;
    gl.uniform2f(u.res, canvas.width, canvas.height);
    gl.uniform1f(u.time, t);
    gl.uniform2f(u.mouse, state.mouseX, state.mouseY);
    gl.uniform1f(u.complexity, state.complexity);
    gl.uniform1f(u.stakes,     state.stakes);
    gl.uniform1f(u.context,    state.context);
    gl.uniform1f(u.scroll,     state.scroll);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
