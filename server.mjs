import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 4173);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};

createServer((request, response) => {
  const requestPath = decodeURIComponent((request.url || "/").split("?")[0]);
  const normalized = normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
  let path = join(root, normalized === "/" ? "index.html" : normalized);
  if (!path.startsWith(root) || !existsSync(path)) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  if (statSync(path).isDirectory()) path = join(path, "index.html");
  response.writeHead(200, {
    "Content-Type": mime[extname(path)] || "application/octet-stream",
    "Cache-Control": "no-cache",
    "Cross-Origin-Resource-Policy": "same-origin"
  });
  createReadStream(path).pipe(response);
}).listen(port, "127.0.0.1", () => {
  console.log(`Margin is running at http://127.0.0.1:${port}`);
});
