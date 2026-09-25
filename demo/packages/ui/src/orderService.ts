/**
 * ui/src/orderService.ts
 *
 * ARCHITECTURAL VIOLATION (forbidden boundary):
 * ui imports directly from db — the UI layer must not know about
 * the data-access layer. Only the domain layer should bridge them.
 */
import { makeUserId, makeMoney } from "@demo/shared";
import { createOrder, fulfillOrder } from "@demo/domain";

// ⚠️  SEEDED VIOLATION: ui → db (forbidden cross-layer dependency)
import { saveOrder, findOrdersByUser } from "@demo/db";

export function placeOrder(
  rawUserId: string,
  amount: number,
  currency: string,
): string {
  const userId = makeUserId(rawUserId);
  const total = makeMoney(amount, currency);
  const order = createOrder(userId, total);
  saveOrder(order); // ← direct db call from UI layer
  return order.id;
}

export function getUserOrders(rawUserId: string) {
  const userId = makeUserId(rawUserId);
  return findOrdersByUser(userId); // ← direct db call from UI layer
}

export function fulfil(order: ReturnType<typeof getUserOrders>[number]) {
  return fulfillOrder(order);
}
