import * as http from "http";
import { parse } from "url"
import * as auth from "./auth"

async function httpConnectionRequest(address: string, username: string, password: string, timeout: number): Promise<void> {
    const options: http.RequestOptions = parse(address);
    if (options.protocol !== "http:")
        throw new Error("Invalid connection request URL or protocol");

    options.agent = new http.Agent({
        maxSockets: 1,
        keepAlive: true
    });

    let authHeader: {};

    let tries = 0;

    while (!authHeader || (username != null && password != null)) {
        if (tries > 5) {
            console.log("Tries exeded")
            break;
        }
        let opts = options;
        if (authHeader) {
            if (authHeader["method"] === "Digest") {
                opts = Object.assign(
                    {
                        headers: {
                            Authorization: auth.solveDigest(
                                username,
                                password,
                                options.path,
                                "GET",
                                null,
                                authHeader
                            )
                        }
                    },
                    options
                );
            } else {
                throw {name: 'UnrecognizedAuthMethod', message: 'Unrecognized auth method'};
            }
        }

        let res = await httpGet(opts, timeout);

        // Workaround for some devices unexpectedly closing the connection
        if (res.statusCode === 0)
            res = await httpGet(opts, timeout);
        if (res.statusCode === 0) throw {name: 'NoResponseFromCpe', message: 'Device is offline'};
        if (res.statusCode === 200 || res.statusCode === 204) {
            console.log("it worked")
            return;
        }
        if (res.statusCode === 401 && res.headers["www-authenticate"]) {
            tries++;
            console.log(res.headers["www-authenticate"])
            authHeader = auth.parseWwwAuthenticateHeader(res.headers["www-authenticate"]);
        } else {
            throw {name: 'UnrecognizedResponseCode', message: `Unexpected response code from device: ${res.statusCode}`};
        }
    }
    throw {
        name: 'IncorrectCredentials',
        message: 'Incorrect connection request credentials'
      };
}



function httpGet(options: http.RequestOptions, timeout: number): Promise<{ statusCode: number; headers: {} }> {
    return new Promise((resolve, reject) => {
        const req = http
            .get(options, res => {
                res.resume();
                resolve({ statusCode: res.statusCode, headers: res.headers });
            })
            .on("error", err => {
                req.abort();
                reject(new Error("Device is offline"));
            })
            .on("socket", socket => {
                socket.setTimeout(timeout);
                socket.on("timeout", () => {
                    req.abort();
                });
            });
    });
}