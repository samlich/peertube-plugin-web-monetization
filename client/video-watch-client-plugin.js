import { VideoPaid } from './paid.js'
import { version, hms, paymentPointerField, viewCostField, adSkipCostField } from './common.js'

const tableOfContentsField = 'table-of-contents_parsed'

var ptHelpers = null
var paid = new VideoPaid()
var paymentPointer = null
var viewCost = 0
var adSkipCost = 0

var unpaid = true
var paidEnds = null
var nextPaid = null
var spanChangeTimers = []

var play = false
var monetized = false
var seeking = false
var lastSeek = null
var chapters = null
var chaptersTrack = null
var videoEl = null

// `peertubeHelpers` is not available for `embed`
function register ({ registerHook, peertubeHelpers }) {
  ptHelpers = peertubeHelpers

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
      console.log('web-monetization: Not enabled for this video.')
      return
    }
    paymentPointer = video.pluginData[paymentPointerField]
    if (video.pluginData[viewCostField] != null && !isNaN(parseFloat(video.pluginData[viewCostField]))) {
      viewCost = parseFloat(video.pluginData[viewCostField])
    }
    if (video.pluginData[adSkipCostField] != null && !isNaN(parseFloat(video.pluginData[adSkipCostField]))) {
      adSkipCost = parseFloat(video.pluginData[adSkipCostField])
    }
    console.log('viewCost ' + viewCost + ' adSkipCost ' + adSkipCost)

    chapters = video.pluginData[tableOfContentsField]
    if (chapters == null) {
      console.log('web-monetization: No chapter information from peertube-plugin-chapters plugin data, sponsor skipping not possible.')
    }

    videoEl = player.el().getElementsByTagName('video')[0]
    if (document.monetization === undefined) {
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
        monetized = true
        // If start occures mid-segment
        cueChange()
      }
    )

    // Monetization end
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
        monetized = false
      }
    )

    // A payment (including first payment) has been made
    document.monetization.addEventListener(
      'monetizationprogress',
      event => {
        const {
          // paymentPointer,
          // requestId,
          amount, assetCode, assetScale, receipt} = event.detail

        var instant = videoEl.currentTime
        if (seeking) {
          // If we are seeking, there is no guarantee whether the time reported is before or after the seek operation
          instant = null
        }
        paid.deposit(instant, amount, -assetScale, assetCode, receipt)
      }
    )

    // Normal state changes
    videoEl.addEventListener('play', (event) => {
      play = true
      // Update timer
      updateSpan()
      enableMonetization()
    })
    videoEl.addEventListener('pause', (event) => {
      play = false
      disableMonetization()
    })
    videoEl.addEventListener('ended', (event) => {
      play = false
      disableMonetization()
    })

    videoEl.addEventListener('ratechange', (event) => {
      // Update timer
      updateSpan()
    })
    videoEl.addEventListener('seeking', (event) => {
      seeking = true
      if (paid.currentSpan != null) {
        // Seems to give time after seeking finished sometimes
        // paid.endSpan(videoEl.currentTime)
        paid.endSpan()
      }
      paidEnds = null
      nextPaid = null
    })
    videoEl.addEventListener('seeked', (event) => {
      lastSeek = videoEl.currentTime
      seeking = false
      cueChange()
      updateSpan()
    })

    // State changes due to loading
    videoEl.addEventListener('playing', (event) => {
      if (play) {
        // Update timer
        updateSpan()
        enableMonetization()
      }
    })
    videoEl.addEventListener('waiting', (event) => {
      disableMonetization()
    })

    function textTracksUpdate () {
      const tracks = player.remoteTextTracks()
      for (var i = 0; i < tracks.length; i++) {
        var track = tracks[i]
        if (track.kind == 'chapters') {
          chaptersTrack = track
          track.addEventListener('cuechange', (event) => {
            if (videoEl != null && videoEl.seeking) {
              // Will be called by `seeked` event, otherwise we can miss the change in positon
              // and skip a segment that the user clicked on
              return
            }else {
              cueChange(event)
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

    if (player.hasStarted_) {
      updateSpan()
    }

    enforceViewCost().then(() => {
    })

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
    var meta = document.createElement('meta')
    meta.name = 'monetization'
    meta.content = paymentPointer
    meta.id = metaId
    document.getElementsByTagName('head')[0].appendChild(meta)
    enabled = true
  }
}

function disableMonetization () {
  enabled = false
  const meta = document.getElementById(metaId)
  if (meta != null) {
    meta.parentNode.removeChild(meta)
    console.log('web-monetization: Paid ' + paid.displayTotal() + ' for this video so far')
  }
}

function cueChange () {
  if (chaptersTrack == null || (!monetized && unpaid)) {
    return
  }
  const xrpPaid = paid.total.xrp()
  const xrpRequired = adSkipCost * paid.totalTime(videoEl.currentTime)
  if (xrpPaid < xrpRequired) {
    // Set some sort of notice
    return
  }
  for (var i = 0; i < chaptersTrack.activeCues.length; i++) {
    const cue = chaptersTrack.activeCues[i]
    var idx = cue.id.match(/Chapter (.+)/)
    if (idx == null) {
      console.log('web-monetization: Failed to parse cue id "' + cue.id + '" expected something like "Chapter 3"')
      return
    }
    idx = parseInt(idx[1]) - 1
    if (window.isNaN(idx)) {
      console.log('web-monetization: Failed to parse cue id "' + cue.id + '" could not parse integer from "' + idx[1] + '", expected something like "Chapter 3"')
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
      if (cue.startTime <= lastSeek && lastSeek <= cue.endTime) {
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

function updateSpan (recurse) {
  if (videoEl == null) { return }
  if (20 < recurse) {
    console.log('web-monetization: Too much recursion in updateSpan pos:' + hms(videoEl.currentTime) + ' paidEnd:' + hms(paidEnds) + ' nextPaid:' + hms(nextPaid))
    console.log(paid.display())
    return
  }

  for (var timer of spanChangeTimers) {
    window.clearTimeout(timer)
  }
  spanChangeTimers = []

  var next = paidEnds
  if (next == null) {
    next = nextPaid
  }
  if (next != null && next <= videoEl.currentTime) {
    paid.endSpan(videoEl.currentTime)
    runStartSpan((recurse || 0) + 1)
    // runStartSpan recurses
    return
  }
  if (paid.currentSpan == null) {
    runStartSpan((recurse || 0) + 1)
    // runStartSpan recurses
    return
  }

  window.setTimeout(updateSpan, (next - videoEl.currentTime) / videoEl.playbackRate * 1000)
}

function runStartSpan (recurse) {
  const startSpan = paid.startSpan(videoEl.currentTime)
  nextPaid = startSpan.nextPaid
  paidEnds = startSpan.paidEnds
  unpaid = startSpan.unpaid
  if (unpaid) {
    enableMonetization()
  }else {
    disableMonetization()
  }
  updateSpan((recurse || 0) + 1)
  console.log(paid.display())
}

var lastEnforcement = null
async function enforceViewCost () {
  var currentTime = null
  if (videoEl != null) {
    currentTime = videoEl.currentTime
  }
  // Allow time for Web Monetization to begin
  if (document.monetization != null &&
    (paid.totalTime(currentTime) < 6 ||
    (paid.totalTime(currentTime) < 12 && 0.85 * xrpRequired < xrpPaid)
    )) {
    //
  }else {
    const xrpPaid = paid.total.xrp()
    var currentTime = null
    if (videoEl != null) {
      currentTime = videoEl.currentTime
    }
    const xrpRequired = viewCost * paid.totalTime(currentTime)
    // Don't repeatedly show the modal if the video is paused
    if ((xrpPaid < xrpRequired || document.monetization == null) && lastEnforcement != currentTime) {
      videoEl.pause()
      lastEnforcement = currentTime
      if (ptHelpers == null) {
      }else {
        var costDisplay
        if (viewCost < 0.001) {
          costDisplay = viewCost.toExponential()
        }else {
          costDisplay = '' + viewCost
        }
        if (document.monetization == null) {
          ptHelpers.showModal({
            title: await ptHelpers.translate('Viewing this video requires payment through Web Monetization'),
            content: await ptHelpers.translate('See <a href="https://webmonetization.org">https://webmonetization.org</a> for more information.') +
              ' ' + costDisplay + ' XRP/s ' + await ptHelpers.translate('is required.'),
            close: true
          })
        }else {
          const currentPayRate = xrpPaid / paid.totalTime(currentTime)
          var paidDisplay
          if (currentPayRate < 0.001) {
            paidDisplay = currentPayRate.toExponential()
          }else {
            paidDisplay = '' + currentPayRate
          }

          ptHelpers.showModal({
            title: await ptHelpers.translate('Viewing this video requires a higher pay rate'),
            content: await ptHelpers.translate('You have paid ') + paidDisplay + ' XRP/s. ' +
              await ptHelpers.translate('This video requires ') + costDisplay + ' XRP/s',
            close: true
          })
        }
        console.log('post modal')
      }
    }
  }

  setTimeout(() => {
    enforceViewCost().then(() => {
    })}, 3000)
}

export { register }
