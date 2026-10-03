/**
 * Final colour grade, applied in display space after tone mapping: amber highlights and teal shadows (an old
 * hand-tinted photograph of a brass-and-steam town), a touch more contrast, and a vignette. Smog warms and flattens
 * the image further; night cools the shadows.
 */
export const GradeShader = {
  name: 'GradeShader',
  uniforms: {
    tDiffuse: { value: null },
    uAmount: { value: 0.8 },
    uSmog: { value: 0 },
    uNight: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uAmount;
    uniform float uSmog;
    uniform float uNight;
    varying vec2 vUv;
    void main() {
      vec4 src = texture2D(tDiffuse, vUv);
      vec3 c = src.rgb;
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      // Split tone: teal into the shadows, amber into the highlights.
      vec3 shadow = vec3(-0.03, 0.025, 0.045) * (1.0 + 0.6 * uNight);
      vec3 light = vec3(0.07, 0.035, -0.04) * (1.0 + 0.5 * uSmog);
      c += mix(shadow, light, smoothstep(0.12, 0.7, l)) * uAmount;
      // Smog flattens the colours towards a warm sepia.
      vec3 sepia = vec3(l * 1.07, l * 0.98, l * 0.82);
      c = mix(c, sepia, 0.12 * uAmount + 0.18 * uSmog);
      // A little contrast around the midtones.
      c = (c - 0.5) * (1.0 + 0.07 * uAmount) + 0.5;
      // Vignette.
      float d = distance(vUv, vec2(0.5));
      c *= 1.0 - (0.22 + 0.1 * uSmog) * smoothstep(0.38, 0.85, d);
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), src.a);
    }`,
}
