// 顶部胶囊的弹簧驱动：位置与宽度都用弹簧积分逼近目标，符合“弹簧动效”的手感。
// 拖动时由 App 直接写值（不进弹簧），松手/换页时再交给弹簧收敛。

export interface SpringTarget {
  left: number;
  width: number;
}

interface SpringState {
  left: number;
  width: number;
  leftVelocity: number;
  widthVelocity: number;
  maxLeft: number;
}

const STIFFNESS = 220;
const DAMPING = 26;
const MASS = 1;

export function createPillSpring(
  apply: (left: number, width: number) => void,
  onSettle?: () => void,
): {
  setBounds: (maxLeft: number) => void;
  jumpTo: (left: number, width: number) => void;
  animateTo: (target: SpringTarget) => void;
  cancel: () => void;
} {
  let state: SpringState = { left: 0, width: 0, leftVelocity: 0, widthVelocity: 0, maxLeft: Number.POSITIVE_INFINITY };
  let target: SpringTarget = { left: 0, width: 0 };
  let frame = 0;
  let last = 0;
  let frames = 0;

  const applyState = (): void => {
    apply(state.left, state.width);
  };

  const step = (time: number): void => {
    frame = 0;
    frames += 1;
    if (!last) last = time;
    const dt = Math.min(0.05, Math.max(0.008, (time - last) / 1000));
    last = time;

    const solve = (value: number, velocity: number, goal: number): [number, number] => {
      const spring = -STIFFNESS * (value - goal);
      const damper = -DAMPING * velocity;
      const acceleration = (spring + damper) / MASS;
      const nextVelocity = velocity + acceleration * dt;
      const nextValue = value + nextVelocity * dt;
      return [nextValue, nextVelocity];
    };

    const [nextLeft, nextLeftVelocity] = solve(state.left, state.leftVelocity, target.left);
    const [nextWidth, nextWidthVelocity] = solve(state.width, state.widthVelocity, target.width);
    state = {
      left: Math.max(0, Math.min(state.maxLeft, nextLeft)),
      width: Math.max(0, nextWidth),
      leftVelocity: nextLeftVelocity,
      widthVelocity: nextWidthVelocity,
      maxLeft: state.maxLeft,
    };
    applyState();

    const settled =
      Math.abs(state.left - target.left) < 0.35 &&
      Math.abs(state.leftVelocity) < 0.35 &&
      Math.abs(state.width - target.width) < 0.35 &&
      Math.abs(state.widthVelocity) < 0.35;

    // 兜底：超过 ~2.5 秒仍未收敛，直接落到目标，避免胶囊永久卡在中间
    if (settled || frames > 150) {
      state = { ...state, left: target.left, width: target.width, leftVelocity: 0, widthVelocity: 0 };
      applyState();
      last = 0;
      onSettle?.();
      return;
    }
    frame = window.requestAnimationFrame(step);
  };

  const run = (): void => {
    if (frame) return;
    last = 0;
    frame = window.requestAnimationFrame(step);
  };

  return {
    setBounds(maxLeft: number): void {
      state.maxLeft = maxLeft;
    },
    jumpTo(left: number, width: number): void {
      this.cancel();
      state = { left, width, leftVelocity: 0, widthVelocity: 0, maxLeft: state.maxLeft };
      applyState();
      onSettle?.();
    },
    animateTo(next: SpringTarget): void {
      target = {
        left: Math.max(0, Math.min(state.maxLeft, next.left)),
        width: Math.max(0, next.width),
      };
      frames = 0;
      run();
    },
    cancel(): void {
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
      last = 0;
      frames = 0;
      onSettle?.();
    },
  };
}