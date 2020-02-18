import { createHash, randomBytes } from "crypto";

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

    console.log("In Digest with params:")
    console.log({
        "username":username,
        "realm": realm,
        "password": password,
        "nonce": nonce,
        "httpMethod": httpMethod,
        "uri":uri,
        "qop": qop,
        "body": body,
        "cnonce": cnonce,
        "nc": nc
    })

    const ha1 = createHash("md5");  //create hash object
    ha1 //add elements listed below
        .update(username)
        .update(":")
        .update(realm)
        .update(":")
        .update(password);
    // TODO support "MD5-sess" algorithm directive
    const ha1d = ha1.digest("hex"); //get the digest

    const ha2 = createHash("md5"); //create hash object
    ha2 //add elements listed below
        .update(httpMethod)
        .update(":")
        .update(uri);

    if (qop === "auth-int") { //if qop equals "auth-int"
        const bodyHash = createHash("md5") //create hash object
            .update(body || "") //add body if specified
            .digest("hex"); //get the digest
        ha2.update(":").update(bodyHash); //add digest to ha2 hash
    }

    const ha2d = ha2.digest("hex"); //get the digest

    const hash = createHash("md5"); //create hash object
    hash
        .update(ha1d) //add HA1's digest
        .update(":")
        .update(nonce); //add server nonce
    if (qop) { //if qop is defined (quality of protection)
        hash
            .update(":")
            .update(nc) //add request counter
            .update(":")
            .update(cnonce) //add client nonce
            .update(":")
            .update(qop); //add qop
    }
    hash.update(":").update(ha2d); //add HA2's digest

    let res = hash.digest("hex");

    console.log("Exiting Digest with val: " + res)

    return res; //return digest of final hash
}


export function solveDigest(
    username: string | Buffer,
    password: string | Buffer,
    uri: string | Buffer,
    httpMethod: string | Buffer,
    body: string | Buffer,
    authHeader
): string {

    console.log("In solveDigest with params:")
    console.log({"username": username,
        "password": password,
        "uri": uri,
        "httpMethod": httpMethod,
        "body": body,
        "authHeader":authHeader})

    const cnonce = randomBytes(8).toString("hex");
    const nc = "00000001";

    let qop;
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


    console.log("Exiting solveDigest with value: " + authString)

    return authString;
}



export function parseWwwAuthenticateHeader(authHeader): {} {
    authHeader = authHeader.trim();
    const method = authHeader.split(" ", 1)[0];
    const res = { method: method };
    Object.assign(res, parseHeaderFeilds(authHeader.slice(method.length + 1)));

    console.log("Exiting parseWwwAuthenticateHeader with value:")
    console.log(res)
    return res;
}


/**
* Return object with header fields and values 
* @param str header fields as string
*/
function parseHeaderFeilds(str: string): {} {
    //example input:
    //username="Mufasa",
    //realm="testrealm@host.com",
    //nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093",
    //uri="/dir/index.html",
    //qop=auth,
    //nc=00000001,
    //cnonce="0a4f113b",
    //response="6629fae49393a05397450978507c4ef1",
    //opaque="5ccc069c403ebaf9f0171e9517f40e41"
    const res = {};
    const parts = str.split(","); //split string into name and value pairs based on commas
    let part;
    while ((part = parts.shift()) != null) { //pop element off array and check if it's null
        const name = part.split("=", 1)[0]; //get name 
        if (name.length === part.length) { // check if there is value
            if (!part.trim()) continue; //if there is nothing, continue
            throw new Error("Unable to parse auth header"); //otherwise, throw an error
        }

        let value = part.slice(name.length + 1); //everything that comes after equals 
        if (!/^\s*"/.test(value)) { //if it doesn't start with whitespace and "
            value = value.trim(); //set value equal to trimmed value
        } else {
            while (!/[^\\]"\s*$/.test(value)) { //while it doesn't end with \" 
                const p = parts.shift(); //get the next part
                if (p == null) throw new Error("Unable to parse auth header"); //if p is null then throw an error
                value += "," + p; //apend comma and p to value
            }

            try {
                value = JSON.parse(value); //try to convert value to JSON
            } catch (error) { //if caught error
                throw new Error("Unable to parse auth header"); //throw error
            }
        }
        res[name.trim()] = value; //add value to res index name
    }
    return res;
}