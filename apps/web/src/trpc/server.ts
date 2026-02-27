import "server-only";

import { headers } from "next/headers";
import { cache } from "react";

import { createCaller } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";

/**
 * This wraps the `createTRPCContext` helper and provides the required context for the tRPC API when
 * handling a tRPC call from a React Server Component.
 */
const createContext = cache(async () => {
  const heads = new Headers(await headers());
  heads.set("x-trpc-source", "rsc");

  // Bridge team selection cookie into x-team-id header for RSC parity
  const cookieHeader = heads.get("cookie");
  if (cookieHeader && !heads.has("x-team-id")) {
    const match = cookieHeader.match(/(?:^|; )usesend-team-id=([1-9]\d*)(?:;|$)/);
    if (match?.[1]) {
      heads.set("x-team-id", match[1]);
    }
  }

  return createTRPCContext({
    headers: heads,
  });
});

export const api = createCaller(createContext);
