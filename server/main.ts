import type { Request, Response } from 'express'
import type { RegisterServerOptions, MVideoFullLight, MVideoThumbnail, PluginStorageManager } from '@peertube/peertube-types'
import short from 'short-uuid'
import { paymentPointerField, paymentPointerStore, receiptServiceField, receiptServiceStore, currencyField, currencyStore, viewCostField, viewCostStore, adSkipCostField, adSkipCostStore, StoreKey, StoreObjectKey } from  '../shared/common.js'
import { VideoPaidStorage, Amount, Receipts, Exchange, quoteCurrencies, SerializedState, SerializedHistogramBinUncommitted, SerializedVideoPaid } from '../shared/paid.js'
import { Histogram, StatsHistogramGet, StatsViewPost, StatsHistogramUpdatePost, MonetizationStatusBulkPost, MonetizationStatusBulkPostRes, MonetizationStatusBulkStatus } from '../shared/api'

const shortUuidTranslator = short()

var exchange = new Exchange()

class StorageManagerTypeFix {
  storageManager: PluginStorageManager
  
  constructor (storageManager: PluginStorageManager) {
    this.storageManager = storageManager
  }
  
  // PeerTube lies and says it will always return a string, when it actually
  // returns undefined when no value exists, and returns an object, number, string, boolean, or null
  // if it's able to parse as json
  async getDataUnknown (key: string): Promise<object | number | string | boolean | null | undefined> {
    // PeerTube spec specifies: async getData (key: string): Promise<string> {
    return await this.storageManager.getData(key) as any
  }
  
  async getDataString (key: StoreKey<string>): Promise<string | undefined> {
    const val = await this.getDataUnknown(key.k)
    if (val === undefined || typeof val == 'string') {
      return val
    }
    // backwards compatibility for when we set values to null in order to unset them
    if (val === null) {
      return undefined
    }
    return JSON.stringify(val)
  }
  
  async getDataObjectRaw (key: StoreKey<object>): Promise<object | undefined> {
    const val = await this.getDataUnknown(key.k)
    if (val === undefined || (typeof val == 'object' && val != null)) {
      return val
    }
    // backwards compatibility for when we set values to null in order to unset them
    if (val === null) {
      return undefined
    }
    throw new Error('expected object for stored value '+key.k+', but got '+typeof val)
  }
  
  async getDataObject<T> (key: StoreObjectKey<T>): Promise<T | null | undefined> {
    const val = await this.getDataUnknown(key.k)
    if (val === undefined) {
      return val
    }
    if (typeof val == 'object' && val != null) {
      return key.validate(val)
    }
    // backwards compatibility for when we set values to null in order to unset them
    if (val === null) {
      return undefined
    }
    throw new Error('expected object for stored value '+key.k+', but got '+typeof val+' with nullness:'+(val === null))
  }
  async getDataNumber (key: StoreKey<number>): Promise<number | undefined> {
    const val = await this.getDataUnknown(key.k)
    if (val === undefined || typeof val == 'number') {
      return val
    }
    // backwards compatibility for when we set values to null in order to unset them
    if (val === null) {
      return undefined
    }
    throw new Error('expected number for stored value '+key.k+', but got '+typeof val)
  }
  
  async getDataBoolean (key: StoreKey<boolean>): Promise<boolean | undefined> {
    const val = await this.getDataUnknown(key.k)
    if (val === undefined || typeof val == 'boolean') {
      return val
    }
    // backwards compatibility for when we set values to null in order to unset them
    if (val === null) {
      return undefined
    }
    throw new Error('expected boolean for stored value '+key.k+', but got '+typeof val)
  }
  
  /*async storeData (key: string, data: any): Promise<any> {
    return await this.storageManager.storeData(key, data)
  }*/
  
  async storeDataRemove<T> (key: StoreKey<T>): Promise<any> {
    return await this.storageManager.storeData(key.k, undefined)
  }
  
  async storeDataString (key: StoreKey<string>, data: string): Promise<void> {
    await this.storageManager.storeData(key.k, data)
  }
  
  async storeDataObjectRaw (key: StoreKey<object>, data: object): Promise<void> {
    await this.storageManager.storeData(key.k, data)
  }
  
  async storeDataObject<T> (key: StoreObjectKey<T>, data: T): Promise<void> {
    await this.storageManager.storeData(key.k, data)
  }
  
  async storeDataNumber (key: StoreKey<number>, data: number): Promise<void> {
    await this.storageManager.storeData(key.k, data)
  }
  
