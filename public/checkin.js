const form = document.querySelector("#checkin-form");
const estimate = document.querySelector("#checkin-estimate");
if (form && estimate) {
  const hobbsOut = Number(form.dataset.hobbsOut);
  const aircraftRate = Number(form.dataset.aircraftRate);
  const instructorRate = Number(form.dataset.instructorRate);
  const hobbsIn = form.querySelector("[name=hobbs_in]");
  const groundIn = form.querySelector("[name=ground_hours]");
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
    let ground = 0;
    let groundLine = "";
    if (groundIn && instructorRate > 0) {
      const raw = String(groundIn.value).trim();
      if (raw) {
        const value = Number(raw);
        const ok = /^\d{1,2}(\.\d{1,2})?$/.test(raw) && value >= 0 && value <= 24;
        if (!ok) {
          estimate.textContent = "Ground instruction must be from 0 to 24 hours, like 1 or 0.5.";
          return;
        }
        ground = Math.round((Math.round(value * 100) * instructorRate) / 100);
        groundLine = ` Ground instruction ${money(ground)}.`;
      }
    }
    const instructorLine = instructorRate > 0 ? ` Flight instruction ${money(instructor)}.` : " Solo, no instructor charge.";
    estimate.textContent = `${hours} Hobbs hours. Aircraft ${money(aircraft)}.${instructorLine}${groundLine} Total ${money(aircraft + instructor + ground)}.`;
  };
  hobbsIn.addEventListener("input", render);
  groundIn?.addEventListener("input", render);
  render();
}
