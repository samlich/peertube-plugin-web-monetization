const common = require('./client/common.js')
const { version, paymentPointerField, viewCostField, adSkipCostField } = common

async function register ({registerHook, registerSetting, settingsManager, storageManager, videoCategoryManager, videoLicenceManager, videoLanguageManager}) {
  registerHook({
    target: 'action:api.video.updated',
    handler: ({ video, body }) => {
      if (!body.pluginData) {
        return
      }

      var paymentPointer = body.pluginData[paymentPointerField]
      if (!paymentPointer || paymentPointer.trim() === '') {
        storageManager.storeData(paymentPointerField + '_v-' + video.id, null)
        storageManager.storeData(viewCostField + '_v-' + video.id, null)
        storageManager.storeData(adSkipCostField + '_v-' + video.id, null)
        return
      }

      storageManager.storeData(paymentPointerField + '_v-' + video.id, paymentPointer.trim())
      storageManager.storeData(viewCostField + '_v-' + video.id, body.pluginData[viewCostField].trim())
      storageManager.storeData(adSkipCostField + '_v-' + video.id, body.pluginData[adSkipCostField].trim())
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

      video.pluginData[paymentPointerField] = await storageManager.getData(paymentPointerField + '_v-' + video.id)
      video.pluginData[viewCostField] = await storageManager.getData(viewCostField + '_v-' + video.id)
      video.pluginData[adSkipCostField] = await storageManager.getData(adSkipCostField + '_v-' + video.id)
      return video
    }
  })
}

async function unregister () {
}

module.exports = {
  register,
unregister}
