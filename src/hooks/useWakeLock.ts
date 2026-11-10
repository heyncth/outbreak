"use client";

import { useCallback, useEffect, useState } from "react";

export function useWakeLock(active: boolean) {
  const [supported] = useState(() => typeof navigator !== "undefined" && "wakeLock" in navigator);
  const [held, setHeld] = useState(false);

  const release = useCallback(async () => {
    try {
      setHeld(false);
    } catch {
      /* noop */
    }
  }, []);

  const request = useCallback(async () => {
    if (!supported || !active) return;
    try {
      await navigator.wakeLock.request("screen");
      setHeld(true);
    } catch {
      setHeld(false);
    }
  }, [active, supported]);

  useEffect(() => {
    if (!active) {
      void release();
      return;
    }
    void request();

    const onVisibility = () => {
      if (document.visibilityState === "visible" && active) {
        void request();
      } else {
        setHeld(false);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      void release();
    };
  }, [active, request, release]);

  return { supported, held };
}
