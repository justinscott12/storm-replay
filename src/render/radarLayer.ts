import { MercatorCoordinate, type CustomLayerInterface, type CustomRenderMethodInput, type Map as MapLibreMap } from 'maplibre-gl';
import type { Frame, FrameMoment, Product } from '../types';
import { buildLut } from './colormaps';

// The radar is drawn as one quad covering the site's full range. The fragment shader turns each
// pixel's mercator position back into (range, azimuth) from the radar and looks up the gate in a
// texture of raw uint8 codes (rows = azimuth bins, columns = gates), then colours it through a
// 256-entry lookup texture. A new frame costs one ~1.3 MB texture upload and no geometry.

const EARTH_R = 6371008.8;

const VERT = `#version 300 es
uniform mat4 u_matrix;
in vec2 a_pos;
out vec2 v_merc;
void main() {
  v_merc = a_pos;
  gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
in vec2 v_merc;
uniform vec2 u_site;      // radar lon, lat (degrees)
uniform float u_r0;       // range to centre of first gate (m)
uniform float u_dr;       // gate spacing (m)
uniform int u_gates;
uniform int u_rows;
uniform float u_opacity;
uniform usampler2D u_data;
uniform sampler2D u_lut;
out vec4 fragColor;
const float PI = 3.141592653589793;
const float EARTH_R = ${EARTH_R.toFixed(1)};
void main() {
  float lon = v_merc.x * 360.0 - 180.0;
  float lat = degrees(atan(sinh(PI * (1.0 - 2.0 * v_merc.y))));
  float north = EARTH_R * radians(lat - u_site.y);
  float east = EARTH_R * radians(lon - u_site.x) * cos(radians(0.5 * (lat + u_site.y)));
  // Ground distance ~= slant range at the 0.5 deg tilt (< 0.1% difference at 460 km).
  float r = length(vec2(east, north));
  int gate = int(floor((r - u_r0) / u_dr + 0.5));
  if (gate < 0 || gate >= u_gates) discard;
  float az = degrees(atan(east, north));
  if (az < 0.0) az += 360.0;
  int row = min(int(az / 360.0 * float(u_rows)), u_rows - 1);
  uint code = texelFetch(u_data, ivec2(gate, row), 0).r;
  vec4 c = texelFetch(u_lut, ivec2(int(code), 0), 0);
  if (c.a == 0.0) discard;
  fragColor = vec4(c.rgb, 1.0) * u_opacity;
}`;

const UNIFORMS = ['u_matrix', 'u_site', 'u_r0', 'u_dr', 'u_gates', 'u_rows', 'u_opacity', 'u_data', 'u_lut'] as const;
type UniformName = (typeof UNIFORMS)[number];

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`shader: ${gl.getShaderInfoLog(s)}`);
  return s;
}

export class RadarLayer implements CustomLayerInterface {
  readonly id = 'radar';
  readonly type = 'custom' as const;
  readonly renderingMode = '2d' as const;
  opacity = 0.85;

  private map: MapLibreMap | null = null;
  private program: WebGLProgram | null = null;
  private quad: WebGLBuffer | null = null;
  private dataTex: WebGLTexture | null = null;
  private lutTex: WebGLTexture | null = null;
  private u = {} as Record<UniformName, WebGLUniformLocation | null>;
  private aPos = 0;
  private frame: Frame | null = null;
  private product: Product = 'REF';
  private dirty = false;

  onAdd(map: MapLibreMap, gl: WebGL2RenderingContext): void {
    this.map = map;
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`link: ${gl.getProgramInfoLog(program)}`);
    this.program = program;
    for (const name of UNIFORMS) this.u[name] = gl.getUniformLocation(program, name);
    this.aPos = gl.getAttribLocation(program, 'a_pos');
    this.quad = gl.createBuffer();
    this.dataTex = gl.createTexture();
    this.lutTex = gl.createTexture();
    for (const tex of [this.dataTex, this.lutTex]) {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
  }

  onRemove(_map: MapLibreMap, gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
    gl.deleteBuffer(this.quad);
    gl.deleteTexture(this.dataTex);
    gl.deleteTexture(this.lutTex);
  }

  /** Show one product of a frame. The GPU upload happens on the next render. */
  show(frame: Frame, product: Product): void {
    this.frame = frame;
    this.product = product;
    this.dirty = true;
    this.map?.triggerRepaint();
  }

  private get moment(): FrameMoment | null {
    if (!this.frame) return null;
    return this.product === 'VEL' ? this.frame.vel : this.frame.ref;
  }

  private upload(gl: WebGL2RenderingContext, frame: Frame, m: FrameMoment): void {
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.bindTexture(gl.TEXTURE_2D, this.dataTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, m.gates, m.rows, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, m.grid);
    gl.bindTexture(gl.TEXTURE_2D, this.lutTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, buildLut(this.product, m));

    // Quad covering the full range circle, in mercator units [0, 1]. Size the longitude span for
    // the poleward edge, where a degree of longitude is shortest.
    const maxRange = m.firstGateM + m.gates * m.gateSpacingM;
    const dLat = (maxRange / EARTH_R) * (180 / Math.PI);
    const north = Math.min(85, frame.lat + dLat);
    const south = Math.max(-85, frame.lat - dLat);
    const dLon = dLat / Math.cos((Math.max(Math.abs(north), Math.abs(south)) * Math.PI) / 180);
    const nw = MercatorCoordinate.fromLngLat([frame.lon - dLon, north]);
    const se = MercatorCoordinate.fromLngLat([frame.lon + dLon, south]);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([nw.x, nw.y, se.x, nw.y, nw.x, se.y, se.x, se.y]), gl.STATIC_DRAW);
  }

  render(gl: WebGL2RenderingContext, options: CustomRenderMethodInput): void {
    const { frame, moment: m, program, u } = this;
    if (!frame || !m || !program) return;
    if (this.dirty) {
      this.upload(gl, frame, m);
      this.dirty = false;
    }
    gl.useProgram(program);
    gl.uniformMatrix4fv(u.u_matrix, false, options.defaultProjectionData.mainMatrix);
    gl.uniform2f(u.u_site, frame.lon, frame.lat);
    gl.uniform1f(u.u_r0, m.firstGateM);
    gl.uniform1f(u.u_dr, m.gateSpacingM);
    gl.uniform1i(u.u_gates, m.gates);
    gl.uniform1i(u.u_rows, m.rows);
    gl.uniform1f(u.u_opacity, this.opacity);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.dataTex);
    gl.uniform1i(u.u_data, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.lutTex);
    gl.uniform1i(u.u_lut, 1);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(this.aPos);
    gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
