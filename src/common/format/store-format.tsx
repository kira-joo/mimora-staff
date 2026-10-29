"use client";

import { moneyView } from "@kira-joo/frontend-toolkit-core";
import { createContext, useContext, useMemo, type ReactNode } from "react";

interface StoreFormat {
  /** A decimal string or number in major units, shown in the store's currency. */
  money: (value: string | number | undefined | null) => string;
  /** An ISO instant shown in the store's own time zone (STORE_TIMEZONE), never the viewer's. */
  dateTime: (value: string | undefined | null) => string;
}

const StoreFormatContext = createContext<StoreFormat | null>(null);

/**
 * Money and dates in the store's terms, bound once. The currency comes from
 * StoreProfile; until one is saved there is none, and amounts show as plain
 * two-decimal figures rather than in a guessed currency.
 */
export function StoreFormatProvider({ currency, timeZone, children }: { currency?: string; timeZone: string; children: ReactNode }) {
  const value = useMemo<StoreFormat>(() => {
    const view = currency ? moneyView(currency, "en") : null;
    const dates = new Intl.DateTimeFormat("en-GB", { timeZone, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    return {
      money: (amount) => {
        if (amount === undefined || amount === null || amount === "") return "—";
        return view ? view.format(amount) : Number(amount).toFixed(2);
      },
      dateTime: (iso) => (iso ? dates.format(new Date(iso)) : "—"),
    };
  }, [currency, timeZone]);

  return <StoreFormatContext.Provider value={value}>{children}</StoreFormatContext.Provider>;
}

export function useStoreFormat(): StoreFormat {
  const format = useContext(StoreFormatContext);
  if (!format) throw new Error("useStoreFormat must be used inside StoreFormatProvider (the console layout mounts it).");
  return format;
}
