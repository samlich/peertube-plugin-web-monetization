import { VideoPaid, VideoPaidStorage, Amount, Exchange, quoteCurrencies } from './paid.js'
import interval from 'interval-promise'

var ptHelpers = null
var exchange = new Exchange()
var displayCurrency = quoteCurrencies['usd']

function register ({ registerHook, peertubeHelpers }) {
  ptHelpers = peertubeHelpers
  interval(populateBadges, 2500, { stopOnError: false })
}

var monetizationStatus = {}

async function populateBadges (recurse) {
  const names = document.getElementsByClassName('video-miniature-name')

  var fetchMonetizationStatus = []
  
  for (var i = 0; i < names.length; i++) {
    if (names[i].classList.contains('web-monetization-badge-checked')) {
      continue
    }
    // Price labels may wrap to second line
    names[i].style.maxHeight = '3em';
    if (names[i].tagName.toLowerCase() == 'a') {
      const dest = names[i].href
      const videoUuid = dest.substring(dest.lastIndexOf('/') + 1)
      if (monetizationStatus[videoUuid] != null ) {
          var badge = document.createElement('img')
          badge.style = 'padding-left:0.5em;height:1.5em;'
        if (monetizationStatus[videoUuid].monetization == 'monetized') {
          badge.src = ptHelpers.getBaseStaticRoute() + '/images/wm-icon.svg'
          badge.title = 'Monetized'
        }
        if (monetizationStatus[videoUuid].monetization == 'ad-skip') {
          badge.src = ptHelpers.getBaseStaticRoute() + '/images/webmon_icon.svg'
          badge.title = 'Monetized (ad-skip)'
        }
        if (monetizationStatus[videoUuid].monetization == 'pay-wall') {
          badge.src = ptHelpers.getBaseStaticRoute() + '/images/webmon_icon.svg'
          badge.title = 'Pay-wall'
        }
        names[i].append(badge)
        if (monetizationStatus[videoUuid].monetization == 'pay-wall') {
          var costTag = document.createElement('span')
          costTag.style = 'padding-left:0.5em;height:1.5em;font-size:0.95em;'
          var costAmount = new Amount(true)
          // 600 to convert from per 10 min to per second
          var significand = monetizationStatus[videoUuid].viewCost / 600 * monetizationStatus[videoUuid].duration
          var exponent = 0
          while (significand * 0.001 < Math.abs(significand - (significand >> 0))) {
            significand *= 10
            exponent -= 1
          }
          significand >>= 0
          costAmount.depositUnchecked(significand, exponent, monetizationStatus[videoUuid].currency, true, null)

          var paidConverted = null
          if (monetizationStatus[videoUuid].paid != null) {
            try {
              const paid = Amount.deserialize(monetizationStatus[videoUuid].paid)
              paidConverted = await paid.inCurrency(exchange, quoteCurrencies[monetizationStatus[videoUuid].currency.toLowerCase()])
            } catch(e) {
              console.error(e)
            }
          }
          costTag.innerText = ''
          if (paidConverted != null && !paidConverted.isEmpty()) {
            costTag.innerText = paidConverted.display() + '/'
          }
          costTag.innerText += costAmount.display()

          if (displayCurrency.code.toLowerCase() != monetizationStatus[videoUuid].currency.toLowerCase()) {
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
          
          names[i].append(costTag)
        }
        names[i].classList.add('web-monetization-badge-checked')
      } else {
        fetchMonetizationStatus.push(videoUuid)
      }
    }
  }

  if (0 < fetchMonetizationStatus.length) {
    var route = ptHelpers.getBaseStaticRoute()
    route = route.slice(0, route.lastIndexOf('/') + 1)+'router/monetization_status_bulk'

    var headers = {}
    if (ptHelpers != null) {
      // needed for checking if video is already paid for
      headers = ptHelpers.getAuthHeader()
    }
    if (headers == null) {
      headers = {}
    }
    headers['content-type'] = 'application/json; charset=utf-8'
    
    fetch(route, {
      method: 'POST',
      headers,
      body: JSON.stringify({ videos: fetchMonetizationStatus })
    }).then(res => res.json())
      .then(data => {
        for (const key in data.statuses) {
          monetizationStatus[key] = data.statuses[key]
        }
        if (!recurse) {
          populateBadges(true)
        }
      })
  }

}

export {
  register
}
