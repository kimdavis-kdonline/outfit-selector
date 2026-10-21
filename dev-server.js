// Local preview that behaves like Vercel: serves index.html and runs /api/product.
// Run with `npm run dev` (or `node dev-server.js`), then open http://localhost:8765
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import productHandler from "./api/product.js";

const PORT = Number(process.env.PORT) || 8765;

createServer(async (req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  if (path === "/api/product") return productHandler(req, res);
  if (path === "/" || path === "/index.html") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(await readFile(new URL("./index.html", import.meta.url)));
  }
  res.statusCode = 404;
  res.end("Not found");
}).listen(PORT, () => console.log(`Outfit selector running at http://localhost:${PORT}`));
