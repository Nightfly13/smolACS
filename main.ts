import * as http from "http";
import * as cluster from "./cluster";
import * as zlib from "zlib";
import * as endFuncs from "./endFuncs"
import * as parseFuncs from "./parseFuncs"
import * as soap from "./soap"
import * as methods from "./methods"
import { Readable } from "stream";
import { Socket } from "net";
import { SessionContext, CpeGetResponse } from "./interfaces";
import { writeFileSync } from "fs";

const VERSION = require('./package.json').version;
const SERVICE_ADDRESS = "127.0.0.1"; // get interface from config
const SERVICE_PORT = "7547"; // get port from config

let server: http.Server;
let listener: (...args) => void;
const currentSessions = new WeakMap<Socket, SessionContext>();

//#region 
if (!cluster.worker) { //If the current worker is master
  const WORKER_COUNT = 0; //get worker count from config

  console.info({ //logs stuff
    message: `genieacs-cwmp starting`,
    pid: process.pid,
    version: VERSION
  });

  cluster.start(WORKER_COUNT, SERVICE_PORT, SERVICE_ADDRESS); //start x workers on x port on x address based on values from config

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
    0
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
  port,
  networkInterface,
  _listener,
  keepAliveTimeout: number = -1
): void {
  listener = _listener;

  server = http.createServer(listener);

  if (keepAliveTimeout >= 0) server.keepAliveTimeout = keepAliveTimeout;
  server.listen(port, networkInterface);
}

let n = 0;
async function CWlistner(httpRequest: http.IncomingMessage, httpResponse: http.ServerResponse) {

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

  let sessionContext = getContext(httpRequest.connection);

  sessionContext.httpRequest = httpRequest
  sessionContext.httpResponse = httpResponse

  //#region Find charset
  let charset;
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

  const bodyStr = parseFuncs.decodeString(body, charset); //decode body

  const parseWarnings = [];
  let rpc;
  rpc = soap.request( //get RPC object from bodyStr
    bodyStr,
    null,
    parseWarnings,
    sessionContext
  );

  if (sessionContext.cwmpVersion == "0") sessionContext.cwmpVersion = rpc.cwmpVersion
  if (!rpc.cwmpVersion) rpc.cwmpVersion = sessionContext.cwmpVersion

  let res

  if (rpc.hasOwnProperty("cpeResponse") && rpc.cpeResponse !== null && rpc.cpeResponse.hasOwnProperty("parameterList")) {
    writeResponseToFile(rpc.cpeResponse);
  }

  switch (sessionContext.cpeRequests[sessionContext.cpeRequests.length - 1]) {
    case "end":
      console.log(sessionContext.acsRequests.length)
      if (sessionContext.acsRequests.length == 0) {
        console.log("STOP")
        httpResponse.writeHead(200, {});
        httpResponse.end()
        currentSessions.delete(httpRequest.connection)
        return;
      }

      if (!rpc.id) rpc.id = Math.random().toString(36).slice(-8);

      let request = sessionContext.acsRequests.shift()
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
              url: request.URL,
              username: request.username,
              password: request.password,
              delaySeconds: request.delaySeconds
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
  return soap.writeResponse(sessionContext, res);
}

function createContext(): SessionContext {
  return {
    cpeRequests: [],
    acsRequests: [
      {
        name: "GetParameterNames",
        parameterPath: "InternetGatewayDevice.ManagementServer.",
        nextLevel: false
      }
    ],
    cwmpVersion: "0"
  }
}

function getContext(socket: Socket): SessionContext {
  if (currentSessions.has(socket)) return currentSessions.get(socket)

  let sessionContext = createContext()
  currentSessions.set(socket, sessionContext);
  return sessionContext
}

function writeResponseToFile(cpeResponse: any): void {
  let fileName = cpeResponse.name + ".json";
  let data: string = "{";

  switch (cpeResponse.name) {
    case "GetParameterValuesResponse":
      data += cpeResponse.parameterList.map(struct => { return `"${struct[0]}":{"value":"${struct[1]}","type":"${struct[2]}"}` }).join(",")
      break;
    case "GetParameterNamesResponse":
      data += cpeResponse.parameterList.map(struct => { return `"${struct[0]}":"${struct[1]}"` }).join(",")
      break;
    case "GetParameterAttributesResponse":
      data += cpeResponse.parameterList.map(struct => { return `"${struct[0]}":{"notification":${struct[1]},"accessList":["${struct[2].join("\",\"")}"]}` }).join(",")
      break;
    default:
      throw Error("Unknown cpeResponse")
  }
  data += "}\n"

  writeFileSync(fileName, data, { flag: "a" })
}