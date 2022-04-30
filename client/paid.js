// import { hms } from './common.js'
const common = require('./common.js')
const { hms } = common

// An amount of money in various assets
// Either an actual account or reference value
// Money cannot be created, other than by `deposit`ing
// It can be added to reference values, but only moved among actual accounts
// export
class Amount {
  constructor (isReference) {
    this.unverified = new Map()
    this.unverifiedReceipts = []
    this.verified = new Map()
    // If this is only a reference amount, e.g. a sum of other values
    if (isReference == true) {
      this.isReference = true
    } else {
      this.isReference = false
    }
  }

  serialize () {
    var ret = {
      isReference: this.isReference,
      unverifiedReceipts: this.unverifiedReceipts
    }
    ret.unverified = [...this.unverified]
    ret.verified = [...this.verified]
    return ret
  }

  static deserialize (obj) {
    if (obj.isReference != true && obj.isReference != false) {
      throw 'Cannot deserialize `Amount`, `isReference` not `true` or `false`'
    }
    var ret = new Amount(obj.isReference)
    if (obj.unverifiedReceipts == null) {
      throw 'Cannot deserialize `Amount`, missing field `unverifiedReceipts`'
    }
    ret.unverifiedReceipts = obj.unverifiedReceipts
    if (obj.unverified == null) {
      throw 'Cannot deserialize `Amount`, missing field `unverified`'
    }
    ret.unverified = new Map(obj.unverified)
    if (obj.verified == null) {
      throw 'Cannot deserialize `Amount`, missing field `verified`'
    }
    ret.verified = new Map(obj.verified)
    return ret
  }

  deposit (significand, exponent, assetCode, verified, receipt) {
    if (this.isReference) {
      throw 'Cannot deposit to reference `Amount`'
    }
    this.depositUnchecked(significand, exponent, assetCode, verified, receipt)
  }

  depositReference (significand, exponent, assetCode, verified) {
    if (!this.isReference) {
      throw 'Cannot `depositReference` to non-reference `Amount`'
    }
    this.depositUnchecked(significand, exponent, assetCode, verified, null)
  }

  depositUnchecked (significand, exponent, assetCode, verified, receipt) {
    if (assetCode == null) {
      throw 'web-monetization: paid.js: Amount.depositUnchecked: `assetCode` cannot be null'
    }
    var destMap
    if (verified) {
      destMap = this.verified
    } else {
      if (receipt != null) {
        this.unverifiedReceipts.push({ significand: significand, exponent: exponent, assetCode: assetCode, receipt: receipt })
      }
      destMap = this.unverified
    }

    if (!destMap.has(assetCode)) {
      destMap.set(assetCode, { significand: 0, exponent: exponent })
    }
    var dest = destMap.get(assetCode)
    if (exponent < dest.exponent) {
      dest.amount *= 10 ** (dest.exponent - exponent)
      dest.exponent = exponent
    }
    dest.significand += significand * 10 ** (exponent - dest.exponent)
  }

  subtractUnchecked (significand, exponent, assetCode, verified, allowOverdraft) {
    if (allowOverdraft) {
      throw 'Negative balance in `Amount` not supported'
    }

    if (significand == 0) {
      return
    }

    var destMap
    if (verified) {
      destMap = this.verified
    } else {
      destMap = this.unverified
    }

    if (!destMap.has(assetCode)) {
      if (allowOverdraft) {
        destMap.set(assetCode, { significand: 0, exponent: exponent })
      } else {
        throw 'Attempt overdraft `Amount`'
      }
    }

    var dest = destMap.get(assetCode)
    if (exponent < dest.exponent) {
      dest.amount *= 10 ** (dest.exponent - exponent)
      dest.exponent = exponent
    }
    const subtract = significand * 10 ** (exponent - dest.exponent)
    if (dest.significand < subtract * 0.999 && !allowOverdraft) {
      throw 'Attempt overdraft `Amount`'
    }
    dest.significand -= subtract
  }

  async verifyReceipts () {}

  acceptReceipts (receipts) {
    /*while (this.verifiedReceipts.length != 0) {
      var res = receipts.retrieve(this.verifiedReceipts[0].receipt)
      if (res != null) {
      this.unverifiedReceipts.shift()
      console.log('TODO: verify')
      }
    }*/
  }

  moveFrom (other) {
    if (this.isReference) {
      throw 'Attempt to move money into reference value.'
    }
    if (other.isReference) {
      throw 'Attempt to move money from reference value.'
    }
    for (const [assetCode, { significand, exponent }] of other.verified) {
      this.deposit(significand, exponent, assetCode, true, null)
    }
    other.verified = new Map()
    for (const [assetCode, { significand, exponent }] of other.unverified) {
      this.deposit(significand, exponent, assetCode, false, null)
    }
    other.unverified = new Map()
    while (other.unverifiedReceipts.length != 0) {
      this.unverifiedReceipts.push(other.unverifiedReceipts.pop())
    }
  }

  moveFromMakeReference (other) {
    if (this.isReference) {
      throw 'Attempt to move money into reference value.'
    }
    if (other.isReference) {
      throw 'Attempt to move money from reference value.'
    }
    other.isReference = true
    for (const [assetCode, { significand, exponent }] of other.verified) {
      this.deposit(significand, exponent, assetCode, true, null)
    }
    for (const [assetCode, { significand, exponent }] of other.unverified) {
      this.deposit(significand, exponent, assetCode, false, null)
    }
    for (var i = 0; i < other.unverifiedReceipts.length; i++) {
      this.unverifiedReceipts.push(other.unverifiedReceipts[i])
    }
  }

