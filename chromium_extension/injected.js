console.log("Injected Twitch Ad Blocker.");

const oldWorker = window.Worker;
window.Worker = class Worker extends oldWorker {
    constructor(arg) {
        var e = `
        var Module = {
            WASM_BINARY_URL: 'https://cvp.twitch.tv/2.6.7/wasmworker.min.wasm',
            WASM_CACHE_MODE: true
        }

        function str2ab(str) {
            var buf = new ArrayBuffer(str.length);
            var bufView = new Uint8Array(buf);
            for (var i=0, strLen=str.length; i < strLen; i++) {
                bufView[i] = str.charCodeAt(i);
            }
            return buf;
        }

        Response.prototype.arrayBuffer = function() {
            return this.text().then((text) => {
                var ret;
                var textStr = text;

                if (!this.url.endsWith('m3u8')) {
                    ret = text;
                } else {
                    // There can be multiple #EXT-X-SCTE35-OUT flags (multiple ads? lol)
                    var haveAdTags = textStr.match(/#EXT-X-SCTE35-OUT/gi) != null;
                    for (var i = 0; i < 10; ++i) {
                        var scte35OutFlag = textStr.match(/#EXT-X-SCTE35-OUT/gi)
                        var scte35InFlag = textStr.match(/#EXT-X-SCTE35-IN/gi)

                        if (scte35OutFlag == null) {
                            break;
                        }

                        self._wasAd = true;

                        if (scte35InFlag == null) {
                            textStr = textStr.replace(/#EXT-X-SCTE35-OUT(.|\\s)*/gmi, '');
                        } else {
                            textStr = textStr.replace(/\\s#EXT-X-SCTE35-OUT(.|\\s)*#EXT-X-SCTE35-IN/gmi, '');
                        }
                    }
                    if (!haveAdTags && self._wasAd) {
                        // No ads anymore (no SCTE35 flags), normal playlist again.
                        // We have to fix the sequence number though.
                        // TODO code quality, missing error handling
                        var currSeq = /#EXT-X-MEDIA-SEQUENCE:([0-9]*)/.exec(textStr)[1];

                        if (self._seq === undefined) {
                            // TODO Right now this results in a jump back by 2 seconds, but no (or minor) buffering.
                            //self._seq = Math.max(0, textStr.match(/#EXTINF:/gi).length - 2);
                            self._seq = Math.max(0, parseInt(currSeq) - 1);
                        }

                        var newSeq = Math.max(0, parseInt(currSeq) - self._seq);
                        textStr = textStr.replace(/#EXT-X-MEDIA-SEQUENCE:([0-9]*)/, '#EXT-X-MEDIA-SEQUENCE:' + newSeq);
                    }

                    // Remove all left over garbage
                    var lines = textStr.split('\\n');
                    lines = lines.filter((line) => {
                        return !line.match(/#EXT-X-DISCONTINUITY/gi)
                            && !line.match(/#EXT-X-DATERANGE:ID="stitched-ad.*/gi)
                            && !line.match(/#EXT-X-SCTE35-OUT.*/gi)
                            && !line.match(/#EXT-X-SCTE35-IN/gi);
                    });
                    ret = lines.join('\\n');
                }

                var buf = str2ab(ret);

                return new Promise((resolve, reject) => {
                    resolve(buf);
                });
            });
        };


        var oldBody = Object.getOwnPropertyDescriptor(Response.prototype, 'body');
        Object.defineProperty(Response.prototype, 'body', {
            get: function() {
                if (this.url.endsWith('m3u8')) {
                    if (!this._gotData) {
                        this._gotData = true;
                        this.body._data = this.arrayBuffer();
                        this.body._dataRead = false;
                    }
                }
                return oldBody.get.call(this);
            },
            set: function(val) {
                oldBody.set.call(this, val);
            }
        });


        var oldReader = ReadableStream.prototype.getReader;
        ReadableStream.prototype.getReader = function() {
            if (this._dataRead === undefined) {
                return oldReader.apply(this, arguments);
            }

            var ret = Object.create(null);
            ret.read = function() {
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

            ret.cancel = function () { }.bind(this);
            ret.releaseLock = function () { }.bind(this);
            Object.defineProperty(ret, 'locked', {
                get: function() {
                    return false;
                },
                set: function(val) {
                }
            });

            return ret;
        }


        importScripts('https://cvp.twitch.tv/2.6.7/wasmworker.min.js');

        `
        super(URL.createObjectURL(new Blob([e])));
    }
}
