/**
 * db/src/repository.ts
 * Data-access layer: persists and retrieves orders.
 * Allowed dependency: db → shared (types only)
 */
import type { UserId } from "@demo/shared";
import type { Order } from "@demo/domain";

const store = new Map<string, Order>();

export function saveOrder(order: Order): void {
  store.set(order.id, order);
}

export function findOrdersByUser(userId: UserId): Order[] {
  return [...store.values()].filter(
    (o) => o.userId.value === userId.value,
  );
}

export function clearAll(): void {
  store.clear();
}
