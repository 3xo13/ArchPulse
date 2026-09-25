import { describe, it, expect } from "vitest";
import { placeOrder, getUserOrders, fulfil } from "../src/orderService.js";

/**
 * Tests for ui/orderService.
 *
 * Note: each `it` block uses a unique userId to avoid cross-test state
 * contamination (the in-memory store is a module singleton).
 */
describe("ui/orderService", () => {
  it("placeOrder returns an order ID", () => {
    const id = placeOrder("user-place-1", 25, "USD");
    expect(id).toMatch(/^order-/);
  });

  it("getUserOrders returns only orders for the requested user", () => {
    placeOrder("user-orders-2a", 10, "EUR");
    placeOrder("user-orders-2a", 20, "EUR");
    placeOrder("user-orders-2b", 5, "USD");
    const orders = getUserOrders("user-orders-2a");
    expect(orders.length).toBeGreaterThanOrEqual(2);
    orders.forEach((o) => expect(o.userId.value).toBe("user-orders-2a"));
  });

  it("fulfil transitions an order to fulfilled", () => {
    placeOrder("user-fulfil-3", 99, "USD");
    const orders = getUserOrders("user-fulfil-3");
    expect(orders.length).toBeGreaterThanOrEqual(1);
    const fulfilled = fulfil(orders[0]!);
    expect(fulfilled.status).toBe("fulfilled");
  });
});
