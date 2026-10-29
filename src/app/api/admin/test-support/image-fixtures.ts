import { deflateSync } from "node:zlib";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/**
 * A real, decodable solid-colour PNG of the given size — what the upload validators actually read, so a
 * test exercises the real dimension check rather than a hand-forged header. `padTo` appends trailing bytes
 * after IEND (ignored by decoders) to reach a byte size, for the "too large" case.
 */
export function makePng(width: number, height: number, padTo?: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x7f)]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return padTo && padTo > png.length ? Buffer.concat([png, Buffer.alloc(padTo - png.length)]) : png;
}

/** A multipart body with one image file and optional plain fields. */
export function imageForm(bytes: Buffer, { mimeType = "image/png", filename = "photo.png", fieldName = "file", fields = {} as Record<string, string> } = {}): FormData {
  const form = new FormData();
  form.append(fieldName, new File([new Uint8Array(bytes)], filename, { type: mimeType }));
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return form;
}
