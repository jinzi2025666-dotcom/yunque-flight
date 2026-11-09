import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  BoxGeometry,
  CylinderGeometry,
  DirectionalLight,
  BackSide,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PointLight,
  Points,
  PointsMaterial,
  RepeatWrapping,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
  type Scene,
} from 'three';
import { AircraftVisual, PARKED_PALETTE } from './aircraft.ts';
import { GEAR_HEIGHT, SUN_X, SUN_Y, SUN_Z } from './constants.ts';
import { FIELD, LAKE, PLACES, sampleGround, terrainHeight, WATER_Y } from './terrain.ts';

const SUN = new Vector3(SUN_X, SUN_Y, SUN_Z).normalize();

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function softDustTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建尘土贴图');
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,0.85)');
  gradient.addColorStop(0.45, 'rgba(255,255,255,0.25)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function glowTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建光晕贴图');
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function asphaltTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建跑道贴图');
  ctx.fillStyle = '#3a4048';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1800; i += 1) {
    const shade = 48 + Math.random() * 36;
    ctx.fillStyle = `rgba(${shade},${shade},${shade + 6},0.18)`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(4, 28);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function numberTexture(text: string): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建跑道号');
  ctx.clearRect(0, 0, 256, 512);
  ctx.fillStyle = '#f5f7fb';
  ctx.font = '700 210px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 256);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

class Dust {
  private readonly positions: Float32Array;
  private readonly velocities: Float32Array;
  private readonly life: Float32Array;
  private readonly geometry: BufferGeometry;
  readonly points: Points;
  private cursor = 0;

  constructor(count = 80) {
    this.positions = new Float32Array(count * 3);
    this.velocities = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.geometry = new BufferGeometry();
    this.geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    this.points = new Points(
      this.geometry,
      new PointsMaterial({
        color: 0xd9d0be,
        map: softDustTexture(),
        size: 0.45,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        sizeAttenuation: true,
      }),
    );
    this.points.frustumCulled = false;
    this.points.visible = false;
  }

  emit(x: number, y: number, z: number, forwardX: number, forwardZ: number): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.life.length;
    const o = i * 3;
    this.positions[o] = x + (Math.random() - 0.5) * 0.4;
    this.positions[o + 1] = y + 0.15;
    this.positions[o + 2] = z + (Math.random() - 0.5) * 0.4;
    this.velocities[o] = -forwardX * (2 + Math.random() * 3) + (Math.random() - 0.5);
    this.velocities[o + 1] = 0.6 + Math.random() * 1.4;
    this.velocities[o + 2] = -forwardZ * (2 + Math.random() * 3) + (Math.random() - 0.5);
    this.life[i] = 0.35 + Math.random() * 0.35;
    this.points.visible = true;
  }

  update(dt: number): void {
    let alive = false;
    for (let i = 0; i < this.life.length; i += 1) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const o = i * 3;
      this.positions[o] += this.velocities[o] * dt;
      this.positions[o + 1] += this.velocities[o + 1] * dt;
      this.positions[o + 2] += this.velocities[o + 2] * dt;
      this.velocities[o + 1] -= dt * 1.5;
      if (this.life[i] > 0) alive = true;
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.points.visible = alive;
  }
}

export class World {
  readonly sun: DirectionalLight;
  readonly sunTarget: Object3D;
  readonly sky: Mesh;
  private readonly papiMats: MeshStandardMaterial[] = [];
  private readonly papiZ: number;
  private readonly clouds: Group[] = [];
  private readonly turbine: Group;
  private readonly windsock: Group;
  private readonly beaconMat: MeshStandardMaterial;
  private readonly beaconLight: PointLight;
  private readonly dust = new Dust();
  private readonly water: ShaderMaterial;
  private readonly parkedProp: Group;
  private readonly sunSprite: Sprite;
  private time = 0;

