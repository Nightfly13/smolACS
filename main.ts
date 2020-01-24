import * as http from "http";
import { ChildProcess } from "child_process";
import * as cluster from "./cluster";
import * as zlib from "zlib";


const VERSION = require('./package.json').version;
const SERVICE_ADDRESS = "127.0.0.1"; // get interface from config
const SERVICE_PORT = "7547"; // get port from config
const processes: { [script: string]: ChildProcess } = {};


/**
 * Shuts down worker ungracefully
 */
function exitWorkerUngracefully(): void {
  killAll().then(() => {
    process.exit(1);
  });
}

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
    exitWorkerUngracefully
  });

  Sstart(
    SERVICE_PORT,
    SERVICE_ADDRESS,
    CWlistner,  //listen to incoming http requests
    //cwmp.onConnection, //function to run on succesfull connection to remote device 
    0
  );

  process.on("SIGINT", () => {
    exitWorkerUngracefully
  });

  process.on("SIGTERM", () => {
    exitWorkerUngracefully
  });
}

/**
 * kills a child process 
 * @param process 
 */
function kill(process: ChildProcess): Promise<void> {
  return new Promise(resolve => {
    const timeToKill = Date.now() + 5000;

    process.kill(); //kill process

    const t = setInterval(() => { //set an interval for every 100ms
      if (!process.connected) { //if process is dead
        clearInterval(t); //clear the interval
        resolve(); //resolve promise
      } else if (Date.now() > timeToKill) { //otherwise, if time to kill ran out
        process.kill("SIGKILL"); //hardkill process
        clearInterval(t); //clear the intercal
        resolve(); //resolve promise
      }
    }, 100);
  });
}

/**
 * kill all active processes
 */
async function killAll(): Promise<void> {
  await Promise.all(
    Object.entries(processes).map(([k, p]) => {
      delete processes[k];
      return kill(p);
    })
  );
}

let server: http.Server
let listener: (...args) => void;

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
export function Sstart(
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

  //If request is empty (no more RPCs from CPE)
  if(httpRequest.headers["content-length"] == "0"){
    httpResponse.writeHead(200, {});
    httpResponse.end()
    return;
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
    const parse = parseXmlDeclaration(body);//get attributes of body
    const e = parse ? parse.find(s => s.localName === "encoding") : null;//checks if encoding attribute exists
    charset = e ? e.value.toLowerCase() : "utf8";//sets charset to found encoding value if it exists; otherwise, use utf8
  }
  //#endregion

  const bodyStr = decodeString(body, charset);//decode body

  const parseWarnings = [];
  let rpc;
  rpc = request( //get RPC object from bodyStr
    bodyStr,
    null,
    parseWarnings
  );

  httpResponse.setHeader('Content-Type', 'text/xml');
  httpResponse.write('<soap-env:Envelope xmlns:soap-enc="http://schemas.xmlsoap.org/soap/encoding/" xmlns:soap-env="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:cwmp="urn:dslforum-org:cwmp-1-0"><soap-env:Header><cwmp:ID soap-env:mustUnderstand="1">w0e9ylwq</cwmp:ID></soap-env:Header><soap-env:Body><cwmp:InformResponse><MaxEnvelopes>1</MaxEnvelopes></cwmp:InformResponse></soap-env:Body></soap-env:Envelope>'); //write a response to the client
  httpResponse.end(); //end the response
}

/**
 * Returns the buffer decoded using charset
 * @param buffer encoded buffer
 * @param charset 
 */
function decodeString(buffer: Buffer, charset: string): string {
  return buffer.toString(charset);
}

interface Attribute {
  name: string;
  namespace: string;
  localName: string;
  value: string;
}

interface Element {
  name: string;
  namespace: string;
  localName: string;
  attrs: string;
  text: string;
  bodyIndex: number;
  children: Element[];
}

/**
 * Returns attributes of an XML declaration
 * @param buffer buffer of XML data
 */
