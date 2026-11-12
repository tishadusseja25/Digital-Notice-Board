import { useEffect } from "react";

const APP = "Digital Notice Board";

/** Sets the browser tab title, so tabs, history and bookmarks tell pages apart. */
export function useTitle(title?: string) {
  useEffect(() => {
    document.title = title ? `${title} · ${APP}` : APP;
  }, [title]);
}
