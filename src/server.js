const HTTP = require("node:http");
const pathUtil = require("node:path");
const fileSystem = require("node:fs");
const { URL } = require("node:url");
const pathExp = require("./pathexp");
const mime = require("./mime.json");
/**
 * @typedef {Object} Options
 * @property {String} staticDirectory
 * @property {Boolean} [directoryBrowser]
 * @property {String} [workingDirectory]
*/
/**
 * @typedef {Object} Listener
 * @property {Method} method
 * @property {Function} pathMatcher
 * @property {RequestListener} callback
*/
/**
 * @typedef {'GET' | 'POST' | 'CONNECT' | 'DELETE' | 'GET' | 'HEAD' | 'OPTIONS' | 'PUT' | 'TRACE'} Method
 */
/**
 * @callback RequestListener
 * @param {HTTP.IncomingMessage} request
 * @param {HTTP.ServerResponse} response
 * @param {URL} requestURL
 * @param {Object} params
 * @param {UseFallback} useFallback
 */
/**
 * @callback RequestErrorListener
 * @param {HTTP.IncomingMessage} request
 * @param {HTTP.ServerResponse} response
 * @param {URL} requestURL
 * @param {Number} errorCode
 * @param {Object} params
 * @param {UseFallback} useFallback
 */
/**
 * @callback UseFallback
 * @param {String} [customDirectory]
 */
class Server {
    /**
     * @type {String}
     */
    #staticDirectory = "";

    /**
     * @type {HTTP.Server}
    */
    #httpServer;
    get httpServer() { // Used to prevent writes to private value
        return this.#httpServer;
    }
    /**
     * @type {listener[]}
    */
    #listeners = [];

    /**
     * @param {Options} options
    */
    constructor(options) {
        const { staticDirectory, workingDirectory = process.cwd(), directoryBrowser = false } = options;
        if (typeof staticDirectory != "string") throw "Options must contain {String} key 'staticDirectory'";
        this.#httpServer = new HTTP.Server();
        this.#staticDirectory = pathUtil.resolve(workingDirectory, staticDirectory);
        this.#httpServer.addListener("request", this.#requestHandle.bind(this));
    }

    /**
     * @param {HTTP.IncomingMessage} request
     * @param {HTTP.ServerResponse} response
    */
    #requestHandle(request, response) {
        try {
            if (!request.url.match(/^\/+/)) throw "Failure to correctly start a proper url";
            response.setHeader(!request.headers["x-forwarded-for"] ? "server" : "x-server", "Styrene");
            let requestURL = new URL(`http://${request.headers.host || `localhost:${request.socket.localPort}`}${request.url}`);
            requestURL.pathname = decodeURIComponent(requestURL.pathname);

            const methodListeners = this.#listeners.filter(listener => listener.method === request.method);

            for (let listener of methodListeners) {
                let match = listener.pathMatcher(requestURL.pathname);
                if (!match) continue;
                try {
                    listener.callback(request, response, requestURL, match.params, this.#doFallback.bind(this, request, response, requestURL));
                } catch (err) {
                    if (response.closed) return;
                    response.writeHead(500);
                    response.end(`Internal Server Error\n${err.message || err}`);
                }
                return;
            }
            this.#useDirectory(request, response, requestURL);
        } catch (err) {
            if (response.closed) return;
            response.writeHead(400);
            response.end(`Bad Request\n${err.message || err}`);
        }
    }

    /**
     * @param {HTTP.IncomingMessage} request
     * @param {HTTP.ServerResponse} response
     * @param {URL} requestURL
     * @param {String} [customDirectory]
     */
    #useDirectory(request, response, requestURL, customDirectory) {
        let filePath = pathUtil.join(customDirectory || this.#staticDirectory, decodeURIComponent(requestURL.pathname).replace(/\/$/, "/index.html"));
        let fileStream;
        let extName = pathUtil.extname(filePath).slice(1);
        let stats = fileSystem.existsSync(filePath) && fileSystem.statSync(filePath);

        if (stats && stats.isFile()) {
            fileStream = fileSystem.createReadStream(filePath);
            Response.setHeader("Content-Type", mime[extName] ?? "application/octet-stream")
        } else if (stats && stats.isDirectory() && pathUtil.dirname(filePath) != filePath) {
            requestURL.pathname += "/";
            response.writeHead(302, { "location": requestURL.href.slice(requestURL.origin.length) });
            response.end();
            return;
        } else {
            response.writeHead(404);
            response.end("Not Found");
            return;
        }
        fileStream.pipe(response, { end: true });
    }

    /**
     * @param {Method} method 
     * @param {String} path 
     * @param {RequestListener} listener
     */
    on(method, path, listener) {
        if (!HTTP.METHODS.includes(method)) throw "Invalid HTTP method";
        if (!(typeof path == "string" && path.startsWith("/"))) throw "Path must be a string that starts with a /";
        if (!(typeof listener == "function")) throw "Listener must be function";

        this.#listeners.push({
            "callback": listener,
            "method": method,
            "pathMatcher": pathExp.match(path)
        });
    }
    /**
     * @param {RequestErrorListener} listener
     */
    onError(listener) {
        if (!HTTP.METHODS.includes(method)) throw "Invalid HTTP method";
        if (!(typeof path == "string" && path.startsWith("/"))) throw "Path must be a string that starts with a /";
        if (!(typeof listener == "function")) throw "Listener must be function";

        this.#listeners.push({
            "callback": listener,
            "method": method,
            "pathMatcher": pathExp.match(path)
        });
    }

    /**
     * @param {HTTP.IncomingMessage} request
     * @param {HTTP.ServerResponse} response
     * @param {URL} requestURL
     * @param {String} [customDirectory]
     */
    #doFallback(request, response, requestURL, customDirectory) {
        try {
            if (!response.closed) this.#useDirectory(request, response, requestURL, customDirectory);
        } catch { }
    }

    /**
     * @param {Number} port 
     */
    listen(port) {
        this.#httpServer.listen(port);
    }
}

module.exports = Server;