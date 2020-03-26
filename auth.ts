import { createHash, randomBytes, Hash } from "crypto";

/**
 * generate MD5 digest response
 * @param username 
 * @param realm 
 * @param password 
 * @param nonce server nonce
 * @param httpMethod 
 * @param uri uniform recourse identifier
 * @param qop quality of protection
 * @param body entity body
 * @param cnonce client nonce
 * @param nc request counter
 */
export function digest(
    username: string | Buffer,
    realm: string | Buffer,
    password: string | Buffer,
    nonce: string | Buffer,
    httpMethod: string | Buffer,
    uri: string | Buffer,
    qop?: string | Buffer,
    body?: string | Buffer,
    cnonce?: string | Buffer,
    nc?: string | Buffer
): string {

    // see details here: https://tools.ietf.org/html/rfc2069

    const ha1: Hash = createHash("md5");  //create hash object
    ha1 //add elements to hash
        .update(username)
        .update(":")
        .update(realm)
        .update(":")
        .update(password);
    const ha1d: string = ha1.digest("hex"); //get the digest as hex

    const ha2: Hash = createHash("md5"); //create hash object
    ha2 //add elements to hash
        .update(httpMethod)
        .update(":")
        .update(uri);

    if (qop === "auth-int") { //if qop equals "auth-int"
        const bodyHash = createHash("md5") //create hash object
            .update(body || "") //add body if specified
            .digest("hex"); //get the digest as hex
        ha2.update(":").update(bodyHash); //add digest to ha2 hash
    }

    const ha2d: string = ha2.digest("hex"); //get the digest as hex

    const hash: Hash = createHash("md5"); //create hash object
    hash //add elements to hash
        .update(ha1d) 
        .update(":")
        .update(nonce); 
    if (qop) { //if qop is defined (quality of protection)
        hash //add elements to hash
            .update(":")
            .update(nc) 
            .update(":")
            .update(cnonce) 
            .update(":")
            .update(qop); 
    }
    hash.update(":").update(ha2d); //add HA2's digest

    let res: string = hash.digest("hex"); //get the digest as hex


    return res; //return digest of final hash
}

/**
 * Generate authentication string for HTTP header 
 * @param username 
 * @param password 
 * @param uri 
 * @param httpMethod 
 * @param body 
 * @param authHeader 
 */
export function solveDigest(
    username: string | Buffer,
    password: string | Buffer,
    uri: string | Buffer,
    httpMethod: string | Buffer,
    body: string | Buffer,
    authHeader
): string {

    // see details here: https://tools.ietf.org/html/rfc2069

    const cnonce = randomBytes(8).toString("hex");
    const nc = "00000001";

    let qop: string;
    if (authHeader.qop) {
        if (authHeader.qop.indexOf(",") !== -1) qop = "auth";
        // Either auth or auth-int, prefer auth
        else qop = authHeader.qop;
    }

    const hash = digest(
        username,
        authHeader.realm,
        password,
        authHeader.nonce,
        httpMethod,
        uri,
        qop,
        body,
        cnonce,
        nc
    );

    let authString = `Digest username="${username}"`;
    authString += `,realm="${authHeader.realm}"`;
    authString += `,nonce="${authHeader.nonce}"`;
    authString += `,uri="${uri}"`;
    if (authHeader.algorithm) authString += `,algorithm=${authHeader.algorithm}`;
    if (qop) authString += `,qop=${qop},nc=${nc},cnonce="${cnonce}"`;
    authString += `,response="${hash}"`;
    if (authHeader.opaque) authString += `,opaque="${authHeader.opaque}"`;


    return authString;
}

/**
 * Parse Www-Authenticate header into a more manageable object
 * @param authHeader 
 */
export function parseWwwAuthenticateHeader(authHeader: string): {} {
    authHeader = authHeader.trim();
    const method = authHeader.split(" ", 1)[0];
    const res = { method: method };
    Object.assign(res, parseHeaderFeilds(authHeader.slice(method.length + 1)));

    return res;
}

/**
* Return object with header fields and values 
* @param str header fields as string
*/
function parseHeaderFeilds(str: string): {} {
    const res = {};
    const parts = str.split(","); //split string into name and value pairs based on commas
    let part: string;
    while ((part = parts.shift()) != null) { //pop element off array and check if it's null
        const name = part.split("=", 1)[0]; //get name 
        if (name.length === part.length) { // check if there is value
            if (!part.trim()) continue; //if there is nothing, continue
            throw new Error("Unable to parse auth header"); //otherwise, throw an error
        }

        let value = part.slice(name.length + 1); //everything that comes after equals 
        if (!RegExp('^\s*"').test(value)) {//if it doesn't start with whitespace and "
            value = value.trim(); //set value equal to trimmed value
        } else {
            while (!/[^\\]"\s*$/.test(value)) { //while it doesn't end with \" 
                const p = parts.shift(); //get the next part
                if (p == null) throw new Error("Unable to parse auth header"); //if p is null then throw an error
                value += "," + p; //append comma and p to value
            }

            try {
                value = JSON.parse(value); //try to convert value to JSON
            } catch (error) { //if caught error
                throw new Error("Unable to parse auth header"); //throw error
            }
        }
        res[name.trim()] = value; //add value to res[name]
    }
    return res;
}