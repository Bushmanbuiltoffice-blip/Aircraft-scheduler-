function standaloneApp() {
  try {
    if (window.navigator.standalone === true) return true;
    return window.matchMedia("(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)").matches;
  } catch (error) {
    return false;
  }
}

function holdPdf() {
  try { sessionStorage.setItem("fh_pdf_hold", String(Date.now())); } catch (error) { /* the link still opens */ }
}

function showPrintStatus(message, kind) {
  var el = document.getElementById("print-status");
  if (!el) return;
  el.hidden = false;
  el.className = kind === "ok" ? "no-print alert ok" : "no-print alert";
  el.textContent = message;
}

function revealUrl(href) {
  var box = document.getElementById("print-url");
  if (!box) return;
  box.hidden = false;
  box.value = href;
  box.defaultValue = href;
}

function bindPrint(button) {
  button.addEventListener("click", function () {
    holdPdf();
    var fired = false;
    function mark() { fired = true; }
    window.addEventListener("beforeprint", mark);
    try {
      window.print();
    } catch (error) {
      window.removeEventListener("beforeprint", mark);
      showPrintStatus("Print did not open (" + (error && error.name ? error.name : "error") + "). Tap Save PDF. It opens this document in a new window from that tap.");
      return;
    }
    window.setTimeout(function () {
      window.removeEventListener("beforeprint", mark);
      if (!fired && standaloneApp()) {
        showPrintStatus("Print did not open. Tap Save PDF. It opens this document in a new window from that tap.");
      }
    }, 700);
  });
}

var printBill = document.getElementById("print-bill");
var printRecord = document.getElementById("print-record");
if (printBill) bindPrint(printBill);
if (printRecord) bindPrint(printRecord);

var saveLinks = document.querySelectorAll("a.save-pdf");
for (var i = 0; i < saveLinks.length; i++) {
  saveLinks[i].addEventListener("click", function (event) {
    var link = event.currentTarget;
    holdPdf();
    if (!standaloneApp()) return;
    if (!link.target || link.target === "_self") {
      event.preventDefault();
      showPrintStatus("Save PDF has no new window. Address: " + link.href);
      revealUrl(link.href);
      return;
    }
    showPrintStatus("Save PDF tapped. A new window should open this document: " + link.href, "ok");
    revealUrl(link.href);
  });
}
