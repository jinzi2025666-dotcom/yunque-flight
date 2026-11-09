import { PerspectiveCamera, Scene, Vector3, WebGLRenderer, ACESFilmicToneMapping, SRGBColorSpace } from 'three';
import { AircraftVisual } from './aircraft.ts';
import { Soundscape } from './audio.ts';
import { FIXED_DT, MAX_SUBSTEPS, SUN_X, SUN_Y, SUN_Z } from './constants.ts';
import { Hud } from './hud.ts';
import { Input } from './input.ts';
import { createFlightState, resetFlight, stepFlight } from './physics.ts';
import { terrainHeight } from './terrain.ts';
import { World } from './world.ts';

export class Game {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly world: World;
  private readonly aircraft = new AircraftVisual();
  private readonly state = createFlightState();
  private readonly input = new Input();
  private readonly audio = new Soundscape();
  private readonly hud: Hud;
  private readonly sunDir = new Vector3(SUN_X, SUN_Y, SUN_Z).normalize();
  private readonly camPos = new Vector3();
  private readonly look = new Vector3();
  private readonly chaseOffset = new Vector3(0, 4.7, 15.4);
  private readonly lookOffset = new Vector3(0, 1.25, -16);
  private readonly eyeOffset = new Vector3(0, 1.05, -0.7);
  private readonly tmp = new Vector3();
  private readonly tmp2 = new Vector3();
  private readonly forward = new Vector3();
  private readonly wheels: Vector3[] = [];
  private paused = false;
  private alive = true;
  private raf = 0;
  private last = 0;
  private accumulator = 0;
  private shake = 0;
  private mode: 'chase' | 'cockpit' = 'chase';
  private camReady = false;
  private heardBanner = '';
  private wasCrashed = false;
  private legendVisible = true;
  private holdThrottle = false;
  private holdPitch = false;
  private readonly onResize = () => {
    this.camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };
  private readonly unlock = () => {
    this.audio.unlock();
    this.hud.hideAudioHint();
  };

