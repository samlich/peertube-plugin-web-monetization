const version = '0.0.2'

var paid = {
		start: 0,
		amount: new Map()
}

// `peertubeHelpers` is not available for `embed`
function register ({ registerHook }) {
  const paymentPointerField = 'web-monetization-payment-pointer'

  registerHook({
    target: 'action:video-watch.player.loaded',
    handler: ({ player, video, videojs }) => {
      setup(player, video, videojs)
    }
  })
  registerHook({
    target: 'action:embed.player.loaded',
    handler: ({ player, video, videojs }) => {
      setup(player, video, videojs)
    }
  })

  function setup (player, video, videojs) {
    if (!video.pluginData || !video.pluginData[paymentPointerField]) {
      console.log('Web Monetization not enabled for this video')
      return
    }
    const paymentPointer = video.pluginData[paymentPointerField]

    if (document.monetization === undefined) {
      console.log('peertube-plugin-web-monetization v', version, ' enabled on server, but Web Monetization not supported by user agent. See https://webmonetization.org.')
      return
    }

    console.log('peertube-plugin-web-monetization v', version, ' detected Web Monetization support. Setting up...')

    // Indicates that Web Monetization is enabled
    document.monetization.addEventListener(
      'monetizationpending',
      event => {
        // const { paymentPointer, requestId } = event.detail
      }
    )

    // First non-zero payment has been sent
    document.monetization.addEventListener(
      'monetizationstart',
      event => {
        // const { paymentPointer, requestId } = event.detail
      }
    )

    // First non-zero payment has been sent
    document.monetization.addEventListener(
      'monetizationstop',
      event => {
        /*
        const {
          paymentPointer,
          requestId,
          finalized // if `requestId` will not be used again
        } = event.detail
        */
      }
    )

    // A payment (including first payment) has been made
    document.monetization.addEventListener(
      'monetizationprogress',
      event => {
        const {
          // paymentPointer,
          // requestId,
          amount,
          assetCode,
          assetScale
          // receipt
        } = event.detail
					if(!paid.amount.has(assetCode)) {
							paid.amount.set(assetCode,
							  {
									amount: 0,
									scale: assetScale
							  }
														 )
					}
					if(paid.amount.get(assetCode).scale < -assetScale) {
							paid.amount.get(assetCode).amount *= 10**(assetScale - paid.amount.get(assetCode).scale)
							paid.amount.get(assetCode).scale = -assetScale
						 }
						 paid.amount.get(assetCode).amount += amount * 10**(paid.amount.get(assetCode).scale - assetScale)
      }
    )

    var play = false
    var eventEl = player.el_.getElementsByTagName('video')[0]
    // Normal state changes
    eventEl.addEventListener('play', (event) => {
      play = true
      enableMonetization(paymentPointer)
    })
    eventEl.addEventListener('pause', (event) => {
      play = false
      disableMonetization()
    })
    eventEl.addEventListener('ended', (event) => {
      play = false
      disableMonetization()
    })

    // State changes due to loading
    eventEl.addEventListener('playing', (event) => {
      if (play) {
        enableMonetization(paymentPointer)
      }
    })
    eventEl.addEventListener('waiting', (event) => {
      disableMonetization()
    })

    if (player.hasStarted_) {
      enableMonetization(paymentPointer)
    }

    console.log('Web Monetization set up. Now waiting on user agent and video to start playing.')
  }
}

const metaId = 'peertube-plugin-web-monetization-meta'
var enabled = false
function enableMonetization (paymentPointer) {
  if (enabled) {
    return
  }
  var meta = document.createElement('meta')
  meta.name = 'monetization'
  meta.content = paymentPointer
  meta.id = metaId
  document.getElementsByTagName('head')[0].appendChild(meta)
  enabled = true
}

function disableMonetization () {
  enabled = false
  const meta = document.getElementById(metaId)
  if (meta != null) {
			meta.parentNode.removeChild(meta)

			var display = ''
			var first = true
			for(const [assetCode, { amount, scale}] of paid.amount) {
					if(!first) {
							display += ', '
					}
					first = false
					const amountFloat = amount * 10**scale
					display += amountFloat+' '+assetCode
			}
      console.log('Web Monetization paid ' + display)
	}
}

export {
  register
}
