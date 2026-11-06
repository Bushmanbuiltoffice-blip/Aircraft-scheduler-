/**
 * Reads text drawn in a PDF (Tj / TJ strings), including FlateDecode streams.
 * No OCR and no network. A scan that is only an image yields no policy text.
 */

export type PdfText = {
  text: string;
  /** A stream used a filter this reader does not decode, or inflate failed. */
  partial: boolean;
};

export async function extractPdfText(bytes: Uint8Array): Promise<PdfText> {
  const parts: string[] = [];
  let partial = false;
  let cursor = 0;
  while (cursor < bytes.length) {
    const at = indexOfAscii(bytes, "stream", cursor);
    if (at < 0) break;
    if (at >= 3 && asciiAt(bytes, at - 3, "end")) {
      cursor = at + 6;
      continue;
    }
    const dictStart = lastIndexOfAscii(bytes, "<<", at);
    const dict = dictStart >= 0 ? asciiSlice(bytes, dictStart, at) : "";
    let dataStart = at + "stream".length;
    if (bytes[dataStart] === 0x0d && bytes[dataStart + 1] === 0x0a) dataStart += 2;
    else if (bytes[dataStart] === 0x0a || bytes[dataStart] === 0x0d) dataStart += 1;
    const length = /\/Length\s+(\d+)/.exec(dict);
    let dataEnd = length ? dataStart + Number(length[1]) : indexOfAscii(bytes, "endstream", dataStart);
    if (dataEnd < dataStart || dataEnd > bytes.length) {
      partial = true;
      cursor = dataStart;
      continue;
    }
    const data = bytes.subarray(dataStart, dataEnd);
    const image = /\/Subtype\s*\/Image|\/DCTDecode|\/JPXDecode|\/CCITTFaxDecode/.test(dict);
    const predictor = /\/Predictor\s+([2-9]|1\d)/.test(dict);
    if (image || predictor) {
      partial = true;
    } else if (/\/FlateDecode/.test(dict)) {
      const inflated = (await inflate(data, "deflate")) ?? (await inflate(data, "deflate-raw"));
      if (inflated) parts.push(textFromContent(inflated));
      else partial = true;
    } else if (/\/Filter/.test(dict)) {
      partial = true;
    } else {
      parts.push(textFromContent(data));
    }
    cursor = Math.max(dataEnd, dataStart + 1);
  }
  return { text: parts.join("\n"), partial };
}

function textFromContent(bytes: Uint8Array): string {
  const raw = latin1(bytes);
  const pieces: string[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] === "(") {
      const parsed = readLiteral(raw, i);
      if (parsed) {
        pieces.push(parsed.value);
        i = parsed.end;
      }
    } else if (raw[i] === "<" && raw[i + 1] !== "<") {
      const parsed = readHex(raw, i);
      if (parsed) {
        pieces.push(parsed.value);
        i = parsed.end;
      }
    }
  }
  return pieces.join(" ");
}

function readLiteral(raw: string, open: number): { value: string; end: number } | null {
  let value = "";
  for (let i = open + 1; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === "\\") {
      const next = raw[i + 1];
      if (next === "n") value += "\n";
      else if (next === "r") value += "\r";
      else if (next === "t") value += "\t";
      else if (next === "(" || next === ")" || next === "\\") value += next;
      else if (next >= "0" && next <= "7") {
        const octal = raw.slice(i + 1, i + 4).match(/^[0-7]{1,3}/)?.[0] ?? "";
        value += String.fromCharCode(parseInt(octal, 8));
        i += octal.length;
        continue;
      } else if (next) value += next;
      i += 1;
      continue;
    }
    if (ch === ")") return { value: decodePdfString(value), end: i };
    value += ch;
  }
  return null;
}

function readHex(raw: string, open: number): { value: string; end: number } | null {
  const close = raw.indexOf(">", open + 1);
  if (close < 0 || close - open > 4000) return null;
  const hex = raw.slice(open + 1, close).replace(/\s+/g, "");
  if (!/^[0-9A-Fa-f]*$/.test(hex) || hex.length < 2) return null;
  const padded = hex.length % 2 === 0 ? hex : `${hex}0`;
  let value = "";
  for (let i = 0; i < padded.length; i += 2) value += String.fromCharCode(parseInt(padded.slice(i, i + 2), 16));
  return { value: decodePdfString(value), end: close };
}

/** PDF text strings may be UTF-16BE with a BOM. */
function decodePdfString(value: string): string {
  if (value.length >= 2 && value.charCodeAt(0) === 0xfe && value.charCodeAt(1) === 0xff) {
    let out = "";
    for (let i = 2; i + 1 < value.length; i += 2) {
      out += String.fromCharCode((value.charCodeAt(i) << 8) | value.charCodeAt(i + 1));
    }
    return out;
  }
  return value;
}

async function inflate(data: Uint8Array, format: "deflate" | "deflate-raw"): Promise<Uint8Array | null> {
  try {
    const stream = new DecompressionStream(format);
    const writer = stream.writable.getWriter();
    await writer.write(data);
    await writer.close();
    return new Uint8Array(await new Response(stream.readable).arrayBuffer());
  } catch {
    return null;
  }
}

function latin1(bytes: Uint8Array): string {
  let out = "";
  const size = 0x8000;
  for (let i = 0; i < bytes.length; i += size) {
    out += String.fromCharCode(...bytes.subarray(i, Math.min(i + size, bytes.length)));
  }
  return out;
}

function asciiSlice(bytes: Uint8Array, start: number, end: number): string {
  let out = "";
  for (let i = start; i < end; i += 1) out += String.fromCharCode(bytes[i] ?? 0);
  return out;
}

function asciiAt(bytes: Uint8Array, offset: number, text: string): boolean {
  for (let i = 0; i < text.length; i += 1) if (bytes[offset + i] !== text.charCodeAt(i)) return false;
  return true;
}

function indexOfAscii(bytes: Uint8Array, needle: string, from: number): number {
  const codes = [...needle].map((ch) => ch.charCodeAt(0));
  outer: for (let i = from; i <= bytes.length - codes.length; i += 1) {
    for (let j = 0; j < codes.length; j += 1) if (bytes[i + j] !== codes[j]) continue outer;
    return i;
  }
  return -1;
}

function lastIndexOfAscii(bytes: Uint8Array, needle: string, before: number): number {
  const codes = [...needle].map((ch) => ch.charCodeAt(0));
  const start = Math.min(before, bytes.length) - codes.length;
  outer: for (let i = start; i >= 0; i -= 1) {
    for (let j = 0; j < codes.length; j += 1) if (bytes[i + j] !== codes[j]) continue outer;
    return i;
  }
  return -1;
}