  addFrom (other) {
    if (!this.isReference) {
      throw 'Attempt to add to non-reference money amount.'
    }
    for (const [assetCode, { significand, exponent }] of other.verified) {
      this.depositUnchecked(significand, exponent, assetCode, true, null)
    }
    for (const [assetCode, { significand, exponent }] of other.unverified) {
      this.depositUnchecked(significand, exponent, assetCode, false, null)
    }
    if (other.unverifiedReceipts < 1000) {
      for (var i = 0; i < other.unverifiedReceipts.length; i++) {
        this.unverifiedReceipts.push(other.unverifiedReceipts[i])
      }
    }
  }

  subtract (other, allowOverdraft) {
    for (const [assetCode, { significand, exponent }] of other.verified) {
      this.subtractUnchecked(significand, exponent, assetCode, true, allowOverdraft)
    }
    for (const [assetCode, { significand, exponent }] of other.unverified) {
      this.subtractUnchecked(significand, exponent, assetCode, false, allowOverdraft)
    }
    for (var i = 0; i < other.unverifiedReceipts.length; i++) {
      var removed = false
      for (var j = 0; j < this.unverifiedReceipts; j++) {
        if (this.unverifiedReceipts[j].receipt == verified[i]) {
          this.unverifiedReceipts.splice(j, 1)
          removed = true
          break
        }
      }
      if (!removed) {
        throw 'Failed to subtract receipt from `Amount`'
      }
    }
  }

  xrp () {
    const xrp = this.unverified.get('XRP')
    var unverified = 0
    if (xrp != null) {
      unverified = xrp.significand * 10 ** xrp.exponent
    }

    const xrpVerified = this.verified.get('XRP')
    var verified = 0
    if (xrp != null) {
      verified = xrp.significand * 10 ** xrp.exponent
    }

    return unverified + verified
  }

  isEmpty () {
    for (const [assetCode, { significand, exponent }] of this.unverified) {
      if (significand != 0) {
        return false
      }
    }
    for (const [assetCode, { significand, exponent }] of this.verified) {
      if (significand != 0) {
        return false
      }
    }
    for (var i = 0; i < this.unverifiedReceipts.length; i++) {
      if (this.unverifiedReceipts[i].significand != 0) {
        return false
      }
    }
    return true
  }

  // Converts as much as possible to desired currency
  async inCurrency (exchange, currency) {
    var converted = new Amount(true)
    const maps = [[this.unverified, false], [this.verified, true]]
    for (var i = 0; i < maps.length; i++) {
      for (const [assetCode, { significand, exponent }] of maps[i][0]) {
        var base = Exchange.currencyFromInterledgerCode(assetCode)
        var newAssetCode
        var newAmount
        if (base == null) {
          console.log("Couldn't convert from " + assetCode + '. Not found in list.')
          newAssetCode = assetCode
          newAmount = significand * 10 ** exponent
        } else {
          try {
            const price = await exchange.getPrice(base, currency)
            newAssetCode = currency.code
            newAmount = price * (significand * 10 ** exponent)
          } catch (e) {
            console.error(e)
            newAssetCode = assetCode
            newAmount = significand * 10 ** exponent
          }
        }
        var newSignificand = newAmount
        var newExponent = 0
        while (newSignificand * 0.001 < Math.abs(newSignificand - (newSignificand >> 0))) {
          newSignificand *= 10
          newExponent -= 1
        }
        newSignificand >>= 0
        converted.depositUnchecked(newSignificand, newExponent, newAssetCode, maps[i][1], null)
      }
    }
    return converted
  }

  displayInDuration (duration) {
    return this.display(duration)
  }

  display (duration) {
    var display = ''
    var first = true

    var phony = new Amount(true)
    for (const [assetCode, { significand, exponent }] of this.unverified) {
      phony.depositUnchecked(significand, exponent, assetCode, false, null)
    }
    for (const [assetCode, { significand, exponent }] of this.verified) {
      phony.depositUnchecked(significand, exponent, assetCode, false, null)
    }

    for (const [assetCode, { significand, exponent }] of phony.unverified) {
      var currency = quoteCurrencies[assetCode.toLowerCase()]
      if (!first) {
        display += ', '
      }
      first = false
      if (duration != null) {
        // 600 to convert from per second to per 10 minutes
        const rate = 600 * significand * 10 ** exponent / duration
        if (0.01 < rate) {
          if (currency != null && currency.symbol != null) {
            display += currency.symbol + roundTo(rate, 8) + '/10m'
          } else {
            display += roundTo(rate, 8) + ' ' + assetCode + '/10m'
          }
        } else {
          const rounded = roundTo(rate, 5 + -exponent)
          if (currency != null && currency.symbol != null) {
            display += currency.symbol + rounded.toExponential() + '/10m'
          } else {
            display += rounded.toExponential() + ' ' + assetCode + '/10m'
          }
        }
      } else {
        const amount = significand * 10 ** exponent
        if (0.01 < amount) {
          if (currency != null && currency.symbol != null) {
            display += currency.symbol + roundTo(amount, 8)
          } else {
            display += roundTo(amount, 8) + ' ' + assetCode
          }
        } else {
          const rounded = roundTo(amount, 5 + -exponent)
          if (currency != null && currency.symbol != null) {
            display += currency.symbol + rounded.toExponential()
          } else {
            display += rounded.toExponential() + ' ' + assetCode
          }
        }
      }
    }

    if (display.length == 0) {
      return '0'
    } else {
      return display
    }
  }
}

class Receipts {
  constructor () {
    this.seq = 100
    this.unverified = []
    this.verified = []
  }

