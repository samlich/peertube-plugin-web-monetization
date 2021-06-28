# 1.0.0 --- Stable release

- Add receipt verification to check payments server-side
- Add stats tracking and viewing: payments made during each 15 seconds of the video are shown as a
  histogram, revenue per day is tracked by subscriber/non-subscriber. User payments to channels
  is tracked, but not currently shown as we cannot retrieve the channel name.
- Currency conversion: Costs now specified in any currency, and stats are shown in any currency.
  It is assumed that all payments are converted to the currency specified for the video upon receipt for
  purposes of stats tracking.
- Opt-out for stats tracking (still records payments made to prevent double payments, although maybe
  this could also be disabled with a more fine-grained option)
- Monetization status is shown when video title/thumbnail is visible. Basic icon for monetized,
  icon with circle for ad skips, and icon with circle followed by cost for mandatory payment.
  

# 0.0.2 --- Initial release

- Add payment pointer field to videos
- Use payment pointer field to direction Web Monetization payments during playback
