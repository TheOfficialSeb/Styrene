const HTTP = require("http")
const PathUtil = require("path")
const {URL} = require("url")
const FileSystem = require("fs")
const Events = require("events")
const PathExp = require("./pathexp")
/**
 * @typedef {Object} Handler
 * @property {Method} method
 * @property {Function} pathMatcher
 * @property {RequestHandler} callback
*/
/**
 * @typedef {'GET' | 'POST'} Method
 */
/**
 * @callback RequestHandler
 * @param {HTTP.IncomingMessage} Request
 * @param {HTTP.ServerResponse} Response
 * @param {URL} RequestURL
 * @param {Object} Params
 * @param {UseFallback} UseFallback
 */
/**
 * @callback UseFallback
 * @param {String} [CustomDirectory]
 */
class Server{
    #PublicDirectory = ""
    /**
	 * @type {HTTP.Server}
    */
    #HTTPServer;
    /**
	 * @type {Handler[]}
    */
    #Handlers = []
    constructor(PublicDirectory){
        this.#HTTPServer = new HTTP.Server()
        this.#PublicDirectory = PathUtil.resolve(PublicDirectory)
        console.log(this.#PublicDirectory)
        this.#HTTPServer.addListener("request",this.#requestHandle.bind(this))
    }
    /**
	 * @param {HTTP.IncomingMessage} Request
	 * @param {HTTP.ServerResponse} Response
    */
    #requestHandle(Request,Response) {
        try{
            Response.setHeader("server","Styrene")
            if (!Request.url.match(/^\/+/))throw "Failure to correctly start a proper url"
            let RequestURL = new URL(`http://${Request.headers.host || `localhost:${Request.socket.localPort}`}${Request.url}`)
            RequestURL.pathname = decodeURIComponent(RequestURL.pathname)
            for (const Handler of this.#Handlers){
                if (Handler.method === Request.method){
                    let Match = Handler.pathMatcher(RequestURL.pathname)
                    if (Match !== false){
                        try{
                            Handler.callback(Request,Response,RequestURL,Match.params,this.#doFallback.bind(this,Request,Response,RequestURL))
                        }catch(Err){
                            if (!Response.closed){
                                Response.writeHead(500)
                                Response.end(`Interal Server Error\n${Err.message || Err}`)
                            }
                        }
                        return;
                    }
                }
            }
            this.#useDirectory(Request,Response,RequestURL)
        }catch(Err){
            if (!Response.closed){
                Response.writeHead(400)
                Response.end(`Bad Request\n${Err.message || Err}`)
            }
        }
    }
    /**
     * @param {HTTP.IncomingMessage} Request
     * @param {HTTP.ServerResponse} Response
     * @param {URL} RequestURL
     * @param {String} [CustomDirectory]
     */
    #useDirectory(Request,Response,RequestURL,CustomDirectory){
        let FilePath = PathUtil.join(CustomDirectory || this.#PublicDirectory,decodeURIComponent(RequestURL.pathname).replace(/\/$/,"/index.html"))
        let FileStream
		let Extname = PathUtil.extname(FilePath)
        let Stats = FileSystem.existsSync(FilePath) && FileSystem.statSync(FilePath)
		if (Stats && Stats.isFile()){
			FileStream = FileSystem.createReadStream(FilePath)
        }else if(Stats && Stats.isDirectory() && PathUtil.dirname(FilePath) != FilePath){
            RequestURL.pathname+="/"
            Response.writeHead(302,{"location":RequestURL.href.slice(RequestURL.origin.length)})
			return Response.end()
        }else{
            Response.writeHead(404)
			return Response.end("Not Found")
		}
		//this.#applyMime(Response,Extname)
		FileStream.pipe(Response)
	}
    /**
     * @param {Method} Method 
     * @param {String} Path 
     * @param {RequestHandler} RequestHandler
     */
    on(Method,Path,RequestHandler){
        if (!HTTP.METHODS.includes(Method))throw "Method should be GET or POST";
        if (!(typeof Path === "string" && Path.startsWith("/"))){throw "Path must be a string that starts with a /"}
        if (!(typeof RequestHandler === "function"))throw "RequestHandler must be defined";
        this.#Handlers.push({
            "callback": RequestHandler,
            "method": Method,
            "pathMatcher": PathExp.match(Path)
        })
    }
    /**
     * @param {HTTP.IncomingMessage} Request
     * @param {HTTP.ServerResponse} Response
     * @param {URL} RequestURL
     * @param {String} [CustomDirectory]
     */
    #doFallback(Request,Response,RequestURL,CustomDirectory){
        try{
            if (!Request.closed)this.#useDirectory(Request,Response,RequestURL,CustomDirectory)
        }catch{}
    }
    /**
     * @param {Number} port 
     */
    listen(port) {
        this.#HTTPServer.listen(port)
    }
}
module.exports = Server