  toCheck (receipt) {
    this.unverified.push({ receipt: receipt, seq: this.seq })
    return this.seq++
  }

  retrieve (seq) {
    if (this.verified.length == 0) {
      return null
    }
    if (seq != seq >> 0) {
      throw 'Receipt `retrieve` passed non-integer'
    }
    const off = seq - this.verified[0]
    if (0 <= off && off < this.verified.length) {
      if (this.verified[off].seq != seq) {
        throw 'Reqceipt `seq` error'
      } else {
        return this.verified[off]
      }
    } else {
      if (seq < this.verified[0]) {
        throw 'Asked for receipt ' + seq + ', but those before ' + this.verified[0] + ' were discarded'
      }
      if (this.seq < seq) {
        throw 'Asked for receipt ' + seq + ', but the next one is ' + this.seq
      }
      return null
    }
  }

  async verifyReceipts () {
    if (this.unverified.length != 0) {
      console.log('RECEIPTS FROM ' + this.unverified[0].seq + ' -> ' + this.unverified[this.unverified.length - 1].seq)
    }
    if (1000 < this.unverified.length) {
      console.error('TOO MANY RECEIPTS')
      this.unverified = []
    }
    while (0 < this.unverified.length) {
      // Receipts must be verified in order, or they expire
      const receiptData = this.unverified.shift()
      console.log(receiptData.seq + ' ' + receiptData.receipt)
      try {
        const res = await fetch('https://webmonetization.org/api/receipts/verify',
          {
            method: 'POST',
            body: receiptData.receipt
          })
        if (res.status != 200) {
          if (res.statusText == 'expired receipt') {
            // Funds cannot be verified
            this.verified.push({ receipt: receiptData.receipt, seq: receiptData.seq, verified: false })
            continue
          } else if (res.status == 429) {
            // Too many requests
            console.error('429 Too many requests when verifying receipts')
            this.unverified.unshift(receiptData)
            break
          } else if (res.status == 400) {
            // Client error, skip
            this.verified.push({ receipt: receiptData.receipt, seq: receiptData.seq, verified: false })
            console.error('400 Bad request when verifying receipts')
            continue
          } else {
            // this.unverified.unshift(receiptData)
            this.verified.push({ receipt: receiptData.receipt, seq: receiptData.seq, verified: false })
            console.error('When verifying receipt: ' + res.status + ' ' + res.statusText)
            break
          }
        }
        const resObj = await res.json()
        console.log('receipt validate data')
        console.log(resObj)
        if (resObj.amount == null) {
          console.error("web-monetization: Receipt validator didn't include `amount`...")
          this.verified.push({ receipt: receiptData.receipt, seq: receiptData.seq, verified: false })
          // This should never happen, so... assume we did something wrong and skip that receipt
          continue
        }
        this.verified.push({ receipt: receiptData.receipt, seq: receiptData.receipt, amount: resObj.amount, spspEndpoint: resObj.spspEndpoint })
      } catch (e) {
        console.error(e)
        this.unverified.unshift(receipt)
        break
      }
    }
  }

  serialize () {
    var ret = {}
    ret.seq = this.seq
    ret.unverified = this.unverified
    ret.verified = this.verified
    return ret
  }

  static deserialize (obj) {
    var ret = new Receipts()
    ret.seq = obj.seq
    ret.unverified = obj.unverified
    ret.verified = obj.verified
    return ret
  }

}

// 15 seconds per bin
const histogramBinSize = 15

// nonce: String; Changed after committed changes are acknowledged
// total: Amount; Sum of `paid` of each span in `spans`
// currentSpan: &Span; Reference to current span
// currentSpanIdx: int; Index of `currentSpan` in `spans`
// spans: [Span]; List of spans not in `base`, strictly increasing by `start` and not overlapping when having the same `change` value
//   Each span contains
//   change: bool; If this span has not been commited to the database
//   start: float; Timestamp in video
//   end: Option<float>; Timestamp in video (or null if current span)
//   paid: Amount; Payments made during this span, both committed nad uncommitted
//   paidUncommitted: Amount; Payments made during this span not committed
// export
class VideoPaid {
  constructor () {
    this.nonce = VideoPaid.generateNonce()
    this.total = new Amount(true)
    this.sessionTime = 0
    this.sessionTotal = new Amount(true)
    this.currentSpan = null
    this.currentSpanIdx = null
    this.spans = []
    this.histogram = []
  }

  changesEmpty (instant) {
    for (var i = 0; i < this.spans.length; i++) {
      if (this.spans[i].change) {
        if (this.spans[i].start != this.spans[i].end) {
          if (this.spans[i].end != null || this.spans[i].start != instant) {
            return false
          }
        }
      }
    }
    return true
  }

  startSpan (instant) {
    if (this.currentSpan != null) {
      console.log('web-monetization: VideoPaid.startSpan called before endSpan, data is lost')
      this.currentSpan = null
    }

    var next = null
    for (var i = 0; i < this.spans.length; i++) {
      if (instant < this.spans[i].start) {
        this.spans.splice(i, 0, { change: true, start: instant, end: null, paid: new Amount(false), paidUncommitted: new Amount(false) })
        this.currentSpan = this.spans[i]
        this.currentSpanIdx = i
        next = this.spans[i + 1]
        break
      } else if (instant <= this.spans[i].end) {
        this.currentSpan = this.spans[i]
        this.currentSpanIdx = i
        if (i < this.spans.length) {
          next = this.spans[i + 1]
        }
        break
      }
    }

    if (this.currentSpan == null) {
      this.spans.splice(this.spans.length, 0, { change: true, start: instant, end: null, paid: new Amount(false), paidUncommitted: new Amount(false) })
      this.currentSpanIdx = this.spans.length - 1
      this.currentSpan = this.spans[this.currentSpanIdx]
    }

    const unpaid = this.currentSpan.end == null || this.currentSpan.end == instant
    if (unpaid) {
      if (next == null) {
        return { unpaid: true, nextPaid: null }
      } else {
        return { unpaid: true, nextPaid: next.start }
      }
    } else {
      return { unpaid: false, paidEnds: this.currentSpan.end }
    }
  }

