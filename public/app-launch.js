// Cold open of the installed app lands on the dashboard.
// In-app links, refreshes, and form results keep sessionStorage and stay put.
// A normal browser tab is left alone, so a shared link still opens that page.
(function () {
  var key = "fh_app_open";
  function standalone() {
    try {
      if (window.navigator.standalone === true) return true;
      return window.matchMedia("(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)").matches;
    } catch (error) {
      return false;
    }
  }
  if (!standalone()) return;
  var fresh = false;
  try {
    fresh = sessionStorage.getItem(key) !== "1";
    sessionStorage.setItem(key, "1");
  } catch (error) {
    return;
  }
  if (!fresh) return;
  var path = location.pathname;
  if (path === "/" || path.indexOf("/invite/") === 0 || path.indexOf("/setup") === 0) return;
  location.replace("/");
})();
