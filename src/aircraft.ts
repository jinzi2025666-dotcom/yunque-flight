import {
  BoxGeometry,
  CanvasTexture,
  ConeGeometry,
  CylinderGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three';
import { GEAR_HEIGHT } from './constants.ts';
import type { PilotInput } from './input.ts';
import type { FlightState } from './physics.ts';
import { clamp } from './math.ts';

export interface Palette {
  body: number;
  accent: number;
  wing: number;
  tailNumber: string;
}

export const PLAYER_PALETTE: Palette = {
  body: 0xf4f0e6,
  accent: 0xe25b2a,
  wing: 0xf7f5ef,
  tailNumber: 'B-1720',
};

export const PARKED_PALETTE: Palette = {
  body: 0xf7f8f6,
  accent: 0x2a6fba,
  wing: 0xeef2f4,
  tailNumber: 'B-8841',
};

interface Airframe {
  root: Group;
  propeller: Group;
  propBlur: Mesh;
  bladeMat: MeshStandardMaterial;
  blurMat: MeshStandardMaterial;
  elevator: Group;
  rudder: Group;
  aileronL: Group;
  aileronR: Group;
  nosePivot: Group;
  wheels: Mesh[];
  beaconMat: MeshStandardMaterial;
}

function makeHalfWing(side: number, span: number, root: number, tip: number, thick: number): BufferGeometry {
  const geo = new BoxGeometry(span, thick, root, 8, 1, 1);
  geo.translate((side * span) / 2, 0, 0);
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const t = Math.abs(x) / span;
    const chord = 1 + (tip / root - 1) * t;
    pos.setZ(i, pos.getZ(i) * chord + t * 0.42);
    pos.setY(i, pos.getY(i) * (1 - t * 0.42));
  }
  geo.computeVertexNormals();
  return geo;
}

function strutBetween(a: Vector3, b: Vector3, radius: number, material: Material): Mesh {
  const delta = new Vector3().subVectors(b, a);
  const length = delta.length();
  const mesh = new Mesh(new CylinderGeometry(radius, radius, length, 6), material);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), delta.normalize());
  return mesh;
}

