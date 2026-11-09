import type { FlightState } from './physics.ts';
import { bearingToRunway, lateralOffsetLabel } from './terrain.ts';
import { formatClock, formatHeading } from './math.ts';

type Phase = 'flying' | 'paused' | 'crashed';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export class Hud {
  onRestart: () => void = () => {};
  onResume: () => void = () => {};
  onThrottleHold: (held: boolean) => void = () => {};
  onPitchHold: (held: boolean) => void = () => {};

  private readonly root: HTMLElement;
  private readonly vignette: HTMLElement;
  private readonly tip: HTMLElement;
  private readonly stall: HTMLElement;
  private readonly legend: HTMLElement;
  private readonly audioHint: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly overlayTitle: HTMLElement;
  private readonly overlayBody: HTMLElement;
  private readonly overlayButton: HTMLButtonElement;
  private readonly speedValue: HTMLElement;
  private readonly altValue: HTMLElement;
  private readonly aglValue: HTMLElement;
  private readonly vsValue: HTMLElement;
  private readonly pitchText: HTMLElement;
  private readonly throttleFill: HTMLElement;
  private readonly throttleText: HTMLElement;
  private readonly rpmText: HTMLElement;
  private readonly gText: HTMLElement;
  private readonly timeText: HTMLElement;
  private readonly landingText: HTMLElement;
  private readonly distText: HTMLElement;
  private readonly peakText: HTMLElement;
  private readonly muteText: HTMLElement;
  private readonly headingCanvas: HTMLCanvasElement;
  private readonly attitudeCanvas: HTMLCanvasElement;
  private readonly mapCanvas: HTMLCanvasElement;
  private readonly trail: Array<{ x: number; z: number }> = [];
  private trailTimer = 0;
  private throttleButton!: HTMLButtonElement;
  private pitchButton!: HTMLButtonElement;
  private throttleHeld = false;
  private pitchHeld = false;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hud');
    this.vignette = el('div', 'vignette');
    this.root.append(this.vignette);

    const top = el('header', 'top');
    const brand = el('div', 'brand');
    brand.append(el('p', 'eyebrow', '轻型教练机'), el('h1', 'title', '云雀飞行'));
    brand.append(el('p', 'touch-note', '此版本使用键盘飞行'));
    const headingWrap = el('div', 'heading-wrap');
    this.headingCanvas = el('canvas', 'heading-canvas');
    headingWrap.append(this.headingCanvas);
    const stats = el('div', 'stats');
    this.timeText = el('p', 'stat', '时间 0:00');
    this.landingText = el('p', 'stat', '着陆 0');
    this.distText = el('p', 'stat', '航程 0.0 km');
    this.peakText = el('p', 'stat', '最高 0 m');
    this.muteText = el('p', 'stat mute');
    stats.append(this.timeText, this.landingText, this.distText, this.peakText, this.muteText);
    top.append(brand, headingWrap, stats);
    this.root.append(top);

    this.tip = el('p', 'tip');
    this.stall = el('p', 'stall', '失速 — 推杆增速');
    this.root.append(this.tip, this.stall);

    this.legend = el('aside', 'legend');
    this.legend.append(el('h2', 'legend-title', '操作'));
    const rows: Array<[string, string]> = [
      ['W / ↑', '拉杆，抬头'],
      ['S / ↓', '推杆，低头'],
      ['A / ←', '左滚，地面转向'],
      ['D / →', '右滚，地面转向'],
      ['Q / E', '方向舵 左 / 右'],
      ['X / Shift', '油门增加'],
      ['Z / PgDn', '油门减小'],
      ['空格 / B', '刹车'],
      ['C', '机外 / 座舱视角'],
      ['H', '显示或隐藏说明'],
      ['P', '暂停'],
      ['R', '重新开始'],
      ['M', '静音'],
    ];
    for (const [key, label] of rows) {
      const row = el('div', 'key-row');
      const keys = el('span', 'keys');
      for (const part of key.split(' / ')) keys.append(el('kbd', undefined, part));
      row.append(keys, el('span', 'key-label', label));
      this.legend.append(row);
    }
    this.root.append(this.legend);

    const instruments = el('footer', 'instruments');
    const speed = el('section', 'readout');
    speed.append(el('span', 'label', '空速'));
    this.speedValue = el('strong', 'value', '0');
    speed.append(this.speedValue, el('span', 'unit', 'km/h'));
    const throttle = el('div', 'throttle');
    this.throttleFill = el('div', 'throttle-fill');
    throttle.append(this.throttleFill);
    this.throttleText = el('span', 'mini', '油门 0%');
    this.rpmText = el('span', 'mini', '转速 700');
    this.gText = el('span', 'mini', '载荷 1.0');
    const speedCol = el('div', 'stack');
    speedCol.append(speed, throttle, this.throttleText, this.rpmText, this.gText);

    this.attitudeCanvas = el('canvas', 'attitude');
    const alt = el('section', 'readout right');
    alt.append(el('span', 'label', '海拔'));
    this.altValue = el('strong', 'value', '0');
    alt.append(this.altValue, el('span', 'unit', 'm'));
    this.aglValue = el('span', 'mini', '离地 0 m');
    this.vsValue = el('span', 'mini', '升降 0.0');
    this.pitchText = el('span', 'mini', '俯仰 +0°');
    const altCol = el('div', 'stack right');
    altCol.append(alt, this.aglValue, this.vsValue, this.pitchText);
    instruments.append(speedCol, this.attitudeCanvas, altCol);
    this.root.append(instruments);

    const mapWrap = el('div', 'map-wrap');
    mapWrap.append(el('span', 'map-label', '北向上'));
    this.mapCanvas = el('canvas', 'map');
    mapWrap.append(this.mapCanvas);
    this.root.append(mapWrap);

    this.overlay = el('div', 'overlay hidden');
    const card = el('div', 'card');
    this.overlayTitle = el('h2');
    this.overlayBody = el('p');
    this.overlayButton = el('button', 'primary');
    this.overlayButton.type = 'button';
    this.overlayButton.addEventListener('click', () => {
      if (this.overlay.dataset.phase === 'paused') this.onResume();
      else this.onRestart();
    });
    card.append(this.overlayTitle, this.overlayBody, this.overlayButton);
    this.overlay.append(card);
    this.root.append(this.overlay);

    this.audioHint = el('p', 'audio-hint', '按任意键或点击画面，启动引擎声');
    this.root.append(this.audioHint);
    const holds = el('div', 'holds');
    this.throttleButton = this.toggleButton('加油', '停止加油', () => this.throttleHeld, (held) => {
      this.throttleHeld = held;
      this.onThrottleHold(held);
    });
    this.pitchButton = this.toggleButton('拉杆', '松杆', () => this.pitchHeld, (held) => {
      this.pitchHeld = held;
      this.onPitchHold(held);
    });
    holds.append(this.throttleButton, this.pitchButton);
    this.root.append(holds);
    parent.append(this.root);
  }

  private toggleButton(
    offLabel: string,
    onLabel: string,
    read: () => boolean,
    write: (held: boolean) => void,
  ): HTMLButtonElement {
    const button = el('button', 'hold', offLabel);
    button.type = 'button';
    button.addEventListener('click', () => {
      const held = !read();
      write(held);
      button.classList.toggle('held', held);
      button.textContent = held ? onLabel : offLabel;
    });
    return button;
  }

  resetControls(): void {
    this.throttleHeld = false;
    this.pitchHeld = false;
    this.throttleButton.classList.remove('held');
    this.pitchButton.classList.remove('held');
    this.throttleButton.textContent = '加油';
    this.pitchButton.textContent = '拉杆';
    this.onThrottleHold(false);
    this.onPitchHold(false);
  }

  hideAudioHint(): void {
    this.audioHint.classList.add('hidden');
  }

  setLegend(visible: boolean): void {
    this.legend.classList.toggle('hidden', !visible);
  }

  reset(): void {
    this.trail.length = 0;
    this.trailTimer = 0;
  }

  update(state: FlightState, extras: { paused: boolean; muted: boolean; dt: number }): void {
    const phase: Phase = state.crashed ? 'crashed' : extras.paused ? 'paused' : 'flying';
    this.speedValue.textContent = Math.round(state.airspeed * 3.6).toString();
    this.altValue.textContent = Math.round(state.altitude).toString();
    this.aglValue.textContent = `离地 ${Math.max(0, Math.round(state.agl))} m`;
    const vs = state.verticalSpeed;
    this.vsValue.textContent = `升降 ${vs >= 0 ? '+' : ''}${vs.toFixed(1)} m/s`;
    const pitchDeg = Math.round((state.pitch * 180) / Math.PI);
    this.pitchText.textContent = `俯仰 ${pitchDeg >= 0 ? '+' : ''}${pitchDeg}°`;
    this.vsValue.classList.toggle('danger', vs < -6 && !state.onGround);
    this.throttleFill.style.height = `${Math.round(state.throttle * 100)}%`;
    this.throttleText.textContent = `油门 ${Math.round(state.throttle * 100)}%`;
    this.rpmText.textContent = `转速 ${Math.round(state.rpm)}`;
    this.gText.textContent = `载荷 ${state.gForce.toFixed(1)} G`;
    this.timeText.textContent = `时间 ${formatClock(state.flightTime)}`;
    this.landingText.textContent = `着陆 ${state.landings}`;
    this.distText.textContent = `航程 ${(state.distanceFlown / 1000).toFixed(1)} km`;
    this.peakText.textContent = `最高 ${Math.round(state.peakAltitude)} m`;
    this.muteText.textContent = extras.muted ? '已静音' : '';
    this.tip.textContent = tipFor(state);
    this.tip.classList.toggle('good', state.banner === '着陆成功' && state.bannerTime > 0);
    this.tip.classList.toggle('bad', state.banner.startsWith('硬着陆') && state.bannerTime > 0);
    this.stall.classList.toggle('show', state.stallWarn && !state.crashed);
    this.vignette.classList.toggle('stalling', state.stallWarn && !state.crashed);
    this.vignette.classList.toggle('crashed', state.crashed);
    this.drawHeading(state.heading);
    this.drawAttitude(state.pitch, state.bank, state.aoa, state.slip);
    if (phase === 'flying') {
      this.trailTimer += extras.dt;
      if (this.trailTimer > 0.35) {
        this.trailTimer = 0;
        this.trail.push({ x: state.position.x, z: state.position.z });
        if (this.trail.length > 70) this.trail.shift();
      }
    }
    this.drawMap(state);
    this.paintOverlay(phase, state);
  }

  private paintOverlay(phase: Phase, state: FlightState): void {
    const show = phase !== 'flying';
    this.overlay.classList.toggle('hidden', !show);
    this.overlay.dataset.phase = phase;
    if (phase === 'crashed') {
      this.overlayTitle.textContent = '坠毁';
      this.overlayBody.textContent = `${state.crashReason}。空速 ${Math.round(state.airspeed * 3.6)} km/h，海拔 ${Math.round(state.altitude)} m。按 R 重新起飞。`;
      this.overlayButton.textContent = '重新起飞';
    } else if (phase === 'paused') {
      this.overlayTitle.textContent = '已暂停';
      this.overlayBody.textContent = '按 P 或点击按钮继续飞行。';
      this.overlayButton.textContent = '继续飞行';
    }
  }

  private prep(canvas: HTMLCanvasElement, cssW: number, cssH: number): CanvasRenderingContext2D {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.floor(cssW * dpr);
    const height = Math.floor(cssH * dpr);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法绘制仪表');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  private drawHeading(heading: number): void {
    const width = 460;
    const height = 64;
    const ctx = this.prep(this.headingCanvas, width, height);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(8, 14, 20, 0.45)';
    roundRect(ctx, 0, 16, width, 46, 8);
    ctx.fill();
    const px = 4.1;
    const center = width / 2;
    const start = Math.floor((heading - 52) / 5) * 5;
    ctx.save();
    ctx.beginPath();
    ctx.rect(8, 16, width - 16, 46);
    ctx.clip();
    for (let deg = start; deg <= heading + 52; deg += 5) {
      const wrapped = ((deg % 360) + 360) % 360;
      const x = center + (deg - heading) * px;
      const major = wrapped % 10 === 0;
      ctx.fillStyle = major ? '#f7f3ea' : 'rgba(247,243,234,0.55)';
      ctx.fillRect(x, major ? 28 : 34, major ? 2 : 1, major ? 18 : 10);
      if (wrapped % 30 === 0) {
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(headingLabel(wrapped), x, 24);
      }
    }
    ctx.restore();
    ctx.fillStyle = '#ffbf3c';
    ctx.beginPath();
    ctx.moveTo(center, 14);
    ctx.lineTo(center - 7, 26);
    ctx.lineTo(center + 7, 26);
    ctx.fill();
    ctx.font = '600 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(formatHeading(heading), center, 56);
  }

  private drawAttitude(pitch: number, bank: number, aoa: number, slip: number): void {
    const size = 210;
    const ctx = this.prep(this.attitudeCanvas, size, size);
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 3, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(-bank);
    const px = 168;
    ctx.translate(0, pitch * px);
    ctx.fillStyle = '#3c92d8';
    ctx.fillRect(-size, -size * 2, size * 2, size * 2);
    ctx.fillStyle = '#8d6236';
    ctx.fillRect(-size, 0, size * 2, size * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-size, 0);
    ctx.lineTo(size, 0);
    ctx.stroke();
    ctx.fillStyle = '#f4f7fb';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    for (const deg of [-40, -30, -20, -10, 10, 20, 30, 40]) {
      const y = (-deg * Math.PI) / 180 * px;
      const wide = Math.abs(deg) % 20 === 0;
      ctx.fillRect(wide ? -36 : -18, y, wide ? 72 : 36, 2);
      if (wide) ctx.fillText(String(Math.abs(deg)), 48, y + 4);
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#ffbf3c';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(size / 2 - 48, size / 2);
    ctx.lineTo(size / 2 - 16, size / 2);
    ctx.moveTo(size / 2 + 16, size / 2);
    ctx.lineTo(size / 2 + 48, size / 2);
    ctx.moveTo(size / 2, size / 2);
    ctx.lineTo(size / 2, size / 2 + 14);
    ctx.stroke();
    const fx = size / 2 + slip * px;
    const fy = size / 2 + aoa * px;
    if (fx > 16 && fy > 16 && fx < size - 16 && fy < size - 16) {
      ctx.strokeStyle = '#b7e4ff';
      ctx.strokeRect(fx - 5, fy - 5, 10, 10);
    }
  }

  private drawMap(state: FlightState): void {
    const size = 168;
    const ctx = this.prep(this.mapCanvas, size, size);
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = 'rgba(8, 14, 20, 0.62)';
    ctx.fillRect(0, 0, size, size);
    const range = Math.max(900, Math.min(4200, 800 + state.agl * 2.5 + state.airspeed * 7));
    const scale = (size * 0.46) / range;
    const cx = size / 2;
    const cy = size / 2;
    const project = (x: number, z: number) => [cx + (x - state.position.x) * scale, cy + (z - state.position.z) * scale];
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    for (const step of [-2, -1, 1, 2]) {
      const [x] = project(state.position.x + step * range * 0.35, state.position.z);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, size);
      ctx.stroke();
    }
    const lake = project(920, -260);
    ctx.fillStyle = 'rgba(56, 150, 186, 0.85)';
    ctx.beginPath();
    ctx.ellipse(lake[0], lake[1], Math.max(3, 420 * scale), Math.max(3, 420 * scale), 0, 0, Math.PI * 2);
    ctx.fill();
    const mount = project(-1650, -2050);
    ctx.fillStyle = '#d7dde4';
    ctx.beginPath();
    ctx.moveTo(mount[0], mount[1] - 7);
    ctx.lineTo(mount[0] + 6, mount[1] + 5);
    ctx.lineTo(mount[0] - 6, mount[1] + 5);
    ctx.fill();
    const south = project(0, 260);
    const north = project(0, -1480);
    ctx.strokeStyle = '#f4f7fb';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(south[0], south[1]);
    ctx.lineTo(north[0], north[1]);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 196, 90, 0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < this.trail.length; i += 1) {
      const point = this.trail[i];
      if (!point) continue;
      const [x, y] = project(point.x, point.z);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((state.heading * Math.PI) / 180);
    ctx.fillStyle = '#ffbf3c';
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(5, 7);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5, 7);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#f7f3ea';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('N', 8, 14);
    ctx.textAlign = 'right';
    ctx.fillText(`${(range / 1000).toFixed(1)} km`, size - 8, size - 8);
  }
}