function parseXmlDeclaration(buffer: Buffer): Attribute[] {
  for (const enc of ["utf16le", "utf8", "latin1", "ascii"]) {
    let str = buffer.toString(enc, 0, 150);
    if (str.startsWith("<?xml")) {
      str = str.split("\n")[0].trim();
      try {
        return parseAttrs(str.slice(5, -2));
      } catch (err) {
        // Ignore
      }
    }
  }
  return null;
}

const CHAR_SINGLE_QUOTE = 39;
const CHAR_DOUBLE_QUOTE = 34;
const CHAR_LESS_THAN = 60;
const CHAR_GREATER_THAN = 62;
const CHAR_COLON = 58;
const CHAR_SPACE = 32;
const CHAR_TAB = 9;
const CHAR_CR = 13;
const CHAR_LF = 10;
const CHAR_SLASH = 47;
const CHAR_EXMARK = 33;
const CHAR_QMARK = 63;
const CHAR_EQUAL = 61;

const STATE_LESS_THAN = 1;
const STATE_SINGLE_QUOTE = 2;
const STATE_DOUBLE_QUOTE = 3;

/**
 * Returns list of attributes based on a string
 * @param string XML string
 */
function parseAttrs(string: string): Attribute[] {
  const attrs: Attribute[] = [];
  const len = string.length;

  let state = 0;
  let name = "";
  let namespace = "";
  let localName = "";
  let idx = 0;
  let colonIdx = 0;
  for (let i = 0; i < len; ++i) {
    const c = string.charCodeAt(i);
    switch (c) {
      case CHAR_SINGLE_QUOTE:
      case CHAR_DOUBLE_QUOTE:
        if (state === c) {
          state = 0;
          if (name) {
            const value = string.slice(idx + 1, i);
            const e = {
              name: name,
              namespace: namespace,
              localName: localName,
              value: value
            };
            attrs.push(e);
            name = "";
            idx = i + 1;
          }
        } else {
          state = c;
          idx = i;
        }
        continue;

      case CHAR_COLON:
        if (idx >= colonIdx) colonIdx = i;
        continue;

      case CHAR_EQUAL:
        if (name) throw new Error(`Unexpected character at ${i}`);
        name = string.slice(idx, i).trim();
        // TODO validate name
        if (colonIdx > idx) {
          namespace = string.slice(idx, colonIdx).trim();
          localName = string.slice(colonIdx + 1, i).trim();
        } else {
          namespace = "";
          localName = name;
        }
    }
  }

  if (name) throw new Error(`Attribute must have value at ${idx}`);

  const tail = string.slice(idx);
  if (tail.trim()) throw new Error(`Unexpected string at ${len - tail.length}`);

  return attrs;
}

let warnings;

interface CpeRequest {
  name: string;
  fileType?: string;
}
interface CpeResponse {
  name: string;
}
interface CpeFault {
  faultCode: string;
  faultString: string;
  detail?: FaultStruct;
}
interface FaultStruct {
  faultCode: string;
  faultString: string;
  setParameterValuesFault?: SpvFault[];
}
interface SpvFault {
  parameterName: string;
  faultCode: string;
  faultString: string;
}
interface SoapMessage {
  id: string;
  cwmpVersion: string;
  sessionTimeout: number;
  cpeRequest?: CpeRequest;
  cpeFault?: CpeFault;
  cpeResponse?: CpeResponse;
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

  const xml = parseXml(body); //get the traversable representation of XML body

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
          rpc.id = decodeEntities(c.text);
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
        const attrs = parseAttrs(e.attrs); //get the attributes of envelope
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
  switch (methodElement.localName) {
    case "Inform":
      rpc.cpeRequest = Inform(methodElement);
      break;
    /*case "GetRPCMethods":
      rpc.cpeRequest = GetRPCMethods();
      break;
    case "TransferComplete":
      rpc.cpeRequest = TransferComplete(methodElement);
      break;
    case "RequestDownload":
      rpc.cpeRequest = RequestDownload(methodElement);
      break;
    case "GetParameterNamesResponse":
      rpc.cpeResponse = GetParameterNamesResponse(methodElement);
      break;
    case "GetParameterValuesResponse":
      rpc.cpeResponse = GetParameterValuesResponse(methodElement);
      break;
    case "SetParameterValuesResponse":
      rpc.cpeResponse = SetParameterValuesResponse(methodElement);
      break;
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
      break;
    case "Fault":
      rpc.cpeFault = fault(methodElement);
      break;*/
    default:
      throw new Error(`8000 Method not supported ${methodElement.localName}`);
  }

