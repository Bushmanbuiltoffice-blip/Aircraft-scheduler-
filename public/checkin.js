const form = document.querySelector("#checkin-form");
const estimate = document.querySelector("#checkin-estimate");
if (form && estimate) {
  const hobbsOut = Number(form.dataset.hobbsOut);
  const aircraftRate = Number(form.dataset.aircraftRate);
  const instructorRate = Number(form.dataset.instructorRate);
  const hobbsIn = form.querySelector("[name=hobbs_in]");
  const render = () => {
    const next = Number(String(hobbsIn.value).trim());
    if (!Number.isFinite(hobbsOut) || !Number.isFinite(next) || String(hobbsIn.value).trim() === "") {
      estimate.textContent = "Enter Hobbs in to preview the cost. Billing uses Hobbs, not the reservation length.";
      return;
    }
    if (!form.dataset.aircraftRate) {
      estimate.textContent = "This airplane has no rate for this flight, so there is nothing to preview.";
      return;
    }
    const tenths = Math.round(next * 10) - Math.round(hobbsOut * 10);
    if (tenths <= 0) {
      estimate.textContent = "Hobbs in has to be higher than Hobbs out.";
      return;
    }
    const hours = (tenths / 10).toFixed(1);
    const aircraft = Math.round((tenths * aircraftRate) / 10);
    const instructor = instructorRate > 0 ? Math.round((tenths * instructorRate) / 10) : 0;
    const money = (cents) => `$${(cents / 100).toFixed(2)}`;
    const instructorLine = instructorRate > 0 ? ` Instructor ${money(instructor)}.` : " Solo, no instructor charge.";
    estimate.textContent = `${hours} Hobbs hours. Aircraft ${money(aircraft)}.${instructorLine} Total ${money(aircraft + instructor)}.`;
  };
  hobbsIn.addEventListener("input", render);
  render();
}
