import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { skyDomeRadius, skyEnvironment } from './sky-environment';
import type { PhotoSeason } from './photo-season';
import type { PhotoTime } from './photo-time';
import type { Theme } from './theme';

const vertexShader = `
  varying vec3 skyDirection;
  void main() {
    skyDirection = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = `
  varying vec3 skyDirection;
  uniform vec3 zenith, horizon, ground, glow, clouds, celestial, celestialDirection;
  uniform float stars, moon, cloudAmount;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  void main() {
    vec3 dir = normalize(skyDirection);
    float elevation = max(dir.y, 0.0);
    vec3 color = mix(horizon, zenith, pow(smoothstep(0.0, 1.0, elevation), .48));
    float facing = max(dot(dir, normalize(celestialDirection)), 0.0);
    color = mix(color, glow, pow(facing, 12.0) * (1.0 - moon) * .46);

    // Soft, stationary cloud banks: no texture download or ongoing animation.
    vec2 cloudUV = dir.xz / (elevation + .3) * 3.0;
    float cloudNoise = noise(cloudUV) * .7 + noise(cloudUV * 2.4) * .3;
    float cloud = smoothstep(.58, .82, cloudNoise) * cloudAmount
      * smoothstep(.025, .16, dir.y) * (1.0 - smoothstep(.8, 1.0, elevation));
    color = mix(color, clouds, cloud);

    // Stars are anchored to world directions rather than screen coordinates.
    vec2 starUV = vec2(atan(dir.z, dir.x) / 6.2831853 + .5,
                       asin(clamp(dir.y, -1.0, 1.0)) / 3.1415927 + .5) * vec2(480.0, 240.0);
    vec2 cell = floor(starUV);
    float seed = hash(cell);
    vec2 offset = vec2(hash(cell + 11.7), hash(cell + 29.3)) * .7 + .15;
    float star = (1.0 - smoothstep(.015, .12, length(fract(starUV) - offset)))
      * step(.982, seed) * stars * smoothstep(.04, .22, dir.y) * (1.0 - cloud);
    color += vec3(.68, .78, 1.0) * star;

    float disk = smoothstep(cos(.012), cos(.009), facing);
    float halo = pow(facing, 700.0) * mix(.16, .035, moon);
    color += celestial * halo;
    // A restrained moon surface gives the night disk some depth.
    float lunarShade = .8 + .2 * noise(dir.xz * 600.0);
    color = mix(color, celestial * mix(1.0, lunarShade, moon), disk);

    // A level horizon and matching lower hemisphere continue the finite map
    // ground without adding geometry over underground spaces or photo points.
    color = mix(ground, color, smoothstep(-.018, .012, dir.y));
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

const colorNames = ['zenith', 'horizon', 'ground', 'glow', 'clouds', 'celestial'] as const;
const numberNames = ['stars', 'moon', 'cloudAmount'] as const;
type SkyColors = Record<typeof colorNames[number], THREE.Color>;
type SkyColorUniforms = Record<typeof colorNames[number], THREE.IUniform<THREE.Color>>;
type SkyNumberUniforms = Record<typeof numberNames[number], THREE.IUniform<number>>;

export default function SkyEnvironment({ theme, season, time }: { theme: Theme; season: PhotoSeason | ''; time: PhotoTime | '' }) {
  const environment = useMemo(() => skyEnvironment(theme, season, time), [theme, season, time]);
  const dome = useRef<THREE.Mesh>(null);
  const material = useRef<THREE.ShaderMaterial>(null);
  const { invalidate } = useThree();
  const uniforms = useMemo(() => ({
    ...Object.fromEntries(colorNames.map(name => [name, { value: new THREE.Color(environment[name]) }])) as SkyColorUniforms,
    ...Object.fromEntries(numberNames.map(name => [name, { value: environment[name] }])) as SkyNumberUniforms,
    celestialDirection: { value: new THREE.Vector3(...environment.direction).normalize() },
  }), []);
  const target = useMemo(() => ({
    ...Object.fromEntries(colorNames.map(name => [name, new THREE.Color(environment[name])])) as SkyColors,
    celestialDirection: new THREE.Vector3(...environment.direction).normalize(),
  }), [environment]);
  const changing = useRef(false);
  const reducedMotion = useRef(false);
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const read = () => { reducedMotion.current = preference.matches; };
    read(); preference.addEventListener('change', read);
    return () => preference.removeEventListener('change', read);
  }, []);
  useEffect(() => { changing.current = true; invalidate(); }, [environment, invalidate]);
  useFrame((_, delta) => {
    if (!changing.current) return;
    const values = material.current?.uniforms as typeof uniforms | undefined;
    if (!values) return;
    const blend = reducedMotion.current ? 1 : 1 - Math.exp(-Math.min(delta, .1) * 7);
    let remaining = 0;
    for (const name of colorNames) {
      const value = values[name].value, to = target[name];
      value.lerp(to, blend);
      remaining = Math.max(remaining, Math.abs(value.r - to.r), Math.abs(value.g - to.g), Math.abs(value.b - to.b));
    }
    for (const name of numberNames) {
      const value = values[name];
      value.value += (environment[name] - value.value) * blend;
      remaining = Math.max(remaining, Math.abs(environment[name] - value.value));
    }
    const direction = values.celestialDirection.value;
    direction.lerp(target.celestialDirection, blend);
    remaining = Math.max(remaining, direction.distanceTo(target.celestialDirection));
    changing.current = remaining > .001;
    if (changing.current) invalidate();
  });
  return <mesh ref={dome} name="campus-sky-dome" renderOrder={-1000} frustumCulled={false} raycast={() => null} onBeforeRender={(_renderer, _scene, camera) => {
    // Follow the final camera pose, including movements applied later in this frame.
    const mesh = dome.current;
    if (!mesh || !(camera instanceof THREE.PerspectiveCamera)) return;
    mesh.position.copy(camera.position);
    mesh.scale.setScalar(skyDomeRadius(camera.near, camera.far));
    mesh.updateMatrixWorld();
  }}>
    <sphereGeometry args={[1, 48, 24]} />
    <shaderMaterial ref={material} uniforms={uniforms} vertexShader={vertexShader} fragmentShader={fragmentShader} side={THREE.BackSide} depthTest={false} depthWrite={false} toneMapped={false} />
  </mesh>;
}
