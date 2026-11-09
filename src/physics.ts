import { Quaternion, Vector3 } from 'three';
import {
  AIR_DENSITY,
  CD0,
  CL_ALPHA,
  GEAR_HEIGHT,
  GRAVITY,
  IDLE_RPM,
  INDUCED_FACTOR,
  MASS,
  MAX_RPM,
  MAX_THRUST,
  STALL_AOA,
  THRUST_FADE_SPEED,
  WIND_X,
  WIND_Z,
  WING_AREA,
  WING_INCIDENCE,
} from './constants.ts';
import type { PilotInput } from './input.ts';
import { clamp, damp, headingDegrees, runwayAlignmentDegrees } from './math.ts';
import { crashSiteName, FIELD, isRunway, terrainHeight } from './terrain.ts';

export interface FlightState {
  position: Vector3;
  velocity: Vector3;
  quaternion: Quaternion;
  angVel: Vector3;
  throttle: number;
  rpm: number;
  onGround: boolean;
  takenOff: boolean;
  airborneTime: number;
  sinceTouchdown: number;
  crashed: boolean;
  crashReason: string;
  hardLanding: boolean;
  landings: number;
  banner: string;
  bannerTime: number;
  flightTime: number;
  airspeed: number;
  altitude: number;
  agl: number;
  verticalSpeed: number;
  heading: number;
  pitch: number;
  bank: number;
  aoa: number;
  slip: number;
  stalled: boolean;
  stallWarn: boolean;
  gForce: number;
  peakAltitude: number;
  distanceFlown: number;
}

interface Attitude {
  forward: Vector3;
  up: Vector3;
  right: Vector3;
  pitch: number;
  bank: number;
  heading: number;
}

const att: Attitude = {
  forward: new Vector3(),
  up: new Vector3(),
  right: new Vector3(),
  pitch: 0,
  bank: 0,
  heading: 0,
};

const airVel = new Vector3();
const liftDir = new Vector3();
const thrustVec = new Vector3();
const dragVec = new Vector3();
const liftVec = new Vector3();
const force = new Vector3();
const wind = new Vector3(WIND_X, 0, WIND_Z);
const deltaQuat = new Quaternion();
const groundForward = new Vector3();
const steerQuat = new Quaternion();
const alignQuat = new Quaternion();
const qYaw = new Quaternion();
const qPitch = new Quaternion();
const qRoll = new Quaternion();
const yAxis = new Vector3(0, 1, 0);
const xAxis = new Vector3(1, 0, 0);
const zAxis = new Vector3(0, 0, 1);

export function readAttitudeForTest(q: Quaternion): { pitch: number; bank: number; heading: number } {
  readAttitude(q, att);
  return { pitch: att.pitch, bank: att.bank, heading: att.heading };
}

function readAttitude(q: Quaternion, out: Attitude): void {
  out.forward.set(0, 0, -1).applyQuaternion(q);
  out.up.set(0, 1, 0).applyQuaternion(q);
  out.right.set(1, 0, 0).applyQuaternion(q);
  out.pitch = Math.asin(clamp(out.forward.y, -1, 1));
  out.bank = Math.atan2(-out.right.y, out.up.y);
  out.heading = Math.atan2(out.forward.x, -out.forward.z);
}

function attitudeQuaternion(yaw: number, pitch: number, roll: number, out: Quaternion): Quaternion {
  qYaw.setFromAxisAngle(yAxis, yaw);
  qPitch.setFromAxisAngle(xAxis, pitch);
  qRoll.setFromAxisAngle(zAxis, roll);
  return out.copy(qYaw).multiply(qPitch).multiply(qRoll);
}

export function liftCoefficient(aoaEff: number): number {
  const sign = Math.sign(aoaEff) || 1;
  const angle = Math.abs(aoaEff);
  if (angle <= STALL_AOA) return sign * CL_ALPHA * angle;
  const clMax = CL_ALPHA * STALL_AOA;
  const over = (angle - STALL_AOA) / 0.32;
  return sign * clMax * (0.4 + 0.6 * Math.exp(-over * 1.35));
}

