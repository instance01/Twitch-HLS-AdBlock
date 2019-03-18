function getFuncsForInjection (usePerformanceFix) {
    function str2ab(str) {
        var buf = new ArrayBuffer(str.length);
        var bufView = new Uint8Array(buf);
        for (var i = 0, strLen = str.length; i < strLen; i++) {
            bufView[i] = str.charCodeAt(i);
        }
        return buf;
    }

    function getSeqNr(textStr) {
        return /#EXT-X-MEDIA-SEQUENCE:([0-9]*)/.exec(textStr)[1];
    }

    function stripAds (textStr) {
        var haveAdTags = textStr.includes('#EXT-X-SCTE35-OUT');

        if (haveAdTags) {
            self._wasAd = true;

            if (self._startSeq === undefined) {
                self._startSeq = Math.max(0, parseInt(getSeqNr(textStr)));
            }

            textStr = textStr.replace(/#EXT-X-SCTE35-OUT(.|\s)*#EXT-X-SCTE35-IN/gmi, '');
            textStr = textStr.replace(/#EXT-X-SCTE35-OUT(.|\s)*/gmi, '');
            textStr = textStr.replace(/#EXT-X-SCTE35-IN/gi, '');
            textStr = textStr.replace(/#EXT-X-DISCONTINUITY/gi, '');
            textStr = textStr.replace(/#EXT-X-DATERANGE:ID="stitched-ad.*/gi, '');

            // Get rid of empty lines
            textStr = textStr.replace(/^\s*$(?:\n)/gm, '');

            if (!textStr.includes('#EXTINF')) {
                // Playlist currently only includes ads and not the underlying actual stream.
                // We stripped the playlist of all ads though, so it's empty.
                // This breaks Twitch.
                // So let's reuse the last stream chunk. This will most likely buffer/be glitchy.
                // We manually increase the sequence number.
                // TODO: Find better solution?
                textStr = self._lastStreamChunk;
                var currSeq = parseInt(getSeqNr(textStr));
                if (self._lastSeq === undefined) {
                    self._lastSeq = 0;
                }
                self._lastSeq += 1;
                textStr = textStr.replace(/#EXT-X-MEDIA-SEQUENCE:([0-9]*)/, '#EXT-X-MEDIA-SEQUENCE:' + (currSeq + self._lastSeq));
            } else {
                self._lastStreamChunk = textStr;
            }
        }

        if (!haveAdTags && self._wasAd) {
            // No ads anymore (no SCTE35 flags), normal playlist again.
            // We have to fix the sequence number though.
            // 
            // Through trial and error it seems the following is most stable.
            // Things tried:
            // * Option 1: Not changing media sequence
            // * Option 2: Subtracting _deltaSeq
            // * Optino 3: Adding _deltaSeq (as seen below)
            // It seems we can't get around buffering. At least with midroll ads, which the below was tested with.
            // Originally Option 2 was used, but only tested with preroll ads, and it seemed to work good for those.
            // TODO: More testing needed.
            var currSeq = parseInt(getSeqNr(textStr));

            if (self._deltaSeq === undefined) {
                self._deltaSeq = currSeq - self._startSeq - 1;
            }

            var newSeq = currSeq + self._deltaSeq - 1;
            textStr = textStr.replace(/#EXT-X-MEDIA-SEQUENCE:([0-9]*)/, '#EXT-X-MEDIA-SEQUENCE:' + newSeq);
        }

        return textStr;
    }

    function overrideFilteredArrayBuffer() {
        Response.prototype.filteredArrayBuffer = function () {
            return this.text().then((text) => {
                var ret;

                if (!this.url.endsWith('m3u8')) {
                    ret = text;
                } else {
                    ret = stripAds(text);
                }

                var buf = str2ab(ret);

                return new Promise((resolve, reject) => {
                    resolve(buf);
                });
            });
        };
    }

    function overrideReadableStream() {
        // Firefox doesn't have ReadableStream
        self.ReadableStream = function () { };
        ReadableStream.prototype.cancel = function () { };
        ReadableStream.prototype.locked = false;
        ReadableStream.prototype.getReader = function () {
            if (this._dataRead === undefined) {
                return;
            }

            var ret = Object.create(null);
            ret.read = function () {
                if (!this._dataRead) {
                    this._dataRead = true;
                    return this._data.then((data) => {
                        return { value: new Uint8Array(data), done: false }}
                    );
                } else {
                    return new Promise((resolve, reject) => {
                        if (performance._now === undefined) {
                            fixPerformance();
                        }
                        resolve({ value: undefined, done: true });
                    });
                }
            }.bind(this);

            // TODO For the future
            // ret.end = function () {
            // }.bind(this);

            ret.cancel = function () { this._dataRead = true; }.bind(this);
            ret.releaseLock = function () { }.bind(this);
            Object.defineProperty(ret, 'locked', {
                get: function () {
                    if (this._locked === undefined) {
                        this._locked = false;
                    }
                    return this._locked;
                },
                set: function (val) {
                    this._locked = val;
                }
            });

            return ret;
        }
    }

    function overrideBody() {
        Object.defineProperty(Response.prototype, 'body', {
            get: function() {
                if (!this._rs) {
                    this._rs = new ReadableStream();
                } else {
                    return this._rs;
                }

                if (!this._gotData) {
                    this._gotData = true;

                    if (this.url.endsWith('m3u8')) {
                        this._rs._data = this.filteredArrayBuffer();
                    } else {
                        this._rs._data = this.arrayBuffer();
                    }
                    this._rs._dataRead = false;
                }

                return this._rs;
            },
            set: function(val) {
                this._rs = val;
            }
        });
    }

    var applyOverrides = `
        console.log('Applying overrides..');
        overrideReadableStream();
        overrideFilteredArrayBuffer();
        overrideBody();
    `

    // For now the ReadableStream implementation above doesn't support chunks.
    // The current code is too slow for Twitch and after a while there can be rare instances where the stream breaks for a few seconds.
    // For now just render their performance checks useless, at least until the code above is more performant.
    function fixPerformance() {
        performance._now = performance.now;

        // zc() is used by the wasm worker, let's not break anything here
        self.zc = function () {
            return performance._now()
        };

        performance.now = function () {
            return 0;
        }
    }

    if (!usePerformanceFix) {
        function fixPerformance() {
            performance._now = performance.now;
        }
    }

    return  `
        ${str2ab.toString()}
        ${getSeqNr.toString()}
        ${stripAds.toString()}
        ${overrideFilteredArrayBuffer.toString()}
        ${overrideReadableStream.toString()}
        ${overrideBody.toString()}
        ${applyOverrides}
        ${fixPerformance.toString()}
    `
}

function getWasmBinaryVersion (twitchBlobUrl) {
    var req = new XMLHttpRequest();
    req.open('GET', twitchBlobUrl, false);
    req.send();
    return req.responseText.match(/tv\/(.*)\/wasmworker/)[1];
}