  return rpc;
}

/**
 * Returns root object of parsed XML
 * @param string XML string
 */
function parseXml(string: string): Element {
  const len = string.length;
  let state1 = 0;
  let state1Index = 0;
  let state2 = 0;
  let state2Index = 0;

  const root: Element = {
    name: "root",
    namespace: "",
    localName: "root",
    attrs: "",
    text: "",
    bodyIndex: 0,
    children: []
  };

  const stack: Element[] = [root];

  for (let i = 0; i < len; ++i) {
    switch (string.charCodeAt(i)) {
      case CHAR_SINGLE_QUOTE:
        switch (state1 & 0xff) {
          case STATE_SINGLE_QUOTE:
            state1 = state2;
            state1Index = state2Index;
            state2 = 0;
            continue;

          case STATE_LESS_THAN:
            state2 = state1;
            state2Index = state1Index;
            state1 = STATE_SINGLE_QUOTE;
            state1Index = i;
            continue;
        }
        continue;

      case CHAR_DOUBLE_QUOTE:
        switch (state1 & 0xff) {
          case STATE_DOUBLE_QUOTE:
            state1 = state2;
            state1Index = state2Index;
            state2 = 0;
            continue;

          case STATE_LESS_THAN:
            state2 = state1;
            state2Index = state1Index;
            state1 = STATE_DOUBLE_QUOTE;
            state1Index = i;
            continue;
        }
        continue;

      case CHAR_LESS_THAN:
        if ((state1 & 0xff) === 0) {
          state2 = state1;
          state2Index = state1Index;
          state1 = STATE_LESS_THAN;
          state1Index = i;
        }
        continue;

      case CHAR_COLON:
        if ((state1 & 0xff) === STATE_LESS_THAN) {
          const colonIndex = (state1 >> 8) & 0xff;
          if (colonIndex === 0) state1 ^= ((i - state1Index) & 0xff) << 8;
        }
        continue;

      case CHAR_SPACE:
      case CHAR_TAB:
      case CHAR_CR:
      case CHAR_LF:
        if ((state1 & 0xff) === STATE_LESS_THAN) {
          const wsIndex = (state1 >> 16) & 0xff;
          if (wsIndex === 0) state1 ^= ((i - state1Index) & 0xff) << 16;
        }
        continue;

      case CHAR_GREATER_THAN:
        if ((state1 & 0xff) === STATE_LESS_THAN) {
          const secondChar = string.charCodeAt(state1Index + 1);
          const wsIndex: number = (state1 >> 16) & 0xff;
          let name: string,
            colonIndex: number,
            e: Element,
            parent: Element,
            selfClosing: number,
            localName: string,
            namespace: string;

          switch (secondChar) {
            case CHAR_SLASH:
              e = stack.pop();
              name =
                wsIndex === 0
                  ? string.slice(state1Index + 2, i)
                  : string.slice(state1Index + 2, state1Index + wsIndex);
              if (e.name !== name)
                throw new Error(`Unmatched closing tag at ${i}`);
              if (!e.children.length)
                e.text = string.slice(e.bodyIndex, state1Index);
              state1 = state2;
              state1Index = state2Index;
              state2 = 0;
              continue;

            case CHAR_EXMARK:
              if (string.startsWith("![CDATA[", state1Index + 1)) {
                if (string.endsWith("]]", i))
                  throw new Error(`CDATA nodes are not supported at ${i}`);
              } else if (string.startsWith("!--", state1Index + 1)) {
                // Comment node, ignore
                if (string.endsWith("--", i)) {
                  state1 = state2;
                  state1Index = state2Index;
                  state2 = 0;
                }
              }
              continue;

            case CHAR_QMARK:
              if (string.charCodeAt(i - 1) === CHAR_QMARK) {
                // XML declaration node, ignore
                state1 = state2;
                state1Index = state2Index;
                state2 = 0;
              }
              continue;

            default:
              selfClosing = +(string.charCodeAt(i - 1) === CHAR_SLASH);
              parent = stack[stack.length - 1];
              colonIndex = (state1 >> 8) & 0xff;

              name =
                wsIndex === 0
                  ? string.slice(state1Index + 1, i - selfClosing)
                  : string.slice(state1Index + 1, state1Index + wsIndex);
              if (colonIndex && (!wsIndex || colonIndex < wsIndex)) {
                localName = name.slice(colonIndex);
                namespace = name.slice(0, colonIndex - 1);
              } else {
                localName = name;
                namespace = "";
              }

              e = {
                name: name,
                namespace: namespace,
                localName: localName,
                attrs: wsIndex
                  ? string.slice(state1Index + wsIndex + 1, i - selfClosing)
                  : "",
                text: "",
                bodyIndex: i + 1,
                children: []
              };
              parent.children.push(e);
              if (!selfClosing) stack.push(e);

              state1 = state2;
              state1Index = state2Index;
              state2 = 0;
              continue;
          }
        }
        continue;
    }
  }

  if (state1) throw new Error(`Unclosed token at ${state1Index}`);

  if (stack.length > 1) {
    const e = stack[stack.length - 1];
    throw new Error(`Unclosed XML element at ${e.bodyIndex}`);
  }

  if (!root.children.length) root.text = string;
  return root;
}

