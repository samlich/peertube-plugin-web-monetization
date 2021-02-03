import url from 'url'

const paymentPointerField = 'web-monetization-payment-pointer'
var invalidPaymentPointerFormatMsg = 'Invalid payment pointer format.'

// const minimumCostField = 'web-monetization-minimum-cost'

async function register ({ registerVideoField, peertubeHelpers }) {
  // payment pointer
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

/*
// minimum cost
const description = "Minimum cost to watch video"
const descriptionHTML = await peertubeHelpers.translate(description)
const commonOptions = {
  name: minimumCostField,
  label: await peertubeHelpers.translate("Web Monetization minimum cost"),
  descriptionHTML: await peertubeHelpers.translate(
    "ONLY USE FOR TESTING. There is currently no way to request a certain value from the user agent."
  ),
  type: "input",
  default: ""
}
for (const type of [ 'upload', 'import-url', 'import-torrent', 'update' ]) {
    const videoFormOptions = { type }
    registerVideoField(commonOptions, videoFormOptions)
}
*/
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

export { register}
