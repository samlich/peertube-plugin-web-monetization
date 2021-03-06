import url from 'url'
import { version, paymentPointerField, receiptServiceField, currencyField, viewCostField, adSkipCostField } from './common.js'
import { quoteCurrencies } from './paid.js'

var invalidPaymentPointerFormatMsg = 'Invalid payment pointer format.'

// const minimumCostField = 'web-monetization-minimum-cost'

async function register ({ registerVideoField, peertubeHelpers }) {
  // Payment pointer
  {
    const commonOptions = {
      name: paymentPointerField,
      label: await peertubeHelpers.translate('Web Monetization payment pointer'),
      descriptionHTML: await peertubeHelpers.translate(
        'Interledger <a href="https://paymentpointers.org/">payment pointer</a> for <a href="https://webmonetization.org/">Web Monetization</a>. In the form of $example.org/account.'
      ),
      type: 'input',
      default: ''
    }
    for (const type of ['upload', 'import-url', 'import-torrent', 'update']) {
      const videoFormOptions = { type}
      registerVideoField(commonOptions, videoFormOptions)
    }
    invalidPaymentPointerFormatMsg = await peertubeHelpers.translate(invalidPaymentPointerFormatMsg)
    finishAddPaymentPointerField()
  }

  // Receipt service
  {
    const commonOptions = {
      name: receiptServiceField,
      label: await peertubeHelpers.translate('Add receipt service to payment pointer (to verify payments)'),
      descriptionHTML: await peertubeHelpers.translate(''),
      type: 'input',
      default: 'true'
    }
    for (const type of ['upload', 'import-url', 'import-torrent', 'update']) {
      const videoFormOptions = { type}
      registerVideoField(commonOptions, videoFormOptions)
    }
  }

  // Currency
  {
    var currencyList = ''
    var codes = Object.keys(quoteCurrencies)
    for (var i = 0; i < codes.length; i++) {
      const currency = quoteCurrencies[codes[i]]
      if (i != 0) {
        currencyList += ', '
      }
      currencyList += currency.code + ': ' + currency.network
    }
    const commonOptions = {
      name: currencyField,
      label: await peertubeHelpers.translate('Currency which costs are quoted in'),
      descriptionHTML: await peertubeHelpers.translate('Choose one of:') + currencyList,
      type: 'input',
      default: 'USD'
    }
    for (const type of ['upload', 'import-url', 'import-torrent', 'update']) {
      const videoFormOptions = { type}
      registerVideoField(commonOptions, videoFormOptions)
    }
  }

  // View cost
  {
    const commonOptions = {
      name: viewCostField,
      label: await peertubeHelpers.translate('Minimum payment rate to view per 10 minutes'),
      descriptionHTML: await peertubeHelpers.translate(''),
      type: 'input',
      default: '0'
    }
    for (const type of ['upload', 'import-url', 'import-torrent', 'update']) {
      const videoFormOptions = { type}
      registerVideoField(commonOptions, videoFormOptions)
    }
  }

  // Ad skip cost
  {
    const commonOptions = {
      name: adSkipCostField,
      label: await peertubeHelpers.translate('Minimum payment rate to skip ads per 10 minutes'),
      descriptionHTML: await peertubeHelpers.translate('Payment rates at or above this level will skip chapters with the "Sponsor" tag, labelled using the chapters plugin.'),
      type: 'input',
      default: '0'
    }
    for (const type of ['upload', 'import-url', 'import-torrent', 'update']) {
      const videoFormOptions = { type}
      registerVideoField(commonOptions, videoFormOptions)
    }
  }
}

function finishAddPaymentPointerField () {
  var paymentPointerElement = document.getElementById(paymentPointerField)
  // The element is not added until the user switches to the "Plugin settings" tab
  if (paymentPointerElement == null) {
    setTimeout(() => {
      finishAddPaymentPointerField()}, 3000)
    return
  }

  var paymentPointerValid = true

  function update () {
    if (paymentPointerElement.value == null ||
      paymentPointerElement.value === '' ||
      validatePaymentPointer(paymentPointerElement.value)) {
      if (!paymentPointerValid) {
        paymentPointerValid = true

        paymentPointerElement.classList.remove('ng-invalid')
        paymentPointerElement.classList.add('ng-valid')

        var errorElRemove = document.getElementById(paymentPointerField + '-error')
        if (errorElRemove != null) {
          errorElRemove.parentNode.removeChild(errorElRemove)
        }
      }
    } else {
      if (paymentPointerValid) {
        paymentPointerValid = false

        paymentPointerElement.classList.remove('ng-valid')
        paymentPointerElement.classList.add('ng-invalid')

        var errorEl = document.createElement('div')
        errorEl.id = paymentPointerField + '-error'
        errorEl.classList.add('form-error')
        errorEl.innerText = invalidPaymentPointerFormatMsg
        paymentPointerElement.parentNode.appendChild(errorEl)
      }
    }
  }

  paymentPointerElement.addEventListener('input', (event) => {
    update()})
  update()
}

function validatePaymentPointer (value) {
  if (!value.startsWith('$')) {
    return false
  }

  const unparsed = 'https://' + value.substring(1)
  const parsed = url.parse(unparsed)

  return parsed.host != null &&
    parsed.auth == null &&
    parsed.search == null &&
    parsed.hash == null
}

export { register }
