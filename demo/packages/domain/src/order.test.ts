import { describe, it, expect } from "vitest";
import { createOrder, fulfillOrder, formatOrder } from "../src/order.js";
import { makeUserId, makeMoney } from "@demo/shared/src/types.js";

describe("domain/order", () => {
  const userId = makeUserId("user-1");
  const total = makeMoney(50, "USD");

  it("createOrder returns a pending order", () => {
    const order = createOrder(userId, total);
    expect(order.status).toBe("pending");
    expect(order.userId).toEqual(userId);
    expect(order.total).toEqual(total);
    expect(order.id).toMatch(/^order-/);
  });

  it("fulfillOrder transitions pending → fulfilled", () => {
    const order = createOrder(userId, total);
    const fulfilled = fulfillOrder(order);
    expect(fulfilled.status).toBe("fulfilled");
  });

  it("fulfillOrder throws when order is not pending", () => {
    const order = createOrder(userId, total);
    const fulfilled = fulfillOrder(order);
    expect(() => fulfillOrder(fulfilled)).toThrow("Cannot fulfil order");
  });

  it("formatOrder produces a readable string", () => {
    const order = createOrder(userId, total);
    const result = formatOrder(order);
    expect(result).toContain("pending");
    expect(result).toContain("50");
    expect(result).toContain("USD");
  });
});