  endSpan (instant) {
    if (this.currentSpan == null) {
      console.log('web-monetization: VideoPaid.endSpan called before startSpan')
      return
    }
    /*if (this.currentSpan.paid.isEmpty() && this.currentSpan.paidUncommitted.isEmpty()) {
      this.spans.splice(this.currentSpanIdx, 1)
      this.currentSpan = null
      return
    }*/

    if (instant != null) {
      if (instant < this.currentSpan.start) {
        console.log('web-monetization: VideoPaid.endSpan called at ' + hms(instant) + ' which is earlier than span start ' + hms(this.currentSpan.start) + ', ignoring it')
      }
      if (this.currentSpan.end == null && this.currentSpan.start < instant) {
        this.sessionTime += instant - this.currentSpan.start
      } else if (this.currentSpan.end < instant) {
        this.sessionTime += instant - this.currentSpan.end
      }
      this.currentSpan.end = Math.max(this.currentSpan.end, instant)
    }
    this.currentSpan.end = Math.max(this.currentSpan.end, this.currentSpan.start)
    const nextIdx = this.currentSpanIdx + 1
    var limit = 0
    while (true) {
      if (10000 < limit) {
        console.log('web-monetization: VideoPaid.endSpan loop limit')
        break
      }
      if (nextIdx < this.spans.length) {
        var next = this.spans[nextIdx]
        if (next.start <= this.currentSpan.end + 0.001) {
          // The spans overlap, merge if `change` is same
          // if `change` differs, we merge the segments after committing change
          if (this.currentSpan.change == next.change) {
            this.currentSpan.end = next.end
            this.currentSpan.paid.moveFrom(next.paid)
            this.spans.splice(nextIdx, 1)
            continue
          }
        }
      }
      break
    }
    this.currentSpan = null
  }

  deposit (instant, significand, exponent, assetCode, receipt) {
    if (significand == 0) {
      return
    }
    this.total.depositReference(significand, exponent, assetCode, false)
    this.sessionTotal.depositReference(significand, exponent, assetCode, false)
    if (this.currentSpan == null) {
      console.log('web-monetization: VideoPaid.deposit without currentSpan')
    } else {
      this.currentSpan.paidUncommitted.deposit(significand, exponent, assetCode, false, receipt)
      this.currentSpan.change = true
      if (instant != null) {
        if (this.currentSpan.end == null) {
          if (this.currentSpan.start < instant) {
            this.sessionTime += instant - this.currentSpan.start
          }
        } else if (this.currentSpan.end < instant) {
          this.sessionTime += instant - this.currentSpan.end
        }

        if (this.currentSpan.end == null) {
          this.currentSpan.end = instant
        } else {
          this.currentSpan.end = Math.max(this.currentSpan.end, instant)
        }
      }
    }

    const bin = (instant / histogramBinSize) >> 0
    while (this.histogram.length <= bin) {
      this.histogram.push({ committed: new Amount(false), uncommitted: new Amount(false) })
    }
    // Receipt is used above, cannot be verified twice
    // TODO: may be possible to have it reference other receipt
    this.histogram[bin].uncommitted.deposit(significand, exponent, assetCode, false, null)
  }

  totalTime (instant) {
    var sum = 0
    for (const span of this.spans) {
      if (span.end != null) {
        sum += span.end - span.start
      } else if (instant != null) {
        sum += instant - span.start
      }
    }
    if (this.currentSpan != null && this.currentSpan.end != null && this.currentSpan.end < instant) {
      sum += instant - this.currentSpan.end
    }
    return sum
  }

  getSessionTime (instant) {
    if (this.currentSpan == null) {
      return this.sessionTime
    } else if (this.currentSpan.end == null) {
      return this.sessionTime + instant - this.currentSpan.start
    } else if (this.currentSpan.end < instant) {
      return this.sessionTime + instant - this.currentSpan.end
    } else {
      return this.sessionTime
    }
  }

  displayTotal () {
    return this.total.display()
  }

  display () {
    var display = ''
    for (const span of this.spans) {
      if (span.change) {
        display += hms(span.start) + ' +++> '
      } else {
        display += hms(span.start) + ' ---> '
      }
      if (span.end == null) {
        display += 'playing...'
      } else {
        display += hms(span.end, 10)
      }
      display += '    ' + span.paid.display()
      if (span.end != null) {
        display += ' (' + span.paid.displayInDuration(span.end - span.start) + ')'
      }
      display += '\n'
    }
    if (display.length == 0) {
      return 'No spans'
    } else {
      return display
    }
  }

  static generateNonce () {
    var nonce = ''
    var possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    for (var i = 0; i < 64; i++) {
      nonce += possible.charAt(Math.floor(Math.random() * possible.length))
    }
    return nonce
  }

