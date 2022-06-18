import type { VideoDetails } from '@peertube/peertube-types'
import type { RegisterClientOptions, RegisterClientHelpers } from '@peertube/peertube-types/client'
import { MonetizationExtendedDocument, MonetizationProgressEvent } from '@webmonetization/types'
import interval from 'interval-promise'
import videojs from 'video.js'
import * as Plotly from 'plotly.js-finance-dist-min'
import { adSkipCostField, currencyField, hms, paymentPointerField, receiptServiceField, version, viewCostField } from 'shared/common'
import { Amount, Exchange, quoteCurrencies, Currency, Receipts, VideoPaid, VideoPaidStorage, SerializedState, SerializedHistogramBinUncommitted } from 'shared/paid'
import { StatsViewPost, StatsHistogramUpdatePost } from 'shared/api'

const tableOfContentsField = 'table-of-contents_parsed'

function getDocument() {
    return document as unknown as MonetizationExtendedDocument
}
const doc = getDocument()

var ptHelpers: RegisterClientHelpers | null = null
var baseStaticRoute: string
var paid = new VideoPaid()
var receipts = new Receipts()
var exchange = new Exchange()
var displayCurrency = quoteCurrencies['usd']
var paymentPointer: string | null
var videoQuoteCurrency: string
var videoQuoteCurrencyObj: Currency
var viewCost = 0
var adSkipCost = 0

var unpaid = true
var paidEnds: number | null = null
var nextPaid: number | null = null

var play = false
var monetized = false
var seeking = false
// `videoEl.currentTime` after `seeked` event is thrown
var lastSeek: number | null = null

type Chapters = {
  chapters: Chapter[],
  description: string | null,
  end: null,
};
type Chapter = {
  start: number,
  end: number,
  name: string,
  tags: {
    sponsor?: boolean,
    selfPromotion?: boolean,
    interactionReminder?: boolean,
    intro?: boolean,
    intermission?: boolean,
    outro?: boolean,
    credits?: boolean,
    nonMusic?: boolean,
  }
};
var chapters: Chapters | null = null
var chaptersTrack: TextTrack | null = null
var videoEl: HTMLVideoElement
var videoId: number

var statsTracking = true