export function createFlightState(): FlightState {
  const state: FlightState = {
    position: new Vector3(),
    velocity: new Vector3(),
    quaternion: new Quaternion(),
    angVel: new Vector3(),
    throttle: 0,
    rpm: IDLE_RPM,
    onGround: true,
    takenOff: false,
    airborneTime: 0,
    sinceTouchdown: 10,
    crashed: false,
    crashReason: '',
    hardLanding: false,
    landings: 0,
    banner: '',
    bannerTime: 0,
    flightTime: 0,
    airspeed: 0,
    altitude: 0,
    agl: 0,
    verticalSpeed: 0,
    heading: 0,
    pitch: 0,
    bank: 0,
    aoa: 0,
    slip: 0,
    stalled: false,
    stallWarn: false,
    gForce: 1,
    peakAltitude: 0,
    distanceFlown: 0,
  };
  resetFlight(state, false);
  return state;
}

export function resetFlight(state: FlightState, keepScore = true): void {
  const landings = keepScore ? state.landings : 0;
  const peak = keepScore ? state.peakAltitude : 0;
  state.position.set(FIELD.startX, 0, FIELD.startZ);
  state.position.y = terrainHeight(state.position.x, state.position.z) + GEAR_HEIGHT;
  state.velocity.set(0, 0, 0);
  state.quaternion.identity();
  state.angVel.set(0, 0, 0);
  state.throttle = 0;
  state.rpm = IDLE_RPM;
  state.onGround = true;
  state.takenOff = false;
  state.airborneTime = 0;
  state.sinceTouchdown = 10;
  state.crashed = false;
  state.crashReason = '';
  state.hardLanding = false;
  state.landings = landings;
  state.banner = '按住 X 或 Shift 加油门，沿中线滑跑';
  state.bannerTime = 8;
  state.flightTime = 0;
  state.airspeed = 0;
  state.altitude = state.position.y;
  state.agl = GEAR_HEIGHT;
  state.verticalSpeed = 0;
  state.heading = 0;
  state.pitch = 0;
  state.bank = 0;
  state.aoa = 0;
  state.slip = 0;
  state.stalled = false;
  state.stallWarn = false;
  state.gForce = 1;
  state.peakAltitude = peak;
  state.distanceFlown = 0;
}

function integrateAttitude(q: Quaternion, angular: Vector3, dt: number): void {
  deltaQuat.set(angular.x * dt * 0.5, angular.y * dt * 0.5, angular.z * dt * 0.5, 1);
  deltaQuat.normalize();
  q.multiply(deltaQuat);
}

function fail(state: FlightState, reason: string): void {
  state.crashed = true;
  state.crashReason = reason;
  state.onGround = true;
  state.banner = '';
  state.bannerTime = 0;
}

