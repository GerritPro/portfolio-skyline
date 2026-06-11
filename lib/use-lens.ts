"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { DEFAULT_LENS, isLensId, lensIndex, type LensId } from "./lenses";

/**
 * Lens state, synced to the `?lens=` URL parameter. We bypass
 * router.push to avoid kicking off a full server render — this is a
 * pure client-side state change. history.replaceState gives back/
 * forward semantics without the cost.
 *
 * Returns the active lens id, a setter, and the slide direction (+1 if
 * the new lens is to the right of the previous in the lens order, -1
 * if to the left). Direction drives the LensView's slide animation.
 */
export function useLens(): {
  lens: LensId;
  direction: number;
  setLens: (next: LensId) => void;
} {
  const [lens, setLensState] = useState<LensId>(DEFAULT_LENS);
  const direction = useRef(0);
  const initialized = useRef(false);

  // Read initial lens from URL on mount. We do this in an effect so
  // we don't run into SSR hydration mismatches.
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const params = new URLSearchParams(window.location.search);
    const candidate = params.get("lens");
    if (isLensId(candidate) && candidate !== lens) {
      setLensState(candidate);
    }
  }, [lens]);

  // Listen for back/forward navigation.
  useEffect(() => {
    const onPopState = () => {
      const params = new URLSearchParams(window.location.search);
      const candidate = params.get("lens");
      if (isLensId(candidate)) {
        direction.current = lensIndex(candidate) >= lensIndex(lens) ? 1 : -1;
        setLensState(candidate);
      } else if (lens !== DEFAULT_LENS) {
        direction.current = lensIndex(DEFAULT_LENS) >= lensIndex(lens) ? 1 : -1;
        setLensState(DEFAULT_LENS);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [lens]);

  const setLens = useCallback(
    (next: LensId) => {
      if (next === lens) return;
      direction.current = lensIndex(next) >= lensIndex(lens) ? 1 : -1;
      const params = new URLSearchParams(window.location.search);
      if (next === DEFAULT_LENS) params.delete("lens");
      else params.set("lens", next);
      const qs = params.toString();
      const newUrl =
        window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash;
      window.history.pushState(null, "", newUrl);
      setLensState(next);
    },
    [lens],
  );

  return { lens, direction: direction.current, setLens };
}
