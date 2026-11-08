// Brings [data-schedule-today] into view once, when this page is opened.
// A week or month that does not contain today has no marker, so a chosen date stays put.
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

function revealIn(container, target) {
  var scrolling = container === document.scrollingElement || container === document.documentElement;
  var viewport = scrolling
    ? { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }
    : { x: container.getBoundingClientRect().left, y: container.getBoundingClientRect().top, width: container.clientWidth, height: container.clientHeight };
  var scroll = scrolling
    ? { x: window.scrollX, y: window.scrollY }
    : { x: container.scrollLeft, y: container.scrollTop };
  var content = scrolling
    ? { width: (document.scrollingElement || document.documentElement).scrollWidth, height: (document.scrollingElement || document.documentElement).scrollHeight }
    : { width: container.scrollWidth, height: container.scrollHeight };
  var next = scrollToReveal({ viewport: viewport, contentSize: content, scroll: scroll, target: target.getBoundingClientRect() });
  if (!next.changed) return;
  if (scrolling) window.scrollTo(next.x, next.y);
  else {
    container.scrollLeft = next.x;
    container.scrollTop = next.y;
  }
}

function scrollable(el) {
  var style = window.getComputedStyle(el);
  return /(auto|scroll|overlay)/.test(style.overflowX + style.overflowY);
}

var todayEl = document.querySelector("[data-schedule-today]");
if (todayEl) {
  var containers = [];
  for (var node = todayEl.parentElement; node && node !== document.body; node = node.parentElement) {
    if (scrollable(node)) containers.push(node);
  }
  containers.forEach(function (container) { revealIn(container, todayEl); });
  revealIn(document.scrollingElement || document.documentElement, todayEl);
  if (typeof todayEl.focus === "function") todayEl.focus({ preventScroll: true });
}
