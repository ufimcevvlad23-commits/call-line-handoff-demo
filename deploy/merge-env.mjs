import { chmod, readFile, rename, writeFile } from "node:fs/promises";

const [targetPath, overlayPath] = process.argv.slice(2);
if (!targetPath || !overlayPath) throw new Error("Usage: node deploy/merge-env.mjs <target> <overlay>");

function parse(text) {
  const lines = String(text).split(/\r?\n/);
  const order = [];
  const values = new Map();
  for (const line of lines) {
    if (!line || line.trimStart().startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    const key = line.slice(0, index).trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) throw new Error(`Некорректный ключ env: ${key}`);
    if (!values.has(key)) order.push(key);
    values.set(key, line.slice(index + 1));
  }
  return { order, values };
}

const current = parse(await readFile(targetPath, "utf8"));
const overlay = parse(await readFile(overlayPath, "utf8"));
for (const key of overlay.order) {
  if (!current.values.has(key)) current.order.push(key);
  current.values.set(key, overlay.values.get(key));
}
const output = `${current.order.map((key) => `${key}=${current.values.get(key)}`).join("\n")}\n`;
const temporaryPath = `${targetPath}.next`;
await writeFile(temporaryPath, output, { encoding: "utf8", mode: 0o640 });
await chmod(temporaryPath, 0o640);
await rename(temporaryPath, targetPath);
console.log(JSON.stringify({ ok: true, updatedKeys: overlay.order.length }));
