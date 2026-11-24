// A tiny WebGL renderer for the AR / VR beacon field: lit boxes and colored
// lines, nothing else. No libraries, so the page stays a few kilobytes and
// works offline from web/serve.py.

// ---------------------------------------------------------------- mat4 (column-major)

export const mat4 = {
  identity: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
  mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++)
      for (let r = 0; r < 4; r++)
        o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    return o;
  },
  /** Translate, rotate about y by `yaw`, then scale (sx, sy, sz). */
  trs(tx, ty, tz, yaw, sx, sy, sz) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    return new Float32Array([c * sx, 0, -s * sx, 0, 0, sy, 0, 0, s * sz, 0, c * sz, 0, tx, ty, tz, 1]);
  },
  perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  },
  /** View matrix for an eye at `p` looking along yaw (0 = -z) and pitch. */
  fps(p, yaw, pitch) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const x = [cy, 0, -sy], y = [sy * sp, cp, cy * sp], z = [sy * cp, -sp, cy * cp];
    const d = (v) => -(v[0] * p[0] + v[1] * p[1] + v[2] * p[2]);
    return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, d(x), d(y), d(z), 1]);
  },
};

export function hexColor(h, a = 1) {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, a];
}

// ---------------------------------------------------------------- renderer

const VS = `
attribute vec3 aPos; attribute vec3 aNrm; attribute vec4 aCol;
uniform mat4 uProj, uView, uModel; uniform float uLit;
varying vec4 vCol; varying float vShade;
void main() {
  vec3 n = normalize(mat3(uModel) * aNrm);
  vShade = mix(1.0, 0.55 + 0.45 * max(dot(n, normalize(vec3(0.4, 0.9, 0.3))), 0.0), uLit);
  vCol = aCol;
  gl_Position = uProj * uView * uModel * vec4(aPos, 1.0);
}`;
const FS = `
precision mediump float;
uniform vec4 uTint; uniform float uGlow;
varying vec4 vCol; varying float vShade;
void main() {
  vec4 c = vCol * uTint;
  gl_FragColor = vec4(c.rgb * vShade + c.rgb * uGlow, c.a);
}`;

function cubeData() {
  // Unit box from y=0 to y=1, x and z from -0.5 to 0.5: stands on the floor.
  const f = [[[0, 0, 1], [[-1, 0, 1], [1, 0, 1], [1, 1, 1], [-1, 1, 1]]], [[0, 0, -1], [[1, 0, -1], [-1, 0, -1], [-1, 1, -1], [1, 1, -1]]],
    [[1, 0, 0], [[1, 0, 1], [1, 0, -1], [1, 1, -1], [1, 1, 1]]], [[-1, 0, 0], [[-1, 0, -1], [-1, 0, 1], [-1, 1, 1], [-1, 1, -1]]],
    [[0, 1, 0], [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]]], [[0, -1, 0], [[-1, 0, -1], [1, 0, -1], [1, 0, 1], [-1, 0, 1]]]];
  const v = [];
  for (const [n, q] of f) for (const i of [0, 1, 2, 0, 2, 3]) v.push(q[i][0] * 0.5, q[i][1], q[i][2] * 0.5, ...n, 1, 1, 1, 1);
  return new Float32Array(v);
}

export class Renderer {
  constructor(gl) {
    this.gl = gl;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    this.prog = p;
    this.loc = {};
    for (const n of ["aPos", "aNrm", "aCol"]) this.loc[n] = gl.getAttribLocation(p, n);
    for (const n of ["uProj", "uView", "uModel", "uTint", "uGlow", "uLit"]) this.loc[n] = gl.getUniformLocation(p, n);
    this.cube = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cube);
    gl.bufferData(gl.ARRAY_BUFFER, cubeData(), gl.STATIC_DRAW);
    this.lineBuf = gl.createBuffer();
  }

  _attribs(buf) {
    const gl = this.gl, L = this.loc, stride = 40;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(L.aPos); gl.vertexAttribPointer(L.aPos, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(L.aNrm); gl.vertexAttribPointer(L.aNrm, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(L.aCol); gl.vertexAttribPointer(L.aCol, 4, gl.FLOAT, false, stride, 24);
  }

  /**
   * Draws one view. `scene` = {boxes: [{m: mat4, color: [r,g,b,a], glow}],
   * lines: Float32Array of (x,y,z, 0,1,0, r,g,b,a) per vertex}.
   */
  draw(scene, proj, view, viewport, { clear = null } = {}) {
    const gl = this.gl, L = this.loc;
    if (viewport) gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);
    if (clear) { gl.clearColor(...clear); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); }
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(L.uProj, false, proj);
    gl.uniformMatrix4fv(L.uView, false, view);
    this._attribs(this.cube);
    gl.uniform1f(L.uLit, 1);
    for (const b of scene.boxes) {
      gl.uniformMatrix4fv(L.uModel, false, b.m);
      gl.uniform4fv(L.uTint, b.color);
      gl.uniform1f(L.uGlow, b.glow || 0);
      gl.drawArrays(gl.TRIANGLES, 0, 36);
    }
    if (scene.lines && scene.lines.length) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
      gl.bufferData(gl.ARRAY_BUFFER, scene.lines, gl.DYNAMIC_DRAW);
      this._attribs(this.lineBuf);
      gl.uniformMatrix4fv(L.uModel, false, mat4.identity());
      gl.uniform4fv(L.uTint, [1, 1, 1, 1]);
      gl.uniform1f(L.uGlow, 0);
      gl.uniform1f(L.uLit, 0);
      gl.depthMask(false);
      gl.drawArrays(gl.LINES, 0, scene.lines.length / 10);
      gl.depthMask(true);
    }
  }
}