// `peertubeHelpers` is not available for `embed`
export function register ({ registerHook, peertubeHelpers }: RegisterClientOptions) {
  ptHelpers = peertubeHelpers
  if (ptHelpers != null) {
    baseStaticRoute = ptHelpers.getBaseStaticRoute()
  }

  registerHook({
    target: 'action:video-watch.player.loaded',
    handler: ({ player, video }: { player: videojs.Player, video: VideoDetails }) => {
      setup(player, video)
    }
  })
  registerHook({
    target: 'action:embed.player.loaded',
    handler: ({ player, video }: { player: videojs.Player, video: VideoDetails }) => {
      // `peertubeHelpers` is not available for embed, make best attempt at getting base route
      // `originInstanceUrl` also doesn't exist for embedded videos
      // baseStaticRoute = video.originInstanceUrl + '/plugins/web-monetization/' + version + '/router'
      baseStaticRoute = video.channel.url
      baseStaticRoute = baseStaticRoute!.slice(0, baseStaticRoute!.lastIndexOf('/'))
      baseStaticRoute = baseStaticRoute.slice(0, baseStaticRoute.lastIndexOf('/'))
      baseStaticRoute += '/plugins/web-monetization/' + version + '/router'
      setup(player, video)
    }
  })

  function setup (player: videojs.Player, video: VideoDetails) {
    if (!video.pluginData || !video.pluginData[paymentPointerField]) {
      console.log('web-monetization: Not enabled for this video.')
      return
    }
    videoId = video.id
    paymentPointer = video.pluginData[paymentPointerField]
    if (paymentPointer != null && (video.pluginData[receiptServiceField] == true || video.pluginData[receiptServiceField] == 'true')) {
      paymentPointer = '$webmonetization.org/api/receipts/' + encodeURIComponent(paymentPointer)
    }

    videoQuoteCurrency = video.pluginData[currencyField] || 'USD'
    videoQuoteCurrencyObj = quoteCurrencies[videoQuoteCurrency!.toLowerCase()]
    if (videoQuoteCurrencyObj == null) {
      videoQuoteCurrency = 'USD'
      videoQuoteCurrencyObj = quoteCurrencies[videoQuoteCurrency!.toLowerCase()]
    }

    if (video.pluginData[viewCostField] != null && !isNaN(parseFloat(video.pluginData[viewCostField]))) {
      // 600 to convert from per 10 min to per second
      viewCost = parseFloat(video.pluginData[viewCostField]) / 600
    }
    if (video.pluginData[adSkipCostField] != null && !isNaN(parseFloat(video.pluginData[adSkipCostField]))) {
      // 600 to convert from per 10 min to per second
      adSkipCost = parseFloat(video.pluginData[adSkipCostField]) / 600
    }
    console.log('web-monetization: paymentPointer: ' + paymentPointer + ' viewCost: ' + viewCost + ' adSkipCost: ' + adSkipCost + ' currency: ' + videoQuoteCurrency)

    chapters = video.pluginData[tableOfContentsField]
    if (chapters == null) {
      console.log('web-monetization: No chapter information from peertube-plugin-chapters plugin data, sponsor skipping not possible.')
    }

    videoEl = player.el().getElementsByTagName('video')[0]
    if (doc.monetization === undefined) {
      console.log('peertube-plugin-web-monetization v', version, ' enabled on server, but Web Monetization not supported by user agent. See https://webmonetization.org.')
      if (0 < viewCost) {
        console.log('web-monetization: Web Monetization not supported by user agent, but viewCost is ' + viewCost + ' cannot view video')
        enforceViewCost().then(() => {
        })
      }
      return
    }

    console.log('peertube-plugin-web-monetization v', version, ' detected Web Monetization support. Setting up...')

    // Indicates that Web Monetization is enabled
    doc.monetization.addEventListener(
      'monetizationpending',
      () => {
        // const { paymentPointer, requestId } = event.detail
      }
    )

    // First non-zero payment has been sent
    doc.monetization.addEventListener(
      'monetizationstart',
      () => {
        // const { paymentPointer, requestId } = event.detail
        monetized = true
        // If start occures mid-segment
        cueChange()
      }
    )

    // Monetization end
    doc.monetization.addEventListener(
      'monetizationstop',
      () => {
        /*
        const {
          paymentPointer,
          requestId,
          finalized // if `requestId` will not be used again
        } = event.detail
        */
        monetized = false
      }
    )

    // A payment (including first payment) has been made
    doc.monetization.addEventListener(
      'monetizationprogress',
      (event: MonetizationProgressEvent) => {
        const {
          // paymentPointer,
          // requestId,
          amount, assetCode, assetScale, receipt } = event.detail

        var instant: number | null = videoEl.currentTime
        if (seeking) {
          // If we are seeking, there is no guarantee whether the time reported is before or after the seek operation
          instant = null
        }
        var receiptNumber = null
        if (receipt != null) {
          receiptNumber = receipts.toCheck(receipt)
        }
        paid.deposit(instant, parseInt(amount), -assetScale, assetCode, receiptNumber)
      }
    )

    // Normal state changes
    videoEl.addEventListener('play', () => {
      play = true
      // Update timer
      updateSpan()
      enableMonetization()
    })
    videoEl.addEventListener('pause', () => {
      play = false
      disableMonetization()
    })
    videoEl.addEventListener('ended', () => {
      play = false
      disableMonetization()
    })

    videoEl.addEventListener('ratechange', () => {
      // Update timer
      updateSpan()
    })
    var preSeekTime: number | null = null
    videoEl.addEventListener('timeupdate', () => {
      if (!seeking) {
        preSeekTime = videoEl.currentTime
      }
    })
    videoEl.addEventListener('seeking', () => {
      seeking = true
      if (preSeekTime != null && paid.currentSpan != null) {
        // Seems to give time after seeking finished sometimes
        // paid.endSpan(videoEl.currentTime)
        // `seeking` event is triggered when skipping a segment, in which case the
        // span will have already been ended, and a new one started after the `preSeekTime`
        if (paid.currentSpan.start <= preSeekTime) {
          paid.endSpan(preSeekTime)
        }
        preSeekTime = null
      }
      paidEnds = null
      nextPaid = null
    })
    videoEl.addEventListener('seeked', () => {
      lastSeek = videoEl.currentTime
      seeking = false
      cueChange()
      updateSpan()
    })

    // State changes due to loading
    videoEl.addEventListener('playing', () => {
      if (play) {
        // Update timer
        updateSpan()
        enableMonetization()
      }
    })
    videoEl.addEventListener('waiting', () => {
      disableMonetization()
    })

    function textTracksUpdate () {
      const tracks = player.remoteTextTracks()
      for (var i = 0; i < tracks.length; i++) {
        var track = tracks[i]
        if (track.kind == 'chapters') {
          chaptersTrack = track
          track.addEventListener('cuechange', () => {
            if (videoEl != null && videoEl.seeking) {
              // Will be called by `seeked` event, otherwise we can miss the change in positon
              // and skip a segment that the user clicked on
              return
            } else {
              cueChange()
            }
          })
          console.log('web-monetization: Chapter cue track appears. Plugin data also available: ' + (chapters != null))
          return
        }
      }

      if (chaptersTrack != null) {
        chaptersTrack.removeEventListener('cuechange', cueChange)
      }
      chaptersTrack = null
    }

    player.remoteTextTracks().addEventListener('addtrack', textTracksUpdate)
    player.remoteTextTracks().addEventListener('removetrack', textTracksUpdate)
    textTracksUpdate()

    if (player.hasStarted()) {
      updateSpan()
    }

    enforceViewCost().then(() => {
    })

    window.setInterval(pushViewedSegments, 10 * 1000)

    var videoActionsMatches = doc.getElementsByClassName('video-actions')
    var videoDescriptionMatches = doc.getElementsByClassName('video-info-description')
    if (videoActionsMatches.length < 1 || videoDescriptionMatches.length < 1) {
      console.error('web-monetization: Failed to add stats panel')
    } else {
      var actions = videoActionsMatches[0]
      var description = videoDescriptionMatches[0]

      var statsPanel = doc.createElement('div')
      statsPanel.style.display = 'none'

      var currencySelect = doc.createElement('select')
      currencySelect.classList.add('peertube-button')
      currencySelect.classList.add('grey-button')
      currencySelect.setAttribute('style', 'margin-top:0.5em;margin-bottom:0.5em;margin-right:0.5em;')
      
      var foundDisplayCurrency = false
      var commonCurrencies = ['usd', 'eur', 'xrp']
      for (var i = 0; i < commonCurrencies.length; i++) {
        const currency = quoteCurrencies[commonCurrencies[i]]
        var option = doc.createElement('option')
        option.innerText = currency.code + ' ' + currency.network
        option.value = currency.code
        currencySelect.appendChild(option)
        if (currency.code == displayCurrency.code) {
          currencySelect.selectedIndex = i
          foundDisplayCurrency = true
        }
      }
      
      var option = doc.createElement('option')
      option.innerText = '================'
      option.value = 'USD'
      currencySelect.appendChild(option)
      
      var codes = Object.keys(quoteCurrencies)
      for (var i = 0; i < codes.length; i++) {
        const currency = quoteCurrencies[codes[i]]
        var option = doc.createElement('option')
        option.innerText = currency.code + ' ' + currency.network
        option.value = currency.code
        currencySelect.appendChild(option)
        if (currency.code == displayCurrency.code && !foundDisplayCurrency) {
          currencySelect.selectedIndex = i
        }
      }
      currencySelect.addEventListener('change', function () {
        var assetCode = this.value
        var currency = quoteCurrencies[assetCode.toLowerCase()]
        if (currency != null) {
          displayCurrency = currency
        }
      })
      statsPanel.appendChild(currencySelect)

      var optOut = doc.createElement('button')
      optOut.classList.add('peertube-button')
      optOut.classList.add('grey-button')
      optOut.textContent = 'Opt-out and delete data'
      optOut.addEventListener('click', function () {
        var headers: Record<string, string> | null = null
        if (ptHelpers != null) {
          headers = ptHelpers.getAuthHeader() || null
        }
        if (headers == null) {
          if (statsTracking) {
            statsTracking = false
            alert('You are not logged in. Stats tracking disabled for this page. (No individualized data is stored)')
            optOut.textContent = 'Opt-in to stats tracking'
          } else {
            statsTracking = true
            optOut.textContent = 'Opt-out and delete data'
          }
        } else {
          headers['content-type'] = 'application/json; charset=utf-8'
          fetch(baseStaticRoute.slice(0, baseStaticRoute.lastIndexOf('/') + 1) + 'router/stats/opt_out', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ optOut: statsTracking })
          }).then(res => res.json())
            .then(data => {
              statsTracking = !data.optOut
              if (statsTracking) {
                optOut.textContent = 'Opt-out and delete data'
              } else {
                optOut.textContent = 'Opt-in to stats tracking'
              }
            })
          if (statsTracking) {
            alert('Sent request.')
          }
        }
      })
      statsPanel.appendChild(optOut)

      statsPanel.appendChild(doc.createElement('br'))

      var summary = doc.createElement('h4')
      statsPanel.appendChild(summary)

      var histogram = doc.createElement('div')
      histogram.id = 'web-monetization-histogram'
      statsPanel.appendChild(histogram)

      var perDayPlot = doc.createElement('div')
      perDayPlot.id = 'web-monetization-by-day-plot'
      statsPanel.appendChild(perDayPlot)

      var channelPlot = doc.createElement('div')
      channelPlot.id = 'web-monetization-channel-plot'
      statsPanel.appendChild(channelPlot)

      var allUserSummary = doc.createElement('h5')
      statsPanel.appendChild(allUserSummary)

      description.parentNode!.insertBefore(statsPanel, description)

      var statsButton = doc.createElement('button')
      statsButton.classList.add('action-button')
      statsButton.setAttribute('placement', 'bottom auto')
      statsButton.setAttribute('ngbTooltip', 'View Monetization Stats')
      statsButton.title = 'View Monetization Stats'
      var icon = doc.createElement('img')
      icon.src = baseStaticRoute + '/images/wm-icon-grey.svg'
      icon.setAttribute('height', '24')

      statsButton.appendChild(icon)
      statsButton.addEventListener('click', function () {
        if (statsPanel.style.display == 'block') {
          statsPanel.style.display = 'none'
        } else {
          statsPanel.style.display = 'block'
        }
      })
      actions.prepend(statsButton)

      // Video parts histogram
      var allHistogramX: number[] | null = null
      var allHistogramY: number[] | null = null
      var totalRevenue = null
      // Per-day data
      var perDayX: string[] | null = null
      var perDayUnknown: number[] | null = null
      var perDaySubscribed: number[] | null = null

      var channelData: Partial<Plotly.PieData> | null = null
      var channelNames: Record<string, string> = {}

      var lastHistogramFetch: number | null = null
      var histogramFetchTries = 0
      var updateStatsClosure = async () => {
        if (statsPanel.style.display == 'none') {
          return
        }
        var display = null
        try {
          display = await paid.total.inCurrency(exchange, displayCurrency)
        } catch (e) {
          console.error(e)
        }
        if (display == null) {
          display = paid.total
        }
        summary.textContent = 'Paid ' + display.display() + ' for ' + hms(paid.totalTime(videoEl.currentTime) >> 0) + ' (' + display.display(paid.totalTime(videoEl.currentTime)) + ')'

        {
          try {
            // Refresh data every 6 minutes
            // If fetch fails, try up to 5 times every 15 seconds, then every 6 minutes
            if (lastHistogramFetch == null || (6 * 60 * 1000 < Date.now() - lastHistogramFetch || (0 < histogramFetchTries && histogramFetchTries < 5 && 15 * 1000 < Date.now() - lastHistogramFetch))
              || ((allHistogramX == null && histogramFetchTries == 0) || (histogramFetchTries < 5 && 15 * 1000 < Date.now() - lastHistogramFetch))) {
              lastHistogramFetch = Date.now()
              histogramFetchTries += 1

              var res = await fetch(baseStaticRoute.slice(0, baseStaticRoute.lastIndexOf('/') + 1) + 'router/stats/histogram/' + videoId, {
                method: 'GET'
              })
              var resData = await res.json()

              try {
                var headers = null
                if (ptHelpers != null) {
                  headers = ptHelpers.getAuthHeader()
                }
                if (headers == null) {
                  channelData = null
                  channelPlot.style.display = 'none'
                } else {
                  var userStatsRes = await fetch(baseStaticRoute.slice(0, baseStaticRoute.lastIndexOf('/') + 1) + 'router/stats/user/channels', {
                    method: 'POST',
                    headers: headers
                  })
                  var userStatsData = await userStatsRes.json()
                  if (userStatsData.optOut) {
                    channelData = null
                    channelPlot.style.display = 'none'
                  } else {
                    channelData = { values: [], labels: [], type: 'pie', textinfo: 'label+percent' }
                    channelPlot.style.display = 'block'

                    var channelList = null
                    for (const channelId in userStatsData.channels) {
                      if (channelNames[channelId] == null) {
                        if (channelList == null) {
                          var api = baseStaticRoute
                          api = api.slice(0, api.lastIndexOf('/'))
                          api = api.slice(0, api.lastIndexOf('/'))
                          api = api.slice(0, api.lastIndexOf('/'))
                          api = api.slice(0, api.lastIndexOf('/'))
                          api = api + '/api/v1'
                          var channelListRes = await fetch(api + '/video-channels', {
                            method: 'GET'
                          })
                          var channelListData = await channelListRes.json()
                          channelList = channelListData.data
                        }
                        const channelIdInt = Number.parseInt(channelId)
                        for (var i = 0; i < channelList.length; i++) {
                          if (channelList[i].id == channelIdInt) {
                            channelNames[channelId] = channelList[i].displayName
                            break
                          }
                        }
                      }
                      channelData.values!.push(userStatsData.channels[channelId])
                      if (channelNames[channelId] != null) {
                        channelData.labels!.push(channelNames[channelId])
                      } else {
                        channelData.labels!.push(channelId)
                      }
                    }
                  }
                }
              } catch (e) {
                console.error(e)
              }

              histogramFetchTries = 0

              allHistogramY = resData.histogram.parts
              allHistogramX = []
              perDayX = []
              perDayUnknown = []
              perDaySubscribed = []
              for (const day in resData.histogram.history) {
                perDayX.push(new Date(Number.parseInt(day) * 86400000).toISOString())
                perDayUnknown.push(resData.histogram.history[day].unknown)
                perDaySubscribed.push(resData.histogram.history[day].subscribed)
              }

              totalRevenue = new Amount(true)
              var significand = 0
              for (var i = 0; i < resData.histogram.parts.length; i++) {
                allHistogramX.push(i * 15000)
                // `allHistogramY` set non-null a few lines above, `allHistogramY = resData.histogram.parts`
                significand += allHistogramY![i]
              }

              var exponent = 0
              while (significand * 0.001 < Math.abs(significand - (significand >> 0))) {
                significand *= 10
                exponent -= 1
              }
              significand >>= 0

              totalRevenue.depositUnchecked(significand, exponent, videoQuoteCurrency, true, null)
              try {
                var converted = await totalRevenue.inCurrency(exchange, displayCurrency)
                if (converted != null) {
                  totalRevenue = converted
                }
              } catch (e) {
                console.error(e)
              }
              allUserSummary.textContent = 'The video has received ' + totalRevenue.display() + ' overall.'
            }
          } catch (e) {
            console.error(e)
          }

          var histogramX = []
          var histogramData = []
          try {
            const currency = videoQuoteCurrencyObj
            for (var i = 0; i < paid.histogram.length; i++) {
              var a = await paid.histogram[i].uncommitted.inCurrency(exchange, currency)
              var b = await paid.histogram[i].committed.inCurrency(exchange, currency)
              a.addFrom(b)
              var sum = 0
              var x = a.unverified.get(currency.code)
              if (x != null) {
                sum += x.significand * 10 ** x.exponent
              }
              var x = a.verified.get(currency.code)
              if (x != null) {
                sum += x.significand * 10 ** x.exponent
              }
              histogramX.push(i * 15000)
              histogramData.push(sum)
            }
          } catch (e) {
            console.error(e)
          }

          var histogramUser: Partial<Plotly.PlotData> = {
            name: 'This session (histogram is not stored per-user)',
            x: histogramX,
            y: histogramData,
            autobinx: false,
            histfunc: 'sum',
            xbins: {
              start: 0,
              end: 15000*Math.ceil(videoEl.duration/15),
              size: 15000,
            },
            type: 'histogram',
            yaxis: 'y',
            opacity: 1.0,
            marker: {
              color: 'orange'
            }
          }
          var histogramAll: Partial<Plotly.PlotData> = {
            name: 'All users',
            x: allHistogramX!,
            y: allHistogramY!,
            autobinx: false,
            histfunc: 'sum',
            xbins: {
              start: 0,
              end: 15000*Math.ceil(videoEl.duration/15),
              size: 15000,
            },
            type: 'histogram',
            yaxis: 'y2',
            opacity: 0.5,
            marker: {
              color: 'grey'
            }
          }
          var data: Plotly.Data[]
          if (allHistogramX != null) {
            data = [histogramUser, histogramAll]
          } else {
            data = [histogramUser]
          }
          var tickformat
          var yUnit
          if (3600 <= videoEl.duration) {
            tickformat = '%H:%M:%S'
            yUnit = 'hh:mm:ss'
          } else {
            tickformat = '%M:%S'
            yUnit = 'mm:ss'
          }
          var layout: any = {
            title: 'Contributions to Video at 15 Second Intervals',
            xaxis: { title: 'Position in video ('+yUnit+')', type: 'date', tickformat, range: [0, videoEl.duration * 1000] },
            yaxis: { title: 'Session contributions (' + videoQuoteCurrency + ')', rangemode: 'nonnegative', tickformat: '.1e' },
            yaxis2: { title: 'All contributions (' + videoQuoteCurrency + ')', rangemode: 'nonnegative', tickformat: '.1e', side: 'right', overlaying: 'y' },
            legend: { orientation: 'h', xanchor: 'right', yanchor: 'top', x: 0.99, y: 0.99 },
            showlegend: true,
            barmode: 'overlay'
          }
          if (histogramData.length != 0 || allHistogramX != null) {
            histogram.setAttribute('style', 'width:50em;height:30em;')
            Plotly.newPlot(histogram, data, layout)
          }

          // Per-day
          {
            var unknown: Plotly.Data = {
              name: 'Unsubscribed users',
              x: perDayX!,
              y: perDayUnknown!,
              type: 'scatter',
              marker: {
                color: 'grey'
              }
            }
            var subscribed: Plotly.Data = {
              name: 'Subscribed users',
              x: perDayX!,
              y: perDaySubscribed!,
              type: 'scatter',
              marker: {
                color: 'orange'
              }
            }
            var data: Plotly.Data[] = [unknown, subscribed]
            var layout: any = {
              title: 'Contributions to Video by Day',
              xaxis: { title: 'Day', type: 'date', 'dtick': 86400000 },
              yaxis: { title: 'Contributions (' + videoQuoteCurrency + ')', rangemode: 'nonnegative', tickformat: '.1e' },
              legend: { orientation: 'h', xanchor: 'right', yanchor: 'top', x: 0.99, y: 0.99 }
            }
            if (perDayX != null && perDayX.length != 0) {
              perDayPlot.setAttribute('style', 'width:50em;height:30em;')
              Plotly.newPlot(perDayPlot, data, layout)
            }
          }

          // Channel pie
          if (channelData != null) {
            channelPlot.setAttribute('style', 'width:50em;height:30em;')
            Plotly.newPlot(channelPlot, [channelData], {
              title: 'Per-channel Contributions'
            })
          }
        }
      }

      interval(updateStatsClosure, 2500, { stopOnError: false })

      console.log('web-monetization: Added stats panel')
    }

    console.log('web-monetization: Set up. Now waiting on user agent and video to start playing.')
  }
}

