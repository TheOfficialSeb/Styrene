let db = require("./db.json")
let keys = []
let values = []
for (var mimeName in db){
    if (db[mimeName].extensions){
        keys.push(mimeName)
        let index = keys.indexOf(mimeName)
        for (var extension of db[mimeName].extensions){
            if (!keys.includes(extension))keys.push(extension);
            let eindex = keys.indexOf(extension)
            if (!values[eindex])values[eindex]=[];
            values[eindex].push(index)
        }
        values[keys.indexOf(mimeName)] = db[mimeName].extensions.map(e=>keys.indexOf(e))
    }
}
let data = JSON.stringify({k:keys,v:values})
require("fs").writeFileSync(`${require("crypto").createHash("sha1").update(data).digest("hex").slice(0,7)}.json`,data)
let j1 = keys.indexOf("text/html")
let j2 = keys.indexOf("html")
console.log(values[j1].map(v=>keys[v]))
console.log(values[j2].map(v=>keys[v]))