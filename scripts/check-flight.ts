import { Quaternion, Vector3 } from 'three';
import { createFlightState, readAttitudeForTest, resetFlight, stepFlight } from '../src/physics.ts';
import type { PilotInput } from '../src/input.ts';
import { FIELD, MOUNTAIN, terrainHeight } from '../src/terrain.ts';

function pilot(partial: Partial<PilotInput> = {}): PilotInput {
  return {
    pitch: 0,
    roll: 0,
    yaw: 0,
    throttleUp: false,
    throttleDown: false,
    brake: false,
    ...partial,
  };
}

function fail(message: string): never {
  throw new Error(message);
}

const flat = terrainHeight(0, FIELD.startZ);
if (Math.abs(flat) > 0.001) fail(`跑道起点不是平地: ${flat}`);
const peak = terrainHeight(MOUNTAIN.x, MOUNTAIN.z);
if (peak < 180) fail(`山峰太矮: ${peak.toFixed(1)}`);
const lake = terrainHeight(1120, -260);
if (lake > -1) fail(`湖面没有下凹: ${lake.toFixed(2)}`);

const attitude = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.2);
const pitched = readAttitudeForTest(attitude);
if (pitched.pitch < 0.15) fail(`抬头符号不对: ${pitched.pitch}`);
const yawed = readAttitudeForTest(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.3));
if (yawed.heading > -0.2) fail(`左偏航应让航向变小: ${yawed.heading}`);
const rolled = readAttitudeForTest(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.3));
if (rolled.bank > -0.1) fail(`右翼上扬时坡度应为负: ${rolled.bank}`);

function runAir(input: PilotInput, seconds: number) {
  const state = createFlightState();
  state.onGround = false;
  state.takenOff = true;
  state.position.set(0, 500, 0);
  state.velocity.set(0, 0, -46);
  state.throttle = 0.75;
  state.rpm = 2200;
  const dt = 1 / 120;
  for (let t = 0; t < seconds; t += dt) stepFlight(state, input, dt);
  return state;
}

const rolledState = runAir(pilot({ roll: 1 }), 0.7);
if (rolledState.bank < 0.18) fail(`右压杆没有向右滚转: bank=${rolledState.bank.toFixed(3)}`);
const pitchedState = runAir(pilot({ pitch: 1 }), 0.8);
if (pitchedState.pitch < 0.08) fail(`拉杆没有抬头: pitch=${pitchedState.pitch.toFixed(3)}`);
const yawedState = runAir(pilot({ yaw: 1 }), 0.8);
const yawHeading = yawedState.heading > 180 ? yawedState.heading - 360 : yawedState.heading;
if (yawHeading < 4) fail(`右舵没有向右转: heading=${yawedState.heading.toFixed(1)}`);

const idle = createFlightState();
for (let i = 0; i < 240; i += 1) stepFlight(idle, pilot(), 1 / 120);
if (!idle.onGround || idle.crashed) fail('静止状态不应离地或坠毁');
if (Math.abs(idle.position.x) > 1 || Math.abs(idle.position.z - FIELD.startZ) > 1.5) {
  fail(`静止时飞机漂移 x=${idle.position.x.toFixed(2)} z=${idle.position.z.toFixed(2)}`);
}

