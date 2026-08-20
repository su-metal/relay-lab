import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitFor = async (url, timeoutMs = 30000) => {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {}
    await sleep(300);
  }
  throw new Error(`timeout: ${url}`);
};

const chromePath = process.env.CHROME_BIN || "google-chrome";
const chrome = spawn(
  chromePath,
  [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--remote-debugging-port=9222",
    "--user-data-dir=/tmp/relay-lab-chrome",
    "about:blank",
  ],
  { stdio: "ignore" },
);

const pending = new Map();
let seq = 0;
let ws;
const cdp = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

try {
  await waitFor("http://127.0.0.1:9222/json/version");
  const targetResponse = await fetch(
    "http://127.0.0.1:9222/json/new?http://localhost:3000",
    { method: "PUT" },
  );
  const target = await targetResponse.json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id);
    if (message.error) item.reject(new Error(JSON.stringify(message.error)));
    else item.resolve(message.result);
  });

  await cdp("Page.enable");
  await cdp("Runtime.enable");
  await sleep(1800);

  const fixture = await readFile("scripts/ladder-preview-circuit.json", "utf8");
  await cdp("Runtime.evaluate", {
    expression: `localStorage.setItem("relay-lab:circuit:v1", ${JSON.stringify(fixture)}); location.reload();`,
  });
  await sleep(2400);

  const click = await cdp("Runtime.evaluate", {
    expression: `(() => { const button = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'ラダー図'); if (!button) return 'button-not-found'; button.click(); return 'clicked'; })()`,
    returnByValue: true,
  });
  if (click.result?.value !== "clicked") throw new Error(String(click.result?.value));
  await sleep(800);

  const extracted = await cdp("Runtime.evaluate", {
    expression: `(() => {
      const svg = document.querySelector('dialog[open] svg[aria-label="同じ実接点を一度だけ描いた共有配線ラダー図"]');
      if (!svg) return { error: 'shared-svg-not-found', text: document.querySelector('dialog[open]')?.innerText ?? document.body.innerText };
      const clone = svg.cloneNode(true);
      const originals = [svg, ...svg.querySelectorAll('*')];
      const clones = [clone, ...clone.querySelectorAll('*')];
      const props = ['fill','stroke','stroke-width','stroke-linecap','stroke-linejoin','font-family','font-size','font-weight','color'];
      originals.forEach((node, index) => {
        const copy = clones[index];
        const style = getComputedStyle(node);
        for (const prop of props) copy.style.setProperty(prop, style.getPropertyValue(prop));
      });
      clone.style.background = getComputedStyle(svg).backgroundColor;
      return { svg: clone.outerHTML, text: document.querySelector('dialog[open]')?.innerText ?? '' };
    })()`,
    returnByValue: true,
  });
  const value = extracted.result?.value;
  if (!value?.svg) throw new Error(`${value?.error ?? "extract-failed"}\n${value?.text ?? ""}`);

  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/ladder-preview.svg",
    `<?xml version="1.0" encoding="UTF-8"?>\n${value.svg}`,
    "utf8",
  );
  await writeFile("artifacts/ladder-preview.txt", value.text, "utf8");
} finally {
  try { ws?.close(); } catch {}
  chrome.kill("SIGTERM");
}
