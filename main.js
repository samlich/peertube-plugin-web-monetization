const common = require('./client/common.js')
const { version, paymentPointerField, receiptServiceField, currencyField, viewCostField, adSkipCostField } = common
const paid = require('./client/paid.js')
const { VideoPaid, VideoPaidStorage, Amount, Receipts, Exchange, quoteCurrencies } = paid

var exchange = new Exchange()

async function register ({peertubeHelpers, getRouter, registerHook, registerSetting, settingsManager, storageManager, videoCategoryManager, videoLicenceManager, videoLanguageManager}) {
  registerHook({
    target: 'action:api.video.updated',
    handler: ({ video, body }) => {
      if (!body.pluginData) {
        return
      }

      var paymentPointer = body.pluginData[paymentPointerField]
      if (!paymentPointer || paymentPointer.trim() === '') {
        storageManager.storeData(paymentPointerField + '_v-' + video.id, null)
        storageManager.storeData(receiptServiceField + '_v-' + video.id, null)
        storageManager.storeData(currencyField + '_v-' + video.id, null)
        storageManager.storeData(viewCostField + '_v-' + video.id, null)
        storageManager.storeData(adSkipCostField + '_v-' + video.id, null)
        return
      }

      storageManager.storeData(paymentPointerField + '_v-' + video.id, paymentPointer.trim())
      storageManager.storeData(receiptServiceField + '_v-' + video.id, body.pluginData[receiptServiceField])
      storageManager.storeData(currencyField + '_v-' + video.id, body.pluginData[currencyField].trim())
      // Divide by 600 to convert from per 10 minutes to per second
      storageManager.storeData(viewCostField + '_v-' + video.id, parseFloat(body.pluginData[viewCostField].trim()))
      storageManager.storeData(adSkipCostField + '_v-' + video.id, parseFloat(body.pluginData[adSkipCostField].trim()))
    }
  })

  registerHook({
    target: 'filter:api.video.get.result',
    handler: async (video) => {
      if (!video) {
        return video
      }
      if (!video.pluginData) {
        video.pluginData = {}
      }

      var paymentPointer = await storageManager.getData(paymentPointerField + '_v-' + video.id)
      video.pluginData[receiptServiceField] = await storageManager.getData(receiptServiceField + '_v-' + video.id)
      //if (receiptService) {
      //  paymentPointer = '$webmonetization.org/api/receipts/'+encodeURIComponent(paymentPointer)
      //}
      video.pluginData[paymentPointerField] = paymentPointer
      video.pluginData[currencyField] = await storageManager.getData(currencyField + '_v-' + video.id)
      video.pluginData[viewCostField] = await storageManager.getData(viewCostField + '_v-' + video.id)
      video.pluginData[adSkipCostField] = await storageManager.getData(adSkipCostField + '_v-' + video.id)
      return video
    }
  })

  const router = getRouter();
  router.get('/stats/histogram/*', async (req, res) => {
    const videoId = req.path.slice(req.path.lastIndexOf('/') + 1)

    var video
    try {
      video = await peertubeHelpers.videos.loadByIdOrUUID(videoId)
    } catch (e) {
      console.error('web-monetization: /stats/histogram/: Failed to video loadByIdOrUUID: '+e)
      res.status(500).send('500 Internal Server Error')
      return
    }
    if (video == null) {
      res.status(404).send('404 Not Found')
      return
    }

    const histogramKey = 'stats_histogram_v-' + video.id
    var histogram
    try {
      histogram = await storageManager.getData(histogramKey)
    } catch (e) {
      console.error('web-monetization: /stats/histogram/: Failed to getData histogram: '+e)
      res.status(500).send('500 Internal Server Error')
      return
    }
    if (histogram == null) {
      histogram = []
    }

    res.send({ histogram: histogram })
  })

  async function commitHistogramChanges(video, histogram, changes, subscribed, userStats) {
    var histogramChanged = false
    const lastBin = (video.duration / 15) >>0
    try {
      const currencyCode = await storageManager.getData(currencyField + '_v-' + video.id)
      const currency = quoteCurrencies[currencyCode.toLowerCase()]
      if (currency != null) {
        for (var i = 0; i < changes.length; i++) {
          var bin = changes[i]
          if (lastBin < bin.bin) {
            // Certainly malicious
            break
          }
          while (histogram.parts.length <= bin.bin) {
            histogram.parts.push(0.0)
          }
          var amount = Amount.deserialize(bin.uncommitted)
          amount = await amount.inCurrency(exchange, currency)
          if (amount != null) {
            var sum = 0
            if (amount.unverified.has(currency.code)) {
              var x = amount.unverified.get(currency.code)
              sum += x.significand * 10 ** x.exponent
            }
            if (amount.verified.has(currency.code)) {
              var x = amount.unverified.get(currency.code)
              sum += x.significand * 10 ** x.exponent
            }
            
            histogram.parts[bin.bin] += sum
            
            const day = (Date.now() / 86400000) >>0
            
            if (histogram.history[''+day] == null) {
              histogram.history[''+day] = { unknown: 0, subscribed: 0 }
            }
            if (subscribed) {
              histogram.history[''+day].subscribed += sum
            } else {
              histogram.history[''+day].unknown += sum
            }

            if (userStats != null && userStats.optOut != null) {
              if (userStats.channels[''+video.channelId] == null) {
                userStats.channels[''+video.channelId] = 0
              }
              // this assumes all their videos are in the same currency
              // there will also need to be a per-channel currency, though this is not possible at the moment
              userStats.channels[''+video.channelId] += sum
            }
            
            if (sum != 0) {
              histogramChanged = true
            }
          }
        }
      }
    } catch (e) {
      console.error(e)
    }
    return histogramChanged
  }
  
  router.post('/stats/histogram_update/*', async (req, res) => {
    var data = req.body
    if (data.histogram.length != 0) {
    
      const videoId = req.path.slice(req.path.lastIndexOf('/') + 1)

      var video
      try {
        video = await peertubeHelpers.videos.loadByIdOrUUID(videoId)
      } catch (e) {
        console.error('web-monetization: /stats/histogram/: Failed to video loadByIdOrUUID: '+e)
        res.status(500).send('500 Internal Server Error')
        return
      }
      if (video == null) {
        res.status(404).send('404 Not Found')
        return
      }

      const histogramKey = 'stats_histogram_v-' + video.id
      var histogram
      try {
        histogram = await storageManager.getData(histogramKey)
      } catch (e) {
        console.error('web-monetization: /stats/histogram/: Failed to getData histogram: '+e)
        res.status(500).send('500 Internal Server Error')
        return
      }
      if (histogram == null) {
        histogram = { parts: [], history: {} }
      }

      var receipts = Receipts.deserialize(data.receipts)
      receipts.verified = []
      try {
        await receipts.verifyReceipts()
      } catch(e) {
        console.error('Failed to verify receipts:')
        console.error(e)
      }


      try {
        const histogramChanged = await commitHistogramChanges(video, histogram, data.histogram, data.subscribed)
        if (histogramChanged) {
          storageManager.storeData(histogramKey, histogram)
        }
      } catch (e) {
        console.error(e)
      }
    }

    res.send({ committed: data.histogram })
  })

  router.post('/stats/opt_out', async (req, res) => {
    var user
    try {
      user = await peertubeHelpers.user.getAuthUser(res)
    } catch (e) {
      console.error('web-monetization: /stats/opt_out/: Failed to getAuthUser: '+e)
      res.status(500).send('500 Internal Server Error')
      return
    }
    
    const userStatsKey = 'stats_user-' + user.id
    var previousUserStats
    try {
      previousUserStats = await storageManager.getData(userStatsKey)
    } catch (e) {
      console.error('web-monetization: /stats/view/: Failed to getData user stats: '+e)
      res.status(500).send('500 Internal Server Error')
      return
    }
    if (previousUserStats == null) {
      previousUserStats = { optOut: false, channels: {} }
    }

    if (req.body.optOut == true) {
      previousUserStats = { optOut: true, channels: {} }
    } else if (req.body.optOut == false) {
      previousUserStats.optOut = false
    }

    storageManager.storeData(userStatsKey, previousUserStats)

    res.send({ optOut: previousUserStats.optOut })
  })
    
  router.post('/stats/view/*', async (req, res) => {
    var user
    try {
      user = await peertubeHelpers.user.getAuthUser(res)
    } catch (e) {
      console.error('web-monetization: /stats/view/: Failed to getAuthUser: '+e)
      res.status(500).send('500 Internal Server Error')
      return
    }
    const videoId = req.path.slice(req.path.lastIndexOf('/') + 1)

    var video
    try {
      video = await peertubeHelpers.videos.loadByIdOrUUID(videoId)
    } catch (e) {
      console.error('web-monetization: /stats/view/: Failed to video loadByIdOrUUID: '+e)
      res.status(500).send('500 Internal Server Error')
      return
    }
    if (video == null) {
      res.status(404).send('404 Not Found')
      return
    }

    var data = req.body

    const storageKey = 'stats_view_v-' + video.id + '_user-' + user.id
    const histogramKey = 'stats_histogram_v-' + video.id
    const userStatsKey = 'stats_user-' + user.id
    var previous
    try {
      previous = await storageManager.getData(storageKey)
      previous.total.unverifiedReceipts = []
      for (var i = 0; i < previous.spans; i++) {
        previous.spans.paid.unverifiedReceipts = []
      }
    } catch (e) {
      console.error('web-monetization: /stats/view/: Failed to getData view stats: '+e)
      res.status(500).send('500 Internal Server Error')
      return
    }
    var previousHistogram
    try {
      previousHistogram = await storageManager.getData(histogramKey)
    } catch (e) {
      console.error('web-monetization: /stats/view/: Failed to getData histogram: '+e)
      res.status(500).send('500 Internal Server Error')
      return
    }
    var previousUserStats
    try {
      previousUserStats = await storageManager.getData(userStatsKey)
    } catch (e) {
      console.error('web-monetization: /stats/view/: Failed to getData user stats: '+e)
      res.status(500).send('500 Internal Server Error')
      return
    }
    if (previousUserStats == null) {
      previousUserStats = { optOut: false, channels: {} }
    }

    var store
    var changed = false
    if (previous == null) {
      store = new VideoPaidStorage()
    } else {
      store = VideoPaidStorage.deserialize(previous)
    }

    var histogramChanged = false
    if (previousHistogram == null) {
      previousHistogram = { parts: [], history: {} }
    }

    var committedChanges = null
    var storeSerizlied
    
    var receipts = Receipts.deserialize(data.receipts)
    receipts.verified = []
    try {
      await receipts.verifyReceipts()
    } catch(e) {
      console.error(e)
    }
    
    var changes = VideoPaid.deserializeChanges(data.changes)
    const anyChanges = store.commitChanges(changes)
    try {
      store.verifyReceipts()
    } catch (e) {
      console.log(e)
    }
    storeSerialized = store.serialize()
    if (anyChanges) {
      storageManager.storeData(storageKey, storeSerialized)
    }

    if (!previousUserStats.optOut) {
      try {
        histogramChanged = await commitHistogramChanges(video, previousHistogram, data.changes.histogram, data.subscribed, previousUserStats)
        if (histogramChanged) {
          storageManager.storeData(histogramKey, previousHistogram)
          storageManager.storeData(userStatsKey, previousUserStats)
        }
      } catch (e) {
        console.error(e)
      }
    }

    var resBody = {
      currentState: storeSerialized,
      committedChanges: data.changes,
      optOut: previousUserStats.optOut
    }
    res.send(resBody)
  })

  router.post('/monetization_status_bulk', async (req, res) => {
    var user
    try {
      user = await peertubeHelpers.user.getAuthUser(res)
    } catch (e) {
      user = null
      console.error('web-monetization: /stats/view/: Failed to getAuthUser: '+e)
    }
    
    var data = req.body
    if (req.body.videos == null || req.body.videos.length == null) {
      res.status(400).send('400 Bad Request')
      return
    }
    const videos = req.body.videos

    var statuses = {}
    for (var i = 0; i < videos.length; i++) {
      try {
        const video = await peertubeHelpers.videos.loadByIdOrUUID(videos[i])
        const paymentPointer = await storageManager.getData(paymentPointerField + '_v-' + video.id)
        if (paymentPointer != null) {
          statuses[videos[i]] = { monetization: 'monetized' }
          const currency = await storageManager.getData(currencyField + '_v-' + video.id)
          const currencyObj = quoteCurrencies[currency.toLowerCase()]
          const viewCost = await storageManager.getData(viewCostField + '_v-' + video.id)
          const adSkipCost = await storageManager.getData(adSkipCostField + '_v-' + video.id)
          if (adSkipCost != null && 0 < adSkipCost) {
            statuses[videos[i]] = { monetization: 'ad-skip' }
          }
          if (viewCost != null && 0 < viewCost) {
            var paid = null
            if (user != null) {
              const storageKey = 'stats_view_v-' + video.id + '_user-' + user.id
              try {
                const stats = await storageManager.getData(storageKey)
                if (stats != null) {
                  paid = stats.total
                }
              } catch (e) {
                console.error(e)
              }
            }

            statuses[videos[i]] = { monetization: 'pay-wall', currency: currency, viewCost: viewCost, duration: video.duration, paid: paid }
          }
        }
      } catch (e) {
        console.log('failed to get video '+videos[i])
        console.log(e)
        if (statuses[videos[i]] == null) {
          statuses[videos[i]] = 'unknown'
        }
      }
    }

    res.send({ statuses: statuses })
  })
}

async function unregister () {
}

module.exports = {
  register,
unregister}
