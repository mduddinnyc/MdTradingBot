"use client";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export default function NavigationProgress() {
  const pathname = usePathname();
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);
  const ticker = useRef<ReturnType<typeof setInterval>>();
  const prev = useRef(pathname);

  // Intercept internal link clicks → start bar
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute("href") ?? "";
      if (!href || href.startsWith("http") || href.startsWith("#") || href.startsWith("mailto")) return;
      if (href === pathname) return;

      setVisible(true);
      setWidth(0);
      let w = 0;
      clearInterval(ticker.current);
      ticker.current = setInterval(() => {
        w = w + (82 - w) * 0.18;
        setWidth(Math.min(w, 82));
      }, 50);
    };

    document.addEventListener("click", handleClick);
    return () => {
      document.removeEventListener("click", handleClick);
      clearInterval(ticker.current);
    };
  }, [pathname]);

  // Pathname changed → navigation complete
  useEffect(() => {
    if (prev.current === pathname) return;
    prev.current = pathname;

    clearInterval(ticker.current);
    setWidth(100);
    const t = setTimeout(() => {
      setVisible(false);
      setWidth(0);
    }, 350);
    return () => clearTimeout(t);
  }, [pathname]);

  if (!visible) return null;

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[9999] h-[2px] pointer-events-none"
      style={{
        background: "linear-gradient(90deg, #5B7FFF 0%, #818cf8 100%)",
        width: `${width}%`,
        transition: width === 100 ? "width 200ms ease-out" : "width 60ms linear",
        opacity: visible ? 1 : 0,
      }}
    />
  );
}
