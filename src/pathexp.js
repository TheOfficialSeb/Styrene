const ID_START = /^[$_\p{ID_Start}]$/u;
const ID_CONTINUE = /^[$\u200c\u200d\p{ID_Continue}]$/u;
const SIMPLE_TOKENS = {
    "{": "{",
    "}": "}",
    "(": "(",
    ")": ")",
    "[": "[",
    "]": "]",
    "+": "+",
    "?": "?",
    "!": "!",
};
function escape(str) {
    return str.replace(/[.+*?^${}()[\]|/\\]/g, "\\$&");
}
function* lexer(str) {
    const chars = [...str];
    let i = 0;
    function name() {
        let value = "";
        if (ID_START.test(chars[++i])) {
            value += chars[i];
            while (ID_CONTINUE.test(chars[++i])) {
                value += chars[i];
            }
        }
        else if (chars[i] === '"') {
            let pos = i;
            while (i < chars.length) {
                if (chars[++i] === '"') {
                    i++;
                    pos = 0;
                    break;
                }
                if (chars[i] === "\\") {
                    value += chars[++i];
                }
                else {
                    value += chars[i];
                }
            }
            if (pos) {
                throw new TypeError(`Unterminated quote at ${pos}`);
            }
        }
        if (!value) {
            throw new TypeError(`Missing parameter name at ${i}`);
        }
        return value;
    }
    while (i < chars.length) {
        const value = chars[i];
        const type = SIMPLE_TOKENS[value];
        if (type) {
            yield { type, index: i++, value };
        }
        else if (value === "\\") {
            yield { type: "ESCAPED", index: i++, value: chars[i++] };
        }
        else if (value === ":") {
            const value = name();
            yield { type: "PARAM", index: i, value };
        }
        else if (value === "*") {
            const value = name();
            yield { type: "WILDCARD", index: i, value };
        }
        else {
            yield { type: "CHAR", index: i, value: chars[i++] };
        }
    }
    return { type: "END", index: i, value: "" };
}
class Iter {
    constructor(tokens) {
        this.tokens = tokens;
    }
    peek() {
        if (!this._peek) {
            const next = this.tokens.next();
            this._peek = next.value;
        }
        return this._peek;
    }
    tryConsume(type) {
        const token = this.peek();
        if (token.type !== type)
            return;
        this._peek = undefined; // Reset after consumed.
        return token.value;
    }
    consume(type) {
        const value = this.tryConsume(type);
        if (value !== undefined)
            return value;
        const { type: nextType, index } = this.peek();
        throw new TypeError(`Unexpected ${nextType} at ${index}, expected ${type}`);
    }
    text() {
        let result = "";
        let value;
        while ((value = this.tryConsume("CHAR") || this.tryConsume("ESCAPED"))) {
            result += value;
        }
        return result;
    }
}
function parse(str) {
    const it = new Iter(lexer(str));
    function consume(endType) {
        const tokens = [];
        while (true) {
            const path = it.text();
            if (path)
                tokens.push({ type: "text", value: path });
            const param = it.tryConsume("PARAM");
            if (param) {
                tokens.push({
                    type: "param",
                    name: param,
                });
                continue;
            }
            const wildcard = it.tryConsume("WILDCARD");
            if (wildcard) {
                tokens.push({
                    type: "wildcard",
                    name: wildcard,
                });
                continue;
            }
            const open = it.tryConsume("{");
            if (open) {
                tokens.push({
                    type: "group",
                    tokens: consume("}"),
                });
                continue;
            }
            it.consume(endType);
            return tokens;
        }
    }
    const tokens = consume("END");
    return tokens
}
function* flatten(tokens, index, init) {
    if (index === tokens.length) {
        return yield init;
    }
    const token = tokens[index];
    if (token.type === "group") {
        const fork = init.slice();
        for (const seq of flatten(token.tokens, 0, fork)) {
            yield* flatten(tokens, index + 1, seq);
        }
    }
    else {
        init.push(token);
    }
    yield* flatten(tokens, index + 1, init);
}
function sequenceToRegExp(tokens, keys) {
    let result = "";
    let backtrack = "";
    let isSafeSegmentParam = true;
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (token.type === "text") {
            result += escape(token.value);
            backtrack += token.value;
            isSafeSegmentParam || (isSafeSegmentParam = token.value.includes("/"));
            continue;
        }
        if (token.type === "param" || token.type === "wildcard") {
            if (!isSafeSegmentParam && !backtrack) {
                throw new TypeError(`Missing text after "${token.name}"`);
            }
            if (token.type === "param") {
                result += `(${negate("/", isSafeSegmentParam ? "" : backtrack)}+)`;
            }
            else {
                result += `([\\s\\S]+)`;
            }
            keys.push(token);
            backtrack = "";
            isSafeSegmentParam = false;
            continue;
        }
    }
    return result;
}
function negate(delimiter, backtrack) {
    if (backtrack.length < 2) {
        if (delimiter.length < 2)
            return `[^${escape(delimiter + backtrack)}]`;
        return `(?:(?!${escape(delimiter)})[^${escape(backtrack)}])`;
    }
    if (delimiter.length < 2) {
        return `(?:(?!${escape(backtrack)})[^${escape(delimiter)}])`;
    }
    return `(?:(?!${escape(backtrack)}|${escape(delimiter)})[\\s\\S])`;
}
function matchInput(input) {
    const m = this.regexp.exec(input);
    if (!m)
        return false;
    const path = m[0];
    const params = {};
    for (let i = 1; i < m.length; i++) {
        if (m[i] === undefined)
            continue;
        const key = this.keys[i - 1];
        const decoder = this.decoders[i - 1];
        params[key.name] = decoder(m[i]);
    }
    return { path, params };
};
function match(path) {
    const keys = [];
    const sources = [];
    for (const seq of flatten(parse(path), 0, []))sources.push(sequenceToRegExp(seq, keys));
    const regexp = new RegExp(`^(?:${sources.join("|")})(?:${escape("/")}$)?$`, "i");
    const decoders = keys.map((key) => {
        if (key.type === "param")
            return decodeURIComponent;
        return (value) => value.split("/").map(decodeURIComponent);
    });
    return matchInput.bind({
        keys,
        regexp,
        decoders
    })
}
module.exports = {match};