function headingLabel(degrees: number): string {
  if (degrees === 0) return '北';
  if (degrees === 90) return '东';
  if (degrees === 180) return '南';
  if (degrees === 270) return '西';
  return String(degrees / 10).padStart(2, '0');
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function tipFor(state: FlightState): string {
  if (state.crashed) return '';
  if (state.bannerTime > 0 && state.banner) return state.banner;
  if (state.stallWarn) return '失速预警：松开拉杆，加油门，放下机头';
  if (!state.takenOff) {
    if (state.airspeed < 8) return '按住 X 或 Shift 加油门，用 A / D 保持在中线上';
    if (state.airspeed < 30) return '继续滑跑。空速约 110 km/h 后轻按 W 抬轮';
    return '轻拉杆抬轮，机翼保持水平';
  }
  if (!state.onGround && state.agl < 30 && state.verticalSpeed < -0.8) {
    return '拉平：轻拉杆，让下降率降到 1 米/秒左右再接地';
  }
  const nav = bearingToRunway(state.position.x, state.position.z);
  if (nav.distance > 1100) {
    return `返回机场 ${(nav.distance / 1000).toFixed(1)} 公里 · 方位 ${formatHeading(nav.bearing)}`;
  }
  if (!state.onGround) return `${lateralOffsetLabel(state.position.x)} · 进近空速约 120`;
  if (state.airspeed < 6) return '停稳了。加油门可以再次起飞';
  return '沿中线滑行，空格刹车';
}
