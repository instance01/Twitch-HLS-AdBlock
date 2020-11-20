console.log("Injected Twitch HLS Adblock.");

const SUPPORTED_VERSION = "2.9.1";
const oldWorker = window.Worker;
window.Worker = class Worker extends oldWorker {
    constructor(twitchBlobUrl) {
        var jsURL = getWasmWorkerUrl(twitchBlobUrl);
        var version = jsURL.match(/wasmworker\.min\-(.*)\.js/)[1];
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
                WASM_BINARY_URL: '${jsURL.replace('.js', '.wasm')}',
                WASM_CACHE_MODE: true
            }

            ${ functions }

            importScripts('${jsURL}');
        `
        super(URL.createObjectURL(new Blob([newBlobStr])));
    }
}

