const version = '0.1.3'
const paymentPointerField = 'web-monetization-payment-pointer'
const viewCostField = 'web-monetization-view-cost'
const adSkipCostField = 'web-monetization-ad-skip-cost'

function hms (duration) {
  if (duration == null || window.isNaN(duration)) {
    return '' + duration
  }
  var s = duration % 60
  const m = Math.round((duration - s) / 60 % 60)
  const h = Math.round((duration - 60 * m - s) / 3600)
  // Only round if it's too long to avoid floating point precision issues
  if (6 < ('' + s).length) {
    s = Math.round(s * 1000) / 1000
  }
  var ret = ''
  if (h != 0) {
    return h + 'h' + m + 'm' + s + 's'
  }
  if (m != 0) {
    return m + 'm' + s + 's'
  }
  return s + 's'
}

module.exports = {
  version,
  paymentPointerField,
  viewCostField,
  adSkipCostField,
hms}