  constructor(root: HTMLElement) {
    this.renderer = new WebGLRenderer({
      antialias: true,
      logarithmicDepthBuffer: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    root.append(this.renderer.domElement);

    this.camera = new PerspectiveCamera(60, window.innerWidth / Math.max(1, window.innerHeight), 0.28, 24000);
    this.world = new World(this.scene);
    this.scene.add(this.aircraft.root);
    this.hud = new Hud(root);
    this.hud.onRestart = () => this.restart();
    this.hud.onResume = () => {
      this.paused = false;
    };
    this.hud.onThrottleHold = (held) => {
      this.holdThrottle = held;
    };
    this.hud.onPitchHold = (held) => {
      this.holdPitch = held;
    };
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.unlock);
    window.addEventListener('pointerdown', this.unlock);
  }

  start(): void {
    this.updateCamera(0.05);
    this.world.follow(this.camera.position);
    this.hud.update(this.state, { paused: false, muted: false, dt: 0 });
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy(): void {
    this.alive = false;
    cancelAnimationFrame(this.raf);
    this.input.dispose();
    this.audio.dispose();
    this.renderer.dispose();
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.unlock);
    window.removeEventListener('pointerdown', this.unlock);
  }

  private restart(): void {
    resetFlight(this.state);
    this.paused = false;
    this.shake = 0;
    this.wasCrashed = false;
    this.heardBanner = '';
    this.camReady = false;
    this.accumulator = 0;
    this.hud.reset();
    this.hud.resetControls();
  }

  private frame = (now: number): void => {
    if (!this.alive) return;
    const dt = Math.min(0.05, this.last ? (now - this.last) / 1000 : 0.016);
    this.last = now;
    const pilot = this.input.snapshot();
    if (this.holdThrottle) pilot.throttleUp = true;
    if (this.holdPitch) pilot.pitch = Math.max(pilot.pitch, 0.45);

    if (this.input.consume('KeyP') && !this.state.crashed) this.paused = !this.paused;
    if (this.input.consume('KeyR')) this.restart();
    if (this.input.consume('KeyC')) this.toggleCamera();
    if (this.input.consume('KeyM')) this.audio.toggleMute();
    if (this.input.consume('KeyH')) {
      this.legendVisible = !this.legendVisible;
      this.hud.setLegend(this.legendVisible);
    }

    if (!this.paused && !this.state.crashed) {
      this.accumulator += dt;
      let steps = 0;
      while (this.accumulator >= FIXED_DT && steps < MAX_SUBSTEPS) {
        stepFlight(this.state, pilot, FIXED_DT);
        this.accumulator -= FIXED_DT;
        steps += 1;
      }
      if (steps === MAX_SUBSTEPS) this.accumulator = 0;
    }

    const visualDt = this.paused || this.state.crashed ? 0 : dt;
    this.aircraft.sync(this.state, pilot, visualDt, now / 1000);
    this.aircraft.root.updateWorldMatrix(true, true);
    this.aircraft.wheelWorldPositions(this.wheels);
    this.forward.set(0, 0, -1).applyQuaternion(this.state.quaternion);
    this.world.update(
      visualDt,
      this.state.position,
      this.forward,
      this.state.agl,
      this.state.onGround,
      this.state.airspeed,
      this.wheels,
    );
    this.world.sun.position.copy(this.state.position).addScaledVector(this.sunDir, 170);
    this.world.sunTarget.position.copy(this.state.position);

    if (this.state.crashed && !this.wasCrashed) {
      this.audio.crash();
      this.shake = 0.85;
    }
    this.wasCrashed = this.state.crashed;
    if (this.state.banner && this.state.banner !== this.heardBanner && this.state.bannerTime > 2.4) {
      if (this.state.banner.startsWith('硬着陆')) {
        this.audio.touch(true);
        this.shake = Math.max(this.shake, 0.38);
      } else if (this.state.banner === '着陆成功') {
        this.audio.touch(false);
      }
      this.heardBanner = this.state.banner;
    }
    if (!this.state.banner) this.heardBanner = '';

    this.updateCamera(dt);
    this.world.follow(this.camera.position);
    this.audio.update(this.state);
    this.hud.update(this.state, { paused: this.paused, muted: this.audio.isMuted, dt: visualDt });
    this.renderer.render(this.scene, this.camera);
    this.input.endFrame();
    this.raf = requestAnimationFrame(this.frame);
  };

  private toggleCamera(): void {
    if (this.mode === 'chase') {
      this.mode = 'cockpit';
      this.camera.fov = 74;
    } else {
      this.mode = 'chase';
      this.camera.fov = 60;
      this.camReady = false;
    }
    this.camera.updateProjectionMatrix();
  }

  private updateCamera(dt: number): void {
    this.shake *= Math.exp(-2.6 * dt);
    const mag = this.shake + (this.state.stallWarn ? 0.06 : 0) + this.state.throttle * 0.012;
    const time = performance.now();
    const jx = Math.sin(time * 0.037) * mag;
    const jy = Math.cos(time * 0.029) * mag * 0.7;

    if (this.mode === 'cockpit') {
      this.tmp.copy(this.eyeOffset).applyQuaternion(this.state.quaternion).add(this.state.position);
      this.tmp.x += jx;
      this.tmp.y += jy;
      const floor = terrainHeight(this.tmp.x, this.tmp.z) + 0.8;
      if (this.tmp.y < floor) this.tmp.y = floor;
      this.camera.position.copy(this.tmp);
      this.camera.quaternion.copy(this.state.quaternion);
      return;
    }

    this.tmp.copy(this.chaseOffset).applyQuaternion(this.state.quaternion).add(this.state.position);
    this.tmp2.copy(this.lookOffset).applyQuaternion(this.state.quaternion).add(this.state.position);
    const alpha = this.camReady ? 1 - Math.exp(-3.5 * Math.max(dt, 0.001)) : 1;
    this.camPos.lerp(this.tmp, alpha);
    this.look.lerp(this.tmp2, alpha);
    this.camReady = true;
    const minY = terrainHeight(this.camPos.x, this.camPos.z) + 1.5;
    if (this.camPos.y < minY) this.camPos.y = minY;
    this.camera.position.copy(this.camPos);
    this.camera.position.x += jx;
    this.camera.position.y += jy;
    this.camera.lookAt(this.look);
  }
}
