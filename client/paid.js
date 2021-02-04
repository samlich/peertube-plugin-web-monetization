import { hms } from './common.js'

var sawReceipt = false

export class Amount {
  constructor () {
    this.assets = new Map()
  }

  // Note that this assetScale
  deposit (significand, exponent, assetCode, receipt) {
    // Receipt validation is not implemented yet as the Coil plugin does not provide receipts at the moment
    if (receipt != null && !sawReceipt) {
      sawReceipt = true
      console.log('web-monetization: Received receipt from client')
    }

    if (!this.assets.has(assetCode)) {
      this.assets.set(assetCode, { significand: 0, exponent: exponent })
    }
    var dest = this.assets.get(assetCode)
    if (exponent < dest.exponent) {
      dest.amount *= 10 ** (exponent - dest.exponent)
      dest.exponent = exponent
    }
    dest.significand += significand * 10 ** (dest.exponent - exponent)
  }

  merge (other) {
    for (const [assetCode, { significand, exponent }] of other.assets) {
      this.deposit(significand, exponent, assetCode, null)
    }
    other.assets = new Map()
  }

  xrp () {
    const xrp = this.assets.get('XRP')
    if (xrp == null) {
      return 0
    }else {
      return xrp.significand * 10 ** xrp.exponent
    }
  }

  isEmpty () {
    for (const [assetCode, { significand, exponent }] of this.assets) {
      if (significand != 0) {
        return false
      }
    }
    return true
  }

  displayInDuration (duration) {
    return this.display(duration)
  }

  display (duration) {
    var display = ''
    var first = true
    for (const [assetCode, { significand, exponent }] of this.assets) {
      if (!first) {
        display += ', '
      }
      first = false
      if (duration != null) {
        const rate = significand * 10 ** exponent / duration
        if (0.01 < rate) {
          display += roundTo(rate, 8) + ' ' + assetCode + '/s'
        }else {
          const rounded = roundTo(rate, 5 + -exponent)
          display += rounded.toExponential() + ' ' + assetCode + '/s'
        }
      }else {
        const amount = significand * 10 ** exponent
        if (0.01 < amount) {
          display += roundTo(amount, 8) + ' ' + assetCode
        }else {
          const rounded = roundTo(amount, 5 + -exponent)
          display += rounded.toExponential() + ' ' + assetCode
        }
      }
    }

    if (display.length == 0) {
      return '0'
    }else {
      return display
    }
  }
}

export class VideoPaid {
  constructor () {
    this.total = new Amount()
    this.currentSpan = null
    this.currentSpanIdx = null
    this.spans = []
  }

  startSpan (instant) {
    if (this.currentSpan != null) {
      console.log('web-monetization: VideoPaid.startSpan called before endSpan, data is lost')
      this.currentSpan = null
    }

    var next = null
    for (var i = 0; i < this.spans.length; i++) {
      if (instant < this.spans[i].start) {
        this.spans.splice(i, 0, { start: instant, end: null, paid: new Amount() })
        this.currentSpan = this.spans[i]
        this.currentSpanIdx = i
        next = this.spans[i + 1]
        break
      }else if (instant <= this.spans[i].end) {
        this.currentSpan = this.spans[i]
        this.currentSpanIdx = i
        if (i < this.spans.length) {
          next = this.spans[i + 1]
        }
        break
      }
    }

    if (this.currentSpan == null) {
      this.spans.splice(this.spans.length, 0, { start: instant, end: null, paid: new Amount() })
      this.currentSpanIdx = this.spans.length - 1
      this.currentSpan = this.spans[this.currentSpanIdx]
    }

    const unpaid = this.currentSpan.end == null || this.currentSpan.end == instant
    if (unpaid) {
      if (next == null) {
        return { unpaid: true, nextPaid: null }
      }else {
        return { unpaid: true, nextPaid: next.start }
      }
    }else {
      return { unpaid: false, paidEnds: this.currentSpan.end }
    }
  }

  endSpan (instant) {
    if (this.currentSpan == null) {
      console.log('web-monetization: VideoPaid.endSpan called before startSpan')
      return
    }
    if (this.currentSpan.paid.isEmpty()) {
      this.spans.splice(this.currentSpanIdx, 1)
      this.currentSpan = null
      return
    }

    if (instant != null) {
      if (instant < this.currentSpan.start) {
        console.log('web-monetization: VideoPaid.endSpan called at ' + hms(instant) + ' which is earlier than span start ' + hms(this.currentSpan.start) + ', ignoring it')
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
          this.currentSpan.end = next.end
          this.currentSpan.paid.merge(next.paid)
          this.spans.splice(nextIdx, 1)
          continue
        }
      }
      break
    }
    this.currentSpan = null
  }

  deposit (instant, significand, exponent, assetCode, receipt) {
    this.total.deposit(significand, exponent, assetCode, receipt)
    if (this.currentSpan == null) {
      console.log('web-monetization: VideoPaid.deposit without currentSpan')
    }else {
      this.currentSpan.paid.deposit(significand, exponent, assetCode, receipt)
      if (instant != null) {
        this.currentSpan.end = Math.max(this.currentSpan.end, instant)
      }
    }
  }

  totalTime (instant) {
    var sum = 0
    for (const span of this.spans) {
      if (span.end != null) {
        sum += span.end - span.start
      }else if (instant != null) {
        sum += instant - span.start
      }
    }
    return sum
  }

  displayTotal () {
    return this.total.display()
  }

  display () {
    var display = ''
    for (const span of this.spans) {
      display += hms(span.start) + ' ---> '
      if (span.end == null) {
        display += 'playing...'
      }else {
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
    }else {
      return display
    }
  }
}

function roundTo (value, places) {
  const precision = 10 ** Math.ceil(places)
  return Math.round(value * precision) / precision
}
