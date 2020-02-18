import * as http from "http";
import * as https from "https";
import * as cluster from "./cluster";
import * as zlib from "zlib";
import * as endFuncs from "./endFuncs"
import * as parseFuncs from "./parseFuncs"
import * as soap from "./soap"
import * as methods from "./methods"
import * as utils from "./utils"
import * as uifuncs from "./uifuncs"
import * as auth from "./auth"
import {parse} from "url"
import { Readable } from "stream";
import { Socket } from "net";
import { SessionContext, GetAcsRequest, SoapMessage } from "./interfaces";
import { resolve } from "path";
import { readFileSync, existsSync } from "fs";

// Find project root directory
export let ROOT_DIR = resolve(__dirname, "..");
while (!existsSync(`${ROOT_DIR}/package.json`)) {
  const d = resolve(ROOT_DIR, "..");
  if (d === ROOT_DIR) {
    ROOT_DIR = process.cwd();
    break;
  }
  ROOT_DIR = d;
}

const VERSION = require('./package.json').version;
const SERVICE_ADDRESS = "192.168.1.101"; // get interface from config
const SERVICE_PORT = 7547; // get port from config

const ConnectionRequestURL = "http://192.168.1.110:1050/cgi-bin/tr069/102024041800807"

let acsRequests: GetAcsRequest[] = [];
let server: http.Server | https.Server;
let listener: (...args: any) => void;
const currentSessions = new WeakMap<Socket, SessionContext>();
const readline = require('readline-sync');
//#region 
if (!cluster.worker) { //If the current worker is master
  const WORKER_COUNT = 1; //get worker count from config

  getUserInput();

  console.info({ //logs stuff
    message: `smolACS starting`,
    pid: process.pid,
    version: VERSION
  });
  console.info({ //logs stuff
    message: SERVICE_ADDRESS + ' ' + SERVICE_PORT,
    pid: process.pid,
    version: VERSION
  });
  cluster.start(WORKER_COUNT, SERVICE_PORT, SERVICE_ADDRESS, acsRequests); //start x workers on x port on x address based on values from config

  process.on("SIGINT", () => { //on SIGINT stop worker
    console.info({
      message: "Received signal SIGINT, exiting",
      pid: process.pid
    });

    cluster.stop();
  });

  process.on("SIGTERM", () => { //on SIGTERM stop worker
    console.info({
      message: "Received signal SIGTERM, exiting",
      pid: process.pid
    });

    cluster.stop();
  });
} else { //if current worker is not master

  const ssl = { //create SSL object
    key: "",//"key.pem", //gets SSL key from config
    cert: ""//"cert.pem" //gets SSL cert from config
  };

  process.on("message", (msg) => {
    console.log("Slave message: " + msg)
    if (msg.acsRequests) {
      acsRequests = msg.acsRequests
    }
  })

  process.send({ topic: "acsRequests" })

  process.on("uncaughtException", err => { //on uncaughtException execute function
    if ((err as NodeJS.ErrnoException).code === "ERR_IPC_DISCONNECTED") return; //Ignores error if it is "ERR_IPC_DISCONNECTED"
    console.error({
      message: "Uncaught exception",
      exception: err,
      pid: process.pid
    });
    endFuncs.exitWorkerUngracefully
  });

  Sstart(
    SERVICE_PORT,
    SERVICE_ADDRESS,
    CWlistner,  //listen to incoming http requests
    //cwmp.onConnection, //function to run on succesfull connection to remote device 
    0,
    ssl
  );

  process.on("SIGINT", () => {
    endFuncs.exitWorkerUngracefully
  });

  process.on("SIGTERM", () => {
    endFuncs.exitWorkerUngracefully
  });
}
//#endregion

/**
 * Start an https server if the ssl object is valid; otherwise start an http server;
 * Both servers run with _listener and onConnection callbacks
 * @param port port to connect to 
 * @param networkInterface interface to connect to
 * @param ssl ssl object with key and cert if required
 * @param _listener function for when a request occurs
 * @param onConnection function for when a connection is established
 * @param keepAliveTimeout keepAliveTimeout for the server
 */
