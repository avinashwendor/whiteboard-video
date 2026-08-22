"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Link2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { connect, isConnected } from "@/lib/ai/image/puter";

type State = "checking" | "connected" | "disconnected" | "connecting";

/**
 * Puter bills the visitor's own account, so it needs a one-time connection.
 * That connection is always a deliberate click here -- never something a
 * generation triggers behind the person's back.
 */
export function PuterConnection() {
  const [state, setState] = useState<State>("checking");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void isConnected().then((connected) => {
      if (!cancelled) setState(connected ? "connected" : "disconnected");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const onConnect = useCallback(async () => {
    setError(null);
    setState("connecting");
    try {
      const ok = await connect();
      setState(ok ? "connected" : "disconnected");
      if (!ok) setError("Connection was cancelled.");
    } catch (err) {
      setState("disconnected");
      setError(err instanceof Error ? err.message : "Couldn't reach Puter.");
    }
  }, []);

  if (state === "connected") {
    return (
      <p className="flex items-center gap-1.5 text-[11px] text-create">
        <Check className="size-3" aria-hidden />
        Puter connected — images run in your browser.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      <p className="text-[11px] leading-relaxed text-faint">
        Puter runs images in your browser and bills your own Puter account. Until you connect it,
        images fall back to Pollinations.
      </p>
      <Button size="sm" variant="secondary" onClick={onConnect} loading={state === "connecting"}>
        {state === "checking" ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
        ) : state === "connecting" ? null : (
          <Link2 className="size-3.5" aria-hidden />
        )}
        {state === "connecting" ? "Waiting for Puter" : "Connect Puter"}
      </Button>
      {error ? <p className="text-[11px] text-danger">{error}</p> : null}
    </div>
  );
}
