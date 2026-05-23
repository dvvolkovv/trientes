"use client";

import Image from "next/image";
import { useState } from "react";

// The one client-side concern in a news card: swap a broken external image for
// the branded placeholder. External image hosts vary, so `unoptimized` skips the
// next/image domain allowlist (same pattern as coin-row.tsx).
export function NewsCardImage({ src, fallback }: { src: string; fallback: React.ReactNode }) {
  const [broken, setBroken] = useState(false);
  if (broken) return <>{fallback}</>;
  return (
    <Image
      src={src}
      alt=""
      fill
      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
      className="object-cover transition-transform duration-500 group-hover:scale-[1.04]"
      unoptimized
      onError={() => setBroken(true)}
    />
  );
}