const metaId = 'peertube-plugin-web-monetization-meta'
var enabled = false
function enableMonetization () {
  if (enabled) {
    return
  }
  if (unpaid) {
    var meta = doc.createElement('meta')
    meta.name = 'monetization'
    meta.content = paymentPointer!
    meta.id = metaId
    doc.getElementsByTagName('head')[0].appendChild(meta)
    enabled = true
  }
}

function disableMonetization () {
  enabled = false
  const meta = doc.getElementById(metaId)
  if (meta != null) {
    meta.parentNode!.removeChild(meta)
    console.log('web-monetization: Paid ' + paid.displayTotal() + ' for this video so far')
  }
}

function cueChange () {
  if (chapters == null || chaptersTrack == null || (!monetized && unpaid)) {
    return
  }
  const xrpPaid = paid.total.xrp()
  const xrpRequired = adSkipCost * paid.totalTime(videoEl.currentTime)
  if (xrpPaid < xrpRequired) {
    // Set some sort of notice
    return
  }
  for (var i = 0; i < (chaptersTrack.activeCues || []).length; i++) {
    const cue = chaptersTrack.activeCues![i]
    var idxMatch = cue.id.match(/Chapter (.+)/)
    if (idxMatch == null) {
      console.log('web-monetization: Failed to parse cue id "' + cue.id + '" expected something like "Chapter 3"')
      return
    }
    var idx = parseInt(idxMatch[1]) - 1
    if (window.isNaN(idx)) {
      console.log('web-monetization: Failed to parse cue id "' + cue.id + '" could not parse integer from "' + idxMatch[1] + '", expected something like "Chapter 3"')
      return
    }
    if (chapters.chapters[idx] == null) {
      console.log('web-monetization: Failed to use cue id "' + cue.id + '" as chapter number ' + (idx + 1) + ' was not found in plugin data, there are only ' + chapters.chapters.length + 'chapters')
      return
    }
    const chapter = chapters.chapters[idx]
    if (chapter.tags.sponsor) {
      if (videoEl == null) {
        console.log('web-monetization: Failed to skip sponsor, video element is not stored')
        return
      }
      if (lastSeek != null && cue.startTime <= lastSeek && lastSeek <= cue.endTime) {
        console.log('web-monetization: Will not skip sponsor "' + chapter.name + '" (' + hms(cue.startTime) + '–' + hms(cue.endTime) + ') ' + hms(videoEl.currentTime) + ' -> ' + hms(cue.endTime) + ' as last seek was to ' + hms(lastSeek))
        return
      }
      if (videoEl.currentTime < cue.endTime) {
        console.log('web-monetization: Skipping sponsor "' + chapter.name + '" (' + hms(cue.startTime) + '–' + hms(cue.endTime) + '), ' + hms(videoEl.currentTime) + ' -> ' + hms(cue.endTime) + ' (last seek ' + hms(lastSeek) + ')')
        if (paid.currentSpan != null) {
          paid.endSpan(videoEl.currentTime)
        }
        paidEnds = null
        nextPaid = null
        videoEl.currentTime = cue.endTime
        updateSpan()
      }
    }
  }
}