  removeCommittedChanges (committed) {
    // committed nonce is null when only histogram (which should be changed)
    if (committed.nonce != null && committed.nonce != this.nonce) {
      throw '`VideoPaid.removeCommittedChanges` nonces differ ' + committed.nonce + ' ' + this.nonce
    }
    this.nonce = VideoPaid.generateNonce()

    var c = committed
    for (var i = 0; i < c.spans; i++) {
      var j = 0
      while (j < this.spans.length) {
        if (this.spans[j].change) {
          if ((this.spans[j].start <= c.spans[i].start && c.spans[i].start <= this.spans[j].end)
            || (this.spans[j].start <= c.spans[i].end && c.spans[i].end <= this.spans[j].end)) {
            // `c` span overlaps `this` span
            this.spans[j].paidUncommitted.subtract(c.spans[i].paidUncommitted)
            if (Math.abs(c.spans[i].start - this.spans[j].start) < 0.01) {
              // Start's are identical
              if (Math.abs(c.spans[i].end - this.spans[j].end) < 0.01) {
                // Ends are the same
                if (this.spans[j].paidUncommitted.isEmpty()) {
                  this.spans.splice(j, 1)
                // `j` stays the same
                } else {
                  // The additional payments must still be committed, leave span marked `change`
                  j++
                }
              } else {
                // Ends differ
                if (c.spans[i].end < this.spans[j].end) {
                  this.spans[j].start = c.spans[i].end
                } else {
                  throw 'Committed ends after uncommitted span'
                }
              }
            } else {
              // Starts differ
              if (this.spans[j].start < c.spans[i].start) {
                if (Math.abs(c.spans[i].end - this.spans[j].end) < 0.01) {
                  this.spans[j].end = c.spans[i].start
                } else if (c.spans[i].end < this.spans[j].end) {
                  throw 'VideoPaid unreachable 78458'
                } else {
                  throw 'VideoPaid unreachable 54899'
                }
              } else {
                throw 'Committed starts before uncommitted span'
              }
            }
          }
        }
      }
    }

    for (var i = 0; i < c.histogram.length; i++) {
      var bin = c.histogram[i]
      var amount = Amount.deserialize(bin.uncommitted)
      this.histogram[bin.bin].uncommitted.subtract(amount)
      this.histogram[bin.bin].committed.moveFrom(amount)
    }
  }

  updateState (state) {
    for (var i = 0; i < this.spans.length; i++) {
      if (this.spans[i].change == false) {
        this.spans.splice(i, 1)
        i--
      }
    }
    for (var i = 0; i < state.spans.length; i++) {
      var insertAt = null
      for (var j = 0; j < this.spans.length; j++) {
        if (state.spans[i].start < this.spans[j].start) {
          insertAt = j
          break
        }
      }
      if (insertAt == null) {
        insertAt = this.spans.length
      }
      this.spans.splice(insertAt, 0, {
        change: false,
        start: state.spans[i].start,
        end: state.spans[i].end,
        paid: state.spans[i].paid,
        paidUncommitted: new Amount(false)
      })
    }
  }

  serializeChanges (instant) {
    if (this.currentSpan != null) {
      if (this.currentSpan.end == null || this.currentSpan.end < instant) {
        this.currentSpan.end = instant
        this.currentSpan.change = true
      }
    }
    var changes = { nonce: this.nonce, spans: [], histogram: [] }
    for (var i = 0; i < this.spans.length; i++) {
      if (this.spans[i].change) {
        changes.spans.push({
          start: this.spans[i].start,
          end: this.spans[i].end,
          paidUncommitted: this.spans[i].paidUncommitted.serialize()
        })
      }
    }

    // 480 bins for a 2 hr movie
    // TODO: maybe optimzie to insanely long videos
    for (var i = 0; i < this.histogram.length; i++) {
      if (!this.histogram[i].uncommitted.isEmpty()) {
        changes.histogram.push({ bin: i, uncommitted: this.histogram[i].uncommitted.serialize() })
      }
    }

    return changes
  }

  static deserializeHistogramChanges (obj) {
    var ret = new VideoPaid()
    ret.nonce = null
    // See not about lack of deserialization below
    ret.histogram = obj
    return ret
  }

  static deserializeChanges (obj) {
    var ret = new VideoPaid()
    // We don't deserialize the histogram, as it is more useful serialized
    // just remember to deserialize the `Amount`s contained
    ret.histogram = obj.histogram
    ret.nonce = obj.nonce
    for (var i = 0; i < obj.spans.length; i++) {
      const from = obj.spans[i]
      ret.spans.push({
        change: true,
        start: from.start,
        end: from.end,
        paid: new Amount(),
        paidUncommitted: Amount.deserialize(from.paidUncommitted)
      })
    }

    return ret
  }
}

// export
class VideoPaidStorage {
  constructor () {
    this.total = new Amount(true)
    this.spans = []
  }

  async verifyReceipts (verified) {
    var verifiedStart = 0
    if (verified == null) {
      verified = []
    } else {
      verifiedStart = verified.length
    }
    for (var i = 0; i < this.spans.length; i++) {
      await this.spans[i].paid.verifyReceipts(verified)
    }
    this.total.acceptReceipts(verified.splice(verifiedStart))
  }

  serialize () {
    var ret = {
      total: this.total.serialize(),
      spans: []
    }
    for (var i = 0; i < this.spans.length; i++) {
      ret.spans.push({
        start: this.spans[i].start,
        end: this.spans[i].end,
        paid: this.spans[i].paid.serialize()
      })
    }
    return ret
  }

  static deserialize (obj) {
    var ret = new VideoPaidStorage()
    ret.total = Amount.deserialize(obj.total)
    for (var i = 0; i < obj.spans.length; i++) {
      ret.spans.push({
        start: obj.spans[i].start,
        end: obj.spans[i].end,
        paid: Amount.deserialize(obj.spans[i].paid)
      })
    }
    return ret
  }

