import { SerializedReceipts, SerializedHistogramBinUncommitted, SerializedChanges, SerializedAmount } from '../shared/paid'

export type Histogram = {
  parts: number[],
  history: Record<string, { unknown: number, subscribed: number }>
}

export type HistogramUpdate = {
  receipts: any,
  histogram: any,
  subscribed: boolean,
}

export type StatsHistogramGet = {
  histogram: Histogram,
}

export type StatsHistogramUpdatePost = {
  receipts: SerializedReceipts,
  histogram: SerializedHistogramBinUncommitted[],
  subscribed: boolean,
}

export type StatsViewPost = {
  receipts: SerializedReceipts,
  changes: SerializedChanges,
  subscribed: boolean,
}

export type MonetizationStatusBulkPost = {
  videos: string[],
}

export type MonetizationStatusBulkStatus = {
  monetization: 'unmonetized' | 'monetized' | 'ad-skip' | 'pay-wall' | 'unknown',
  currency?: string,
  viewCost?: number,
  duration?: number,
  paid?: SerializedAmount | null,
}
export type MonetizationStatusBulkPostRes = {
  statuses: Record<string, MonetizationStatusBulkStatus>,
}
