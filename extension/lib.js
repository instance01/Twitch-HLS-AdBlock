function getFuncsForInjection (usePerformanceFix) {
    function str2ab(str) {
        var buf = new ArrayBuffer(str.length);
        var bufView = new Uint8Array(buf);
        for (var i = 0, strLen = str.length; i < strLen; i++) {
            bufView[i] = str.charCodeAt(i);
        }
        return buf;
    }

    function fixSeqNr(textStr) {
        var currSeq = /#EXT-X-MEDIA-SEQUENCE:([0-9]*)/.exec(textStr)
        if (currSeq === null) {
            // That's bad, MEDIA-SEQUENCE is missing which is mandatory in the spec
            return textStr;
        }

        if (currSeq.length < 2) {
            return textStr;
        }

        currSeq = currSeq[1];

        if (self._seq === undefined) {
            // Right now this results in a jump back by 2 seconds, but no (or minor) buffering.
            self._seq = Math.max(0, parseInt(currSeq) - 1);
        }

        var newSeq = Math.max(0, parseInt(currSeq) - self._seq);
        return textStr.replace(/#EXT-X-MEDIA-SEQUENCE:([0-9]*)/, '#EXT-X-MEDIA-SEQUENCE:' + newSeq);
    }

    function stripAds (textStr) {
        var haveAdTags = textStr.includes('#EXT-X-SCTE35-OUT');

        if (haveAdTags) {
            self._wasAd = true;
            textStr = textStr.replace(/#EXT-X-SCTE35-OUT(.|\s)*#EXT-X-SCTE35-IN/gmi, '');
            textStr = textStr.replace(/#EXT-X-SCTE35-OUT(.|\s)*/gmi, '');
            textStr = textStr.replace(/#EXT-X-SCTE35-IN/gi, '');
            textStr = textStr.replace(/#EXT-X-DISCONTINUITY/gi, '');
            textStr = textStr.replace(/#EXT-X-DATERANGE:ID="stitched-ad.*/gi, '');
            textStr = textStr.replace(/^\s*$(?:\n)/gm, '');
        }

        if (!haveAdTags && self._wasAd) {
            // No ads anymore (no SCTE35 flags), normal playlist again.
            // We have to fix the sequence number though.
            textStr = fixSeqNr(textStr);
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
        ${fixSeqNr.toString()}
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