  // Merge in changes `c` serizlized from `VideoPaid`,
  commitChanges (c) {
    // assumes that `spans` in `this` is sorted such that the spans strictly increase by `start` and do not overlap
    var changed = false
    for (var i = 0; i < c.spans.length; i++) {
      // Span is empty
      if (c.spans[i].start == c.spans[i].end && c.spans[i].paidUncommitted.isEmpty()) {
        continue
      }
      var spanMerged = false
      for (var j = 0; j < this.spans.length; j++) {
        if (c.spans[i].start < this.spans[j].start) {
          if (c.spans[i].end < this.spans[j].start) {
            // c: [#####]----------
            //  this: ---------[####]--
            // final: [#####]--[####]--
            this.spans.splice(j, 0, { start: c.spans[i].start, end: c.spans[i].end, paid: c.spans[i].paidUncommitted })
            this.total.addFrom(c.spans[i].paidUncommitted)
            spanMerged = true
            break
          } else {
            // this.spans[j].start <= c.spans[i].end
            // c: [#####]----------
            //  this: ----[####]-------
            // final: [########]-------
            this.spans[j].start = c.spans[i].start
            this.spans[j].paid.moveFromMakeReference(c.spans[i].paidUncommitted)
            this.total.addFrom(c.spans[i].paidUncommitted)
            spanMerged = true
            break
          }
        } else {
          if (this.spans[j].end < c.spans[i].start) {
            // c: ---------[#####]-
            //  this: --[####]-????????
            continue
          } else {
            // c.spans[i].start <= this.spans[j].end
            //   c: ------[#####]----
            //    this: --[####]-????????
            // final A: --[#########]----
            // final B: --[#############]
            this.spans[j].end = c.spans[i].end
            this.spans[j].paid.moveFromMakeReference(c.spans[i].paidUncommitted)
            this.total.addFrom(c.spans[i].paidUncommitted)
            // Now, we must handle a case such as:
            //   c: ------[#####]----
            //    this: --[####]-[#][###]
            // as currently, our merged segment is overlapping
            while (j + 1 < this.spans.length && this.spans[j + 1].start < this.spans[j].end) {
              this.spans[j].end = this.spans[j + 1].end
              this.spans[j].paid.moveFromMakeReference(this.spans[j + 1].paid)
              // Do not add `paid` to total as it is already accounted for
              this.spans.splice(j + 1, 1)
            }
            spanMerged = true
            break
          }
        }
      }
      if (!spanMerged) {
        // c: ---------[#####]-
        //  this: --[####]---------
        // final: --[####] [#####]-
        this.spans.push({ start: c.spans[i].start, end: c.spans[i].end, paid: c.spans[i].paidUncommitted })
        this.total.addFrom(c.spans[i].paidUncommitted)
      }
      changed = true
    }
    return changed
  }
}

function roundTo (value, places) {
  const precision = 10 ** Math.ceil(places)
  return Math.round(value * precision) / precision
}

