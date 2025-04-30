const {Server:STServer} = require("./../")
const Server = new STServer({
    "staticDirectory": __dirname+"/public"
})
Server.listen(3040)