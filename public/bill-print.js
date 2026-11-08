function standaloneApp() {
  try {
    if (window.navigator.standalone === true) return true;
    return window.matchMedia("(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)").matches;
  } catch (error) {
    return false;
  }
}

function holdPdf() {
  try { sessionStorage.setItem("fh_pdf_hold", String(Date.now())); } catch (error) { /* the download still starts */ }
}

function saveBlob(blob, name) {
  var url = URL.createObjectURL(blob);
  var anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
}

for (const id of ["print-bill", "print-record"]) {
  var button = document.getElementById(id);
  if (!button) continue;
  if (standaloneApp()) button.hidden = true;
  button.addEventListener("click", function () {
    holdPdf();
    if (standaloneApp()) return;
    window.print();
  });
}

document.querySelectorAll("a.save-pdf").forEach(function (link) {
  link.addEventListener("click", function (event) {
    holdPdf();
    if (!standaloneApp() || typeof navigator.share !== "function") return;
    event.preventDefault();
    var name = link.getAttribute("download") || "document.pdf";
    fetch(link.href, { credentials: "same-origin" }).then(function (response) {
      if (!response.ok) throw new Error("pdf");
      return response.blob();
    }).then(function (blob) {
      var file = new File([blob], name, { type: "application/pdf" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        return navigator.share({ files: [file], title: name });
      }
      saveBlob(blob, name);
    }).catch(function (error) {
      if (error && error.name === "AbortError") return;
      saveBlobFallback(link);
    });
  });
});

function saveBlobFallback(link) {
  var anchor = document.createElement("a");
  anchor.href = link.href;
  anchor.download = link.getAttribute("download") || "";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