export function stepFlight(state: FlightState, input: PilotInput, dt: number): void {
  if (state.crashed) return;
  const step = clamp(dt, 0.001, 0.05);

  state.flightTime += step;
  if (state.bannerTime > 0) state.bannerTime = Math.max(0, state.bannerTime - step);

  if (input.throttleUp) state.throttle = Math.min(1, state.throttle + step * 0.42);
  if (input.throttleDown) state.throttle = Math.max(0, state.throttle - step * 0.42);
  const rpmTarget = IDLE_RPM + state.throttle * (MAX_RPM - IDLE_RPM);
  state.rpm = damp(state.rpm, rpmTarget, 2.4, step);

  const startedGrounded = state.onGround;
  readAttitude(state.quaternion, att);

  airVel.copy(state.velocity).sub(wind);
  const speed = airVel.length();
  const vForward = airVel.dot(att.forward);
  const vUp = airVel.dot(att.up);
  const vRight = airVel.dot(att.right);

  let aoa = 0;
  let slip = 0;
  if (speed > 1.2) {
    aoa = Math.atan2(-vUp, Math.max(vForward, 0.4));
    slip = Math.atan2(vRight, Math.max(Math.abs(vForward), 0.4));
  }
  const aoaEff = aoa + WING_INCIDENCE;
  const dynamic = 0.5 * AIR_DENSITY * speed * speed;
  const cl = liftCoefficient(aoaEff);
  const stalled = aoaEff > STALL_AOA && speed > 15;
  const cd = CD0 + INDUCED_FACTOR * cl * cl + (stalled ? 0.12 : 0);
  let lift = dynamic * WING_AREA * Math.abs(cl);
  const drag = dynamic * WING_AREA * cd;
  const groundY = terrainHeight(state.position.x, state.position.z);
  const aglPreview = state.position.y - groundY;
  if (aglPreview < 14 && aglPreview > 0 && cl > 0) {
    lift *= 1 + 0.16 * (1 - aglPreview / 14);
  }

  liftDir.copy(att.up);
  if (speed > 1) {
    const inv = 1 / speed;
    liftDir.addScaledVector(airVel, -liftDir.dot(airVel) * inv * inv);
    if (liftDir.lengthSq() < 1e-6) liftDir.copy(att.up);
    else liftDir.normalize();
  }
  if (cl < 0) liftDir.multiplyScalar(-1);

  const spool = clamp((state.rpm - IDLE_RPM) / (MAX_RPM - IDLE_RPM), 0, 1);
  const fade = clamp(1 - Math.max(0, vForward - 38) / THRUST_FADE_SPEED, 0.22, 1);
  thrustVec.copy(att.forward).multiplyScalar(MAX_THRUST * spool * fade);
  if (speed > 0.2) dragVec.copy(airVel).multiplyScalar(-drag / speed);
  else dragVec.set(0, 0, 0);
  liftVec.copy(liftDir).multiplyScalar(lift);
  force.copy(thrustVec).add(dragVec).add(liftVec);
  force.y -= MASS * GRAVITY;
  state.velocity.addScaledVector(force, step / MASS);

  const speedCap = 150;
  const velocityMag = state.velocity.length();
  if (velocityMag > speedCap) state.velocity.multiplyScalar(speedCap / velocityMag);

  if (!startedGrounded) {
    const authority = clamp((speed - 7) / 22, 0.38, 1);
    const clNeeded = (MASS * GRAVITY) / Math.max(120, dynamic * WING_AREA);
    const aoaTrim = clamp(clNeeded / CL_ALPHA - WING_INCIDENCE, -0.05, STALL_AOA * 0.7);
    const stickAoa = input.pitch * 0.2;
    let pitchRate = -(aoa - (aoaTrim + stickAoa)) * 2.6 * authority;
    pitchRate += -att.pitch * (Math.abs(input.pitch) < 0.08 ? 0.55 : 0.16) * authority;
    pitchRate += (1 - Math.cos(att.bank)) * 0.12 * authority;
    if (aoaEff > STALL_AOA) pitchRate -= (aoaEff - STALL_AOA) * 1.5;
    if (aoaEff > STALL_AOA * 0.86 && speed > 18) {
      const buffet = (aoaEff / STALL_AOA - 0.86) * 0.55;
      pitchRate += Math.sin(state.flightTime * 46) * buffet;
    }

    let rollRate = input.roll * 1.28 * authority;
    rollRate += -att.bank * (Math.abs(input.roll) < 0.08 ? 1.05 : 0.18) * authority;
    rollRate += -slip * 0.42 * authority;
    if (aoaEff > STALL_AOA * 0.9 && speed > 18) {
      rollRate += Math.sin(state.flightTime * 33) * 0.25;
    }

    let yawRate = input.yaw * 0.58 * authority;
    if (Math.abs(input.yaw) < 0.08) yawRate += slip * 1.45 * authority;
    yawRate += input.roll * 0.1 * authority;

    const blend = 1 - Math.exp(-7 * step);
    state.angVel.x += (pitchRate - state.angVel.x) * blend;
    state.angVel.y += (-yawRate - state.angVel.y) * blend;
    state.angVel.z += (-rollRate - state.angVel.z) * blend;
    state.angVel.x = clamp(state.angVel.x, -1.3, 1.3);
    state.angVel.y = clamp(state.angVel.y, -1.1, 1.1);
    state.angVel.z = clamp(state.angVel.z, -2.1, 2.1);
    integrateAttitude(state.quaternion, state.angVel, step);
  }

  state.position.addScaledVector(state.velocity, step);
  resolveGround(state, input, step, {
    startedGrounded,
    supportY: liftVec.y + thrustVec.y,
  });

  if (!Number.isFinite(state.position.x) || !Number.isFinite(state.velocity.y)) {
    fail(state, '飞行状态异常');
  }

  readAttitude(state.quaternion, att);
  airVel.copy(state.velocity).sub(wind);
  const airspeed = airVel.length();
  const forwardNow = airVel.dot(att.forward);
  const upNow = airVel.dot(att.up);
  const rightNow = airVel.dot(att.right);
  const aoaNow = airspeed > 1.2 ? Math.atan2(-upNow, Math.max(forwardNow, 0.4)) : 0;
  const slipNow = airspeed > 1.2 ? Math.atan2(rightNow, Math.max(Math.abs(forwardNow), 0.4)) : 0;
  const aoaEffNow = aoaNow + WING_INCIDENCE;
  const gy = terrainHeight(state.position.x, state.position.z);
  state.airspeed = airspeed;
  state.altitude = state.position.y;
  state.agl = state.position.y - gy;
  state.verticalSpeed = state.velocity.y;
  state.heading = headingDegrees(att.heading);
  state.pitch = att.pitch;
  state.bank = att.bank;
  state.aoa = aoaNow;
  state.slip = slipNow;
  state.stalled = aoaEffNow > STALL_AOA && airspeed > 16 && !state.onGround;
  state.stallWarn = aoaEffNow > STALL_AOA * 0.84 && airspeed > 14 && !state.onGround;
  const liftLoad = lift / (MASS * GRAVITY);
  state.gForce = state.onGround ? Math.max(1, liftLoad) : liftLoad;
  state.peakAltitude = Math.max(state.peakAltitude, state.position.y);
  if (!state.onGround && state.agl > 4 && forwardNow > 24) state.takenOff = true;
  if (!state.onGround) state.airborneTime += step;
  state.sinceTouchdown += step;
  const horiz = Math.hypot(state.velocity.x, state.velocity.z);
  state.distanceFlown += horiz * step;

  if (!state.crashed && state.takenOff && Math.hypot(state.position.x, state.position.z - PLACES_Z) > 5400) {
    fail(state, '飞出训练空域');
  }
}

