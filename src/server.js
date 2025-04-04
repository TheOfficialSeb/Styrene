const HTTP = require("node:http");
const pathUtil = require("node:path");
const fileSystem = require("node:fs");
const { URL } = require("node:url");
const pathExp = require("./pathexp");
const mime = require("./mime.json");
/**
 * @typedef {Object} Options
 * @property {String} [staticDirectory]
 * @property {Boolean} [directoryBrowser]
 * @property {String} [workingDirectory]
 * @property {DefaultResponder} [defaultResponder]
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
 * @typedef {'vanilla' | 'react' | 'throw'} DefaultResponder
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
     * @type {DefaultResponder}
     */
    #defaultResponder = "";

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
        const { staticDirectory, workingDirectory = process.cwd(), directoryBrowser = false, defaultResponder = "vanilla" } = options;
        if (typeof staticDirectory != "string" && defaultResponder !== "throw") throw "Options must contain {String} key 'staticDirectory'";
        this.#httpServer = new HTTP.Server();
        this.#staticDirectory = staticDirectory ? pathUtil.resolve(workingDirectory, staticDirectory) : "";
        this.#httpServer.addListener("request", this.#requestHandle.bind(this));
        this.#defaultResponder = defaultResponder;
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
                    if (response.closed || response.headersSent) return;
                    response.writeHead(500, { "content-type": "text/html" });
                    response.end(this.#generateHTMLError(500, "Internal Server Error"));
                }
                return;
            }
            this.#useDirectory(request, response, requestURL);
        } catch (err) {
            if (response.closed || response.headersSent) return;
            response.writeHead(400, { "content-type": "text/html" });
            response.end(this.#generateHTMLError(400, "Bad Request"));
        }
    }
    #errorHTMLFormat = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Error {0}</title></head><body style="display:flex;justify-content:center;align-items:center;height:100vh;margin:0; font-family: Arial,sans-serif;text-align:center;background-color:#111;color:#ff6464;"><div style="padding: 20px;"><h1 style="font-size:50px;margin: 0;">{0}</h1><p style="font-size:20px;margin: 10px 0 0;">{1}</p></div></body></html>';
    /**
     * @param {Number} code 
     * @param {String} message 
     * @returns {String}
     */
    #generateHTMLError(code, message) {
        let args = [code, message];
        return this.#errorHTMLFormat.replace(/{(\d+)}/g, (m, n) => (args)[n] ?? m);
    }
    /**
     * 
     * @param {String} mimeType 
     * @returns {Array<String>}
     */
    #getExtensionsForMimeType(mimeType) {
        let isWildcard = mimeType === "*/*";
        let halfWildcard = mimeType.match(/(.+)\/\*$/);
        let keys = Object.keys(mime);
        return isWildcard ? keys : keys.filter(ext => halfWildcard ? mime[ext].startsWith(halfWildcard[1]) : mime[ext] === mimeType);
    }
    /**
     * @param {HTTP.IncomingMessage} request
     * @param {HTTP.ServerResponse} response
     * @param {URL} requestURL
     * @param {String} [customDirectory]
     */
    #useDirectory(request, response, requestURL, customDirectory) {
        if (this.#defaultResponder === "throw") {
            response.writeHead(500, { "content-type": "text/html" });
            response.end(this.#generateHTMLError(500, "Internal Server Error"));
            return;
        }
        let acceptMime = request.headers?.accept ? request.headers?.accept.split(',').map(type => type.trim().split(";")[0]).filter(type => type.length > 0) : ["*/*"];
        let filePath = pathUtil.join(customDirectory || this.#staticDirectory, decodeURIComponent(requestURL.pathname).replace(/\/$/, "/index.html"));
        let fileStream;
        let baseName = pathUtil.basename(filePath);
        let extName = pathUtil.extname(filePath).slice(1);
        let dirName = pathUtil.dirname(filePath);
        let stats = fileSystem.existsSync(filePath) && fileSystem.statSync(filePath);
        if (!stats && !extName.length) {
            let possibleExts = acceptMime.map(e => this.#getExtensionsForMimeType(e)).flat()
            let newStats;
            for (extName of possibleExts) {
                filePath = pathUtil.join(dirName, `${baseName}.${extName}`);
                newStats = fileSystem.existsSync(filePath) && fileSystem.statSync(filePath);
                if (newStats) break;
            }
            if (newStats) stats = newStats;
        }
        if (!stats && this.#defaultResponder === "react" && (acceptMime.includes("text/html") || acceptMime.includes("*/*"))) {
            filePath = pathUtil.join(customDirectory || this.#staticDirectory, "index.html");
            baseName = pathUtil.basename(filePath);
            extName = pathUtil.extname(filePath).slice(1);
            dirName = pathUtil.dirname(filePath);
            stats = fileSystem.existsSync(filePath) && fileSystem.statSync(filePath);
        }
        if (stats && stats.isFile()) {
            fileStream = fileSystem.createReadStream(filePath);
        } else if (stats && stats.isDirectory() && dirName != filePath) {
            requestURL.pathname += "/";
            response.writeHead(302, { "location": requestURL.href.slice(requestURL.origin.length) });
            response.end();
            return;
        } else {
            response.writeHead(404);
            response.end(this.#generateHTMLError(404, "Not Found"));
            return;
        }
        response.writeHead(200, { "Content-Type": mime[extName] ?? "application/octet-stream" });
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