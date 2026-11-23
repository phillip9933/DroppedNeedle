# OtoHari

OtoHari is an independent Android and iPhone music player for your own DroppedNeedle server. Browse your library, build a queue, save music offline and customize Now Playing. The interface uses Svelte and Capacitor with native audio playback on each platform.

## Install

- **Android:** Download the signed APK from [OtoHari releases](https://github.com/phillip9933/OtoHari/releases). In the app, choose **Settings → App → App updates → Beta** to receive prereleases.
- **iPhone:** [Join the public TestFlight beta](https://testflight.apple.com/join/ep112gZM) on your iPhone. The invitation currently lists the app as **Unofficial DroppedNeedle**. Install TestFlight if prompted, then tap **Accept** and **Install**.

## Development

Android and the shared player are developed on [main](https://github.com/phillip9933/OtoHari/tree/main). The [ios branch](https://github.com/phillip9933/OtoHari/tree/ios) contains the iPhone work. See the [mobile guide](mobile/README.md) for connection options, features and build instructions.

OtoHari uses the DroppedNeedle v3 API and shares some web player code and assets. Server and web contributions continue through the [DroppedNeedle fork](https://github.com/phillip9933/DroppedNeedle). See the [license](LICENSE) and [third-party notices](NOTICE.md).
