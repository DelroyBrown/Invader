export interface PointerInfo {
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  /** movement accumulated since the last frame — cleared by endFrame() */
  dx: number;
  dy: number;
}

// Physical key codes — immune to Shift/layout changing the reported character.
const CODEMAP: Record<string, string> = {
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  Space: 'shoot',
  ShiftLeft: 'dash',
  ShiftRight: 'dash',
  KeyP: 'pause',
  Escape: 'pause',
  KeyB: 'bomb',
  KeyX: 'bomb',
  KeyM: 'mute',
  KeyH: 'help',
  Enter: 'confirm',
  NumpadEnter: 'confirm',
};

type HAction = 'left' | 'right';
type VAction = 'up' | 'down';

export class Input {
  isTouch = false;
  taps: { x: number; y: number }[] = [];
  pointers = new Map<number, PointerInfo>();

  /** action -> set of physical codes currently holding it (A + ArrowLeft both map to 'left') */
  private held = new Map<string, Set<string>>();
  private pressed = new Set<string>();
  private anyKeyThisFrame = false;
  /** press-order stacks: the most recent still-held direction wins (no opposing-key deadlock) */
  private hOrder: HAction[] = [];
  private vOrder: VAction[] = [];

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      const action = CODEMAP[e.code];
      if (action) {
        e.preventDefault();
        if (!e.repeat) this.pressed.add(action);
        let codes = this.held.get(action);
        if (!codes) {
          codes = new Set();
          this.held.set(action, codes);
        }
        const wasHeld = codes.size > 0;
        codes.add(e.code);
        if (!wasHeld) this.axisPush(action);
      }
      if (!e.repeat) this.anyKeyThisFrame = true;
    });

    window.addEventListener('keyup', (e) => {
      const action = CODEMAP[e.code];
      if (!action) return;
      const codes = this.held.get(action);
      if (codes) {
        codes.delete(e.code);
        if (codes.size === 0) this.axisRemove(action);
      }
    });

    // Missed keyups (alt-tab, OS dialogs, sticky-keys popup) must never leave
    // the ship stuck — drop all held state whenever focus is lost.
    const releaseAll = () => {
      this.held.clear();
      this.hOrder = [];
      this.vOrder = [];
    };
    window.addEventListener('blur', releaseAll);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) releaseAll();
    });

    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (e.pointerType === 'touch') this.isTouch = true;
      const p = this.toCanvas(e);
      this.pointers.set(e.pointerId, {
        id: e.pointerId, x: p.x, y: p.y, startX: p.x, startY: p.y, dx: 0, dy: 0,
      });
      this.taps.push(p);
      this.anyKeyThisFrame = true;
      try { canvas.setPointerCapture(e.pointerId); } catch { /* ok */ }
    });

    canvas.addEventListener('pointermove', (e) => {
      const info = this.pointers.get(e.pointerId);
      if (info) {
        const p = this.toCanvas(e);
        info.dx += p.x - info.x;
        info.dy += p.y - info.y;
        info.x = p.x;
        info.y = p.y;
      }
    });

    const release = (e: PointerEvent) => this.pointers.delete(e.pointerId);
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private axisPush(action: string): void {
    if (action === 'left' || action === 'right') {
      this.hOrder = this.hOrder.filter((a) => a !== action);
      this.hOrder.push(action);
    } else if (action === 'up' || action === 'down') {
      this.vOrder = this.vOrder.filter((a) => a !== action);
      this.vOrder.push(action);
    }
  }

  private axisRemove(action: string): void {
    if (action === 'left' || action === 'right') {
      this.hOrder = this.hOrder.filter((a) => a !== action);
    } else if (action === 'up' || action === 'down') {
      this.vOrder = this.vOrder.filter((a) => a !== action);
    }
  }

  private toCanvas(e: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  isDown(action: string): boolean {
    return (this.held.get(action)?.size ?? 0) > 0;
  }

  /** -1 left, +1 right — the most recently pressed held direction wins. */
  axisX(): number {
    const last = this.hOrder[this.hOrder.length - 1];
    return last === 'left' ? -1 : last === 'right' ? 1 : 0;
  }

  /** -1 up, +1 down — the most recently pressed held direction wins. */
  axisY(): number {
    const last = this.vOrder[this.vOrder.length - 1];
    return last === 'up' ? -1 : last === 'down' ? 1 : 0;
  }

  wasPressed(action: string): boolean {
    return this.pressed.has(action);
  }

  anyPressed(): boolean {
    return this.anyKeyThisFrame;
  }

  /** First active pointer outside the given exclusion circles — used to steer the ship. */
  movePointer(exclude: { x: number; y: number; r: number }[]): PointerInfo | null {
    for (const p of this.pointers.values()) {
      const inButton = exclude.some(
        (b) => (p.startX - b.x) ** 2 + (p.startY - b.y) ** 2 < b.r * b.r,
      );
      if (!inButton) return p;
    }
    return null;
  }

  /** Call once per frame after update logic — clears edge-triggered state. */
  endFrame(): void {
    this.pressed.clear();
    this.taps.length = 0;
    this.anyKeyThisFrame = false;
    for (const p of this.pointers.values()) {
      p.dx = 0;
      p.dy = 0;
    }
  }
}
