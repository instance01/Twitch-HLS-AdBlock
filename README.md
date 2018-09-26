# Motivation

Twitch is playing a 15-30 second advertisement whenever one starts watching a new channel. For people who jump around a bit this is pretty annoying.

Twitch staff has been fairly quick to remove client side fixes that disable advertisements. Since they're able to inject advertisementst into the HLS stream directly ([SSAI](https://aws.amazon.com/blogs/media/why-is-server-side-ad-insertion-important/), Twitch's [SureStream](http://twitchadvertising.tv/ad-products/surestream/) if you want to research further), I believe such fixes will not always be available.

This extension monkey patches the web worker (among others) Twitch uses and edits the m3u8 playlist that gets requested every few seconds to simply remove segments that are marked as advertisments with SCTE-35 flags.

Right now Twitch also makes the actual stream available in those playlist files after a few seconds, which means that after just around 5 seconds the real stream begins, instead of 30 seconds of advertisements.

# Installation

To install manually for Chrome:

1. Check [releases](https://github.com/instance01/Twitch-HLS-AdBlock/releases) for the latest zip or download the source
2. Unzip into a directory and keep the directory in mind
3. Go to chrome://extensions/ and enable Developer Mode
4. Click on 'Load unpacked' and go to the directory with the extension (see if manifest.json is in the directory)

To install manually for FireFox:

1. Download the latest release (xpi file)
2. Go to about:addons and load addon from file


# Limitations

Generally it seems to work fine. Whenever one loads up a new channel, if there's an advertisment injected by Twitch, after a few seconds of loading the real stream begins without any indication of an advertisment.

However I've seen rare instances where the stream breaks, which requires a browser reload. This happened once when the advertisment loaded 2-3 seconds after the stream has started normally.

Currently this is only tested on the latest stable chromium browser and latest Firefox stable.

# Contributing

I appreciate any contributions, be it pull requests or issues. Right now there's no tests however, so make sure to test extensively on Twitch before submitting a pull request.