const takeoff = createFlightState();
const dt = 1 / 120;
let airborneAt = -1;
for (let step = 0; step < 40 * 120; step += 1) {
  const t = step * dt;
  const pull = takeoff.onGround ? (takeoff.airspeed > 28 ? 0.72 : 0) : 0.28;
  stepFlight(takeoff, pilot({ pitch: pull, throttleUp: true }), dt);
  if (takeoff.crashed) {
    fail(`起飞阶段坠毁: ${takeoff.crashReason} x=${takeoff.position.x.toFixed(1)} hdg=${takeoff.heading.toFixed(1)}`);
  }
  if (!takeoff.onGround && airborneAt < 0 && takeoff.agl > 8) airborneAt = t;
  if (t < 18 && takeoff.onGround) {
    const headingDelta = Math.min(takeoff.heading, 360 - takeoff.heading);
    if (Math.abs(takeoff.position.x) > 14 || headingDelta > 10) {
      fail(`滑跑偏离 x=${takeoff.position.x.toFixed(2)} hdg=${takeoff.heading.toFixed(1)} t=${t.toFixed(1)}`);
    }
  }
  if (step % 60 === 0) {
    console.log(
      `t=${t.toFixed(1)} spd=${(takeoff.airspeed * 3.6).toFixed(0)} agl=${takeoff.agl.toFixed(1)} pitch=${((takeoff.pitch * 180) / Math.PI).toFixed(1)} g=${takeoff.gForce.toFixed(2)} ground=${takeoff.onGround} thr=${takeoff.throttle.toFixed(2)}`,
    );
  }
  if (takeoff.agl > 50 && !takeoff.onGround) break;
}
if (airborneAt < 0 || takeoff.agl < 30) {
  fail(`未能爬升到 30 米，当前离地 ${takeoff.agl.toFixed(1)} 米，空速 ${(takeoff.airspeed * 3.6).toFixed(0)}`);
}
console.log(`起飞成功，用时 ${airborneAt.toFixed(1)} 秒，离地 ${takeoff.agl.toFixed(1)} 米`);

const landing = createFlightState();
resetFlight(landing);
const ground = terrainHeight(0, 1400);
landing.position.set(0, ground + 150, 1400);
landing.velocity.set(0, -2, -40);
landing.quaternion.identity();
landing.onGround = false;
landing.takenOff = true;
landing.airborneTime = 4;
landing.throttle = 0.35;
landing.rpm = 1800;
let landed = false;
for (let step = 0; step < 80 * 120; step += 1) {
  const agl = landing.agl;
  const tdZ = 40;
  const distance = landing.position.z - tdZ;
  const desired = Math.max(0.8, distance * Math.tan((3.1 * Math.PI) / 180));
  const altError = agl - desired;
  let targetVy = -3.4;
  if (altError > 12) targetVy = -6;
  else if (altError < -6) targetVy = -1.2;
  if (agl < 14) targetVy = -1.15;
  if (agl < 5) targetVy = -0.7;
  const vyError = landing.verticalSpeed - targetVy;
  let pitch = Math.max(-1, Math.min(1, -vyError * 0.45));
  if (landing.pitch > 0.22) pitch = Math.min(pitch, -0.1);
  if (landing.pitch < -0.16) pitch = Math.max(pitch, 0.2);
  const headingError = landing.heading > 180 ? landing.heading - 360 : landing.heading;
  let roll = Math.max(-1, Math.min(1, -landing.position.x * 0.03 - landing.bank * 1.4 - headingError * 0.045));
  const speedTarget = agl < 18 ? 33 : 38;
  stepFlight(
    landing,
    pilot({
      pitch,
      roll,
      throttleUp: landing.airspeed < speedTarget - 0.8,
      throttleDown: landing.airspeed > speedTarget + 1.2,
    }),
    dt,
  );
  if (landing.crashed) {
    fail(
      `进近坠毁: ${landing.crashReason} x=${landing.position.x.toFixed(1)} z=${landing.position.z.toFixed(1)} agl=${landing.agl.toFixed(1)} vs=${landing.verticalSpeed.toFixed(2)} bank=${((landing.bank * 180) / Math.PI).toFixed(1)}`,
    );
  }
  if (landing.onGround && landing.sinceTouchdown < 1 && (landing.landings > 0 || landing.hardLanding)) {
    landed = true;
    break;
  }
  if (step % 120 === 0) {
    console.log(
      `land t=${(step * dt).toFixed(0)} z=${landing.position.z.toFixed(0)} agl=${landing.agl.toFixed(1)} spd=${(landing.airspeed * 3.6).toFixed(0)} vs=${landing.verticalSpeed.toFixed(1)} x=${landing.position.x.toFixed(1)} hdg=${landing.heading.toFixed(1)}`,
    );
  }
}
if (!landed) fail(`自动进近没有落地 z=${landing.position.z.toFixed(0)} agl=${landing.agl.toFixed(1)}`);
console.log(
  `着陆成功 landings=${landing.landings} hard=${landing.hardLanding} z=${landing.position.z.toFixed(0)} x=${landing.position.x.toFixed(1)}`,
);