  async storeDataBoolean (key: StoreKey<boolean>, data: boolean): Promise<void> {
    await this.storageManager.storeData(key.k, data)
  }
}

function histogramStore (videoId: string): StoreObjectKey<Histogram> {
  return {
    k: 'stats_histogram_v-' + videoId,
    validate: (x: object): Histogram | null => {
    if (!x.hasOwnProperty('parts') || !x.hasOwnProperty('history')) {
        return null
    }
    var y = x as any
    return { parts: y.parts, history: y.history }
    }
  }
}

type UserStats = {
    optOut: boolean,
    channels: any,
}
function userStatsStore (userId: string): StoreObjectKey<UserStats> {
  return {
    k: 'stats_user-' + userId,
    validate: (x: object): UserStats | null => {
    var y = x as any
    var optOut
    var channels
    if (x.hasOwnProperty('optOut')) {
        optOut = y.optOut
    } else {
        optOut = false
    }
    if (x.hasOwnProperty('channels')) {
      channels = y.channels
    } else {
      channels = {}
    }
    var y = x as any
    return { optOut, channels }
    }
  }
}

function videoPaidStore (videoId: string, userId: string): StoreObjectKey<SerializedVideoPaid> {
  return {
    k: 'stats_view_v-' + videoId + '_user-' + userId,
    validate: (x: object): SerializedVideoPaid | null => {
    if (!x.hasOwnProperty('total') || !x.hasOwnProperty('spans')) {
        return null
    }
    var y = x as any
    return { total: y.total, spans: y.spans }
    }
  }
}

