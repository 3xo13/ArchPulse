/**
 * shared/src/types.ts
 * Shared value-object types used across all layers.
 * No dependencies on other demo packages.
 */

export interface UserId {
  readonly value: string;
}

export interface ProductId {
  readonly value: string;
}

export interface Money {
  readonly amount: number;
  readonly currency: string;
}

export function makeUserId(value: string): UserId {
  if (!value.trim()) throw new Error("UserId cannot be empty");
  return { value };
}

export function makeMoney(amount: number, currency: string): Money {
  if (amount < 0) throw new Error("Amount cannot be negative");
  return { amount, currency };
}