const PLACES_Z = (FIELD.south + FIELD.north) / 2;

function resolveGround(
  state: FlightState,
  input: PilotInput,
  dt: number,
  info: { startedGrounded: boolean; supportY: number },
): void {
  const x = state.position.x;
  const z = state.position.z;
  const groundY = terrainHeight(x, z);
  const floor = groundY + GEAR_HEIGHT;
  readAttitude(state.quaternion, att);
  const horizSpeed = Math.hypot(state.velocity.x, state.velocity.z);
  const impact = Math.max(0, -state.velocity.y);
  const forwardSpeed = Math.max(0, state.velocity.dot(att.forward));
  const touching = state.position.y <= floor + 0.2 && state.velocity.y <= 0.85;

  if (
    touching &&
    !info.startedGrounded &&
    state.takenOff &&
    state.airborneTime > 0.6 &&
    state.sinceTouchdown > 1.2
  ) {
    const alignment = runwayAlignmentDegrees(headingDegrees(att.heading));
    let reason = '';
    if (!isRunway(x, z)) reason = crashSiteName(x, z, groundY);
    else if (state.stalled && impact > 3) reason = '失速坠地';
    else if (Math.abs(att.bank) > 0.34) reason = '机翼未放平';
    else if (att.pitch < -0.18 && impact > 1.6) reason = '机头接地';
    else if (att.pitch > 0.42) reason = '接地姿态过大';
    else if (alignment > 22) reason = '未对准跑道';
    else if (impact > 7.4) reason = '下降率过大';
    if (reason) {
      state.position.y = floor;
      state.velocity.y = 0;
      fail(state, reason);
      return;
    }
    state.sinceTouchdown = 0;
    state.airborneTime = 0;
    state.hardLanding = impact > 4.1;
    state.banner = state.hardLanding ? '硬着陆，起落架还在' : '着陆成功';
    state.bannerTime = 3.4;
    if (!state.hardLanding) state.landings += 1;
  }

  const wantsFly =
    info.supportY > MASS * GRAVITY * 1.01 &&
    att.pitch > 0.08 &&
    forwardSpeed > 23 &&
    state.throttle > 0.45 &&
    isRunway(x, z);

  if (state.position.y < floor) {
    state.position.y = floor;
    if (state.velocity.y < 0) {
      state.velocity.y = !state.crashed && impact > 2.6 && impact < 7.2 ? impact * 0.15 : 0;
    }
  }

  if (wantsFly && state.position.y <= floor + 0.45) {
    state.onGround = false;
    state.velocity.y = Math.max(state.velocity.y, 1.15);
    state.angVel.set(0, 0, 0);
    return;
  }

  if (!touching) {
    state.onGround = false;
    return;
  }

  state.onGround = true;
  state.position.y = floor;
  if (state.velocity.y < 0.25) state.velocity.y = 0;
  if (state.throttle < 0.03 && horizSpeed < 0.35 && !input.brake) {
    state.velocity.x = 0;
    state.velocity.z = 0;
  }

  if (horizSpeed > 8 && !isRunway(x, z)) {
    fail(state, crashSiteName(x, z, groundY));
    return;
  }

  groundForward.copy(att.forward);
  groundForward.y = 0;
  if (groundForward.lengthSq() < 1e-6) groundForward.set(0, 0, -1);
  else groundForward.normalize();

  const vForward = state.velocity.x * groundForward.x + state.velocity.z * groundForward.z;
  const latX = state.velocity.x - groundForward.x * vForward;
  const latZ = state.velocity.z - groundForward.z * vForward;
  const latDamp = 1 - Math.exp(-12 * dt);
  state.velocity.x -= latX * latDamp;
  state.velocity.z -= latZ * latDamp;
  const brake = input.brake ? 16 : 0.42;
  const resist = brake + Math.abs(vForward) * 0.012;
  const remove = Math.min(Math.abs(vForward), resist * dt) * Math.sign(vForward);
  state.velocity.x -= groundForward.x * remove;
  state.velocity.z -= groundForward.z * remove;

  if (horizSpeed > 1.1) {
    const steer = clamp(input.yaw * 0.7 + input.roll * 0.85, -1, 1);
    const yawDelta = -steer * Math.min(0.95, horizSpeed * 0.05) * dt;
    steerQuat.setFromAxisAngle(yAxis, yawDelta);
    state.quaternion.multiply(steerQuat);
  }

  readAttitude(state.quaternion, att);
  const targetPitch =
    input.pitch > 0 && horizSpeed > 16
      ? Math.min(0.22, input.pitch * 0.36 * clamp((horizSpeed - 15) / 8, 0, 1))
      : input.pitch < 0
        ? Math.max(-0.04, input.pitch * 0.04)
        : 0;
  attitudeQuaternion(att.heading, targetPitch, 0, alignQuat);
  state.quaternion.slerp(alignQuat, 1 - Math.exp(-8 * dt));
  state.angVel.set(0, 0, 0);
}
