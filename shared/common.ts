const version = '1.0.6'

export interface StoreKey<T> {
  k: string
}
export interface StoreObjectKey<T> {
  k: string,
  validate: (x: object) => T | null
}

export function paymentPointerStore(videoId: string): StoreKey<string> {
  return { k: paymentPointerField + '_v-' + videoId }
}
export function receiptServiceStore(videoId: string): StoreKey<boolean> {
  return { k: receiptServiceField + '_v-' + videoId }
}
export function currencyStore(videoId: string): StoreKey<string> {
  return { k: currencyField + '_v-' + videoId }
}
export function viewCostStore(videoId: string): StoreKey<number> {
  return { k: viewCostField + '_v-' + videoId }
}
export function adSkipCostStore(videoId: string): StoreKey<number> {
  return { k: adSkipCostField + '_v-' + videoId }
}

const paymentPointerField = 'web-monetization-payment-pointer'
const receiptServiceField = 'web-monetization-receipt-service'
const currencyField = 'web-monetization-currency'
const viewCostField = 'web-monetization-view-cost'
const adSkipCostField = 'web-monetization-ad-skip-cost'

function hms (duration: number | null) {
  if (duration == null || isNaN(duration)) {
    return '' + duration
  }
  var s = duration % 60
  const m = Math.round((duration - s) / 60 % 60)
  const h = Math.round((duration - 60 * m - s) / 3600)
  // Only round if it's too long to avoid floating point precision issues
  if (6 < ('' + s).length) {
    s = Math.round(s * 1000) / 1000
  }
  
  if (h != 0) {
    return h + 'h' + m + 'm' + s + 's'
  }
  if (m != 0) {
    return m + 'm' + s + 's'
  }
  return s + 's'
}

export {
  version,
  paymentPointerField,
  receiptServiceField,
  currencyField,
  viewCostField,
  adSkipCostField,
hms}
