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

function showPrintStatus(message) {
  var el = document.getElementById("print-status");
  if (!el) return;
  el.hidden = false;
  el.textContent = message;
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
      showPrintStatus("Print did not open (" + (error && error.name ? error.name : "error") + "). Save PDF opens this document. If a share sheet appears, choose Print. The file stays on this site.");
      return;
    }
    window.setTimeout(function () {
      window.removeEventListener("beforeprint", mark);
      if (!fired && standaloneApp()) {
        showPrintStatus("Print did not open. Save PDF opens this document. If a share sheet appears, choose Print. The file stays on this site.");
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
  saveLinks[i].addEventListener("click", function () { holdPdf(); });
}
