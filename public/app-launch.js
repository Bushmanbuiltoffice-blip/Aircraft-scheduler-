// Installed app (home screen) opens on the dashboard.
// A normal browser tab is never redirected, so bookmarks and shared links stay put.
// Coming back to a still-open page also goes to the dashboard, unless a form is
// half filled, the rental agreement is on screen, a file picker is open, or Print / Save PDF just ran.
(function () {
  var key = "fh_app_open";
  var awayMs = 1000;
  function standalone() {
    try {
      if (window.navigator.standalone === true) return true;
      return window.matchMedia("(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)").matches;
    } catch (error) {
      return false;
    }
  }
  if (!standalone()) return;

  var path = location.pathname;
  try {
    var fresh = sessionStorage.getItem(key) !== "1";
    sessionStorage.setItem(key, "1");
    if (fresh && path !== "/" && path.indexOf("/invite/") !== 0 && path.indexOf("/setup") !== 0) {
      location.replace("/");
      return;
    }
  } catch (error) {
    return;
  }

  var hiddenAt = 0;
  var pageHideAt = 0;
  var navigatedAway = false;
  var lastHistoryShow = 0;
  var printing = false;
  var printGraceUntil = 0;
  var filePicker = false;

  function formDirty() {
    var fields = document.querySelectorAll("input, textarea, select");
    for (var i = 0; i < fields.length; i++) {
      var el = fields[i];
      if (!el || el.type === "hidden" || el.type === "submit" || el.type === "button" || el.type === "reset") continue;
      if (el.type === "checkbox" || el.type === "radio") {
        if (el.checked !== el.defaultChecked) return true;
      } else if (el.tagName === "SELECT") {
        var options = el.options;
        for (var j = 0; j < options.length; j++) {
          if (options[j].selected !== options[j].defaultSelected) return true;
        }
      } else if (el.value !== el.defaultValue) return true;
    }
    return false;
  }

  function printingNow(at) {
    if (printing || at < printGraceUntil) return true;
    try {
      return window.matchMedia("print").matches;
    } catch (error) {
      return false;
    }
  }

  function goHome(at, hiddenMs, picker) {
    var current = location.pathname;
    if (current === "/" || current.indexOf("/invite/") === 0 || current.indexOf("/setup") === 0) return;
    if (current === "/agreement" || current.indexOf("/agreement/") === 0) return;
    if (printingNow(at) || formDirty() || picker) return;
    if (hiddenMs < awayMs) return;
    location.replace("/");
  }

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") {
      hiddenAt = Date.now();
      navigatedAway = false;
      return;
    }
    if (document.visibilityState !== "visible") return;
    var away = hiddenAt ? Date.now() - hiddenAt : 0;
    hiddenAt = 0;
    var picker = filePicker;
    filePicker = false;
    if (navigatedAway) return;
    goHome(Date.now(), away, picker);
  });

  window.addEventListener("pagehide", function (event) {
    pageHideAt = Date.now();
    if (!event.persisted) navigatedAway = true;
  });

  window.addEventListener("pageshow", function (event) {
    if (!event.persisted) return;
    var now = Date.now();
    lastHistoryShow = now;
    var away = pageHideAt ? now - pageHideAt : 0;
    var picker = filePicker;
    filePicker = false;
    goHome(now, away, picker);
  });

  window.addEventListener("resume", function () {
    var now = Date.now();
    if (now - lastHistoryShow < awayMs) return;
    var away = hiddenAt ? now - hiddenAt : awayMs;
    var picker = filePicker;
    filePicker = false;
    if (navigatedAway) return;
    goHome(now, away, picker);
  });

  window.addEventListener("beforeprint", function () { printing = true; });
  window.addEventListener("afterprint", function () {
    printing = false;
    printGraceUntil = Date.now() + 3000;
  });

  document.addEventListener("click", function (event) {
    var target = event.target;
    if (target && target.closest && target.closest("input[type=file]")) filePicker = true;
  }, true);
})();
