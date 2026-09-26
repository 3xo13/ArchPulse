/**
 * domain/src/index.ts
 * Public API of the domain layer.
 */
export { createOrder, fulfillOrder, formatOrder, saveOrder, findOrdersByUser } from "./order.js";
export type { Order } from "./order.js";
