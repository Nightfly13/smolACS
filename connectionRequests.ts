import * as http from "http";
import { parse } from "url"
import * as auth from "./auth"
import { client, xml } from '@xmpp/client'
import { randomBytes } from "crypto";
//import * as debug from '@xmpp/debug';

const xmppServer = "10.200.3.210:5222"
const xmppUsername = "xmpptest"
const xmppPassword = "12341234"
const xmppCpeID = "nalstrongap@tr069.com/102024041800381"

export async function makeConnectionRequest(address: string, username: string, password: string, timeout: number): Promise<void> {
    try {
        await httpConnectionRequest(address, username, password, timeout)
    } catch (error) {
        if (error.name == 'NoResponseFromCpe') {
            console.log("trying xmpp");
            await xmppConnectionRequest(address, username, password)
        }
        else {
            console.log("throwing error: " + error)
            throw new Error(error.message)
        }
    }
}

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
                throw { name: 'UnrecognizedAuthMethod', message: 'Unrecognized auth method' };
            }
        }

        let res = await httpGet(opts, timeout);

        // Workaround for some devices unexpectedly closing the connection
        if (res.statusCode === 0)
            res = await httpGet(opts, timeout);
        if (res.statusCode === 0) throw { name: 'NoResponseFromCpe', message: 'Device is offline' };
        if (res.statusCode === 200 || res.statusCode === 204) {
            console.log("it worked")
            return;
        }
        if (res.statusCode === 401 && res.headers["www-authenticate"]) {
            tries++;
            console.log(res.headers["www-authenticate"])
            authHeader = auth.parseWwwAuthenticateHeader(res.headers["www-authenticate"]);
        } else {
            throw { name: 'UnrecognizedResponseCode', message: `Unexpected response code from device: ${res.statusCode}` };
        }
    }
    throw {
        name: 'IncorrectCredentials',
        message: 'Incorrect connection request credentials'
    };
}

let xmpp: any;

async function xmppConnectionRequest(address: string, username: string, password: string): Promise<void> {
    process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";

    xmpp = client({
        service: `xmpp://${xmppServer}`,
        resource: "example", //randomBytes(8).toString("hex"),
        username: xmppUsername,
        password: xmppPassword,
    })

    //let gotRoster = false

    //debug(xmpp, true)

    xmpp.on('error', err => {
        console.error(err)
    })

    xmpp.on('offline', () => {
        console.log('offline')
    })

    xmpp.on('stanza', async stanza => {
        if (stanza.is('message')) {
            await xmpp.send(xml('presence', { type: 'unavailable' }))
            await xmpp.stop()
        }
        if(stanza.is('iq') && stanza.attrs.from == xmppCpeID &&  stanza.attrs.type == 'result'){
            await xmpp.stop()
        }
    })

    xmpp.on('online', async (address: string) => {
        // Makes itself available
        await xmpp.send(xml('presence'))

        /*let message = xml(
          'iq',
          {from: address, id: 'cr002', type: 'get'},
          xml(
            'query ',
            {xmlns:'jabber:iq:roster'},
            ''
          )
        )
        //await xmpp.send(message)
      
        while (!gotRoster) {}*/
        // Sends a chat message to itself
        const message = xml(
            'iq',
            { from: address, to: xmppCpeID, id: 'cr001', type: 'get' },
            xml(
                'connectionRequest',
                { xmlns: "urn:broadband-forum-org:cwmp:xmppConnReq-1-0" },
                [
                    xml("username", {}, username),
                    xml("password", {}, password)
                ]
            )
        )
        await xmpp.send(message)
    })
    xmpp.start().catch(console.error)
}

export function xmppStop(): void{
    if(typeof xmpp.stop === 'function') xmpp.stop()
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
                resolve({ statusCode: 0, headers: {} });
            })
            .on("socket", socket => {
                socket.setTimeout(timeout);
                socket.on("timeout", () => {
                    req.abort();
                    resolve({ statusCode: 0, headers: {} });
                });
            });
    });
}