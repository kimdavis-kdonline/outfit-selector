// Vercel serverless function: GET /api/product?url=<product page link>
// Reads a store's product page and returns { found, image, name, price, currency, available }.
// The browser can't read other sites' pages itself, so the app asks this function instead.
// Some stores (Nordstrom, Amazon, Max Mara, Saks, Lafayette 148) block automated readers;
// for those it returns found: false and the app asks the user for a photo.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const TIMEOUT_MS = 8000;
const MAX_BYTES = 3_000_000;
const MAX_REDIRECTS = 5;
const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml",
  "Accept-Language": "en-US,en;q=0.9"
};

export default async function handler(req, res) {
  const target = new URL(req.url, "http://localhost").searchParams.get("url") || "";
  try {
    const result = await readProduct(target);
    // Product pages change slowly; let Vercel's edge cache repeat lookups for a day
    res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
    sendJson(res, 200, result);
  } catch (err) {
    sendJson(res, err.status || 502, { found: false, error: err.expose ? err.message : "Couldn't read that page." });
  }
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  err.expose = true;
  return err;
}

export async function readProduct(target) {
  let url;
  try {
    url = new URL(target);
  } catch {
    throw fail(400, "Not a valid link.");
  }
  if (!/^https?:$/.test(url.protocol)) throw fail(400, "Only http(s) links are supported.");

  const { status, finalUrl, html } = await fetchPage(url);
  if (status === 404 || status === 410) return { found: false, available: false };
  if (status >= 400) return { found: false, blocked: true };

  const info = extractProduct(html, finalUrl);
  // A redirect to the home page means the product is gone
  if (!info.isProduct && finalUrl.pathname.replace(/\/[a-z]{2}(-[a-z]{2})?\/?$/i, "/") === "/") {
    return { found: false, available: false };
  }
  if (!info.isProduct) return { found: false, blocked: !html.includes("og:") };

  return {
    found: true,
    image: info.image || "",
    name: info.name || "",
    brand: info.brand || "",
    price: info.price,
    currency: info.currency || "",
    available: info.available
  };
}

// Follows redirects by hand so every hop is checked against private addresses
async function fetchPage(startUrl) {
  let url = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHost(url.hostname);
    const response = await fetch(url, {
      headers: BROWSER_HEADERS,
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      url = new URL(location, url);
      if (!/^https?:$/.test(url.protocol)) throw fail(400, "Redirected to an unsupported link.");
      continue;
    }
    return { status: response.status, finalUrl: url, html: await readCapped(response) };
  }
  throw fail(502, "Too many redirects.");
}

async function readCapped(response) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  reader.cancel().catch(() => {});
  return new TextDecoder().decode(Buffer.concat(chunks));
}

// Blocks requests to localhost, private networks and cloud metadata addresses
async function assertPublicHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addresses.length) throw fail(400, "Couldn't find that website.");
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) throw fail(400, "That address isn't allowed.");
  }
}

function isPrivateAddress(address) {
  const ip = address.toLowerCase().replace(/^::ffff:/, "");
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  return ip === "::" || ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80");
}

// ---- Page parsing: Open Graph meta tags plus schema.org Product data (JSON-LD) ----

export function extractProduct(html, pageUrl) {
  const meta = readMetaTags(html);
  const ld = findJsonLdProduct(html);

  const ogType = (meta["og:type"] || "").toLowerCase();
  const priceText = meta["product:price:amount"] || meta["og:price:amount"] || ld.price;
  const isProduct = Boolean(ld.found || ogType.includes("product") || priceText);

  const image = absoluteUrl(ld.image || meta["og:image:secure_url"] || meta["og:image"] || meta["twitter:image"], pageUrl);
  const price = parsePrice(priceText);
  const availability = (ld.availability || meta["product:availability"] || meta["og:availability"] || "").toLowerCase();

  return {
    isProduct,
    image,
    name: ld.name || cleanTitle(meta["og:title"]),
    brand: ld.brand || meta["product:brand"] || "",
    price,
    currency: meta["product:price:currency"] || meta["og:price:currency"] || ld.currency || "",
    available: availability ? !/outofstock|out of stock|discontinued|soldout|sold out/.test(availability.replace(/\s/g, "")) : null
  };
}

function readMetaTags(html) {
  const meta = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attrs = {};
    for (const [, name, , dq, sq] of tag.matchAll(/([a-z:_-]+)\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
      attrs[name.toLowerCase()] = decodeEntities(dq ?? sq ?? "");
    }
    const key = (attrs.property || attrs.name || attrs.itemprop || "").toLowerCase();
    if (key && attrs.content && !(key in meta)) meta[key] = attrs.content;
  }
  return meta;
}

function findJsonLdProduct(html) {
  for (const [, body] of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data;
    try {
      data = JSON.parse(body.trim());
    } catch {
      continue;
    }
    const product = findProductNode(data);
    if (!product) continue;
    const offers = [].concat(product.offers || []).flatMap(o => o.offers ? [].concat(o.offers) : [o]);
    const offer = offers.find(o => o && o.price != null) || offers[0] || {};
    const image = [].concat(product.image || [])[0];
    return {
      found: true,
      name: decodeEntities(product.name || ""),
      brand: decodeEntities(typeof product.brand === "string" ? product.brand : product.brand?.name || ""),
      image: typeof image === "string" ? image : image?.url || image?.contentUrl || "",
      price: offer.price ?? offer.lowPrice ?? "",
      currency: offer.priceCurrency || "",
      availability: String(offer.availability || "")
    };
  }
  return {};
}

function findProductNode(node) {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findProductNode(child);
      if (found) return found;
    }
    return null;
  }
  const types = [].concat(node["@type"] || []).map(String);
  if (types.some(t => /^(Product|ProductGroup)$/i.test(t))) return node;
  return findProductNode(node["@graph"]);
}

function parsePrice(text) {
  if (text == null || text === "") return null;
  const n = Number(String(text).replace(/[^0-9.,]/g, "").replace(/,(?=\d{3}\b)/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// "Iverness Top Grey – The Row" -> "Iverness Top Grey"
function cleanTitle(title) {
  return (title || "").split(/\s+[–|—-]\s+/)[0].trim();
}

// Resolves relative links and upgrades http to https so the photo loads on the https site
function absoluteUrl(value, base) {
  if (!value) return "";
  try {
    const url = new URL(value, base);
    if (url.protocol === "http:") url.protocol = "https:";
    return /^https:$/.test(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&ndash;/g, "–").replace(/&mdash;/g, "—").replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}
