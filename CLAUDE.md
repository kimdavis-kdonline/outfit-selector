# Designer Outfit Selector

## What this app is for
A styling tool for a stylist / designer. It does two jobs in one app:
1. **Wardrobe + Style me**: keep a wardrobe of pieces and get random outfit suggestions from it.
2. **Client lookbook**: keep a separate wardrobe and lookbook per client, save suggested looks,
   and mark the looks the client picked.

"My wardrobe" is the default profile; every client is just another profile with its own pieces and looks.

## How it's built
- One file: `index.html` (HTML + CSS + vanilla JS). No frameworks, no build step, no server.
- Data lives in the browser's `localStorage` under the key `outfit-selector`. Nothing is sent anywhere,
  and data does not sync between devices or browsers.
- Deployed as a static site (GitHub → Vercel), the same way as `../todo-app`.

## Data model
```
state = {
  currentId,                        // selected profile
  profiles: [{
    id, name,
    items: [{ id, name, designer, category, price | null, image }],
    looks: [{ id, itemIds: [itemId...], picked: boolean }],
    wishlist: [{ id, name, designer, category, size, price | null, image, link }]   // pieces to buy
  }]
}
```
Categories: Top, Bottom, Dress, Outerwear, Shoes, Accessory.

## Rules the code follows
- **Style me**: a Dress, or a Top + Bottom (50/50 when both are possible), then one Outerwear,
  Shoes and Accessory each if that category has pieces. Disabled until a dress or a top + bottom exists.
- **Edit** loads a piece into the add form ("Save changes" / "Cancel"); edits show up everywhere the
  piece appears, including saved looks. Switching client cancels an edit.
- Deleting a piece removes it from saved looks; a look left empty is dropped.
- **Wishlist** pieces (per profile) are kept out of the wardrobe, so Style me never uses them.
  "View" opens the product link (http(s) only) in a new tab. "Move to wardrobe" moves the piece,
  details and link included, into `items`. Profiles saved before the wishlist existed get `wishlist: []` on load.
- **Autofill from product link** (`parseProductLink`): reads only the URL text, never fetches the page
  (a static page can't read other sites, and retailers block bots). Designer comes from `BRAND_SITES`
  (single-brand domains) or a `KNOWN_DESIGNERS` prefix of the slug (Nordstrom); name is the rest of the
  slug; category from the last garment word (`CATEGORY_WORDS`); size from `?size=`. It fills only
  fields the user hasn't typed in. Price, photo and stock status would need a server function.
- The placeholder test pieces in the browser are intentional during design testing. Don't clear them.
- User text is always rendered with `textContent`, never `innerHTML`.
- Image links render only for `http(s)` URLs; a broken link falls back to a lettered placeholder tile.
- Price is optional; look totals add up only the priced pieces.

## Working on it
- Test by serving the folder (`python3 -m http.server`) and using the page. `localStorage`
  is blocked on some `file://` / preview URLs.
- Add one feature at a time and check it in the browser before starting the next.
- Keep it a single static `index.html` unless there is a clear reason to change that.
