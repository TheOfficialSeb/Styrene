let {k:keys,v:values} = require("./mime.json")
function get(key){
    return keys.includes(key) ? values[keys.indexOf(key)].map(v=>keys[v]) : false
}
module.exports = {get,keys}