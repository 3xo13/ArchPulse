/**
 * domain/src/order.ts
 * Domain logic for orders.
 * Allowed dependency: domain → shared (types only)
 */
import type { UserId, Money } from "@demo/shared";

export interface Order {
  readonly id: string;
  readonly userId: UserId;
  readonly total: Money;
  readonly status: "pending" | "fulfilled" | "cancelled";
}

let _seq = 0;

export function createOrder(userId: UserId, total: Money): Order {
  return {
    id: `order-${Date.now()}-${++_seq}`,
    userId,
    total,
    status: "pending",
  };
}

export function fulfillOrder(order: Order): Order {
  if (order.status !== "pending") {
    throw new Error(`Cannot fulfil order in status: ${order.status}`);
  }
  return { ...order, status: "fulfilled" };
}

/** Used by shared/src/index.ts — this re-export is what creates the cycle. */
export function formatOrder(order: Order): string {
  return `Order ${order.id} (${order.status}) — ${order.total.amount} ${order.total.currency}`;
}