  constructor(scene: Scene) {
    scene.fog = new Fog(0xefc7a0, 420, 8200);
    scene.background = new Color(0xefc7a0);

    const hemi = new HemisphereLight(0xc5dcff, 0x6d7a45, 0.72);
    scene.add(hemi);
    this.sunTarget = new Object3D();
    scene.add(this.sunTarget);
    this.sun = new DirectionalLight(0xfff1d4, 3.35);
    this.sun.position.copy(SUN).multiplyScalar(180);
    this.sun.target = this.sunTarget;
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 20;
    this.sun.shadow.camera.far = 280;
    this.sun.shadow.camera.left = -70;
    this.sun.shadow.camera.right = 70;
    this.sun.shadow.camera.top = 70;
    this.sun.shadow.camera.bottom = -70;
    this.sun.shadow.bias = -0.00025;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun);

    const fill = new DirectionalLight(0xc3d5ff, 0.55);
    fill.position.set(-90, 50, -40);
    scene.add(fill);

    this.sky = this.makeSky();
    scene.add(this.sky);
    this.sunSprite = this.makeSunSprite();
    scene.add(this.sunSprite);
    this.addTerrain(scene);
    this.addAirport(scene);
    this.water = this.addLakeShimmer(scene);
    this.addTrees(scene);
    this.addClouds(scene);
    this.turbine = this.addTurbine(scene);
    this.windsock = this.addWindsock(scene);
    const beacon = this.addBuildings(scene);
    this.beaconMat = beacon.mat;
    this.beaconLight = beacon.light;
    this.papiZ = FIELD.south - 210;
    this.addPapi(scene, this.papiZ);
    this.parkedProp = this.addParkedAircraft(scene);
    scene.add(this.dust.points);
  }

  update(
    dt: number,
    position: Vector3,
    forward: Vector3,
    agl: number,
    onGround: boolean,
    airspeed: number,
    wheels: Vector3[],
  ): void {
    this.time += dt;
    this.turbine.rotation.z += dt * 1.6;
    this.windsock.rotation.z = Math.sin(this.time * 7) * 0.12;
    this.windsock.rotation.x = -0.35 + Math.sin(this.time * 5) * 0.06;
    const flash = Math.sin(this.time * 6) > 0.35;
    this.beaconMat.emissiveIntensity = flash ? 3 : 0.15;
    this.beaconLight.intensity = flash ? 18 : 0;
    this.water.uniforms.uTime.value = this.time;
    for (const cloud of this.clouds) {
      cloud.position.x += dt * 1.6;
      if (cloud.position.x > 2800) cloud.position.x = -2800;
    }
    this.parkedProp.rotation.z += dt * 8;
    this.updatePapi(position, agl);
    if (onGround && airspeed > 14) {
      for (const wheel of wheels) {
        if (Math.random() > 0.72) continue;
        this.dust.emit(wheel.x, wheel.y, wheel.z, forward.x, forward.z);
      }
    }
    this.dust.update(dt);
  }

  follow(cameraPosition: Vector3): void {
    this.sky.position.copy(cameraPosition);
    this.sunSprite.position.copy(cameraPosition).addScaledVector(SUN, 8000);
  }

  private updatePapi(position: Vector3, agl: number): void {
    const horiz = position.z - this.papiZ;
    const degrees = horiz > 25 ? (Math.atan2(Math.max(agl, 0), horiz) * 180) / Math.PI : 1.2;
    const cuts = [3.5, 3.15, 2.85, 2.5];
    for (let i = 0; i < this.papiMats.length; i += 1) {
      const white = degrees > (cuts[i] ?? 3);
      const mat = this.papiMats[i];
      mat.color.set(white ? 0xfff4d2 : 0xff2d2d);
      mat.emissive.set(white ? 0xffe29a : 0xff241c);
    }
  }

  private makeSky(): Mesh {
    const material = new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      uniforms: { uSun: { value: SUN.clone() } },
      vertexShader: `
        varying vec3 vDir;
        #include <common>
        #include <logdepthbuf_pars_vertex>
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          #include <logdepthbuf_vertex>
        }
      `,
      fragmentShader: `
        varying vec3 vDir;
        uniform vec3 uSun;
        #include <common>
        #include <logdepthbuf_pars_fragment>
        void main() {
          vec3 dir = normalize(vDir);
          float h = dir.y;
          vec3 zenith = vec3(0.15, 0.40, 0.76);
          vec3 mid = vec3(0.49, 0.71, 0.92);
          vec3 hor = vec3(0.98, 0.73, 0.48);
          vec3 below = vec3(0.55, 0.46, 0.36);
          vec3 col = mix(below, hor, smoothstep(-0.08, 0.02, h));
          col = mix(col, mid, smoothstep(0.0, 0.32, h));
          col = mix(col, zenith, smoothstep(0.2, 0.78, h));
          float sunDot = max(dot(dir, normalize(uSun)), 0.0);
          col += vec3(1.0, 0.93, 0.78) * pow(sunDot, 1600.0) * 1.5;
          col += vec3(1.0, 0.58, 0.24) * pow(sunDot, 14.0) * 0.32;
          gl_FragColor = vec4(col, 1.0);
          #include <logdepthbuf_fragment>
        }
      `,
    });
    const sky = new Mesh(new SphereGeometry(15000, 32, 20), material);
    sky.frustumCulled = false;
    sky.renderOrder = -1;
    return sky;
  }

  private makeSunSprite(): Sprite {
    const sprite = new Sprite(
      new SpriteMaterial({
        map: glowTexture(),
        color: 0xfff0c2,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        opacity: 0.95,
      }),
    );
    sprite.position.copy(SUN).multiplyScalar(8000);
    sprite.scale.set(700, 700, 1);
    sprite.frustumCulled = false;
    return sprite;
  }

  private addTerrain(scene: Scene): void {
    const geo = new PlaneGeometry(12000, 12000, 200, 200);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    const grass = new Color('#6e933c');
    const lawn = new Color('#86a64a');
    const dry = new Color('#c2ae72');
    const sand = new Color('#d7c48a');
    const rock = new Color('#8e8880');
    const snow = new Color('#e7eef3');
    const waterDeep = new Color('#0d4d66');
    const waterShallow = new Color('#2f8ea4');
    const tint = new Color();
    for (let i = 0; i < pos.count; i += 1) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const sample = sampleGround(x, z);
      pos.setY(i, sample.y);
      const n = sample.raw * 0.01 + ((i * 17) % 10) / 40;
      if (sample.water) tint.copy(waterDeep).lerp(waterShallow, Math.min(1, (sample.raw + 8) / 7));
      else if (sample.mask < 0.12) tint.copy(lawn).offsetHSL(0, 0, ((i % 5) - 2) * 0.01);
      else if (sample.y < 0.6) tint.copy(sand).lerp(grass, Math.max(0, sample.y));
      else if (sample.y > 250) tint.copy(rock).lerp(snow, Math.min(1, (sample.y - 240) / 90));
      else if (sample.y > 130) tint.copy(grass).lerp(rock, Math.min(1, (sample.y - 110) / 120));
      else tint.copy(grass).lerp(dry, Math.min(0.55, Math.max(0, n)));
      colors[i * 3] = tint.r;
      colors[i * 3 + 1] = tint.g;
      colors[i * 3 + 2] = tint.b;
    }
    geo.setAttribute('color', new BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mesh = new Mesh(
      geo,
      new MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0 }),
    );
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  private addAirport(scene: Scene): void {
    const length = FIELD.south - FIELD.north;
    const centerZ = (FIELD.south + FIELD.north) / 2;
    const asphalt = new MeshStandardMaterial({
      map: asphaltTexture(),
      color: 0x8d93a0,
      roughness: 0.92,
      metalness: 0.04,
    });
    const runway = new Mesh(new PlaneGeometry(FIELD.runwayHalf * 2, length), asphalt);
    runway.rotation.x = -Math.PI / 2;
    runway.position.set(0, 0.06, centerZ);
    runway.receiveShadow = true;
    scene.add(runway);

    const apron = new Mesh(new PlaneGeometry(156, 210), asphalt);
    apron.rotation.x = -Math.PI / 2;
    apron.position.set(98, 0.045, 105);
    apron.receiveShadow = true;
    scene.add(apron);

    const white = new MeshStandardMaterial({ color: 0xf4f7fb, roughness: 0.5 });
    const yellow = new MeshStandardMaterial({ color: 0xf0c53a, roughness: 0.55 });
    const edge = new Mesh(new PlaneGeometry(0.45, length - 8), white);
    edge.rotation.x = -Math.PI / 2;
    const edgeL = edge.clone();
    edgeL.position.set(-FIELD.runwayHalf + 0.7, 0.09, centerZ);
    const edgeR = edge.clone();
    edgeR.position.set(FIELD.runwayHalf - 0.7, 0.09, centerZ);
    scene.add(edgeL, edgeR);

    for (let z = FIELD.north + 30; z < FIELD.south - 30; z += 36) {
      const dash = new Mesh(new PlaneGeometry(0.55, 18), white);
      dash.rotation.x = -Math.PI / 2;
      dash.position.set(0, 0.09, z);
      scene.add(dash);
    }

    for (const end of [FIELD.south - 34, FIELD.north + 34]) {
      for (let i = 0; i < 8; i += 1) {
        const stripe = new Mesh(new PlaneGeometry(1.7, 30), white);
        stripe.rotation.x = -Math.PI / 2;
        stripe.position.set(-15.2 + i * 4.35, 0.095, end);
        scene.add(stripe);
      }
    }

    for (const side of [-1, 1]) {
      const aim = new Mesh(new PlaneGeometry(5.5, 42), white);
      aim.rotation.x = -Math.PI / 2;
      aim.position.set(side * 9, 0.095, FIELD.south - 340);
      scene.add(aim);
    }

    this.placeNumber('36', FIELD.south - 90, 0, scene);
    this.placeNumber('18', FIELD.north + 90, Math.PI, scene);

    const taxi = new Mesh(new PlaneGeometry(0.25, 120), yellow);
    taxi.rotation.x = -Math.PI / 2;
    taxi.rotation.z = Math.PI / 2;
    taxi.position.set(78, 0.08, 100);
    scene.add(taxi);

    const lightMat = new MeshStandardMaterial({
      color: 0xfff6df,
      emissive: 0xfff1cc,
      emissiveIntensity: 0.7,
      roughness: 0.4,
    });
    const yellowMat = new MeshStandardMaterial({
      color: 0xffc44a,
      emissive: 0xffb000,
      emissiveIntensity: 0.8,
      roughness: 0.4,
    });
    const whites: number[] = [];
    const yellows: number[] = [];
    for (let z = FIELD.north + 8; z <= FIELD.south - 8; z += 32) {
      const caution = z < FIELD.north + 520 || z > FIELD.south - 520;
      const bucket = caution ? yellows : whites;
      bucket.push(-FIELD.runwayHalf - 1.5, 0.28, z, FIELD.runwayHalf + 1.5, 0.28, z);
    }
    scene.add(this.lightsFrom(whites, lightMat), this.lightsFrom(yellows, yellowMat));

    const greenMat = new MeshStandardMaterial({
      color: 0x37e07a,
      emissive: 0x1ec75a,
      emissiveIntensity: 1.1,
    });
    const redMat = new MeshStandardMaterial({
      color: 0xff3b3b,
      emissive: 0xff2020,
      emissiveIntensity: 1.1,
    });
    const greens: number[] = [];
    const reds: number[] = [];
    for (let x = -16; x <= 16; x += 4) {
      greens.push(x, 0.32, FIELD.south + 6, x, 0.32, FIELD.north - 6);
      reds.push(x, 0.32, FIELD.south + 14, x, 0.32, FIELD.north - 14);
    }
    for (let z = FIELD.south + 20; z <= 500; z += 34) {
      greens.push(0, 0.45, z);
    }
    scene.add(this.lightsFrom(greens, greenMat), this.lightsFrom(reds, redMat));
  }

  private lightsFrom(coords: number[], material: MeshStandardMaterial): InstancedMesh {
    const mesh = new InstancedMesh(new SphereGeometry(0.28, 8, 8), material, Math.max(1, coords.length / 3));
    const dummy = new Object3D();
    for (let i = 0; i < coords.length; i += 3) {
      dummy.position.set(coords[i] ?? 0, coords[i + 1] ?? 0, coords[i + 2] ?? 0);
      dummy.scale.setScalar(coords.length > 40 ? 1 : 0.85);
      dummy.updateMatrix();
      mesh.setMatrixAt(i / 3, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }

  private placeNumber(text: string, z: number, yaw: number, scene: Scene): void {
    const mesh = new Mesh(
      new PlaneGeometry(9, 20),
      new MeshStandardMaterial({
        map: numberTexture(text),
        transparent: true,
        roughness: 0.55,
        polygonOffset: true,
        polygonOffsetFactor: -4,
      }),
    );
    mesh.rotation.order = 'YXZ';
    mesh.rotation.y = yaw;
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(0, 0.11, z);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  private addPapi(scene: Scene, z: number): void {
    const glow = glowTexture();
    for (let i = 0; i < 4; i += 1) {
      const mat = new MeshStandardMaterial({
        color: 0xfff4d2,
        emissive: 0xffe29a,
        emissiveIntensity: 1.4,
      });
      const lamp = new Mesh(new BoxGeometry(0.55, 0.45, 0.4), mat);
      lamp.position.set(-24 - i * 3.1, 1.15, z);
      scene.add(lamp);
      const sprite = new Sprite(
        new SpriteMaterial({ map: glow, color: 0xfff1c8, transparent: true, blending: AdditiveBlending, depthWrite: false, opacity: 0.85 }),
      );
      sprite.position.copy(lamp.position);
      sprite.scale.set(2.4, 2.4, 1);
      scene.add(sprite);
      this.papiMats.push(mat);
    }
  }

  private addLakeShimmer(scene: Scene): ShaderMaterial {
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        varying vec2 vUv;
        #include <common>
        #include <logdepthbuf_pars_vertex>
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          #include <logdepthbuf_vertex>
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        uniform float uTime;
        #include <common>
        #include <logdepthbuf_pars_fragment>
        void main() {
          vec2 p = vUv * 10.0;
          float w = sin(p.x * 5.0 + uTime * 1.4) * sin(p.y * 4.0 - uTime);
          float edge = smoothstep(0.5, 0.42, length(vUv - 0.5));
          vec3 deep = vec3(0.05, 0.32, 0.48);
          vec3 lit = vec3(0.45, 0.78, 0.86);
          vec3 col = mix(deep, lit, w * 0.5 + 0.5);
          gl_FragColor = vec4(col, 0.28 * edge);
          #include <logdepthbuf_fragment>
        }
      `,
    });
    const mesh = new Mesh(new PlaneGeometry(LAKE.radius * 1.15, LAKE.radius * 1.15), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(LAKE.x, WATER_Y + 0.18, LAKE.z);
    scene.add(mesh);
    return material;
  }

  private addTrees(scene: Scene): void {
    const random = rng(42);
    const pineSpots: Array<[number, number, number, number]> = [];
    const roundSpots: Array<[number, number, number, number]> = [];
    for (let n = 0; n < 900 && pineSpots.length + roundSpots.length < 220; n += 1) {
      const x = (random() - 0.5) * 5200;
      const z = (random() - 0.5) * 5200;
      if (Math.abs(x) < 230 && z < 620 && z > -2000) continue;
      const sample = sampleGround(x, z);
      if (sample.water || sample.y < -0.2 || sample.y > 150 || sample.mask < 0.45) continue;
      const height = 4 + random() * 7;
      const bucket = sample.y > 40 || random() > 0.45 ? pineSpots : roundSpots;
      bucket.push([x, sample.y, z, height]);
    }
    const plant = (
      spots: Array<[number, number, number, number]>,
      crownGeo: SphereGeometry | ConeGeometry,
      color: number,
    ) => {
      if (spots.length === 0) return;
      const trunk = new InstancedMesh(
        new CylinderGeometry(0.18, 0.28, 1, 5),
        new MeshStandardMaterial({ color: 0x6b4a32, roughness: 0.9 }),
        spots.length,
      );
      const crown = new InstancedMesh(
        crownGeo,
        new MeshStandardMaterial({ color, roughness: 0.85 }),
        spots.length,
      );
      const dummy = new Object3D();
      const tint = new Color(color);
      for (let i = 0; i < spots.length; i += 1) {
        const [x, y, z, height] = spots[i] as [number, number, number, number];
        dummy.position.set(x, y + height * 0.22, z);
        dummy.scale.set(1, height * 0.45, 1);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        trunk.setMatrixAt(i, dummy.matrix);
        dummy.position.set(x, y + height * 0.72, z);
        dummy.scale.setScalar(height / 6);
        dummy.updateMatrix();
        crown.setMatrixAt(i, dummy.matrix);
        tint.set(color).offsetHSL(0, (i % 5) * 0.01 - 0.02, (i % 4) * 0.02 - 0.03);
        crown.setColorAt(i, tint);
      }
      trunk.instanceMatrix.needsUpdate = true;
      crown.instanceMatrix.needsUpdate = true;
      if (crown.instanceColor) crown.instanceColor.needsUpdate = true;
      scene.add(trunk, crown);
    };
    plant(pineSpots, new ConeGeometry(1.15, 2.4, 6), 0x2f6a34);
    plant(roundSpots, new SphereGeometry(1.05, 7, 6), 0x3e7d3a);
  }

  private addClouds(scene: Scene): void {
    const random = rng(7);
    const seeds = [
      [180, 280, -700],
      [-620, 340, -1100],
      [900, 300, 280],
      [-280, 390, 720],
      [1400, 360, -1500],
      [-1500, 420, -600],
      [420, 260, -1800],
      [-800, 310, 1400],
      [1800, 380, 600],
    ];
    const material = new MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xfff8ef,
      emissiveIntensity: 0.18,
      roughness: 1,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    for (const [x, y, z] of seeds) {
      const cloud = new Group();
      const puffs = 5 + Math.floor(random() * 3);
      for (let i = 0; i < puffs; i += 1) {
        const puff = new Mesh(new SphereGeometry(18 + random() * 16, 8, 6), material);
        puff.position.set((random() - 0.5) * 70, (random() - 0.4) * 12, (random() - 0.5) * 36);
        puff.scale.y = 0.62;
        cloud.add(puff);
      }
      cloud.position.set(x ?? 0, y ?? 300, z ?? 0);
      this.clouds.push(cloud);
      scene.add(cloud);
    }
  }

  private addTurbine(scene: Scene): Group {
    const y = terrainHeight(PLACES.turbine.x, PLACES.turbine.z);
    const mast = new Mesh(
      new CylinderGeometry(0.35, 0.7, 42, 8),
      new MeshStandardMaterial({ color: 0xf2f4f6, roughness: 0.4 }),
    );
    mast.position.set(PLACES.turbine.x, y + 21, PLACES.turbine.z);
    mast.castShadow = true;
    scene.add(mast);
    const rotor = new Group();
    rotor.position.set(PLACES.turbine.x, y + 42, PLACES.turbine.z);
    for (let i = 0; i < 3; i += 1) {
      const blade = new Mesh(
        new BoxGeometry(0.55, 18, 0.2),
        new MeshStandardMaterial({ color: 0xf7f7f5, roughness: 0.35 }),
      );
      blade.position.y = 9.2;
      const pivot = new Group();
      pivot.rotation.z = (i * Math.PI * 2) / 3;
      pivot.add(blade);
      rotor.add(pivot);
    }
    rotor.add(new Mesh(new SphereGeometry(0.8, 10, 8), new MeshStandardMaterial({ color: 0xdfe6ea })));
    scene.add(rotor);
    return rotor;
  }

  private addWindsock(scene: Scene): Group {
    const y = terrainHeight(PLACES.windsock.x, PLACES.windsock.z);
    const pole = new Mesh(
      new CylinderGeometry(0.08, 0.1, 7, 6),
      new MeshStandardMaterial({ color: 0xdedee2, roughness: 0.45 }),
    );
    pole.position.set(PLACES.windsock.x, y + 3.5, PLACES.windsock.z);
    pole.castShadow = true;
    scene.add(pole);
    const sock = new Group();
    sock.position.set(PLACES.windsock.x, y + 6.8, PLACES.windsock.z);
    const cloth = new Mesh(
      new ConeGeometry(0.38, 1.8, 8),
      new MeshStandardMaterial({ color: 0xe4572a, roughness: 0.6 }),
    );
    cloth.rotation.x = Math.PI / 2;
    cloth.position.z = 0.9;
    sock.add(cloth);
    sock.rotation.y = Math.atan2(1.4, 4.8);
    scene.add(sock);
    return sock;
  }

  private addBuildings(scene: Scene): { mat: MeshStandardMaterial; light: PointLight } {
    const wall = new MeshStandardMaterial({ color: 0xd7d2c8, roughness: 0.72 });
    const roof = new MeshStandardMaterial({ color: 0xb55238, roughness: 0.6 });
    const glass = new MeshStandardMaterial({
      color: 0x16343f,
      emissive: 0x0c2a33,
      emissiveIntensity: 0.4,
      roughness: 0.15,
      metalness: 0.2,
    });
    const hangar = new Mesh(new BoxGeometry(34, 9, 20), wall);
    hangar.position.set(PLACES.hangar.x, terrainHeight(PLACES.hangar.x, PLACES.hangar.z) + 4.5, PLACES.hangar.z);
    hangar.castShadow = true;
    hangar.receiveShadow = true;
    const hangarRoof = new Mesh(new BoxGeometry(35, 1.2, 21), roof);
    hangarRoof.position.set(0, 5, 0);
    hangar.add(hangarRoof);
    scene.add(hangar);

    const office = new Mesh(new BoxGeometry(16, 7, 12), wall);
    office.position.set(PLACES.office.x, 3.5, PLACES.office.z);
    office.castShadow = true;
    office.receiveShadow = true;
    for (const wy of [1.2, -0.8]) {
      for (const wx of [-4.5, -1.5, 1.5, 4.5]) {
        const windowPane = new Mesh(new BoxGeometry(1.6, 1.3, 0.12), glass);
        windowPane.position.set(wx, wy, 6.02);
        office.add(windowPane);
      }
    }
    scene.add(office);

    const tank = new Mesh(
      new CylinderGeometry(3.2, 3.2, 4.2, 16),
      new MeshStandardMaterial({ color: 0xf2f2f0, roughness: 0.35, metalness: 0.25 }),
    );
    tank.position.set(PLACES.fuel.x, 2.3, PLACES.fuel.z);
    tank.castShadow = true;
    const band = new Mesh(
      new CylinderGeometry(3.28, 3.28, 0.45, 16),
      new MeshStandardMaterial({ color: 0xd23b2f, roughness: 0.45 }),
    );
    band.position.y = 0.4;
    tank.add(band);
    scene.add(tank);

    const shaft = new Mesh(
      new CylinderGeometry(1.3, 1.7, 16, 10),
      new MeshStandardMaterial({ color: 0xe7e4dc, roughness: 0.55 }),
    );
    const baseY = terrainHeight(PLACES.tower.x, PLACES.tower.z);
    shaft.position.set(PLACES.tower.x, baseY + 8, PLACES.tower.z);
    shaft.castShadow = true;
    scene.add(shaft);
    const cab = new Mesh(new BoxGeometry(4.4, 2.6, 4.4), glass);
    cab.position.set(PLACES.tower.x, baseY + 17.2, PLACES.tower.z);
    scene.add(cab);
    const beaconMat = new MeshStandardMaterial({
      color: 0xff4a3a,
      emissive: 0xff2a1c,
      emissiveIntensity: 0.5,
    });
    const beacon = new Mesh(new SphereGeometry(0.28, 10, 8), beaconMat);
    beacon.position.set(PLACES.tower.x, baseY + 19.2, PLACES.tower.z);
    scene.add(beacon);
    const beaconLight = new PointLight(0xff5530, 0, 32, 2);
    beaconLight.position.copy(beacon.position);
    scene.add(beaconLight);

    const cottageY = terrainHeight(PLACES.island.x, PLACES.island.z);
    const cottage = new Mesh(new BoxGeometry(3.2, 2.2, 2.6), new MeshStandardMaterial({ color: 0xf0e2c4, roughness: 0.75 }));
    cottage.position.set(PLACES.island.x, cottageY + 1.1, PLACES.island.z);
    cottage.castShadow = true;
    const cottageRoof = new Mesh(new ConeGeometry(2.3, 1.5, 4), roof);
    cottageRoof.position.y = 1.7;
    cottageRoof.rotation.y = Math.PI / 4;
    cottage.add(cottageRoof);
    scene.add(cottage);

    return { mat: beaconMat, light: beaconLight };
  }

  private addParkedAircraft(scene: Scene): Group {
    const parked = new AircraftVisual(PARKED_PALETTE);
    const y = terrainHeight(78, 42);
    parked.root.position.set(78, y + GEAR_HEIGHT, 42);
    parked.root.rotation.y = 0.9;
    scene.add(parked.root);
    return parked.propeller;
  }
}
