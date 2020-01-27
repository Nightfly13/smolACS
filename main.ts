import * as http from "http";
import * as cluster from "./cluster";
import * as zlib from "zlib";
import * as endfuncs from "./endfuncs"
import * as parsefuncs from "./parsefuncs"
import { Element, SoapMessage, InformRequest, CpeFault, FaultStruct, SpvFault, AcsResponse, CpeGetResponse, CpeSetResponse } from "./interfaces"

const VERSION = require('./package.json').version;
const SERVICE_ADDRESS = "127.0.0.1"; // get interface from config
const SERVICE_PORT = "7547"; // get port from config

let warnings;
let server: http.Server;
let listener: (...args) => void;

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
    endfuncs.exitWorkerUngracefully
  });

  Sstart(
    SERVICE_PORT,
    SERVICE_ADDRESS,
    CWlistner,  //listen to incoming http requests
    //cwmp.onConnection, //function to run on succesfull connection to remote device 
    0
  );

  process.on("SIGINT", () => {
    endfuncs.exitWorkerUngracefully
  });

  process.on("SIGTERM", () => {
    endfuncs.exitWorkerUngracefully
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
async function CWlistner(httpRequest, httpResponse) {

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


  if (n == 2) {
    httpResponse.writeHead(200, {});
    httpResponse.end()
    n = 0;
    return;
  }


  //If request is empty (no more RPCs from CPE)
  if (httpRequest.headers["content-length"] == "0") {
    httpResponse.setHeader('Content-Type', 'text/xml');
    httpResponse.write('<?xml version="1.0" encoding="UTF-8"?><soap-env:Envelope xmlns:soap-enc="http://schemas.xmlsoap.org/soap/encoding/" xmlns:soap-env="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:cwmp="urn:dslforum-org:cwmp-1-0"><soap-env:Header><cwmp:ID soap-env:mustUnderstand="1">s61b602f</cwmp:ID></soap-env:Header><soap-env:Body><cwmp:GetParameterNames><ParameterPath/><NextLevel>false</NextLevel></cwmp:GetParameterNames></soap-env:Body></soap-env:Envelope>'); //write a response to the client
    httpResponse.end(); //end the response
    n = 2;

  }



  //#region Decode request if encoded
  let stream = httpRequest;
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

  //#region Find charset
  let charset;
  if (httpRequest.headers["content-type"]) {//If the request has a content type header field
    const m = httpRequest.headers["content-type"].match( //get the value of this header
      /charset=['"]?([^'"\s]+)/i
    );
    if (m) charset = m[1].toLowerCase();
  }
  if (!charset) { //If charset is not set
    const parse = parsefuncs.parseXmlDeclaration(body);//get attributes of body
    const e = parse ? parse.find(s => s.localName === "encoding") : null;//checks if encoding attribute exists
    charset = e ? e.value.toLowerCase() : "utf8";//sets charset to found encoding value if it exists; otherwise, use utf8
  }
  //#endregion

  const bodyStr = parsefuncs.decodeString(body, charset);//decode body

  const parseWarnings = [];
  let rpc;
  rpc = request( //get RPC object from bodyStr
    bodyStr,
    null,
    parseWarnings
  );

  //httpResponse.setHeader('Content-Type', 'text/xml');
  //httpResponse.write('<soap-env:Envelope xmlns:soap-enc="http://schemas.xmlsoap.org/soap/encoding/" xmlns:soap-env="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:cwmp="urn:dslforum-org:cwmp-1-0"><soap-env:Header><cwmp:ID soap-env:mustUnderstand="1">w0e9ylwq</cwmp:ID></soap-env:Header><soap-env:Body><cwmp:InformResponse><MaxEnvelopes>1</MaxEnvelopes></cwmp:InformResponse></soap-env:Body></soap-env:Envelope>'); //write a response to the client
  //httpResponse.end(); //end the response
}

/**
 * Creates an RPC object from XML and returns it
 * @param body XML body
 * @param cwmpVersion 
 * @param warn array for warnings
 */
function request(body: string, cwmpVersion, warn): SoapMessage {
  warnings = warn;

  const rpc = {
    id: null,
    cwmpVersion: cwmpVersion,
    sessionTimeout: null,
    cpeRequest: null,
    cpeFault: null,
    cpeResponse: null
  };

  if (!body.length) return rpc; //if body is empty return 

  const xml = parsefuncs.parseXml(body); //get the traversable representation of XML body

  if (!xml.children.length) return rpc;//if there was no xml - return 

  const envelope = xml.children[0];//get the soap envelope

  let headerElement: Element, bodyElement: Element;

  for (const c of envelope.children) {//get header and body soap elements
    switch (c.localName) {
      case "Header":
        headerElement = c;
        break;
      case "Body":
        bodyElement = c;
        break;
    }
  }

  if (headerElement) {//if the header element is present
    for (const c of headerElement.children) {
      switch (c.localName) {
        case "ID"://find the ID
          rpc.id = parsefuncs.decodeEntities(c.text);
          break;
        case "sessionTimeout":
          rpc.sessionTimeout = parseInt(c.text);
          break;
      }
    }
  }

  const methodElement = bodyElement.children[0];//get cwmp method element

  if (!rpc.cwmpVersion && methodElement.localName !== "Fault") {//if cwmp version is not defined and methodElement is not "Fault";
    let namespace, namespaceHref;
    for (const e of [methodElement, bodyElement, envelope]) {
      namespace = namespace || e.namespace;
      if (e.attrs) {
        const attrs = parsefuncs.parseAttrs(e.attrs); //get the attributes of envelope
        const attr = namespace//if namespace exists
          ? attrs.find(//find attribute with namespce xmlns and localname equal to namespace
            s => s.namespace === "xmlns" && s.localName === namespace
          )
          : attrs.find(s => s.name === "xmlns");//if namespace doesn't exist, find attribute with name xmlns

        if (attr) namespaceHref = attr.value;//if attribute was found, set namespace href to the value of that attribute
      }
    }

    switch (namespaceHref) {
      case "urn:dslforum-org:cwmp-1-0":
        rpc.cwmpVersion = "1.0";
        break;
      case "urn:dslforum-org:cwmp-1-1":
        rpc.cwmpVersion = "1.1";
        break;
      case "urn:dslforum-org:cwmp-1-2":
        if (rpc.sessionTimeout) rpc.cwmpVersion = "1.3";
        else rpc.cwmpVersion = "1.2";

        break;
      case "urn:dslforum-org:cwmp-1-3":
        rpc.cwmpVersion = "1.4";
        break;
      default:
        throw new Error("Unrecognized CWMP version");
    }
  }
  /**
   * assign function based on method element recieved
   */

  console.info({ //logs stuff
    message: "request method is " + methodElement.localName,
    pid: process.pid,
  });
  switch (methodElement.localName) {
    case "Inform":
      rpc.cpeRequest = Inform(methodElement);
      break;
    case "GetRPCMethods":
      rpc.cpeRequest = GetRPCMethods();
      break;
    /*case "TransferComplete":
      rpc.cpeRequest = TransferComplete(methodElement);
      break;
    case "RequestDownload":
      rpc.cpeRequest = RequestDownload(methodElement);
      break;*/
    case "GetParameterNamesResponse":
      rpc.cpeResponse = GetParameterNamesResponse(methodElement);
      break;
    case "GetParameterValuesResponse":
      rpc.cpeResponse = GetParameterValuesResponse(methodElement);
      break;
    case "SetParameterValuesResponse":
      rpc.cpeResponse = SetParameterValuesResponse(methodElement);
      break;/*
    case "AddObjectResponse":
      rpc.cpeResponse = AddObjectResponse(methodElement);
      break;
    case "DeleteObjectResponse":
      rpc.cpeResponse = DeleteObjectResponse(methodElement);
      break;
    case "RebootResponse":
      rpc.cpeResponse = RebootResponse();
      break;
    case "FactoryResetResponse":
      rpc.cpeResponse = FactoryResetResponse();
      break;
    case "DownloadResponse":
      rpc.cpeResponse = DownloadResponse(methodElement);
      break;*/
    case "Fault":
      rpc.cpeFault = fault(methodElement);
      break;
    default:
      throw new Error(`8000 Method not supported ${methodElement.localName}`);
  }

  return rpc;
}

/**
 * returns object with name, parameter list, device ID, event and retry counter
 * @param xml inform xml object
 */
function Inform(xml: Element): InformRequest {
  let retryCount, evnt, parameterList;
  const deviceId = {
    Manufacturer: null,
    OUI: null,
    ProductClass: null,
    SerialNumber: null
  };

  for (const c of xml.children) {//for each child of xml
    switch (c.localName) {//based on name
      case "ParameterList"://get array of parameter values
        parameterList = parameterValueList(c);
        break;
      case "DeviceId"://set values of deviceId
        for (const cc of c.children) {
          const n = cc.localName;
          if (n in deviceId) deviceId[n] = parsefuncs.decodeEntities(cc.text);
        }
        break;
      case "Event"://set evnt equal to the event code of the xml
        evnt = parsefuncs.event(c);
        break;
      case "RetryCount"://sets the retry counter
        retryCount = parseInt(c.text);
        break;
    }
  }

  return {//return object with name, parameter list, device ID, event and retry counter 
    name: "Inform",
    parameterList: parameterList,
    deviceId: deviceId,
    event: evnt,
    retryCount: retryCount
  };
}

/**
 * returns an array of arrays populated by parameter name, value and type
 * @param xml 
 */
function parameterValueList(
  xml: Element
): [string, string | number | boolean, string][] {
  return xml.children
    .filter(e => e.localName === "ParameterValueStruct")//filters out elements that arent ParameterValueStruct in xml body
    .map<[string, string | number | boolean, string]>(e => {//for each element 
      let valueElement: Element, param: string;
      for (const c of e.children) {//for each child in element
        switch (c.localName) {
          case "Name"://if localName is "Name"
            param = c.text;//set param to text of child
            break;
          case "Value"://if localName is "Value"
            valueElement = c;//set valueElement equal to child
            break;
        }
      }

      const valueType = parsefuncs.getValueType(valueElement.attrs);//get value type

      const value = parsefuncs.decodeEntities(valueElement.text);//decodes entities and saves results in value
      let parsed: string | number | boolean = value;
      if (valueType === "xsd:boolean") {//if the valueType is boolean
        parsed = parsefuncs.parseBool(value); //get the value
        if (parsed === null) {//check if invalid and add warning
          warnings.push({
            message: "Invalid value attribute",
            parameter: param
          });
          parsed = value;//revert parsed to value
        }
      } else if (valueType === "xsd:int" || valueType === "xsd:unsignedInt") {//if value is integer or unsigned integer
        parsed = parseInt(value);//get the value
        if (isNaN(parsed)) {//check if invalid and add warning
          warnings.push({
            message: "Invalid value attribute",
            parameter: param
          });
          parsed = value;//revert parsed to value
        }
      } else if (valueType === "xsd:dateTime") { //if value is date
        parsed = Date.parse(value);//get the value
        if (isNaN(parsed)) {//check if invalid and add warning
          warnings.push({
            message: "Invalid value attribute",
            parameter: param
          });
          parsed = value;//revert parsed to value
        }
      }

      return [param, parsed, valueType];//return array with name, value and value type
    });
}

function parameterInfoList(xml: Element): [string, boolean][] {
  return xml.children
    .filter(e => e.localName === "ParameterInfoStruct")
    .map<[string, boolean]>(e => {
      let param: string, value: string;
      for (const c of e.children) {
        switch (c.localName) {
          case "Name":
            param = c.text;
            break;
          case "Writable":
            value = c.text;
            break;
        }
      }

      let parsed: boolean = parsefuncs.parseBool(value);

      if (parsed === null) {
        warnings.push({
          message: "Invalid writable attribute",
          parameter: param
        });
        parsed = false;
      }

      return [param, parsed];
    });
}

function fault(xml: Element): CpeFault {
  let faultCode, faultString, detail;
  for (const c of xml.children) {
    switch (c.localName) {
      case "faultcode":
        faultCode = c.text;
        break;
      case "faultstring":
        faultString = parsefuncs.decodeEntities(c.text);
        break;
      case "detail":
        detail = faultStruct(c.children.find(n => n.localName === "Fault"));
        break;
    }
  }

  return { faultCode, faultString, detail };
}

function faultStruct(xml: Element): FaultStruct {
  let faultCode, faultString, setParameterValuesFault: SpvFault[], pn, fc, fs;
  for (const c of xml.children) {
    switch (c.localName) {
      case "FaultCode":
        faultCode = c.text;
        break;
      case "FaultString":
        faultString = parsefuncs.decodeEntities(c.text);
        break;
      case "SetParameterValuesFault":
        setParameterValuesFault = setParameterValuesFault || [];
        for (const cc of c.children) {
          switch (cc.localName) {
            case "ParameterName":
              pn = cc.text;
              break;
            case "FaultCode":
              fc = cc.text;
              break;
            case "FaultString":
              fs = parsefuncs.decodeEntities(cc.text);
              break;
          }
        }
        setParameterValuesFault.push({
          parameterName: pn,
          faultCode: fc,
          faultString: fs
        });
    }
  }

  return { faultCode, faultString, setParameterValuesFault };
}

function GetRPCMethods(): AcsResponse {
  return { name: "GetRPCMethods" };
}

function GetParameterNamesResponse(xml): CpeGetResponse {
  return {
    name: "GetParameterNamesResponse",
    parameterList: parameterInfoList(
      xml.children.find(n => n.localName === "ParameterList")
    )
  };
}

function GetParameterValuesResponse(xml: Element): CpeGetResponse {
  return {
    name: "GetParameterValuesResponse",
    parameterList: parameterValueList(
      xml.children.find(n => n.localName === "ParameterList")
    )
  };
}

function SetParameterValuesResponse(xml: Element): CpeSetResponse {
  return {
    name: "SetParameterValuesResponse",
    status: parseInt(xml.children.find(n => n.localName === "Status").text)
  };
}
