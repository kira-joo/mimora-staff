/** Shared test fixtures for the catalog importer tests (not a test file itself). */
import { deflateSync } from "node:zlib";

export const CAT = "6ae9bd7d431804dc15cf9991";
export const COL = "6ae3c285750dd161bb65a05b";
export const product = (slug, extra = {}) => ({
  sourceImageFilename: `${slug}.jpg`,
  product: { name: { en: slug, ar: `ا ${slug}` }, description: { en: "", ar: "" }, slug, categoryId: CAT, collectionIds: [COL], optionAxes: [], attributes: [], lifecycle: "published", ...extra.product },
  variants: extra.variants ?? [{ sku: `SKU-${slug}`, optionValues: [], price: "100.00", stock: 10 }],
  ...(extra.entry ?? {}),
});

/** A real (tiny-on-disk) PNG of the given size — enough for type and dimension detection. */
export function png(width, height, seed = 0) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buffer) => {
    let c = 0xffffffff;
    for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.alloc(1 + width * 3, seed % 256);
  row[0] = 0;
  const pixels = deflateSync(Buffer.concat(Array.from({ length: height }, () => row)));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", pixels), chunk("IEND", Buffer.alloc(0))]);
}

