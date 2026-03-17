"use client";

import { useActionState } from "react";
import { subscribeEmail } from "./actions";

export function EmailForm() {
  const [state, action, isPending] = useActionState(subscribeEmail, null);

  if (state?.success) {
    return (
      <div className="animate-fade-in flex items-center gap-2.5 border border-gold/30 px-6 py-3.5">
        <span className="font-mono text-sm text-gold">{state.message}</span>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-2">
      <form
        action={action}
        className="animate-fade-in-up delay-300 flex w-full flex-col items-stretch gap-3 sm:flex-row"
      >
        <input
          type="email"
          name="email"
          required
          placeholder="you@email.com"
          className="flex-1 border border-stroke bg-transparent px-5 py-3.5 font-mono text-sm text-text-white placeholder:text-text-dark outline-none transition-colors focus:border-gold/50"
        />
        <button
          type="submit"
          disabled={isPending}
          className="shrink-0 bg-gold px-7 py-3.5 font-mono text-sm font-semibold tracking-wider text-bg transition-all hover:brightness-110 disabled:opacity-60"
        >
          {isPending ? "..." : "NOTIFY ME"}
        </button>
      </form>
      {state?.message && !state.success && (
        <p className="font-mono text-xs text-red-400">{state.message}</p>
      )}
    </div>
  );
}
