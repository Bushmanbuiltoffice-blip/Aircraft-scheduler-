/** Puts one rectangle inside a scrollport. Already-visible targets keep the current scroll. */

export type Box = { x: number; y: number; width: number; height: number };

export function scrollToReveal(input: {
  viewport: Box;
  contentSize: { width: number; height: number };
  scroll: { x: number; y: number };
  target: Box;
}): { x: number; y: number; changed: boolean } {
  const viewLeft = input.scroll.x;
  const viewTop = input.scroll.y;
  const viewRight = viewLeft + input.viewport.width;
  const viewBottom = viewTop + input.viewport.height;
  const targetLeft = input.target.x - input.viewport.x + viewLeft;
  const targetTop = input.target.y - input.viewport.y + viewTop;
  const targetRight = targetLeft + input.target.width;
  const targetBottom = targetTop + input.target.height;
  const visibleX = targetLeft >= viewLeft - 0.5 && targetRight <= viewRight + 0.5;
  const visibleY = targetTop >= viewTop - 0.5 && targetBottom <= viewBottom + 0.5;
  let x = viewLeft;
  let y = viewTop;
  if (!visibleX) {
    x = input.target.width <= input.viewport.width
      ? targetLeft - (input.viewport.width - input.target.width) / 2
      : targetLeft;
  }
  if (!visibleY) {
    y = input.target.height <= input.viewport.height
      ? targetTop - (input.viewport.height - input.target.height) / 2
      : targetTop;
  }
  const maxX = Math.max(0, input.contentSize.width - input.viewport.width);
  const maxY = Math.max(0, input.contentSize.height - input.viewport.height);
  x = clamp(x, 0, maxX);
  y = clamp(y, 0, maxY);
  return { x, y, changed: Math.abs(x - viewLeft) > 0.5 || Math.abs(y - viewTop) > 0.5 };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Width of the sticky resource label on the week board. */
export const WEEK_LABEL_PX = 150;

/**
 * Horizontal scroll for a Sunday-start week so weekday index 0–6 is on screen.
 * A wide viewport that already fits the whole week stays at 0.
 * Index 0 (Sunday, when that is today) stays at the start. Later weekdays move off that start.
 */
export function weekScrollLeft(input: { todayIndex: number; viewportWidth: number; contentWidth: number; labelWidth?: number }): number {
  if (input.viewportWidth <= 0 || input.contentWidth <= input.viewportWidth + 1) return 0;
  const label = input.labelWidth ?? WEEK_LABEL_PX;
  const column = Math.max(0, (input.contentWidth - label) / 7);
  const targetLeft = label + input.todayIndex * column;
  const centered = input.todayIndex === 0 ? 0 : targetLeft - (input.viewportWidth - column) / 2;
  return clamp(centered, 0, input.contentWidth - input.viewportWidth);
}
