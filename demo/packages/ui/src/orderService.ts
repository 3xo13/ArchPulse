/**
 * ui/src/orderService.ts
 * Application service: orchestrates domain operations.
 * Allowed dependencies: domain and shared only.
 */
import { makeUserId, makeMoney } from "@demo/shared";
import { createOrder, fulfillOrder, saveOrder, findOrdersByUser } from "@demo/domain";

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
