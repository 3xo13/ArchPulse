/**
 * shared/src/index.ts
 *
 * ARCHITECTURAL VIOLATION (circular):
 * shared imports formatOrder from domain — a lower-level package
 * must not depend on a higher-level one.
 * This creates the cycle: domain → shared → domain
 */
export { makeUserId, makeMoney } from "./types.js";
export type { UserId, ProductId, Money } from "./types.js";

// ⚠️  SEEDED VIOLATION: shared → domain (circular back-edge)
export { formatOrder } from "@demo/domain";
