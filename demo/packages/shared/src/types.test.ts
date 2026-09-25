import { describe, it, expect } from "vitest";
import { makeUserId, makeMoney } from "../src/types.js";

describe("shared/types", () => {
  it("makeUserId rejects empty string", () => {
    expect(() => makeUserId("")).toThrow("UserId cannot be empty");
    expect(() => makeUserId("  ")).toThrow("UserId cannot be empty");
  });

  it("makeUserId accepts a non-empty string", () => {
    expect(makeUserId("u1")).toEqual({ value: "u1" });
  });

  it("makeMoney rejects negative amount", () => {
    expect(() => makeMoney(-1, "USD")).toThrow("Amount cannot be negative");
  });

  it("makeMoney accepts zero and positive amounts", () => {
    expect(makeMoney(0, "USD")).toEqual({ amount: 0, currency: "USD" });
    expect(makeMoney(9.99, "EUR")).toEqual({ amount: 9.99, currency: "EUR" });
  });
});