// Currencies supported by CoinGecko. They may change them, but we would need to update the additional details anyway.
// `coinGeckoId` only listed when supported by API
const quoteCurrencies = {
  btc: { coinGeckoQuote: 'btc', coinGeckoId: 'bitcoin', network: 'Bitcoin', nameSingular: 'bitcoin', namePlural: 'bitcoins', code: 'BTC', symbol: '₿' },
  eth: { coinGeckoQuote: 'eth', coinGeckoId: 'ethereum', network: 'Ethereum', nameSingular: 'ether', namePlural: 'ether', code: 'ETH', symbol: 'Ξ' },
  ltc: { coinGeckoQuote: 'ltc', coinGeckoId: 'litecoin', network: 'Litecoin', nameSingular: 'litecoin', namePlural: 'litecoins', code: 'LTC', symbol: null },
  bch: { coinGeckoQuote: 'bch', coinGeckoId: 'bitcoin-cash', network: 'Bitcoin Cash', nameSingular: 'bitcoin cash', namePlural: 'bitcoin cash', code: 'BCH', symbol: null },
  bnb: { coinGeckoQuote: 'bnb', coinGeckoId: null, network: 'Binance coin', nameSingular: 'Binance coin', namePlural: 'Binance coins', code: 'BNB', symbol: null },
  eos: { coinGeckoQuote: 'eos', coinGeckoId: 'eos', network: 'EOS', nameSingular: 'EOS', namePlural: 'EOS', code: 'EOS', symbol: null },
  xrp: { coinGeckoQuote: 'xrp', coinGeckoId: 'ripple', network: 'RippleNet', nameSingular: 'XRP', namePlural: 'XRP', code: 'XRP', symbol: null },
  xlm: { coinGeckoQuote: 'xlm', coinGeckoId: 'stellar', network: 'Stellar', nameSingular: 'lumen', namePlural: 'lumens', code: 'XLM', symbol: null },
  link: { coinGeckoQuote: 'link', coinGeckoId: 'chainlink', network: 'Chainlink', nameSingular: 'Chainlink token', namePlural: 'Chainlink tokens', code: 'LINK', symbol: null },
  dot: { coinGeckoQuote: 'dot', coinGeckoId: 'polkadot', network: 'Polkadot', nameSingular: 'DOT', namePlural: 'DOT', code: 'DOT', symbol: null },
  yfi: { coinGeckoQuote: 'yfi', coinGeckoId: 'yearn-finance', network: 'yearn.finance', nameSingular: 'YFI', namePlural: 'YFI', code: 'YFI', symbol: null },
  usd: { coinGeckoQuote: 'usd', coinGeckoId: 'usd-coin', network: 'US dollar', nameSingular: 'dollar', namePlural: 'dollars', code: 'USD', symbol: '$' },
  aed: { coinGeckoQuote: 'aed', coinGeckoId: null, network: 'Emirati dirham', nameSingular: 'dirham', namePlural: 'dirhams', code: 'AED', symbol: 'د.إ' },
  ars: { coinGeckoQuote: 'ars', coinGeckoId: null, network: 'Argentine peso', nameSingular: 'peso', namePlural: 'pesos', code: 'ARS', symbol: '$m/n' },
  aud: { coinGeckoQuote: 'aud', coinGeckoId: null, network: 'Australian dollar', nameSingular: 'dollar', namePlural: 'dollars', code: 'AUD', symbol: 'AU$' },
  bdt: { coinGeckoQuote: 'bdt', coinGeckoId: null, network: 'Bangladeshi taka', nameSingular: 'taka', namePlural: 'takas', code: 'BDT', symbol: '৳' },
  bhd: { coinGeckoQuote: 'bhd', coinGeckoId: null, network: 'Bahraini dinar', nameSingular: 'dinar', namePlural: 'dinars', code: 'BHD', symbol: 'BD ' },
  bmd: { coinGeckoQuote: 'bmd', coinGeckoId: null, network: 'Bermudan dollar', nameSingular: 'dollar', namePlural: 'dollars', code: 'BMD', symbol: 'BD$' },
  brl: { coinGeckoQuote: 'brl', coinGeckoId: null, network: 'Brailian real', nameSingular: 'real', namePlural: 'reals', code: 'BRL', symbol: 'R$' },
  cad: { coinGeckoQuote: 'cad', coinGeckoId: null, network: 'Canadian dollar', nameSingular: 'dollar', namePlural: 'dollars', code: 'CAD', symbol: 'CA$' },
  chf: { coinGeckoQuote: 'chf', coinGeckoId: null, network: 'Swiss Franc', nameSingular: 'franc', namePlural: 'francs', code: 'CHF', symbol: 'CHF ' },
  clp: { coinGeckoQuote: 'clp', coinGeckoId: null, network: 'Chilean peso', nameSingular: 'peso', namePlural: 'pesos', code: 'CLP', symbol: 'CLP$' },
  cny: { coinGeckoQuote: 'cny', coinGeckoId: null, network: 'Renminbi', nameSingular: 'yuan', namePlural: 'yuan', code: 'CNY', symbol: 'CN¥' },
  czk: { coinGeckoQuote: 'czk', coinGeckoId: null, network: 'Czech koruna', nameSingular: 'koruna', namePlural: 'korunas', code: 'CZK', symbol: 'Kč ' },
  dkk: { coinGeckoQuote: 'dkk', coinGeckoId: null, network: 'Danish krone', nameSingular: 'krone', namePlural: 'kroner', code: 'DKK', symbol: 'kr.' },
  eur: { coinGeckoQuote: 'eur', coinGeckoId: null, network: 'Euro', nameSingular: 'Euro', namePlural: 'Euros', code: 'EUR', symbol: '€' },
  gbp: { coinGeckoQuote: 'gbp', coinGeckoId: null, network: 'British Pound', nameSingular: 'Pound', namePlural: 'Pounds', code: 'GBP', symbol: '£' },
  hkd: { coinGeckoQuote: 'hkd', coinGeckoId: null, network: 'Hong Kong dollar', nameSingular: 'dollar', namePlural: 'dollars', code: 'HKD', symbol: 'HK$' },
  /*  huf: { coinGeckoQuote: '', coinGeckoId: null, network: '', nameSingular: '', namePlural: '', code: null, symbol: null },
    idr: { coinGeckoQuote: '', coinGeckoId: null, network: '', nameSingular: '', namePlural: '', code: null, symbol: null },
    ils: { coinGeckoQuote: '', coinGeckoId: null, network: '', nameSingular: '', namePlural: '', code: null, symbol: null },
    inr: { coinGeckoQuote: '', coinGeckoId: null, network: '', nameSingular: '', namePlural: '', code: null, symbol: null },
    jpy: { coinGeckoQuote: '', coinGeckoId: null, network: '', nameSingular: '', namePlural: '', code: null, symbol: null },
    krw: { coinGeckoQuote: '', coinGeckoId: null, network: '', nameSingular: '', namePlural: '', code: null, symbol: null },
    kwd: { coinGeckoQuote: '', coinGeckoId: null, network: '', nameSingular: '', namePlural: '', code: null, symbol: null },
    lkr: { coinGeckoQuote: '', coinGeckoId: null, network: '', nameSingular: '', namePlural: '', code: null, symbol: null },
    mmk: { coinGeckoQuote: '', coinGeckoId: null, network: '', nameSingular: '', namePlural: '', code: null, symbol: null },
    mxn: { coinGeckoQuote: '', coinGeckoId: null, network: '', nameSingular: '', namePlural: '', code: null, symbol: null },
    myr: { coinGeckoQuote: '', coinGeckoId: null, network: '', nameSingular: '', namePlural: '', code: null, symbol: null },
    ngn: { coinGeckoQuote: '', coinGeckoId: null, network: '', nameSingular: '', namePlural: '', code: null, symbol: null },
    nok: { coinGeckoQuote: '', coinGeckoId: null, network: '', nameSingular: '', namePlural: '', code: null, symbol: null },
    nzd: { coinGeckoQuote: '', coinGeckoId: null, network: '', nameSingular: '', namePlural: '', code: null, symbol: null },
    php: { coinGeckoQuote: '', coinGeckoId: null, network: '', nameSingular: '', namePlural: '', code: null, symbol: null },
    pkr: { coinGeckoQuote: '', coinGeckoId: null, network: '', nameSingular: '', namePlural: '', code: null, symbol: null },
    pln: { coinGeckoQuote: '', coinGeckoId: null, network: '', nameSingular: '', namePlural: '', code: null, symbol: null },
    rub: { coinGeckoQuote: '', coinGeckoId: null, network: '', nameSingular: '', namePlural: '', code: null, symbol: null },
    sar: { coinGeckoQuote: '', coinGeckoId: null, network: '', nameSingular: '', namePlural: '', code: null, symbol: null },
    sek: { coinGeckoQuote: '', coinGeckoId: null, network: '', nameSingular: '', namePlural: '', code: null, symbol: null },
    sgd: { coinGeckoQuote: '', coinGeckoId: null, network: '', nameSingular: '', namePlural: '', code: null, symbol: null },
    thb: { coinGeckoQuote: '', coinGeckoId: null, network: '', nameSingular: '', namePlural: '', code: null, symbol: null },
    'try': { coinGeckoQuote: '', coinGeckoId: null, network: '', nameSingular: '', namePlural: '', code: null, symbol: null },
    twd: { coinGeckoQuote: '', coinGeckoId: null, network: '', nameSingular: '', namePlural: '', code: null, symbol: null },
    uah: { coinGeckoQuote: '', coinGeckoId: null, network: '', nameSingular: '', namePlural: '', code: null, symbol: null },
    vef: { coinGeckoQuote: '', coinGeckoId: null, network: '', nameSingular: '', namePlural: '', code: null, symbol: null },
    vnd: { coinGeckoQuote: '', coinGeckoId: null, network: '', nameSingular: '', namePlural: '', code: null, symbol: null },
    zar: { coinGeckoQuote: '', coinGeckoId: null, network: '', nameSingular: '', namePlural: '', code: null, symbol: null },
    xdr: { coinGeckoQuote: '', coinGeckoId: null, network: '', nameSingular: '', namePlural: '', code: null, symbol: null },
    xag: { coinGeckoQuote: '', coinGeckoId: null, network: '', nameSingular: '', namePlural: '', code: null, symbol: null },
    xau: { coinGeckoQuote: '', coinGeckoId: null, network: '', nameSingular: '', namePlural: '', code: null, symbol: null },
    bits: { coinGeckoQuote: 'bits', coinGeckoId: null, network: '', nameSingular: '', namePlural: '', code: null, symbol: null },*/
  sats: { coinGeckoQuote: 'sats', coinGeckoId: null, network: 'Satoshi', nameSingular: 'Satoshi', namePlural: 'Satoshis', code: 'sat', symbol: null }
}

