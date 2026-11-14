import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Image files for the importer: which exist, what they really are (read from the bytes, not the extension), and
 * whether the server's catalog image policy will accept them — so a dry run reports a bad file before anything is
 * uploaded. Mirrors `CATALOG_IMAGE_UPLOAD_POLICY` (src/server/core/assets/upload-policies.ts); the server re-checks.
 */
export const IMAGE_POLICY = { maxBytes: 8 * 1024 * 1024, minSide: 200, maxSide: 8000, types: { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } };

/** The real type and pixel size of an image buffer, or null when it is not a JPEG, PNG or WebP. */
export function imageInfo(buffer) {
  if (buffer.length >= 24 && buffer.readUInt32BE(0) === 0x89504e47 && buffer.toString("ascii", 12, 16) === "IHDR") {
    return { mime: "image/png", width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) return null;
      const marker = buffer[offset + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      const length = buffer.readUInt16BE(offset + 2);
      // Start-of-frame markers carry the size: SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC).
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { mime: "image/jpeg", width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
      }
      offset += 2 + length;
    }
    return null;
  }
  if (buffer.length >= 30 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    const chunk = buffer.toString("ascii", 12, 16);
    if (chunk === "VP8X") return { mime: "image/webp", width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
    if (chunk === "VP8 ") return { mime: "image/webp", width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
    if (chunk === "VP8L") {
      const bits = buffer.readUInt32LE(21);
      return { mime: "image/webp", width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
    }
  }
  return null;
}

/** Why the server would refuse this image, or null. */
export function imageProblem(info, bytes) {
  if (!info) return "not a JPEG, PNG or WebP image";
  if (bytes > IMAGE_POLICY.maxBytes) return `${(bytes / 1024 / 1024).toFixed(1)} MB is over the 8 MB limit`;
  if (Math.min(info.width, info.height) < IMAGE_POLICY.minSide) return `${info.width}×${info.height} is below the ${IMAGE_POLICY.minSide}px minimum`;
  if (Math.max(info.width, info.height) > IMAGE_POLICY.maxSide) return `${info.width}×${info.height} is over the ${IMAGE_POLICY.maxSide}px maximum`;
  return null;
}

/**
 * A file name in the folder that is probably what a missing name meant — the same name without a " (1)" / "(1)" copy
 * marker, case-insensitively. Only ever SUGGESTED in the report: the importer never substitutes a file on its own.
 */
export function suggestFile(missing, available) {
  const normalize = (name) => name.toLowerCase().replace(/\s*\(\d+\)(?=\.[^.]+$)/, "").replace(/\s+/g, " ");
  const target = normalize(missing);
  const matches = available.filter((name) => normalize(name) === target);
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Every image the catalog references: exists?, sha256, real type, size, policy problem, and a suggestion when missing.
 * Also lists files in the folder nothing references (reported, never uploaded).
 */
export function inspectImages(dir, referenced) {
  const available = fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => /\.(jpe?g|png|webp)$/i.test(name)) : [];
  const files = new Map();
  for (const name of new Set(referenced)) {
    const full = path.join(dir, name);
    if (path.dirname(path.resolve(full)) !== path.resolve(dir)) {
      files.set(name, { name, exists: false, problem: "must be a file directly inside the import folder", suggestion: null });
      continue;
    }
    if (!fs.existsSync(full)) {
      files.set(name, { name, exists: false, problem: "file not found", suggestion: suggestFile(name, available) });
      continue;
    }
    const buffer = fs.readFileSync(full);
    const info = imageInfo(buffer);
    files.set(name, { name, path: full, exists: true, bytes: buffer.length, sha256: createHash("sha256").update(buffer).digest("hex"), ...(info ?? {}), problem: imageProblem(info, buffer.length) });
  }
  const unused = available.filter((name) => !files.has(name));
  return { files, unused };
}
