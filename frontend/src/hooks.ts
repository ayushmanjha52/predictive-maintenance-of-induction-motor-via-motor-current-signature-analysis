import { useEffect, useRef, useState } from "react";

const SITE = "MotorScope";

function setMeta(selector: string, attr: string, value: string) {
  const el = document.head.querySelector(selector);
  if (el) el.setAttribute(attr, value);
}

/** Per-route <title>, meta description and canonical URL. */
export function usePageMeta(title: string, description: string, noindex = false) {
  useEffect(() => {
    document.title = `${title} · ${SITE}`;
    setMeta('meta[name="description"]', "content", description);
    setMeta('meta[property="og:title"]', "content", `${title} · ${SITE}`);
    setMeta('meta[property="og:description"]', "content", description);
    const canonical = document.head.querySelector('link[rel="canonical"]');
    if (canonical) {
      const origin = new URL(canonical.getAttribute("href") || "/", window.location.href).origin;
      canonical.setAttribute("href", `${origin}${window.location.pathname}`);
    }
    let robots = document.head.querySelector('meta[name="robots"]');
    if (noindex) {
      if (!robots) {
        robots = document.createElement("meta");
        robots.setAttribute("name", "robots");
        document.head.appendChild(robots);
      }
      robots.setAttribute("content", "noindex");
    } else {
      robots?.remove();
    }
  }, [title, description, noindex]);
}

/** Element width via ResizeObserver, for charts drawn at true pixel size. */
export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    setWidth(Math.floor(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}
