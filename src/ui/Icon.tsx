/**
 * Character and Arc artwork.
 *
 * Files are fetched at build time into `public/img/` and referenced by their
 * hashed name - everness is never contacted at runtime.
 *
 * The single-file `file://` build carries no images, and seven character
 * codenames have no everness record and so no icon at all. Both cases end up
 * here, and both fall back to the name rather than a broken-image box: the name
 * is the information that actually identifies the character.
 */
import { useState } from "react";

import icons from "../generated/icons.json";

const FILES = (icons as { files: Record<string, string> }).files;

export function iconFile(key: string): string | null {
  return FILES[key] ?? null;
}

export function Icon({
  entry,
  alt,
  size = 44,
}: {
  entry: string;
  alt: string;
  size?: number;
}) {
  const [broken, setBroken] = useState(false);
  const file = iconFile(entry);
  if (!file || broken) {
    return (
      <span className="icon icon--fallback" style={{ width: size, height: size }}>
        {alt.slice(0, 2)}
      </span>
    );
  }
  return (
    <img
      className="icon"
      src={`./img/${file}`}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setBroken(true)}
    />
  );
}
