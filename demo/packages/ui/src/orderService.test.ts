import { describe, it, expect, beforeEach } from "vitest";
import { placeOrder, getUserOrders, fulfil } from "../src/orderService.js";
import { clearAll, saveOrder, findOrdersByUser } from "@demo/db";
import { createOrder } from "@demo/domain";
import { makeUserId, makeMoney } from "@demo/shared";

/**
 * Tests for ui/orderService.
 *
 * Reset the shared store through the db compatibility API before each test.
 */
describe("ui/orderService", () => {
  beforeEach(() => clearAll());
  it("placeOrder returns an order ID", () => {
    const id = placeOrder("user-place-1", 25, "USD");
    expect(id).toMatch(/^order-/);
  });

  it("getUserOrders returns only orders for the requested user", () => {
    placeOrder("user-orders-2a", 10, "EUR");
    placeOrder("user-orders-2a", 20, "EUR");
    placeOrder("user-orders-2b", 5, "USD");
    const orders = getUserOrders("user-orders-2a");
    expect(orders).toHaveLength(2);
    orders.forEach((o) => expect(o.userId.value).toBe("user-orders-2a"));
  });

  it("fulfil transitions an order to fulfilled", () => {
    placeOrder("user-fulfil-3", 99, "USD");
    const orders = getUserOrders("user-fulfil-3");
    expect(orders).toHaveLength(1);
    const fulfilled = fulfil(orders[0]!);
    expect(fulfilled.status).toBe("fulfilled");
  });

  it("shares orders and resets with the db compatibility API", () => {
    const user = makeUserId("shared-store-user");
    const uiId = placeOrder(user.value, 10, "USD");
    expect(findOrdersByUser(user).map(order => order.id)).toEqual([uiId]);
    const dbOrder = createOrder(user, makeMoney(20, "USD"));
    saveOrder(dbOrder);
    expect(getUserOrders(user.value).map(order => order.id)).toEqual([uiId, dbOrder.id]);
    clearAll();
    expect(getUserOrders(user.value)).toEqual([]);
    expect(findOrdersByUser(user)).toEqual([]);
  });
});
