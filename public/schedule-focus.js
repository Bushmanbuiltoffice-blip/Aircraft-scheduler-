// Scrolls today into view once per page load. Another date has no marker and is left alone.
// Retries after layout so a wide week does not stay parked on Sunday.
function scrollToReveal(input) {
  var viewLeft = input.scroll.x;
  var viewTop = input.scroll.y;
  var viewRight = viewLeft + input.viewport.width;
  var viewBottom = viewTop + input.viewport.height;
  var targetLeft = input.target.x - input.viewport.x + viewLeft;
  var targetTop = input.target.y - input.viewport.y + viewTop;
  var targetRight = targetLeft + input.target.width;
  var targetBottom = targetTop + input.target.height;
  var visibleX = targetLeft >= viewLeft - 0.5 && targetRight <= viewRight + 0.5;
  var visibleY = targetTop >= viewTop - 0.5 && targetBottom <= viewBottom + 0.5;
  var x = viewLeft;
  var y = viewTop;
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
  var maxX = Math.max(0, input.contentSize.width - input.viewport.width);
  var maxY = Math.max(0, input.contentSize.height - input.viewport.height);
  x = Math.min(maxX, Math.max(0, x));
  y = Math.min(maxY, Math.max(0, y));
  return { x: x, y: y, changed: Math.abs(x - viewLeft) > 0.5 || Math.abs(y - viewTop) > 0.5 };
}

function weekScrollLeft(index, viewportWidth, contentWidth) {
  if (viewportWidth <= 0 || contentWidth <= viewportWidth + 1) return 0;
  var label = 150;
  var column = Math.max(0, (contentWidth - label) / 7);
  var targetLeft = label + index * column;
  var centered = index === 0 ? 0 : targetLeft - (viewportWidth - column) / 2;
  return Math.min(contentWidth - viewportWidth, Math.max(0, centered));
}

function revealIn(container, target) {
  if (!container || container.clientWidth <= 0 || container.clientHeight <= 0) return false;
  var scrolling = container === document.scrollingElement || container === document.documentElement;
  var viewport = scrolling
    ? { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }
    : container.getBoundingClientRect();
  viewport = scrolling
    ? viewport
    : { x: viewport.left, y: viewport.top, width: container.clientWidth, height: container.clientHeight };
  var scroll = scrolling ? { x: window.scrollX, y: window.scrollY } : { x: container.scrollLeft, y: container.scrollTop };
  var root = document.scrollingElement || document.documentElement;
  var content = scrolling
    ? { width: root.scrollWidth, height: root.scrollHeight }
    : { width: container.scrollWidth, height: container.scrollHeight };
  var rect = target.getBoundingClientRect();
  if (rect.width <= 0 && rect.height <= 0) return false;
  var next = scrollToReveal({ viewport: viewport, contentSize: content, scroll: scroll, target: rect });
  if (!next.changed) return true;
  if (scrolling) window.scrollTo(next.x, next.y);
  else {
    container.scrollLeft = next.x;
    container.scrollTop = next.y;
  }
  return true;
}

function overflows(el) {
  return el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
}

var userMoved = false;
function noteMove() { userMoved = true; }
window.addEventListener("pointerdown", noteMove, { once: true });
window.addEventListener("keydown", noteMove, { once: true });

function focusToday() {
  if (userMoved) return;
  var board = document.getElementById("week-board");
  var index = board ? Number(board.getAttribute("data-today-index")) : NaN;
  if (board && Number.isFinite(index)) {
    var x = weekScrollLeft(index, board.clientWidth, board.scrollWidth);
    if (board.clientWidth > 0 && board.scrollWidth > board.clientWidth + 1) board.scrollLeft = x;
  }
  var todayEl = document.querySelector("[data-schedule-today]");
  if (!todayEl) return;
  var containers = [];
  for (var node = todayEl.parentElement; node; node = node.parentElement) {
    if (overflows(node)) containers.push(node);
  }
  var root = document.scrollingElement || document.documentElement;
  if (containers.indexOf(root) < 0) containers.push(root);
  containers.forEach(function (container) { revealIn(container, todayEl); });
  if (typeof todayEl.focus === "function") todayEl.focus({ preventScroll: true });
}

function scheduleFocus() {
  window.requestAnimationFrame(function () {
    window.requestAnimationFrame(focusToday);
  });
}
scheduleFocus();
window.addEventListener("load", scheduleFocus);
