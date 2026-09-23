"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Opening this page marks everything read on the server, but the unread badge
 * is rendered by the LAYOUT — and the App Router keeps a layout mounted across
 * navigations inside it. So the count sat there unchanged next to your name
 * after you had just read everything, until a full page reload.
 *
 * One refresh, once, only when something was actually marked. The ref guards
 * against React's development double-effect turning it into a loop.
 */
export function RefreshOnce({ when }: { when: boolean }) {
  const router = useRouter();
  const done = useRef(false);

  useEffect(() => {
    if (!when || done.current) return;
    done.current = true;
    router.refresh();
  }, [when, router]);

  return null;
}