// I've only seen XRP, include others mentioned on the Interledger GitHub page, excluding EUR as it needs a trustworthy stablecoin on CoinGecko
const interledgerCurrencies = {
  xrp: quoteCurrencies['xrp'],
  btc: quoteCurrencies['btc'],
  eth: quoteCurrencies['eth'],
  // CoinGecko id is of currency pegged to dollar, though not actual dollar
  usd: quoteCurrencies['usd']

}

class Exchange {
  constructor (apiEndpoint) {
    // TODO: Proxy client requests through server, so we don't use their API so much
    this.apiEndpoint = 'https://api.coingecko.com/api' // apiEndpoint
    this.assets = new Map()
  }

  static currencyFromInterledgerCode (assetCode) {
    return interledgerCurrencies[assetCode.toLowerCase()]
  }

  async getPrice (base, quote) {
    var inverse = false
    if (base.coinGeckoId == null) {
      if (quote.coinGeckoId != null && base.coinGeckoQuote != null) {
        inverse = !inverse
        const tmp = quote
        quote = base
        base = tmp
      } else {
        throw 'Base currency not supported'
      }
    }
    if (quote.coinGeckoQuote == null) {
      if (quote.coinGeckoId != null && base.coinGeckoQuote != null) {
        inverse = !inverse
        const tmp = quote
        quote = base
        base = tmp
      } else {
        throw 'Quote currency not supported'
      }
    }

    var baseData = null
    if (this.assets.has(base)) {
      baseData = this.assets.get(base)
    } else {
      if (this.assets.has(quote) && quote.coinGeckoId != null && base.coinGeckoQuote != null) {
        var quoteData = this.assets.get(quote)
        var inversePrice = quoteData.get(base)
        if (inversePrice != null) {
          inverse = !inverse
          const tmp = quote
          quote = base
          base = tmp
          baseData = quoteData
        }
      }

      if (baseData == null) {
        this.assets.set(base, new Map())
        baseData = this.assets.get(base)
      }
    }
    if (!baseData.has(quote)) {
      baseData.set(quote, { price: 0.0, lastUpdate: null })
    }
    var price = baseData.get(quote)

    if (price.lastUpdate == null || 4 * 3600 * 1000 < Date.now() - price.lastUpdate) {
      var res = await fetch(this.apiEndpoint + '/v3/simple/price?ids=' + base.coinGeckoId + '&vs_currencies=' + quote.coinGeckoQuote, {
        method: 'GET',
        headers: { accept: 'application/json' }
      })
      const resData = await res.json()
      if (resData[base.coinGeckoId] == null || resData[base.coinGeckoId][quote.coinGeckoQuote] == null) {
        console.error(resData)
        throw 'web-monetization: paid.js Exchange: API bad'
      }
      price.price = resData[base.coinGeckoId][quote.coinGeckoQuote]
      price.lastUpdate = Date.now()
    }

    if (inverse) {
      return 1 / price.price
    } else {
      return price.price
    }
  }
}

module.exports = {
  Amount,
  Receipts,
  VideoPaid,
  VideoPaidStorage,
  quoteCurrencies,
Exchange}
