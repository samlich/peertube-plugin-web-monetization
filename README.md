# PeerTube Web Monetization Plugin

Web Monetization makes it easy for viewers to support creators through anonymous micropayments.

Viewers can sign up for a service such as [Coil](https://coil.com/) and either install their extension or use their Puma Browser (Coil is currently the only provider). Then, when viewing a supported video, payments will be made while the video is playing.

Creators can monetize their content by using a PeerTube instance with the Web Monetization plugin installed, and adding their Interledger payment pointer.
A payment pointer provides a way for funds to be deposited, and a supported wallet can be created using [GateHub](https://gatehub.net/) or [Uphold](https://uphold.com). The payment pointer is added under the "Plugin Settings" tab in the video editing interface. You can also set a minimum pay rate to view.

![Editing plugin settings on a video](https://milesdewitt.com/peertube-web-monetization/video-edit3.png)

The monetization status of videos will then show when viewing their thumbnails.

![Badges on video titles](https://milesdewitt.com/peertube-web-monetization/badges.png)

Creators can specify the location of sponsors segments using the [PeerTube chapters plugin](https://milesdewitt.com/peertube-chapters), and those who pay with Web Monetization will automatically skip those sponsor segments. You can also set a minimum pay rate for ad-skipping as seen above.

![Chapter menu including sponsor segments](https://milesdewitt.com/peertube-chapters/chapters-menu.png)

Segments of the video which have already been paid for are remembered and will not receive double-payment. Users can store this data when logged-in to not pay multiple times. General contribution data is made available in the stats tray below the video. However, no data sharing is necessary.

![Stats tray](https://milesdewitt.com/peertube-web-monetization/stats.png)

## Contributing

Code is run through `npx standard-format <file>`. Some of the changes it makes are wrong, but at least it's consistent.