export async function register ({peertubeHelpers, getRouter, registerHook, registerSetting: _r, settingsManager: _s, storageManager: storageManager_ }: RegisterServerOptions) {
  const log = peertubeHelpers.logger
  const storageManager = new StorageManagerTypeFix(storageManager_)
  
  registerHook({
    target: 'action:api.video.updated',
    handler: ({ video, body }: { video: MVideoFullLight, body: any }) => {
      if (!body.pluginData) {
        return
      }

      var paymentPointer = body.pluginData[paymentPointerField]
      if (!paymentPointer || paymentPointer.trim() === '') {
        storageManager.storeDataRemove(paymentPointerStore(video.id))
        storageManager.storeDataRemove(receiptServiceStore(video.id))
        storageManager.storeDataRemove(currencyStore(video.id))
        storageManager.storeDataRemove(viewCostStore(video.id))
        storageManager.storeDataRemove(adSkipCostStore(video.id))
        return
      }

      storageManager.storeDataString(paymentPointerStore(video.id), paymentPointer.trim())
      storageManager.storeDataBoolean(receiptServiceStore(video.id), body.pluginData[receiptServiceField])
      storageManager.storeDataString(currencyStore(video.id), body.pluginData[currencyField].trim())
      // Divide by 600 to convert from per 10 minutes to per second
      storageManager.storeDataNumber(viewCostStore(video.id), parseFloat(body.pluginData[viewCostField].trim()))
      storageManager.storeDataNumber(adSkipCostStore(video.id), parseFloat(body.pluginData[adSkipCostField].trim()))
    }
  })

  registerHook({
    target: 'filter:api.video.get.result',
    handler: async (video: any) => {
      if (!video) {
        return video
      }
      if (!video.pluginData) {
        video.pluginData = {}
      }

      var paymentPointer = await storageManager.getDataString(paymentPointerStore(video.id))
      video.pluginData[receiptServiceField] = await storageManager.getDataBoolean(receiptServiceStore(video.id))
      // if (receiptService) {
      //  paymentPointer = '$webmonetization.org/api/receipts/'+encodeURIComponent(paymentPointer)
      // }
      video.pluginData[paymentPointerField] = paymentPointer
      video.pluginData[currencyField] = await storageManager.getDataString(currencyStore(video.id))
      video.pluginData[viewCostField] = await storageManager.getDataNumber(viewCostStore(video.id))
      video.pluginData[adSkipCostField] = await storageManager.getDataNumber(adSkipCostStore(video.id))
      return video
    }
  })

  const router = getRouter()
  router.get('/stats/histogram/*', async (req: Request, res: Response) => {
    const videoId = req.path.slice(req.path.lastIndexOf('/') + 1)

    var video
    try {
      video = await peertubeHelpers.videos.loadByIdOrUUID(videoId)
    } catch (e) {
      log.error('web-monetization: /stats/histogram/: Failed to video loadByIdOrUUID: ' + e)
      res.status(500).send('500 Internal Server Error')
      return
    }
    if (video == null) {
      res.status(404).send('404 Not Found')
      return
    }

    var histogramObj: Histogram | null | undefined
    try {
      histogramObj = await storageManager.getDataObject(histogramStore(video.id))
    } catch (e) {
      log.error('web-monetization: /stats/histogram/: Failed to getData histogram: ' + e)
      res.status(500).send('500 Internal Server Error')
      return
    }
    var histogram
    if(histogramObj === undefined) {
      histogram = { parts: [], history: {} }
    } else if (histogramObj === null) {
      log.error('web-monetization: /stats/histogram/: `Histogram` in store failed validation')
      res.status(500).send('500 Internal Server Error')
      return
    } else {
        histogram = histogramObj
    }

    const body: StatsHistogramGet = { histogram }
    res.send(body)
  })

  async function commitHistogramChanges (video: MVideoThumbnail, histogram: Histogram, changes: SerializedHistogramBinUncommitted[], subscribed: boolean, userStats: any = null): Promise<boolean> {
    var histogramChanged = false
    const lastBin = (video.duration / 15) >> 0
    try {
      const currencyCode = await storageManager.getDataString(currencyStore(video.id))
      const currency = currencyCode == null ? null : quoteCurrencies[currencyCode.toLowerCase()]
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
            var x = amount.unverified.get(currency.code)
            if (x != null) {
              sum += x.significand * 10 ** x.exponent
            }
            var x = amount.unverified.get(currency.code)
            if (x != null) {
              sum += x.significand * 10 ** x.exponent
            }

            histogram.parts[bin.bin] += sum

            const day = (Date.now() / 86400000) >> 0

            if (histogram.history['' + day] == null) {
              histogram.history['' + day] = { unknown: 0, subscribed: 0 }
            }
            if (subscribed) {
              histogram.history['' + day].subscribed += sum
            } else {
              histogram.history['' + day].unknown += sum
            }

            if (userStats != null && userStats.optOut != null) {
              if (userStats.channels['' + video.channelId] == null) {
                userStats.channels['' + video.channelId] = 0
              }
              // this assumes all their videos are in the same currency
              // there will also need to be a per-channel currency, though this is not possible at the moment
              userStats.channels['' + video.channelId] += sum
            }

            if (sum != 0) {
              histogramChanged = true
            }
          }
        }
      }
    } catch (e) {
      log.error('within commmitHistogramChanges: ' + e)
    }
    return histogramChanged
  }

  router.post('/stats/histogram_update/*', async (req, res) => {
    var data: StatsHistogramUpdatePost = req.body
    if (data.histogram.length != 0) {
      const videoId = req.path.slice(req.path.lastIndexOf('/') + 1)

      var video
      try {
        video = await peertubeHelpers.videos.loadByIdOrUUID(videoId)
      } catch (e) {
        log.error('web-monetization: /stats/histogram/: Failed to video loadByIdOrUUID: ' + e)
        res.status(500).send('500 Internal Server Error')
        return
      }
      if (video == null) {
        res.status(404).send('404 Not Found')
        return
      }

      var histogramObj
      try {
        histogramObj = await storageManager.getDataObject(histogramStore(video.id))
      } catch (e) {
        log.error('web-monetization: /stats/histogram/: Failed to getData histogram: ' + e)
        res.status(500).send('500 Internal Server Error')
        return
      }
      var histogram
      if(histogramObj === undefined) {
        histogram = { parts: [], history: {} }
      } else if (histogramObj === null) {
        log.error('web-monetization: /stats/histogram/: `Histogram` in store failed validation')
        res.status(500).send('500 Internal Server Error')
        return
      } else {
          histogram = histogramObj
      }


      var receipts = Receipts.deserialize(data.receipts)
      receipts.verified = []
      try {
        await receipts.verifyReceipts()
      } catch(e) {
        log.error('Failed to verify receipts:' + e)
      }

      try {
        const histogramChanged = await commitHistogramChanges(video, histogram, data.histogram, data.subscribed)
        if (histogramChanged) {
          storageManager.storeDataObject(histogramStore(video.id), histogram)
        }
      } catch (e) {
        log.error('commitHistogramChanges: ' + e)
      }
    }

    const resBody: { committed: SerializedHistogramBinUncommitted[] } = { committed: data.histogram }
    res.send(resBody)
  })

  router.post('/stats/opt_out', async (req, res) => {
    var user
    try {
      user = await peertubeHelpers.user.getAuthUser(res)
    } catch (e) {
      log.error('web-monetization: /stats/opt_out/: Failed to getAuthUser: ' + e)
      res.status(500).send('500 Internal Server Error')
      return
    }
    if (user == null) {
      return
    }
    if (user.id == null) {
      log.error('web-monetization: /stats/opt_out/: `user.id == null`')
      res.status(500).send('500 Internal Server Error')
      return
    }
    
    var previousUserStatsObj: UserStats | null | undefined
    try {
      previousUserStatsObj = await storageManager.getDataObject(userStatsStore(user.id))
     } catch (e) {
      log.error('web-monetization: /stats/view/: Failed to getData user stats: ' + e)
      res.status(500).send('500 Internal Server Error')
      return
    }
    var previousUserStats 
    if (previousUserStatsObj === undefined) {
      previousUserStats = { optOut: false, channels: {} }
    } else if (previousUserStatsObj === null) {
      log.error('web-monetization: /stats/view/: `UserStats` in store failed validation')
      res.status(500).send('500 Internal Server Error')
      return
    } else {
      previousUserStats = previousUserStatsObj
    }

    if (req.body.optOut == true) {
      previousUserStats = { optOut: true, channels: {} }
    } else if (req.body.optOut == false) {
      previousUserStats.optOut = false
    }

    storageManager.storeDataObject(userStatsStore(user.id), previousUserStats)

    res.send({ optOut: previousUserStats.optOut })
  })

  router.post('/stats/user/channels', async (_: Request, res: Response) => {
    var user
    try {
      user = await peertubeHelpers.user.getAuthUser(res)
    } catch (e) {
      log.error('web-monetization: /stats/user/channels: Failed to getAuthUser: ' + e)
      res.status(500).send('500 Internal Server Error')
      return
    }
    if (user == null) {
      return
    }
    if (user.id == null) {
      log.error('web-monetization: /stats/opt_out/: `user.id == null`')
      res.status(500).send('500 Internal Server Error')
      return
    }

    var userStatsObj: UserStats | null | undefined
    try {
      userStatsObj = await storageManager.getDataObject(userStatsStore(user.id))
    } catch (e) {
      log.error('web-monetization: /stats/user/channels: Failed to getData user stats: ' + e)
      res.status(500).send('500 Internal Server Error')
      return
    }
    var userStats 
    if (userStatsObj === undefined) {
      userStats = { optOut: false, channels: {} }
    } else if (userStatsObj === null) {
      log.error('web-monetization: /stats/view/: `UserStats` in store failed validation')
      res.status(500).send('500 Internal Server Error')
      return
    } else {
      userStats = userStatsObj
    }

    res.send(userStats)
  })

  router.post('/stats/view/*', async (req, res) => {
    var user
    try {
      user = await peertubeHelpers.user.getAuthUser(res)
    } catch (e) {
      log.error('web-monetization: /stats/view/: Failed to getAuthUser: ' + e)
      res.status(500).send('500 Internal Server Error')
      return
    }
    if (user == null) {
      return
    }
    if (user.id == null) {
      log.error('web-monetization: /stats/opt_out/: `user.id == null`')
      res.status(500).send('500 Internal Server Error')
      return
    }
    
    const videoId = req.path.slice(req.path.lastIndexOf('/') + 1)

    var video
    try {
      video = await peertubeHelpers.videos.loadByIdOrUUID(videoId)
    } catch (e) {
      log.error('web-monetization: /stats/view/: Failed to video loadByIdOrUUID: ' + e)
      res.status(500).send('500 Internal Server Error')
      return
    }
    if (video == null) {
      res.status(404).send('404 Not Found')
      return
    }

    var data: StatsViewPost = req.body

    var previous: SerializedVideoPaid | null | undefined
    try {
      previous = await storageManager.getDataObject(videoPaidStore(video.id, user.id))
    } catch (e) {
      log.error('web-monetization: /stats/view/: Failed to getData view stats: ' + e)
      res.status(500).send('500 Internal Server Error')
      return
    }

    var previousHistogramObj
    try {
      previousHistogramObj = await storageManager.getDataObject(histogramStore(video.id))
    } catch (e) {
      log.error('web-monetization: /stats/view/: Failed to getData histogram: ' + e)
      res.status(500).send('500 Internal Server Error')
      return
    }
    var previousHistogram
    if(previousHistogramObj === undefined) {
      previousHistogram = { parts: [], history: {} }
    } else if (previousHistogramObj === null) {
      log.error('web-monetization: /stats/histogram/: `Histogram` in store failed validation')
      res.status(500).send('500 Internal Server Error')
      return
    } else {
        previousHistogram = previousHistogramObj
    }
    
    var previousUserStatsObj
    try {
      previousUserStatsObj = await storageManager.getDataObject(userStatsStore(user.id))
    } catch (e) {
      log.error('web-monetization: /stats/view/: Failed to getData user stats: ' + e)
      res.status(500).send('500 Internal Server Error')
      return
    }
    var previousUserStats 
    if (previousUserStatsObj === undefined) {
      previousUserStats = { optOut: false, channels: {} }
    } else if (previousUserStatsObj === null) {
      log.error('web-monetization: /stats/view/: `UserStats` in store failed validation')
      res.status(500).send('500 Internal Server Error')
      return
    } else {
      previousUserStats = previousUserStatsObj
    }

    var store
    if (previous == null) {
      store = new VideoPaidStorage()
    } else {
      store = VideoPaidStorage.deserialize(previous)
    }

    var receipts = Receipts.deserialize(data.receipts)
    receipts.verified = []
    try {
      await receipts.verifyReceipts()
    } catch(e) {
      log.error('verify receipts:' + e)
    }

    // `histogram` field in `VideoPAid` here is sparse, most functions are invalid
    // var changes = VideoPaid.deserializeChanges(data.changes)
    const anyChanges = store.commitChanges(data.changes)
    try {
      store.verifyReceipts()
    } catch (e) {
      log.error('verify receipts:' + e)
    }
    const storeSerialized: SerializedVideoPaid = store.serialize()
    if (anyChanges) {
      storageManager.storeDataObject(videoPaidStore(video.id, user.id), storeSerialized)
    }

    var histogramChanged = false
    if (!previousUserStats.optOut) {
      try {
        histogramChanged = await commitHistogramChanges(video, previousHistogram, data.changes.histogram, data.subscribed, previousUserStats)
        if (histogramChanged) {
          storageManager.storeDataObject(histogramStore(video.id), previousHistogram)
          storageManager.storeDataObject(userStatsStore(user.id), previousUserStats)
        }
      } catch (e) {
        log.error('commitHistogramChanges: ' + e)
      }
    }

    var resBody: SerializedState = {
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
      log.error('web-monetization: /stats/view/: Failed to getAuthUser: ' + e)
    }

    var data: MonetizationStatusBulkPost = req.body
    if (req.body.videos == null || req.body.videos.length == null) {
      res.status(400).send('400 Bad Request')
      return
    }
    const videos: string[] = data.videos

    var statuses: Record<string, MonetizationStatusBulkStatus> = {}
    for (var i = 0; i < videos.length; i++) {
      try {
        const video = await peertubeHelpers.videos.loadByIdOrUUID(shortUuidTranslator.toUUID(videos[i]))
        const paymentPointer = await storageManager.getDataString(paymentPointerStore(video.id))
        if (paymentPointer != null) {
          statuses[videos[i]] = { monetization: 'monetized' }
          
          try {
            const currency = await storageManager.getDataString(currencyStore(video.id))
            const viewCost = await storageManager.getDataNumber(viewCostStore(video.id))
            const adSkipCost = await storageManager.getDataNumber(adSkipCostStore(video.id))
            if (adSkipCost != undefined && !isNaN(adSkipCost) && 0 < adSkipCost) {
              statuses[videos[i]] = { monetization: 'ad-skip' }
            }
            if (viewCost != undefined && !isNaN(viewCost) && 0 < viewCost) {
              var paid = null
              if (user != null && user.id != null) {
                try {
                  const stats = await storageManager.getDataObject(videoPaidStore(video.id, user.id))
                  if (stats != null) {
                    paid = stats.total
                  }
                } catch (e) {
                  log.error('failed to try to get stats for video '+video.id+' for user '+user.id+', error:'+e)
                }
              }

              statuses[videos[i]] = { monetization: 'pay-wall', currency: currency, viewCost: viewCost, duration: video.duration, paid: paid }
            }
          } catch (e) {
            log.error('failed to get extended monetization data for video '+video.id+', error:'+e)
          }
        }
      } catch (e) {
        log.error('failed to get video ' + videos[i])
        log.error('failed to get video error: ' + e)
        if (statuses[videos[i]] == null) {
          statuses[videos[i]] = { monetization: 'unknown' }
        }
      }
    }

    const body: MonetizationStatusBulkPostRes = { statuses }
    res.send(body)
  })
}

export async function unregister () {
}
