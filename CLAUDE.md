# Designer Outfit Selector

## What this app is for
A styling tool for a stylist / designer. It does two jobs in one app:
1. **Wardrobe + Style me**: keep a wardrobe of pieces and get random outfit suggestions from it.
2. **Client lookbook**: keep a separate wardrobe and lookbook per client, save suggested looks,
   and mark the looks the client picked.

"My wardrobe" is the default profile; every client is just another profile with its own pieces and looks.

## How it's built
- `index.html`: the whole app (HTML + CSS + vanilla JS). No frameworks, no build step.
- `api/product.js`: one Vercel serverless function, `GET /api/product?url=<product link>`. It reads the
  store's product page (Open Graph tags + schema.org Product JSON-LD) and returns the photo, name, brand,
  price and availability. Browsers can't read other sites' pages, so this has to run on a server.
  It refuses private/localhost addresses (checked on every redirect), times out after 8s and reads at most 3 MB.
- `dev-server.js`: local stand-in for Vercel that serves the page and runs the function (`npm run dev`).
  Without it (e.g. `python3 -m http.server`) the app still works, just without photo lookup.
- Data lives in the browser's `localStorage` under the key `outfit-selector`. Uploaded photos are shrunk
  to 600px JPEG data URLs so they fit; it does not sync between devices or browsers.
- Deployed on Vercel from GitHub; Vercel picks up `api/` automatically.

## Data model
```
state = {
  currentId,                        // selected profile
  profiles: [{
    id, name,
    items: [{ id, name, designer, store, category, size, price | null, link, image }],  // image: https URL or uploaded data URL
    looks: [{ id, itemIds: [itemId...], picked: boolean }],
    wishlist: [{ id, name, designer, category, size, store, price | null, image, link }]   // pieces to buy
  }]
}
```
Categories: Top, Bottom, Dress, Outerwear, Shoes, Accessory.

## Rules the code follows
- **Style me**: a Dress, or a Top + Bottom (50/50 when both are possible), then one Outerwear,
  Shoes and Accessory each if that category has pieces. Disabled until a dress or a top + bottom exists.
- **Photos** (both forms): pasted photo link, "Upload photo", or found from the product link by
  `/api/product`. A found photo follows the link; a pasted, uploaded, or already-saved photo is never
  replaced automatically, only by the user uploading or pasting another.
- **Store support for the photo lookup**: works for The Row, Quince, Toteme and other Shopify-type stores;
  Nordstrom (Akamai), Amazon, Max Mara, Lafayette 148 and Saks block it, and the app tells the user to
  paste the photo address or upload instead.
- **View** asks `/api/product` first; if the product is gone (404, redirect home, or out of stock) it opens
  the store's home page instead.
- **Edit** loads a piece into the add form ("Save changes" / "Cancel"); edits show up everywhere the
  piece appears, including saved looks. Switching client cancels an edit.
- Deleting a piece removes it from saved looks; a look left empty is dropped.
- **Wishlist** pieces (per profile) are kept out of the wardrobe, so Style me never uses them.
  "View" opens the product link (http(s) only) in a new tab. "Move to wardrobe" moves the piece,
  details and link included, into `items`. Profiles saved before the wishlist existed get `wishlist: []` on load.
- **Autofill from product link** (`parseProductLink`, used by both the wardrobe and wishlist forms): first reads the URL text instantly;
  then `/api/product` adds photo, price and missing name/designer. Designer comes from `BRAND_SITES`
  (single-brand domains) or a `KNOWN_DESIGNERS` prefix of the slug (Nordstrom); name is the rest of the
  slug; category from the last garment word (`CATEGORY_WORDS`); size from `?size=`; store from the
  domain (`STORE_SITES`: brand sites, Nordstrom, Saks, Amazon, ...; unknown domain = blank). It fills only
  fields the user hasn't typed in; autofilled fields follow the current link and go blank when it
  doesn't say.
- The placeholder test pieces in the browser are intentional during design testing. Don't clear them.
- User text is always rendered with `textContent`, never `innerHTML`.
- Photos render only from `http(s)` URLs or uploaded image data URLs; a broken link falls back to a
  lettered placeholder tile. If storage fills up (uploads are the big items), saving shows an alert.
- Price is optional; look totals add up only the priced pieces.

## Working on it
- Test with `npm run dev` (needs Node 20+) and use the page at http://localhost:8765.
- Add one feature at a time and check it in the browser before starting the next.
- Keep the app in `index.html` and server code in `api/`; no dependencies unless there is a clear reason.
