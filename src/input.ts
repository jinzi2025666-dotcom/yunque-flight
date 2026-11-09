export interface PilotInput {
  pitch: number;
  roll: number;
  yaw: number;
  throttleUp: boolean;
  throttleDown: boolean;
  brake: boolean;
}

const BLOCKED = new Set([
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyQ',
  'KeyE',
  'KeyZ',
  'KeyX',
  'KeyB',
  'KeyR',
  'KeyP',
  'KeyC',
  'KeyM',
  'KeyH',
  'PageUp',
  'PageDown',
  'NumpadAdd',
  'NumpadSubtract',
  'Equal',
  'Minus',
]);

export class Input {
  private readonly down = new Set<string>();
  private readonly just = new Set<string>();
  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.repeat) {
      if (BLOCKED.has(event.code)) event.preventDefault();
      this.down.add(event.code);
      return;
    }
    if (BLOCKED.has(event.code)) event.preventDefault();
    if (!this.down.has(event.code)) this.just.add(event.code);
    this.down.add(event.code);
  };
  private readonly onKeyUp = (event: KeyboardEvent) => {
    this.down.delete(event.code);
  };
  private readonly onBlur = () => {
    this.down.clear();
  };

  constructor() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }

  consume(code: string): boolean {
    if (!this.just.has(code)) return false;
    this.just.delete(code);
    return true;
  }

  endFrame(): void {
    this.just.clear();
  }

  snapshot(): PilotInput {
    const noseUp = this.down.has('KeyW') || this.down.has('ArrowUp');
    const noseDown = this.down.has('KeyS') || this.down.has('ArrowDown');
    const rollRight = this.down.has('KeyD') || this.down.has('ArrowRight');
    const rollLeft = this.down.has('KeyA') || this.down.has('ArrowLeft');
    const yawRight = this.down.has('KeyE');
    const yawLeft = this.down.has('KeyQ');
    return {
      pitch: (noseUp ? 1 : 0) - (noseDown ? 1 : 0),
      roll: (rollRight ? 1 : 0) - (rollLeft ? 1 : 0),
      yaw: (yawRight ? 1 : 0) - (yawLeft ? 1 : 0),
      throttleUp:
        this.down.has('KeyX') ||
        this.down.has('ShiftLeft') ||
        this.down.has('ShiftRight') ||
        this.down.has('PageUp') ||
        this.down.has('NumpadAdd') ||
        this.down.has('Equal'),
      throttleDown:
        this.down.has('KeyZ') ||
        this.down.has('PageDown') ||
        this.down.has('NumpadSubtract') ||
        this.down.has('Minus'),
      brake: this.down.has('Space') || this.down.has('KeyB'),
    };
  }
}
