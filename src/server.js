const HTTP = require("node:http");
const pathUtil = require("node:path");
const fileSystem = require("node:fs");
const { URL } = require("node:url");
const pathExp = require("./pathexp");

/**
 * @typedef {Object} handler
 * @property {method} method
 * @property {Function} pathMatcher
 * @property {RequestHandler} callback
*/
/**
 * @typedef {'CONNECT' | 'DELETE' | 'GET' | 'HEAD' | 'OPTIONS' | 'POST' | 'PUT' | 'TRACE'} method
 */
/**
 * @callback RequestHandler
 * @param {HTTP.IncomingMessage} request
 * @param {HTTP.ServerResponse} response
 * @param {URL} requestURL
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
    #publicDirectory = "";

    /**
     * @type {HTTP.Server}
    */
    httpServer;

    /**
     * @type {handler[]}
    */
    #handlers = [];

    constructor(publicDirectory) {
        if (!publicDirectory) throw "No public/static directory specified";
        this.httpServer = new HTTP.Server();
        this.#publicDirectory = pathUtil.resolve(publicDirectory);
        this.httpServer.addListener("request", this.#requestHandle.bind(this));
    }

    /**
     * @param {HTTP.IncomingMessage} request
     * @param {HTTP.ServerResponse} response
    */
    #requestHandle(request, response) {
        try {
            if (!request.url.match(/^\/+/)) throw "Failure to correctly start a proper url";
            response.setHeader("server", "Styrene");
            let requestURL = new URL(`http://${request.headers.host || `localhost:${request.socket.localPort}`}${request.url}`);
            requestURL.pathname = decodeURIComponent(requestURL.pathname);

            const validHandlers = this.#handlers.filter(handler => handler.method === request.method);

            for (let handler of validHandlers) {
                let match = handler.pathMatcher(requestURL.pathname);
                if (!match) continue;
                try {
                    handler.callback(request, response, requestURL, match.params, this.#doFallback.bind(this, request, response, requestURL));
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
        let filePath = pathUtil.join(customDirectory || this.#publicDirectory, decodeURIComponent(requestURL.pathname).replace(/\/$/, "/index.html"));
        let fileStream;
        let extName = pathUtil.extname(filePath);
        let stats = fileSystem.existsSync(filePath) && fileSystem.statSync(filePath);

        if (stats && stats.isFile()) {
            fileStream = fileSystem.createReadStream(filePath);
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
        //this.#applyMime(Response, Extname)
        fileStream.pipe(response, { end: true });
    }

    /**
     * @param {method} method 
     * @param {String} path 
     * @param {RequestHandler} requestHandler
     */
    on(method, path, requestHandler) {
        if (!HTTP.METHODS.includes(method)) throw "Invalid HTTP method";
        if (!(typeof path == "string" && path.startsWith("/"))) throw "Path must be a string that starts with a /";
        if (!(typeof requestHandler == "function")) throw "RequestHandler must be defined";

        this.#handlers.push({
            "callback": requestHandler,
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
            if (!request.closed) this.#useDirectory(request, response, requestURL, customDirectory);
        } catch {}
    }

    /**
     * @param {Number} port 
     */
    listen(port) {
        this.httpServer.listen(port);
    }
}

module.exports = Server;