const HTTP = require("node:http");
const pathUtil = require("node:path");
const fileSystem = require("node:fs");
const { URL } = require("node:url");
const pathExp = require("./pathexp");
const MIME = require("./mime.js");
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
 * @typedef {Object} MidListener
 * @property {Function} pathMatcher
 * @property {RequestListener} callback
*/
/**
 * @typedef {'GET' | 'POST' | 'CONNECT' | 'DELETE' | 'GET' | 'HEAD' | 'OPTIONS' | 'PUT' | 'TRACE'} Method
 */
/**
 * @typedef {'vanilla' | 'singlepage' | 'throw'} DefaultResponder
 */
/**
 * @callback RequestListener
 * @param {HTTP.IncomingMessage} request
 * @param {HTTP.ServerResponse} response
 * @param {URL} requestURL
 * @param {Object} params
 */
/**
 * @callback RequestMidListener
 * @param {HTTP.IncomingMessage} request
 * @param {HTTP.ServerResponse} response
 * @param {UseNext} useNext
 * @param {URL} requestURL
 * @param {Object} params
 */
/**
 * @callback UseNext
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
     * @type {Listener[]}
    */
    #listeners = [];
    /**
     * @type {MidListener[]}
    */
    #midListeners = [];
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
     * @param {URL} requestURL
    */
    #listenerHandle(request, response, requestURL) {
        const methodListeners = this.#listeners.filter(listener => listener.method === request.method);
        for (let listener of methodListeners) {
            let match = listener.pathMatcher(requestURL.pathname);
            if (!match) continue;
            try {
                listener.callback(request, response, requestURL, match.params);
            } catch (err) {
                if (response.closed || response.headersSent) return;
                response.writeHead(500, { "content-type": "text/html" });
                response.end(this.#generateHTMLError(500, "Internal Server Error"));
            }
            return;
        }
        this.#useDirectory(request, response, requestURL);
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
            const midListeners = [...this.#midListeners]
            midListeners.reverse();
            let useNext = this.#listenerHandle.bind(this,request, response, requestURL);
            for (let listener of midListeners) {
                let match = listener.pathMatcher(requestURL.pathname);
                if (!match) continue;
                useNext = listener.callback.bind(listener.callback,request,response,useNext,requestURL,match.params);
            }
            useNext();
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
        let extName = pathUtil.extname(filePath).slice(1);
        let dirName = pathUtil.dirname(filePath);
        let stats = fileSystem.existsSync(filePath) && fileSystem.statSync(filePath);
        if (request.headers["accept-encoding"]?.includes("gzip") && fileSystem.existsSync(filePath + ".gz")) {
            filePath += ".gz";
            stats = fileSystem.statSync(filePath);
            response.setHeader("Content-Encoding", "gzip");
        }
        if (!stats && this.#defaultResponder === "singlepage" && (acceptMime.includes("text/html") || acceptMime.includes("*/*"))) {
            filePath = pathUtil.join(customDirectory || this.#staticDirectory, "index.html");
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
        response.writeHead(200, { "Content-Type": MIME.get(extName) ?? "application/octet-stream", "Content-Length": stats.size });
        fileStream.pipe(response, { end: true, });
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
     * @param {String} path 
     * @param {RequestMidListener} listener
     */
    use(path, listener) {
        if (!(typeof path == "string" && path.startsWith("/"))) throw "Path must be a string that starts with a /";
        if (!(typeof listener == "function")) throw "Listener must be function";

        this.#midListeners.push({
            "callback": listener,
            "pathMatcher": pathExp.match(path)
        });
    }

    /**
     * @param {Number} port 
     */
    listen(port) {
        this.#httpServer.listen(port);
    }
}

module.exports = Server;