"use client";

import { useEffect, useRef, useState } from "react";

/** The picture, or initials if there isn't one or it fails to load. */
export function AvatarImg({ src, initials, size }: { src: string | null; initials: string; size: number }) {
  const [failed, setFailed] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  // An image can fail before the page's scripts load, so onError never fires; check once mounted.
  useEffect(() => {
    const el = img.current;
    if (el && el.complete && el.naturalWidth === 0) setFailed(true);
  }, [src]);
  if (!src || failed) return <span style={{ fontSize: size * 0.38 }}>{initials}</span>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img ref={img} src={src} alt="" width={size} height={size} decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
  );
}
