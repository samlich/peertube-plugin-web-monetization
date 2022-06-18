import { RegisterClientFormFieldOptions, RegisterClientVideoFieldOptions } from '@peertube/peertube-types'
import type { RegisterClientOptions } from '@peertube/peertube-types/client'
import { adSkipCostField, currencyField, paymentPointerField, receiptServiceField, viewCostField } from '../shared/common'
import { quoteCurrencies } from '../shared/paid'

var invalidPaymentPointerFormatMsg = 'Invalid payment pointer format.'

export async function register ({ registerVideoField, peertubeHelpers }: RegisterClientOptions): Promise<void> {
  // Payment pointer
  {
    const commonOptions: RegisterClientFormFieldOptions = {
      name: paymentPointerField,
      label: await peertubeHelpers.translate('Web Monetization payment pointer'),
      type: 'input',
      descriptionHTML: await peertubeHelpers.translate(
        'Interledger <a href="https://paymentpointers.org/">payment pointer</a> for <a href="https://webmonetization.org/">Web Monetization</a>. In the form of $example.org/account.'
      ),
      default: ''
    }
    const types: ('upload' | 'import-url' | 'import-torrent' | 'update' | 'go-live')[] = ['upload', 'import-url', 'import-torrent', 'update']
    for (const type of types) {
      const videoFormOptions: RegisterClientVideoFieldOptions = { type}
      registerVideoField(commonOptions, videoFormOptions)
    }
    invalidPaymentPointerFormatMsg = await peertubeHelpers.translate(invalidPaymentPointerFormatMsg)
    finishAddPaymentPointerField()
  }

  // Receipt service
  {
    const commonOptions: RegisterClientFormFieldOptions = {
      name: receiptServiceField,
      label: await peertubeHelpers.translate('Add receipt service to payment pointer (to verify payments)'),
      type: 'input-checkbox',
      descriptionHTML: '',
      default: true
    }
    const types: ('upload' | 'import-url' | 'import-torrent' | 'update' | 'go-live')[] = ['upload', 'import-url', 'import-torrent', 'update']
    for (const type of types) {
      const videoFormOptions: RegisterClientVideoFieldOptions = { type}
      registerVideoField(commonOptions, videoFormOptions)
    }
  }

  // Currency
  {
    var currencies = []
    const commonCurrencies = ['usd', 'eur', 'xrp']
    for (var i = 0; i < commonCurrencies.length; i++) {
      const currency = quoteCurrencies[commonCurrencies[i]]
      currencies.push({
        label: currency.network,
        value: currency.code
      })
    }
    currencies.push({
      label: '================',
      value: 'USD'
    })
    var codes = Object.keys(quoteCurrencies)
    for (var i = 0; i < codes.length; i++) {
      const currency = quoteCurrencies[codes[i]]
      currencies.push({
        label: currency.network,
        value: currency.code
      })
    }

    const commonOptions: RegisterClientFormFieldOptions = {
      name: currencyField,
      label: await peertubeHelpers.translate('Currency which costs are quoted in'),
      type: 'select',
      options: currencies,
      descriptionHTML: '',
      default: 'USD'
    }
    const types: ('upload' | 'import-url' | 'import-torrent' | 'update' | 'go-live')[] = ['upload', 'import-url', 'import-torrent', 'update']
    for (const type of types) {
      const videoFormOptions: RegisterClientVideoFieldOptions = { type}
      registerVideoField(commonOptions, videoFormOptions)
    }
  }

  // View cost
  {
    const commonOptions: RegisterClientFormFieldOptions = {
      name: viewCostField,
      label: await peertubeHelpers.translate('Minimum payment rate to view per 10 minutes'),
      type: 'input',
      descriptionHTML: await peertubeHelpers.translate(''),
      default: '0'
    }
    const types: ('upload' | 'import-url' | 'import-torrent' | 'update' | 'go-live')[] = ['upload', 'import-url', 'import-torrent', 'update']
    for (const type of types) {
      const videoFormOptions: RegisterClientVideoFieldOptions = { type}
      registerVideoField(commonOptions, videoFormOptions)
    }
  }

  // Ad skip cost
  {
    const commonOptions: RegisterClientFormFieldOptions = {
      name: adSkipCostField,
      label: await peertubeHelpers.translate('Minimum payment rate to skip ads per 10 minutes'),
      type: 'input',
      descriptionHTML: await peertubeHelpers.translate('Payment rates at or above this level will skip chapters with the "Sponsor" tag, labelled using the chapters plugin.'),
      default: '0'
    }
    const types: ('upload' | 'import-url' | 'import-torrent' | 'update' | 'go-live')[] = ['upload', 'import-url', 'import-torrent', 'update']
    for (const type of types) {
      const videoFormOptions: RegisterClientVideoFieldOptions = { type}
      registerVideoField(commonOptions, videoFormOptions)
    }
  }
}

function finishAddPaymentPointerField () {
  var paymentPointerElement = document.getElementById(paymentPointerField)
  // The element is not added until the user switches to the "Plugin settings" tab
  if (paymentPointerElement == null) {
    setTimeout(() => {
      finishAddPaymentPointerField()
    }, 3000)
    return
  }

  var paymentPointerValid = true

  function update () {
    if (paymentPointerElement == null) {
      throw 'typescript unreachable'
    }

    if (paymentPointerElement.getAttribute('value') == null ||
      paymentPointerElement.getAttribute('value') === '' ||
      validatePaymentPointer(paymentPointerElement.getAttribute('value'))) {
      if (!paymentPointerValid) {
        paymentPointerValid = true

        paymentPointerElement.classList.remove('ng-invalid')
        paymentPointerElement.classList.add('ng-valid')

        var errorElRemove = document.getElementById(paymentPointerField + '-error')
        if (errorElRemove != null) {
          errorElRemove.parentNode!.removeChild(errorElRemove)
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
        paymentPointerElement.parentNode!.appendChild(errorEl)
      }
    }
  }

  paymentPointerElement.addEventListener('input', () => {
    update()
  })
  update()
}

function validatePaymentPointer (value: string | null): boolean {
  if (value == null) {
    return false
  }
  if (!value.startsWith('$')) {
    return false
  }

  const unparsed = 'https://' + value.substring(1)
  const parsed = new URL(unparsed)

  return parsed.host != null &&
    parsed.username == null &&
    parsed.password == null &&
    parsed.search == null &&
    parsed.hash == null
}
