"use client";

import { useState, type RefObject } from "react";

/** Renders the given element to a PNG with html-to-image; uses the native share sheet when available. */
export default function ShareButton({ target, filename }: { target: RefObject<HTMLElement | null>; filename: string }) {
  const [busy, setBusy] = useState(false);

  async function share() {
    if (!target.current) return;
    setBusy(true);
    try {
      const { toBlob } = await import("html-to-image");
      const bg = getComputedStyle(document.body).backgroundColor;
      const blob = await toBlob(target.current, { pixelRatio: 2, backgroundColor: bg, cacheBust: true });
      if (!blob) throw new Error("render failed");
      const file = new File([blob], filename, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "My Vibe Check" }).catch(() => {});
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch {
      alert("Couldn't create the image. Try a screenshot instead.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={share}
      disabled={busy}
      className="rounded-full border border-line bg-card px-4 py-2 text-sm font-medium transition hover:border-ink-3 disabled:opacity-50"
    >
      {busy ? "Making image…" : "Share as image"}
    </button>
  );
}
