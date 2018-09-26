console.log("Injected Twitch Ad Blocker.");

function getFuncsForInjection () {
    var str2ab = `
        function str2ab(str) {
            var buf = new ArrayBuffer(str.length);
            var bufView = new Uint8Array(buf);
            for (var i=0, strLen=str.length; i < strLen; i++) {
                bufView[i] = str.charCodeAt(i);
            }
            return buf;
        }
    `

    var fixSeqNr = `
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
    `

    var stripAds = `
        function stripAds (textStr) {
            var beforeStr = textStr;

            var haveAdTags = textStr.match(/#EXT-X-SCTE35-OUT/gi) != null;

            // There can be multiple #EXT-X-SCTE35-OUT flags (multiple ads)
            // Let's block up to 20 ads
            for (var i = 0; i < 20; ++i) {
                var scte35OutFlag = textStr.match(/#EXT-X-SCTE35-OUT/gi)
                var scte35InFlag = textStr.match(/#EXT-X-SCTE35-IN/gi)

                if (scte35OutFlag === null) {
                    break;
                }

                self._wasAd = true;

                if (scte35InFlag === null) {
                    textStr = textStr.replace(/#EXT-X-SCTE35-OUT(.|\\s)*/gmi, '');
                } else {
                    textStr = textStr.replace(/\\s#EXT-X-SCTE35-OUT(.|\\s)*#EXT-X-SCTE35-IN/gmi, '');
                }
            }

            if (!haveAdTags && self._wasAd) {
                // No ads anymore (no SCTE35 flags), normal playlist again.
                // We have to fix the sequence number though.
                textStr = fixSeqNr(textStr);
            }

            // Remove all left over garbage
            var lines = textStr.split('\\n');
            lines = lines.filter((line) => {
                return !line.match(/#EXT-X-DISCONTINUITY/gi)
                    && !line.match(/#EXT-X-DATERANGE:ID="stitched-ad.*/gi)
                    && !line.match(/#EXT-X-SCTE35-OUT.*/gi)
                    && !line.match(/#EXT-X-SCTE35-IN/gi);
            });
            return lines.join('\\n');
        }
    `

    var filteredArrayBuffer = `
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
    `

    var reader = `
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
                        resolve({ value: undefined, done: true });
                    });
                }
            }.bind(this);

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
    `

    var body = `
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
    `

    return  `
        ${str2ab}
        ${fixSeqNr}
        ${stripAds}
        ${body}
        ${filteredArrayBuffer}
        ${reader}
    `
}

const oldWorker = window.Worker;
window.Worker = class Worker extends oldWorker {
    constructor(twitchBlobUrl) {
        var newBlobStr = `
            var Module = {
                WASM_BINARY_URL: 'https://cvp.twitch.tv/2.6.7/wasmworker.min.wasm',
                WASM_CACHE_MODE: true
            }

            ${ getFuncsForInjection() }

            importScripts('https://cvp.twitch.tv/2.6.7/wasmworker.min.js');
        `
        super(URL.createObjectURL(new Blob([newBlobStr])));
    }
}
