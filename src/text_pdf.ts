/** A one-page PDF of plain lines. Text is not compressed, so the saved words stay in the file. */

function escapePdf(text: string): string {
  return text.replace(/[^\x20-\x7E]/g, "?").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

export function textPdf(lines: string[]): Uint8Array {
  const commands = ["BT", "/F1 11 Tf", "72 752 Td"];
  lines.forEach((line, index) => {
    if (index > 0) commands.push("0 -14 Td");
    commands.push(`(${escapePdf(line)}) Tj`);
  });
  commands.push("ET");
  const stream = commands.join("\n");
  const header = "%PDF-1.4\n";
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n",
    `4 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  ];
  const encoder = new TextEncoder();
  let offset = encoder.encode(header).length;
  const offsets = objects.map((object) => {
    const start = offset;
    offset += encoder.encode(object).length;
    return start;
  });
  let xref = "xref\n0 6\n0000000000 65535 f \n";
  for (const start of offsets) xref += `${String(start).padStart(10, "0")} 00000 n \n`;
  const trailer = `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`;
  return encoder.encode(header + objects.join("") + xref + trailer);
}

export function pdfText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}
