import { describe, it, expect, beforeEach } from "vitest";
import { saveOrder, findOrdersByUser, clearAll } from "../src/repository.js";
import { makeUserId, makeMoney } from "@demo/shared/src/types.js";
import { createOrder } from "@demo/domain/src/order.js";

describe("db/repository", () => {
  const userId = makeUserId("user-42");
  const total = makeMoney(100, "USD");

  beforeEach(() => clearAll());

  it("saveOrder stores an order retrievable by userId", () => {
    const order = createOrder(userId, total);
    saveOrder(order);
    const found = findOrdersByUser(userId);
    expect(found).toHaveLength(1);
    expect(found[0]!.id).toBe(order.id);
  });

  it("findOrdersByUser returns only orders for the given user", () => {
    const other = makeUserId("user-99");
    const o1 = createOrder(userId, total);
    const o2 = createOrder(other, total);
    saveOrder(o1);
    saveOrder(o2);
    const forUser = findOrdersByUser(userId);
    const forOther = findOrdersByUser(other);
    expect(forUser).toHaveLength(1);
    expect(forOther).toHaveLength(1);
    expect(forUser[0]!.id).toBe(o1.id);
    expect(forOther[0]!.id).toBe(o2.id);
  });

  it("clearAll empties the store", () => {
    saveOrder(createOrder(userId, total));
    clearAll();
    expect(findOrdersByUser(userId)).toHaveLength(0);
  });
});