function Sstart(
  port: number,
  networkInterface: string,
  _listener: { (httpRequest: http.IncomingMessage, httpResponse: http.ServerResponse): Promise<void>; (...args: any): void; },
  keepAliveTimeout: number = -1,
  ssl: any
): void {
  listener = _listener;

  if (ssl && ssl.key && ssl.cert) {
    const options = {
      key: ssl.key
        .split(":")
        .map(f => readFileSync(resolve(ROOT_DIR, f.trim()))),
      cert: ssl.cert
        .split(":")
        .map(f => readFileSync(resolve(ROOT_DIR, f.trim())))
    };

    server = https.createServer(options, listener);
    console.log("https")
  } else {
    server = http.createServer(listener);
    console.log("http")
  }
  if (keepAliveTimeout >= 0) server.keepAliveTimeout = keepAliveTimeout;
  server.listen(port, networkInterface);
}

let n = 0;
async function CWlistner(httpRequest: http.IncomingMessage, httpResponse: http.ServerResponse): Promise<void> {

  //console.log("AcsReq is now: " + acsRequests)

  //#region Check that HTTP method is POST
  if (httpRequest.method !== "POST") {//if request method isn't "POST", send/respond with 405 Method Not Allowed
    httpResponse.writeHead(405, {
      Allow: "POST",
      Connection: "close"
    });
    httpResponse.end("405 Method Not Allowed");
    return;
  }
  //#endregion


  //console.log("AcsReq is now: " + acsRequests)


  //#region Decode request if encoded
  let stream: Readable = httpRequest;
  if (httpRequest.headers["content-encoding"]) {//if request has content eencoding, then try to decode it
    switch (httpRequest.headers["content-encoding"]) {
      case "gzip":
        stream = httpRequest.pipe(zlib.createGunzip());
        break;
      case "deflate":
        stream = httpRequest.pipe(zlib.createInflate());
        break;
      default://if the server cant decode data, then send 415 Unsupported Media Type 
        httpResponse.writeHead(415, { Connection: "close" });
        httpResponse.end("415 Unsupported Media Type");
        return;
    }
  }
  //#endregion
  //console.log("AcsReq is now: " + acsRequests)

  //#region Get HTTP body from stream
  const body = await new Promise<Buffer>((resolve, reject) => {//create promise of buffer
    const chunks = [];//create empty buffer
    let bytes = 0;

    stream.on("data", chunk => {//when stream recieves data 
      chunks.push(chunk);//add data bytes to chunks array
      bytes += chunk.length;//increases byte size
    });

    stream.on("end", () => {//when stream has recieved all the data
      const _body = Buffer.allocUnsafe(bytes);//allocate memory space
      let offset = 0;
      for (const chunk of chunks) {//for each data chunk
        chunk.copy(_body, offset, 0, chunk.length);//copies chunk to allocated memory
        offset += chunk.length;//increments offset
      }
      resolve(_body);//resolves promise, returns _body Buffer
    });

    stream.on("error", reject); //reject the promise on stream error
  });
  //#endregion
  //console.log("AcsReq is now: " + acsRequests)

  let sessionContext = getContext(httpRequest.connection);

  sessionContext.httpRequest = httpRequest
  sessionContext.httpResponse = httpResponse
  //console.log("AcsReq is now: " + acsRequests)

  //#region Find charset
  let charset: string;
  if (httpRequest.headers["content-type"]) {//If the request has a content type header field
    const m = httpRequest.headers["content-type"].match( //get the value of this header
      /charset=['"]?([^'"\s]+)/i
    );
    if (m) charset = m[1].toLowerCase();
  }
  if (!charset) { //If charset is not set
    const parse = parseFuncs.parseXmlDeclaration(body);//get attributes of body
    const e = parse ? parse.find(s => s.localName === "encoding") : null;//checks if encoding attribute exists
    charset = e ? e.value.toLowerCase() : "utf8";//sets charset to found encoding value if it exists; otherwise, use utf8
  }
  //#endregion
  //console.log("AcsReq is now: " + acsRequests)

  const bodyStr = parseFuncs.decodeString(body, charset); //decode body

  const parseWarnings = [];
  let rpc: SoapMessage;
  rpc = soap.request( //get RPC object from bodyStr
    bodyStr,
    null,
    parseWarnings,
    sessionContext
  );
  //console.log("AcsReq is now: " + acsRequests)

  if (sessionContext.cwmpVersion == "0") sessionContext.cwmpVersion = rpc.cwmpVersion
  if (!rpc.cwmpVersion) rpc.cwmpVersion = sessionContext.cwmpVersion

  let res: { code: number; headers: {}; data: string; }

  if (rpc.hasOwnProperty("cpeResponse") && rpc.cpeResponse !== null && rpc.cpeResponse.hasOwnProperty("parameterList")) {
    utils.writeResponseToFile(rpc.cpeResponse);
  }
  //console.log("AcsReq is now: " + acsRequests)

  switch (sessionContext.cpeRequests[sessionContext.cpeRequests.length - 1]) {
    case "end":
      //console.log("1AcsReq is now: " + acsRequests)

      console.log("Requests left: " + sessionContext.acsRequests.length)
      if (sessionContext.acsRequests.length == 0) {
        //console.log("2AcsReq is now: " + acsRequests)

        console.log("STOP")
        httpResponse.writeHead(200, {});
        httpResponse.end()
        currentSessions.delete(httpRequest.connection)
        //console.log("3AcsReq is now: " + acsRequests)

        return;
      }

      if (!rpc.id) rpc.id = Math.random().toString(36).slice(-8);
      // console.log("5AcsReq is now: " + acsRequests)

      let request = sessionContext.acsRequests.shift()
      console.log("Requests left now: " + sessionContext.acsRequests.length)
      console.log("Request: " + request)

      // console.log("4AcsReq is now: " + acsRequests)

      switch (request.name) {
        case "GetParameterNames":
          res = soap.response({
            id: rpc.id,
            body: methods.GetParameterNames({
              parameterPath: request.parameterPath,
              nextLevel: request.nextLevel
            }),
            cwmpVersion: rpc.cwmpVersion
          })
          break;
        case "GetParameterValues":
          res = soap.response({
            id: rpc.id,
            body: methods.GetParameterValues({
              parameterNames: request.parameterNames
            }),
            cwmpVersion: rpc.cwmpVersion
          })
          break;
        case "SetParameterValues":
          res = soap.response({
            id: rpc.id,
            body: methods.SetParameterValues({
              parameterList: request.parameterList
            }),
            cwmpVersion: rpc.cwmpVersion
          })
          break;
        case "SetParameterAttributes":
          res = soap.response({
            id: rpc.id,
            body: methods.SetParameterAttributes({
              parameterList: request.setParameterAttributes
            }),
            cwmpVersion: rpc.cwmpVersion
          })
          break;
        case "GetParameterAttributes":
          res = soap.response({
            id: rpc.id,
            body: methods.GetParameterAttributes({
              parameterNames: request.parameterNames
            }),
            cwmpVersion: rpc.cwmpVersion
          })
          break;
        case "AddObject":
          res = soap.response({
            id: rpc.id,
            body: methods.AddObject({
              objectName: request.objectName
            }),
            cwmpVersion: rpc.cwmpVersion
          })
          break;
        case "DeleteObject":
          res = soap.response({
            id: rpc.id,
            body: methods.DeleteObject({
              objectName: request.objectName
            }),
            cwmpVersion: rpc.cwmpVersion
          })
          break;
        case "Reboot":
          res = soap.response({
            id: rpc.id,
            body: methods.Reboot({}),
            cwmpVersion: rpc.cwmpVersion
          })
          break;
        case "FactoryReset":
          res = soap.response({
            id: rpc.id,
            body: methods.FactoryReset(),
            cwmpVersion: rpc.cwmpVersion
          })
          break;
        case "Download":
          res = soap.response({
            id: rpc.id,
            body: methods.Download({
              fileType: request.fileType,
              url: request.DownloadParams.URL,
              username: request.DownloadParams.username,
              password: request.DownloadParams.password,
              delaySeconds: request.DownloadParams.delaySeconds
            }),
            cwmpVersion: rpc.cwmpVersion
          })
          break;
        default:
          throw new Error("Unknown CPE method: " + sessionContext.cpeRequests[sessionContext.cpeRequests.length - 1])
      }
      break;
    case "Inform":
      res = soap.response({
        id: rpc.id,
        body: methods.InformResponse(),
        cwmpVersion: rpc.cwmpVersion
      });
      break;
    case "GetRPCMethods":
      res = soap.response({
        id: rpc.id,
        acsResponse: {
          name: "GetRPCMethodsResponse",
          methodList: ["Inform", "GetRPCMethods", "TransferComplete", "AutonomousTransferComplete"]
        },
        cwmpVersion: rpc.cwmpVersion
      });
      break;
    case "TransferComplete":
      res = soap.response({
        id: rpc.id,
        body: methods.TransferCompleteResponse(),
        cwmpVersion: rpc.cwmpVersion
      });
      break;
    case "AutonomousTransferComplete":
      res = soap.response({
        id: rpc.id,
        body: methods.AutonomousTransferCompleteResponse(),
        cwmpVersion: rpc.cwmpVersion
      });
      break;
    case "RequestDownload":
      res = soap.response({
        id: rpc.id,
        body: methods.RequestDownloadResponse(),
        cwmpVersion: rpc.cwmpVersion
      });
      break;
    default:
      console.log("STOP fail with: " + sessionContext.cpeRequests)
      httpResponse.writeHead(200, {});
      httpResponse.end()
      currentSessions.delete(httpRequest.connection)
      return;
  }
  //console.log("AcsReq is now: " + acsRequests)

  return soap.writeResponse(sessionContext, res);
}

function createContext(): SessionContext {
  console.log("In createContext" + acsRequests)
  return {
    cpeRequests: [],
    acsRequests: [...acsRequests],
    cwmpVersion: "0"
  }
}

function getContext(socket: Socket): SessionContext {
  if (currentSessions.has(socket)) return currentSessions.get(socket)

  let sessionContext = createContext()
  currentSessions.set(socket, sessionContext);
  return sessionContext
}

function getUserInput(): void {
  let answer: string, answerTwo: string;
  while (true) {
    answer = readline.keyInYN('Do you want to add any requests?\n')
    if (answer) {
      answerTwo = readline.question('What request do you want to make?\n1: SetParameterValues\n2: GetParameterValues\n3: GetParameterNames\n4: SetParameterAttributes\n5: GetParameterAttributes\n6: AddObject\n7: DeleteObject\n8: Download\n9: Reboot\n')
      let request: GetAcsRequest
      switch (answerTwo) {
        case '1':
          request = uifuncs.generateSetParameterValuesRequest(readline);
          break;
        case '2':
          request = uifuncs.generateGetParameterValuesRequest(readline);
          break;
        case '3':
          request = uifuncs.generateGetParameterNamesRequest(readline);
          break;
        case '4':
          request = uifuncs.generateSetParameterAttributesRequest(readline);
          break;
        case '5':
          request = uifuncs.generateGetParameterAttributesRequest(readline);
          break;
        case '6':
          request = uifuncs.generateAddObjectRequest(readline);
          break;
        case '7':
          request = uifuncs.generateDeleteObjectRequest(readline);
          break;
        case '8':
          request = uifuncs.generateDownloadRequest(readline);
          break;
        case '9':
          request = uifuncs.generateRebootRequest(readline);
          break;
        default:
          console.log("Invalid input");
          request = null;
          break;
      }

      console.log(request)

      if (request !== null) acsRequests.push(request)
    }
    else {
      /*answer = readline.keyInYN('Do you want to start with a Connection Request?\n')
      if (answer){
        setTimeout(function(){httpConnectionRequest(ConnectionRequestURL, 3000)}, 1000)
      }*/
      return
    }
  }
}

export async function httpConnectionRequest(address: string, timeout: number): Promise<void> {
  const options: http.RequestOptions = parse(address);
  if (options.protocol !== "http:")
    throw new Error("Invalid connection request URL or protocol");

  options.agent = new http.Agent({
    maxSockets: 1,
    keepAlive: true
  });

  let authHeader: {};
  let username: string = "";
  let password: string = "";

  while (!authHeader || (username != null && password != null)) {
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
        throw new Error("Unrecognized auth method");
      }
    }

    let res = await httpGet(opts, timeout);

    // Workaround for some devices unexpectedly closing the connection
    if (res.statusCode === 0)
      res = await httpGet(opts, timeout);
    if (res.statusCode === 0) throw new Error("Device is offline");
    if (res.statusCode === 200 || res.statusCode === 204) return;
    
    if (res.statusCode === 401 && res.headers["www-authenticate"]) {
      authHeader = auth.parseWwwAuthenticateHeader(res.headers["www-authenticate"]);
    } else {
      throw new Error(
        `Unexpected response code from device: ${res.statusCode}`
      );
    }
  }
  throw new Error("Incorrect connection request credentials");
}

function httpGet(options: http.RequestOptions, timeout): Promise<{ statusCode: number; headers: {} }> {
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