import { useCallback, useEffect, useRef, useState } from "react";

export type SaveState = "saved" | "pending" | "saving" | "error";

/**
 * Collects edits and saves them a moment after typing stops, and straight away when
 * the page is left. Failed saves keep their changes so the next save retries them.
 */
export function useAutosave<T extends Record<string, unknown>>(save: (changes: Partial<T>) => Promise<unknown>, delay = 900) {
  const pending = useRef<Partial<T>>({});
  const timer = useRef<number | undefined>(undefined);
  const saveRef = useRef(save);
  saveRef.current = save;
  const [state, setState] = useState<SaveState>("saved");
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    const changes = pending.current;
    if (!Object.keys(changes).length) return;
    pending.current = {};
    setState("saving");
    try {
      await saveRef.current(changes);
      setSavedAt(new Date());
      setState(Object.keys(pending.current).length ? "pending" : "saved");
    } catch {
      pending.current = { ...changes, ...pending.current };
      setState("error");
    }
  }, []);

  const queue = useCallback(
    (changes: Partial<T>) => {
      pending.current = { ...pending.current, ...changes };
      setState("pending");
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), delay);
    },
    [delay, flush],
  );

  const discard = useCallback(() => {
    window.clearTimeout(timer.current);
    pending.current = {};
  }, []);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (Object.keys(pending.current).length) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      void flush();
    };
  }, [flush]);

  const label =
    state === "saving" || state === "pending"
      ? "Saving…"
      : state === "error"
        ? "Not saved"
        : savedAt
          ? `Saved ${savedAt.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`
          : "All changes saved";

  return { queue, flush, discard, state, label };
}
