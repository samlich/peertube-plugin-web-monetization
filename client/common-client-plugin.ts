import { RegisterClientHelpers, RegisterClientOptions } from '@peertube/peertube-types/client'
import interval from 'interval-promise'
import { Amount, Exchange, quoteCurrencies } from 'shared/paid'
import { MonetizationStatusBulkPost, MonetizationStatusBulkPostRes, MonetizationStatusBulkStatus } from 'shared/api'

var ptHelpers: RegisterClientHelpers | null = null
var exchange = new Exchange()
var displayCurrency = quoteCurrencies['usd']

export function register ({ peertubeHelpers }: RegisterClientOptions) {
  ptHelpers = peertubeHelpers
  interval(async () => await populateBadges(), 2500, { stopOnError: false })
}

var monetizationStatus: Record<string, MonetizationStatusBulkStatus> = {}

async function populateBadges (recurse: boolean = false): Promise<void> {
  if (ptHelpers == null) {
    console.error("`populateBadges` without `peertubeHelpers`")
    return
  }

  const names = document.getElementsByClassName('video-miniature-name')

  var fetchMonetizationStatus: string[] = []

  for (var i = 0; i < names.length; i++) {
    if (names[i].classList.contains('web-monetization-badge-checked')) {
      continue
    }
    // Price labels may wrap to second line
    // names[i].setAttribute('style', 'maxHeight:3emw')
    var link
    // older versions use `<a>`, newer versions user `<my-link>` with an `<a>` child
    if (names[i].tagName.toLowerCase() == 'a') {
      link = names[i]
    } else {
      const children = names[i].getElementsByTagName('a')
      if (children.length != 0) {
        link = children[0]
      } else {
        continue
      }
    }
    
    const dest = link.getAttribute('href')
    if (dest == null) {
      continue
    }
    const videoUuid = dest.substring(dest.lastIndexOf('/') + 1)
    const status = monetizationStatus[videoUuid]
    if (status == null) {
      fetchMonetizationStatus.push(videoUuid)
      continue
    }
    
    if (status.monetization == 'monetized' || status.monetization == 'ad-skip' || status.monetization == 'pay-wall') {
      var badge = document.createElement('img')
      badge.setAttribute('style', 'padding-left:0.5em;height:1.5em;')
      if (status.monetization == 'monetized') {
        badge.src = ptHelpers.getBaseStaticRoute() + '/images/wm-icon.svg'
        badge.title = 'Monetized'
      }
      if (status.monetization == 'ad-skip') {
        badge.src = ptHelpers.getBaseStaticRoute() + '/images/webmon_icon.svg'
        badge.title = 'Monetized (ad-skip)'
      }
      if (status.monetization == 'pay-wall') {
        badge.src = ptHelpers.getBaseStaticRoute() + '/images/webmon_icon.svg'
        badge.title = 'Pay-wall'
      }
      link.append(badge)
    }
    
    if (status.monetization == 'pay-wall') {
      var costTag = document.createElement('span')
      costTag.setAttribute('style', 'padding-left:0.5em;height:1.5em;font-size:0.95em;')
  
      if (status.viewCost != null && status.duration != null && status.currency != null ) {
        var costAmount = new Amount(true)
        // 600 to convert from per 10 min to per second
        var significand = status.viewCost / 600 * status.duration
        var exponent = 0
        while (significand * 0.001 < Math.abs(significand - (significand >> 0))) {
          significand *= 10
          exponent -= 1
        }
        significand >>= 0
        costAmount.depositUnchecked(significand, exponent, status.currency, true, null)

        var paidConverted = null
        if (status.paid != null) {
          try {
            const paid = Amount.deserialize(status.paid)
            paidConverted = await paid.inCurrency(exchange, quoteCurrencies[status.currency.toLowerCase()])
          } catch (e) {
            console.error(e)
          }
        }
        costTag.innerText = ''
        if (paidConverted != null && !paidConverted.isEmpty()) {
          costTag.innerText = paidConverted.display() + '/'
        }
        costTag.innerText += costAmount.display()

        if (displayCurrency.code.toLowerCase() != status.currency.toLowerCase()) {
          var exchanged = null
          try {
            exchanged = await costAmount.inCurrency(exchange, displayCurrency)
          } catch (e) {
            console.error(e)
          }
          if (exchanged != null) {
            costTag.innerText += ' (' + exchanged.display() + ')'
          }
        }
      }

      link.append(costTag)
    }
    names[i].classList.add('web-monetization-badge-checked')
  }

  if (0 < fetchMonetizationStatus.length) {
    var route = ptHelpers.getBaseStaticRoute()
    route = route.slice(0, route.lastIndexOf('/') + 1) + 'router/monetization_status_bulk'

    var headers: Record<string, string> = {}
    // needed for checking if video is already paid for
    var tryHeaders = ptHelpers.getAuthHeader()
    if (tryHeaders != null) {
      headers = tryHeaders
    }
    headers['content-type'] = 'application/json; charset=utf-8'

    fetch(route, {
      method: 'POST',
      headers,
      body: JSON.stringify({ videos: fetchMonetizationStatus })
    }).then(res => res.json())
      .then((data: MonetizationStatusBulkPostRes) => {
        for (const key in data.statuses) {
          monetizationStatus[key] = data.statuses[key]
        }
        if (!recurse) {
          populateBadges(true)
        }
      })
  }
}
