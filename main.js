async function register ({
  registerHook,
  registerSetting,
  settingsManager,
  storageManager,
  videoCategoryManager,
  videoLicenceManager,
  videoLanguageManager
}) {
  const paymentPointerField = 'web-monetization-payment-pointer'
  // const minimumCostField = 'web-monetization-minimum-cost'

  registerHook({
    target: 'action:api.video.updated',
    handler: ({ video, body }) => {
      if (!body.pluginData) {
        return
      }

      var paymentPointer = body.pluginData[paymentPointerField]
      if (!paymentPointer) {
        return
      }

      if (paymentPointer === '') {
        paymentPointer = null
      }
      storageManager.storeData(paymentPointerField + '_v-' + video.id, paymentPointer)
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
      return video
    }
  })
}

async function unregister () {

}

module.exports = {
  register,
  unregister
}