/**
 * Decodes the encoded entities (if there are any)
 * @param string 
 */
export function decodeEntities(string): string {
  return string.replace(/&[0-9a-z#]+;/gi, match => {
    switch (match) {
      case "&quot;":
        return '"';

      case "&amp;":
        return "&";

      case "&apos;":
        return "'";

      case "&lt;":
        return "<";

      case "&gt;":
        return ">";

      default:
        if (match.startsWith("&#x")) {
          const str = match.slice(3, -1).toLowerCase();
          const n = parseInt(str, 16);
          if (str.endsWith(n.toString(16))) return String.fromCharCode(n);
        } else if (match.startsWith("&#")) {
          const str = match.slice(2, -1);
          const n = parseInt(str);
          if (str.endsWith(n.toString())) return String.fromCharCode(n);
        }
    }
    return match;
  });
}


interface InformRequest extends CpeRequest {
  name: "Inform";
  deviceId: {
    Manufacturer: string;
    OUI: string;
    ProductClass?: string;
    SerialNumber: string;
  };
  event: string[];
  retryCount: number;
  parameterList: [string, string | number | boolean, string][];
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
          if (n in deviceId) deviceId[n] = decodeEntities(cc.text);
        }
        break;
      case "Event"://set evnt equal to the event code of the xml
        evnt = event(c);
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
 * returns event code
 * @param xml event struct
 */
function event(xml: Element): string[] {
  return xml.children
    .filter(n => n.localName === "EventStruct")
    .map(c => c.children.find(n => n.localName === "EventCode").text.trim());
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

      const valueType = getValueType(valueElement.attrs);//get value type

      const value = decodeEntities(valueElement.text);//decodes entities and saves results in value
      let parsed: string | number | boolean = value;
      if (valueType === "xsd:boolean") {//if the valueType is boolean
        parsed = parseBool(value); //get the value
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

/**
 * checks if true or false and returns appropriately 
 * @param v 
 */
function parseBool(v): boolean {
  v = "" + v;
  if (v === "true" || v === "TRUE" || v === "True" || v === "1") return true;
  else if (v === "false" || v === "FALSE" || v === "False" || v === "0")
    return false;
  else return null;
}

function getValueType(str): string {
  return parseAttrs(str).find(s => s.localName === "type").value.trim()
}