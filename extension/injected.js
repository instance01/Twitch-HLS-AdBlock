console.log("Injected Twitch HLS Adblock.");

const SUPPORTED_VERSION = "2.9.1";
const oldWorker = window.Worker;
window.Worker = class Worker extends oldWorker {
    constructor(twitchBlobUrl) {
        var version = getWasmBinaryVersion(twitchBlobUrl);
        var usePerformanceFix = true;

        if (version != SUPPORTED_VERSION) {
            console.log(`Twitch HLS Adblock found possibly unsupported version: ${version}.`);
            console.log(`Current supported version: ${SUPPORTED_VERSION}.`);
            console.log("This is most likely fine. Trying upstream wasmworker..");
            usePerformanceFix = false;
        }

        var functions = getFuncsForInjection(usePerformanceFix);

        var newBlobStr = `
            var Module = {
                WASM_BINARY_URL: 'https://static.twitchcdn.net/assets/wasmworker.min-${version}.wasm',
                WASM_CACHE_MODE: true
            }

            ${ functions }

            importScripts('https://static.twitchcdn.net/assets/wasmworker.min-${version}.js');
        `
        super(URL.createObjectURL(new Blob([newBlobStr])));
    }
}
