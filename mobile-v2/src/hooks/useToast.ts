import { useCallback, useRef, useState } from "react";

export type ToastState = { message: string | null; isError: boolean };

/** Local (per-screen) toast — matches the widget's `showToast(message, isError)` UX: a short-lived banner, auto-dismissed after ~2.6s, replaced immediately if a new one fires while one is showing. */
export function useToast() {
  const [state, setState] = useState<ToastState>({ message: null, isError: false });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((message: string, isError = false) => {
    setState({ message, isError });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState({ message: null, isError: false }), 2600);
  }, []);

  return { toast: state, show };
}