function updateSpan (recurse = 0) {
  if (videoEl == null) { return }
  if (20 < recurse) {
    console.log('web-monetization: Too much recursion in updateSpan pos:' + hms(videoEl.currentTime) + ' paidEnd:' + hms(paidEnds) + ' nextPaid:' + hms(nextPaid))
    console.log(paid.display())
    return
  }

  var next = paidEnds
  if (next == null) {
    next = nextPaid
  }
  if (next != null && next <= videoEl.currentTime) {
    paid.endSpan(videoEl.currentTime)
    runStartSpan(recurse + 1)
    // runStartSpan recurses
    return
  }
  if (paid.currentSpan == null) {
    runStartSpan(recurse + 1)
    // runStartSpan recurses
    return
  }

  if (next != null) {
    window.setTimeout(updateSpan, (next - videoEl.currentTime) / videoEl.playbackRate * 1000)
  }
}

function runStartSpan (recurse = 0) {
  const startSpan = paid.startSpan(videoEl.currentTime)
  nextPaid = startSpan.nextPaid || null
  paidEnds = startSpan.paidEnds || null
  unpaid = startSpan.unpaid
  if (unpaid) {
    enableMonetization()
  } else {
    disableMonetization()
  }
  updateSpan(recurse + 1)
}

var lastEnforcement: number | null = null
async function enforceViewCost () {
  var currentTime = null
  if (videoEl != null) {
    currentTime = videoEl.currentTime
  }

  const totalTime = paid.totalTime(currentTime)
  const sessionTime = paid.getSessionTime(currentTime)

  var xrpPaid: number
  try {
    const amount = await paid.total.inCurrency(exchange, videoQuoteCurrencyObj)
    xrpPaid = 0
    if (amount.unverified.has(videoQuoteCurrencyObj.code)) {
      var x = amount.unverified.get(videoQuoteCurrencyObj.code)!
      xrpPaid += x.significand * 10 ** x.exponent
    }
    if (amount.verified.has(videoQuoteCurrencyObj.code)) {
      var x = amount.unverified.get(videoQuoteCurrencyObj.code)!
      xrpPaid += x.significand * 10 ** x.exponent
    }
  } catch (e) {
    console.error(e)
    xrpPaid = paid.total.xrp()
  }
  const xrpRequired = viewCost * totalTime
  var paidSessionAmount: Amount
  var xrpPaidSession: number
  try {
    const amount = await paid.sessionTotal.inCurrency(exchange, videoQuoteCurrencyObj)
    paidSessionAmount = amount
    xrpPaidSession = 0
    if (amount.unverified.has(videoQuoteCurrencyObj.code)) {
      var x = amount.unverified.get(videoQuoteCurrencyObj.code)!
      xrpPaidSession += x.significand * 10 ** x.exponent
    }
    if (amount.verified.has(videoQuoteCurrencyObj.code)) {
      var x = amount.unverified.get(videoQuoteCurrencyObj.code)!
      xrpPaidSession += x.significand * 10 ** x.exponent
    }
  } catch (e) {
    console.error(e)
    xrpPaidSession = paid.sessionTotal.xrp()
    paidSessionAmount = paid.sessionTotal
  }
  const xrpRequiredSession = viewCost * sessionTime

  // Allow time for Web Monetization to begin
  if (doc.monetization != null &&
    (sessionTime < 6 ||
    (sessionTime < 12 && (0.85 * xrpRequired < xrpPaid || 0.85 * xrpRequiredSession < xrpPaidSession))
    )) {
    //
  } else {
    // Don't repeatedly show the modal if the video is paused
    if ((xrpPaid < xrpRequired && xrpPaidSession < xrpRequiredSession || doc.monetization == null) && lastEnforcement != currentTime) {
      videoEl.pause()
      lastEnforcement = currentTime
      if (ptHelpers == null) {
      } else {
        var costAmount = new Amount(true)
        var significand = viewCost
        var exponent = 0
        while (significand * 0.001 < Math.abs(significand - (significand >> 0))) {
          significand *= 10
          exponent -= 1
        }
        significand >>= 0
        costAmount.depositUnchecked(significand, exponent, videoQuoteCurrency, true, null)

        if (doc.monetization == null) {
          ptHelpers.showModal({
            title: await ptHelpers.translate('Viewing this video requires payment through Web Monetization'),
            content: await ptHelpers.translate('See <a href="https://webmonetization.org">https://webmonetization.org</a> for more information.') +
              ' ' + costAmount.display(1) + ' ' + await ptHelpers.translate('is required.'),
            close: true
          })
        } else {
          ptHelpers.showModal({
            title: await ptHelpers.translate('Viewing this video requires a higher pay rate'),
            content: await ptHelpers.translate('You have paid ') + paidSessionAmount.display(sessionTime) + '. ' +
              await ptHelpers.translate('This video requires ') + costAmount.display(1) + '.',
            close: true
          })
        }
      }
    }
  }

  setTimeout(() => {
    enforceViewCost().then(() => {
    })
  }, 3000)
}