function labelTexture(text: string, width: number, height: number, color: string): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建注册号贴图');
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = color;
  ctx.font = `700 ${Math.floor(height * 0.62)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, width / 2, height / 2 + 2);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

export function createAirframe(palette: Palette): Airframe {
  const root = new Group();
  const body = new MeshStandardMaterial({ color: palette.body, roughness: 0.42, metalness: 0.08 });
  const wingMat = new MeshStandardMaterial({ color: palette.wing, roughness: 0.5, metalness: 0.04 });
  const accent = new MeshStandardMaterial({ color: palette.accent, roughness: 0.38, metalness: 0.12 });
  const dark = new MeshStandardMaterial({ color: 0x2a3038, roughness: 0.55, metalness: 0.2 });
  const metal = new MeshStandardMaterial({ color: 0x9aa1a8, roughness: 0.32, metalness: 0.72 });
  const rubber = new MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.85, metalness: 0.05 });
  const glass = new MeshStandardMaterial({
    color: 0x173942,
    roughness: 0.06,
    metalness: 0.15,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
  });

  const profile = [
    [0.04, 0],
    [0.16, 0.18],
    [0.34, 0.55],
    [0.5, 1.15],
    [0.62, 1.9],
    [0.74, 2.7],
    [0.78, 3.45],
    [0.62, 4.25],
    [0.4, 5.15],
    [0.24, 6.15],
    [0.1, 6.9],
    [0.02, 7.25],
  ].map(([radius, y]) => new Vector2(radius, y));
  const fuselage = new Mesh(new LatheGeometry(profile, 22), body);
  fuselage.geometry.rotateX(-Math.PI / 2);
  fuselage.geometry.translate(0, 0, 3.5);
  root.add(fuselage);

  const canopy = new Mesh(new SphereGeometry(0.62, 18, 14), glass);
  canopy.scale.set(0.78, 0.62, 1.25);
  canopy.position.set(0, 0.48, -0.05);
  canopy.userData.noShadow = true;
  root.add(canopy);

  for (const side of [-1, 1]) {
    const stripe = new Mesh(new BoxGeometry(0.045, 0.16, 3.4), accent);
    stripe.position.set(side * 0.6, 0.08, 0.15);
    root.add(stripe);
  }

  const wingSpan = 5.15;
  const wings: Group[] = [];
  for (const side of [-1, 1]) {
    const wing = new Group();
    const surface = new Mesh(makeHalfWing(side, wingSpan, 1.62, 0.92, 0.16), wingMat);
    wing.add(surface);
    wing.position.set(0, -0.02, -0.15);
    wing.rotation.z = side * 0.055;
    const aileron = new Group();
    const aileronMesh = new Mesh(new BoxGeometry(1.35, 0.035, 0.28), accent);
    aileronMesh.position.set(side * 0.05, 0, 0.02);
    aileron.add(aileronMesh);
    aileron.position.set(side * 3.55, 0, 0.62);
    wing.add(aileron);
    root.add(wing);
    wings.push(wing);
    if (side < 0) {
      wing.userData.aileron = aileron;
    } else {
      wing.userData.aileron = aileron;
    }
  }

  const hStab = new Group();
  hStab.add(new Mesh(makeHalfWing(1, 1.55, 0.95, 0.62, 0.07), wingMat));
  hStab.add(new Mesh(makeHalfWing(-1, 1.55, 0.95, 0.62, 0.07), wingMat));
  const elevator = new Group();
  elevator.add(new Mesh(new BoxGeometry(3.05, 0.03, 0.28), accent));
  elevator.position.set(0, 0, 0.42);
  hStab.add(elevator);
  hStab.position.set(0, 0.42, 2.95);
  root.add(hStab);

  const vStab = new Group();
  const fin = new Mesh(new BoxGeometry(0.07, 1.15, 0.95), wingMat);
  fin.position.set(0, 0.55, -0.05);
  fin.geometry.translate(0, 0, -0.12);
  vStab.add(fin);
  const rudder = new Group();
  rudder.add(new Mesh(new BoxGeometry(0.045, 1.05, 0.28), accent));
  rudder.position.set(0, 0.48, 0.42);
  vStab.add(rudder);
  vStab.position.set(0, 0.35, 2.85);
  root.add(vStab);

  const propeller = new Group();
  propeller.position.set(0, 0.04, -3.78);
  const bladeMat = new MeshStandardMaterial({
    color: 0x2a2d31,
    roughness: 0.45,
    metalness: 0.1,
    transparent: true,
    opacity: 1,
  });
  const blades = new Mesh(new BoxGeometry(0.12, 1.82, 0.04), bladeMat);
  propeller.add(blades);
  const blurMat = new MeshStandardMaterial({
    color: 0x1a1c1f,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    roughness: 1,
    metalness: 0,
    side: 2,
  });
  const propBlur = new Mesh(new CylinderGeometry(0.92, 0.92, 0.02, 24), blurMat);
  propBlur.rotation.x = Math.PI / 2;
  propBlur.userData.noShadow = true;
  propeller.add(propBlur);
  const spinner = new Mesh(new ConeGeometry(0.16, 0.42, 16), accent);
  spinner.rotation.x = -Math.PI / 2;
  spinner.position.z = -0.18;
  propeller.add(spinner);
  propeller.add(new Mesh(new SphereGeometry(0.12, 12, 10), dark));
  root.add(propeller);

  const wheels: Mesh[] = [];
  const addWheel = (parent: Group, x: number, z: number, radius: number) => {
    const wheel = new Mesh(new CylinderGeometry(radius, radius, 0.16, 14), rubber);
    wheel.geometry.rotateZ(Math.PI / 2);
    wheel.position.set(x, -GEAR_HEIGHT + radius, z);
    const hub = new Mesh(new CylinderGeometry(radius * 0.45, radius * 0.45, 0.18, 10), metal);
    hub.geometry.rotateZ(Math.PI / 2);
    wheel.add(hub);
    parent.add(wheel);
    wheels.push(wheel);
  };

  for (const side of [-1, 1]) {
    const axle = new Vector3(side * 1.15, -GEAR_HEIGHT + 0.28, 0.2);
    root.add(strutBetween(new Vector3(side * 0.35, -0.45, 0.25), axle, 0.045, metal));
    root.add(strutBetween(new Vector3(side * 0.55, -0.35, -0.35), axle, 0.035, metal));
    addWheel(root, side * 1.15, 0.2, 0.28);
  }

  const nosePivot = new Group();
  nosePivot.position.set(0, -0.35, -1.85);
  const noseWheelY = -GEAR_HEIGHT + 0.22 - nosePivot.position.y;
  nosePivot.add(strutBetween(new Vector3(0, 0, 0), new Vector3(0, noseWheelY, -0.15), 0.04, metal));
  const noseWheel = new Mesh(new CylinderGeometry(0.22, 0.22, 0.12, 14), rubber);
  noseWheel.geometry.rotateZ(Math.PI / 2);
  noseWheel.position.set(0, noseWheelY, -0.15);
  nosePivot.add(noseWheel);
  wheels.push(noseWheel);
  root.add(nosePivot);

  const beaconMat = new MeshStandardMaterial({
    color: 0xff2a2a,
    emissive: 0xff2a2a,
    emissiveIntensity: 0.4,
    roughness: 0.4,
  });
  const beacon = new Mesh(new SphereGeometry(0.07, 10, 8), beaconMat);
  beacon.position.set(0, 1.55, 2.7);
  root.add(beacon);

  const nav = (color: number, x: number, y: number, z: number) => {
    const mat = new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8, roughness: 0.4 });
    const light = new Mesh(new SphereGeometry(0.05, 8, 8), mat);
    light.position.set(x, y, z);
    root.add(light);
  };
  nav(0xff2430, -5.05, 0.02, -0.05);
  nav(0x21d35a, 5.05, 0.02, -0.05);
  nav(0xf2f5ff, 0, 0.4, 3.35);

  const plate = new Mesh(
    new BoxGeometry(0.9, 0.22, 0.01),
    new MeshStandardMaterial({
      map: labelTexture(palette.tailNumber, 256, 64, '#1c2128'),
      transparent: true,
      roughness: 0.6,
    }),
  );
  plate.position.set(-0.66, 0.18, 1.15);
  plate.rotation.y = Math.PI / 2;
  root.add(plate);

  root.traverse((obj) => {
    const mesh = obj as Mesh;
    if (mesh.isMesh && mesh.userData.noShadow !== true) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });

  return {
    root,
    propeller,
    propBlur,
    bladeMat,
    blurMat,
    elevator,
    rudder,
    aileronL: wings[0]?.userData.aileron as Group,
    aileronR: wings[1]?.userData.aileron as Group,
    nosePivot,
    wheels,
    beaconMat,
  };
}

export class AircraftVisual {
  readonly root: Group;
  readonly propeller: Group;
  private readonly frame: Airframe;

  constructor(palette: Palette = PLAYER_PALETTE) {
    this.frame = createAirframe(palette);
    this.root = this.frame.root;
    this.propeller = this.frame.propeller;
  }

  sync(state: FlightState, input: PilotInput, dt: number, time: number): void {
    this.root.position.copy(state.position);
    this.root.quaternion.copy(state.quaternion);
    if (!state.crashed) {
      this.frame.propeller.rotateZ(((state.rpm * Math.PI) / 30) * dt);
    }
    this.frame.elevator.rotation.x = -input.pitch * 0.42;
    this.frame.rudder.rotation.y = -input.yaw * 0.45;
    this.frame.aileronL.rotation.x = input.roll * 0.38;
    this.frame.aileronR.rotation.x = -input.roll * 0.38;
    const steer = state.onGround ? clamp(-input.yaw * 0.55 - input.roll * 0.35, -0.6, 0.6) : 0;
    this.frame.nosePivot.rotation.y = steer;
    const groundSpeed = state.onGround ? Math.hypot(state.velocity.x, state.velocity.z) : 0;
    for (const wheel of this.frame.wheels) wheel.rotateX((groundSpeed * dt) / 0.28);
    this.frame.blurMat.opacity = clamp((state.rpm - 850) / 1500, 0, 0.34);
    this.frame.bladeMat.opacity = clamp(1 - (state.rpm - 950) / 1300, 0.14, 1);
    this.frame.beaconMat.emissiveIntensity = Math.sin(time * 11) > 0.2 ? 2.6 : 0.2;
  }

  wheelWorldPositions(out: Vector3[]): void {
    for (let i = 0; i < this.frame.wheels.length; i += 1) {
      const target = out[i] ?? new Vector3();
      out[i] = target;
      this.frame.wheels[i].getWorldPosition(target);
    }
  }
}
