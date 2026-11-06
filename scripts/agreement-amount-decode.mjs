/** Adobe ASCII85, the encoding used by the ReportLab agreement PDF. */
export function a85decode(input) {
  const clean = Buffer.from(input).toString("latin1").replace(/\s+/g, "").replace(/~>$/, "");
  const out = [];
  for (let i = 0; i < clean.length; ) {
    if (clean[i] === "z") {
      out.push(0, 0, 0, 0);
      i += 1;
      continue;
    }
    const chunk = clean.slice(i, i + 5);
    i += chunk.length;
    let value = 0;
    for (let j = 0; j < 5; j += 1) value = value * 85 + ((j < chunk.length ? chunk.charCodeAt(j) : 117) - 33);
    for (let j = 0; j < chunk.length - 1; j += 1) out.push((value >>> (24 - 8 * j)) & 255);
  }
  return Buffer.from(out);
}