var pushViewedSegmentsPendingNonce: string | null = null
var pushViewedSegmentsPendingSince: number | null = null
var totalPaidWhenSubmitted: Amount | null = null
function pushViewedSegments () {
  if (pushViewedSegmentsPendingSince != null && Date.now() - pushViewedSegmentsPendingSince < 60 * 1000) {
    return
  }
  const instant = videoEl.currentTime
  const changes = paid.serializeChanges(instant)

  var subscribed = false
  if (doc.getElementsByClassName('subscribe-button').length == 0 && doc.getElementsByClassName('unsubscribe-button').length == 1) {
    subscribed = true
  }

  var headers: Record<string, string> | null = null
  if (ptHelpers != null) {
    headers = ptHelpers.getAuthHeader() || null
  }
  if (headers == null) {
    if (!statsTracking) {
      return
    }
    // Not logged in. Still submit to histogram
    pushViewedSegmentsPendingNonce = paid.nonce
    pushViewedSegmentsPendingSince = Date.now()
    
    const body: StatsHistogramUpdatePost = { receipts: receipts.serialize(), histogram: changes.histogram, subscribed: false }
    fetch(baseStaticRoute.slice(0, baseStaticRoute.lastIndexOf('/') + 1) + 'router/stats/histogram_update/' + videoId, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body)
    }).then(res => res.json())
      .then(dataRaw => {
        if (dataRaw.committed == null) {
          throw 'web-monetization: /stats/histogram_update gave no `committed`'
        }
        const data: { committed: SerializedHistogramBinUncommitted[] } = dataRaw
        paid.removeCommittedChanges(VideoPaid.deserializeHistogramChanges(data.committed))
        pushViewedSegmentsPendingNonce = null
        pushViewedSegmentsPendingSince = null
      })
    return
  }
  headers['content-type'] = 'application/json; charset=utf-8'
  pushViewedSegmentsPendingNonce = paid.nonce
  pushViewedSegmentsPendingSince = Date.now()
  totalPaidWhenSubmitted = paid.total
  
  const reqBody: StatsViewPost = { receipts: receipts.serialize(), changes: changes, subscribed: subscribed }
  fetch(baseStaticRoute.slice(0, baseStaticRoute.lastIndexOf('/') + 1) + 'router/stats/view/' + videoId, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(reqBody)
  }).then(res => res.json())
    .then((data: SerializedState) => {
      if (data.currentState == null) {
        throw 'web-monetization: /stats/view gave no `currentState`'
      }
      if (data.committedChanges == null) {
        throw 'web-monetization: /stats/view gave no `committedChanges`'
      }

      if (data.optOut) {
        statsTracking = false
      }

      const recvdState = VideoPaidStorage.deserialize(data.currentState)
      if (totalPaidWhenSubmitted != null) {
        paid.total.subtract(totalPaidWhenSubmitted)
        totalPaidWhenSubmitted = null
        paid.total.addFrom(recvdState.total)
      } else {
        console.error('totalPaidWhenSubmitted is null')
      }

      paid.removeCommittedChanges(VideoPaid.deserializeChanges(data.committedChanges))
      paid.updateState(recvdState)
      pushViewedSegmentsPendingNonce = null
      pushViewedSegmentsPendingSince = null
    })
}
