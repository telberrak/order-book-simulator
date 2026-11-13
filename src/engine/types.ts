/** Prices inside the engine are integer ticks, so there is no floating point drift. */
export type Side = 'buy' | 'sell';
export type OrderType = 'limit' | 'market';
export type TimeInForce = 'GTC' | 'IOC';

export interface OrderRequest {
  owner: string;
  side: Side;
  type: OrderType;
  /** Limit price in ticks. Ignored for market orders. */
  price?: number;
  qty: number;
  tif?: TimeInForce;
}

export interface Order {
  id: number;
  owner: string;
  side: Side;
  type: OrderType;
  price: number; // ticks; for market orders this is unused
  qty: number; // original size
  remaining: number;
  filled: number;
  tif: TimeInForce;
  /** Sequence number at the moment it joined the book. Lower = earlier in the queue. */
  seq: number;
  time: number; // sim time (ms) when submitted
}

export interface Trade {
  id: number;
  time: number;
  price: number; // ticks
  qty: number;
  /** Side of the incoming (aggressive) order. */
  aggressor: Side;
  makerOrderId: number;
  takerOrderId: number;
  makerOwner: string;
  takerOwner: string;
}

export type OrderStatus = 'resting' | 'filled' | 'partial-resting' | 'cancelled' | 'rejected';

export interface SubmitResult {
  order: Order;
  trades: Trade[];
  status: OrderStatus;
  /** Quantity that was not filled and did not rest (market / IOC leftovers). */
  unfilledCancelled: number;
  reason?: string;
}

export interface LevelView {
  price: number;
  qty: number;
  orders: number;
}
