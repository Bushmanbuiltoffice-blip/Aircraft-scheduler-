for (const id of ["print-bill", "print-record"]) {
  document.getElementById(id)?.addEventListener("click", () => window.print());
}
