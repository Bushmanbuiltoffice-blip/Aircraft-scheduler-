import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { test } from "node:test";
import assert from "node:assert/strict";
import { a85decode } from "./agreement-amount-decode.mjs";

const root = new URL("../src/agreements/", import.meta.url);
const txt = readFileSync(new URL("fire-hound-rental-agreement-v1.txt", root));
const html = readFileSync(new URL("fire-hound-rental-agreement-v1.html", root));
const pdf = readFileSync(new URL("fire-hound-rental-agreement-v1.pdf", root));

function pdfText(bytes) {
  const latin = bytes.toString("latin1");
  let out = "";
  for (const match of latin.matchAll(/stream\n([\s\S]*?)endstream/g)) {
    let body = Buffer.from(match[1], "latin1");
    if (body[body.length - 1] === 0x0a) body = body.subarray(0, -1);
    out += inflateSync(a85decode(body)).toString("latin1");
  }
  return out;
}

test("current agreement copies say $75,000.00 and not $60,000.00", () => {
  for (const [name, bytes] of [["txt", txt], ["html", html]]) {
    const text = bytes.toString("utf8");
    assert.equal(text.split("$75,000.00").length - 1, 1, name);
    assert.equal(text.includes("$60,000.00"), false, name);
    assert.equal(text.includes("Fire Hound Rental"), true, name);
    assert.equal(text.includes("cash or check only"), true, name);
    assert.equal(text.includes("less than twenty-four (24) hours"), true, name);
    assert.equal(text.includes("$50 cancellation fee"), true, name);
    assert.equal(text.includes("Cancellations due to weather are exempt"), true, name);
  }
  const words = pdfText(pdf);
  assert.equal(words.includes("$75,000.00"), true);
  assert.equal(words.includes("$60,000.00"), false);
  assert.equal(words.includes("Fire Hound Rental"), true);
  assert.equal(words.includes("cash or check only"), true);
  assert.equal(words.includes("twenty-four"), true);
  assert.equal(words.includes("weather"), true);
});
