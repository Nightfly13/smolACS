import * as parsefuncs from "./parseFuncs"
import { Element, FaultStruct, SpvFault, SoapMessage, SessionContext } from "./interfaces"
import * as methods from "./methods"
import { promisify } from "util";
import * as zlib from "zlib";

const VERSION = require('./package.json').version;
let warnings;

/**
 * Creates an RPC object from XML and returns it
 * @param body XML body
 * @param cwmpVersion 
 * @param warn array for warnings
 */
export function request(body: string, cwmpVersion, warn, sessionContext: SessionContext): SoapMessage {
  warnings = warn;

  const rpc = {
    id: null,
    cwmpVersion: cwmpVersion,
    sessionTimeout: null,
    cpeRequest: null,
    cpeFault: null,
    cpeResponse: null
  };


  if (!body.length) {
    sessionContext.cpeRequests.push("end");
    return rpc; //if body is empty return 
  }
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

  if (!methodElement.localName.includes("Response")) sessionContext.cpeRequests.push(methodElement.localName)

  switch (methodElement.localName) {
    case "Inform":
      rpc.cpeRequest = methods.Inform(methodElement);
      break;
    case "GetRPCMethods":
      rpc.cpeRequest = methods.GetRPCMethods();
      break;
    case "TransferComplete":
      rpc.cpeRequest = methods.TransferComplete(methodElement);
      break;
    case "RequestDownload":
      rpc.cpeRequest = methods.RequestDownload(methodElement);
      break;
    case "GetParameterNamesResponse":
      rpc.cpeResponse = methods.GetParameterNamesResponse(methodElement);
      break;
    case "GetParameterValuesResponse":
      rpc.cpeResponse = methods.GetParameterValuesResponse(methodElement);
      break;
    case "SetParameterValuesResponse":
      rpc.cpeResponse = methods.SetParameterValuesResponse(methodElement);
      break;
    case "SetParameterAttributesResponse":
      rpc.cpeResponse = methods.SetParameterAttributesResponse();
      break;
    case "GetParameterAttributesResponse":
      rpc.cpeResponse = methods.GetParameterAttributesResponse(methodElement);
      break;
    case "AddObjectResponse":
      rpc.cpeResponse = methods.AddObjectResponse(methodElement);
      break;
    case "DeleteObjectResponse":
      rpc.cpeResponse = methods.DeleteObjectResponse(methodElement);
      break;
    case "RebootResponse":
      rpc.cpeResponse = methods.RebootResponse();
      break;
    case "FactoryResetResponse":
      rpc.cpeResponse = methods.FactoryResetResponse();
      break;
    case "DownloadResponse":
      rpc.cpeResponse = methods.DownloadResponse(methodElement);
      break;
    case "Fault":
      rpc.cpeFault = methods.fault(methodElement);
      break;
    default:
      throw new Error(`8000 Method not supported ${methodElement.localName}`);
  }

  return rpc;
}

/**
 * returns an array of arrays populated by parameter name, value and type
 * @param xml 
 */
export function parameterValueList(
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

export function parameterInfoList(xml: Element): [string, boolean][] {
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

export function faultStruct(xml: Element): FaultStruct {
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

const SERVER_NAME = `smolACS/${VERSION}`;

const NAMESPACES = {
  "1.0": {
    "soap-enc": "http://schemas.xmlsoap.org/soap/encoding/",
    "soap-env": "http://schemas.xmlsoap.org/soap/envelope/",
    xsd: "http://www.w3.org/2001/XMLSchema",
    xsi: "http://www.w3.org/2001/XMLSchema-instance",
    cwmp: "urn:dslforum-org:cwmp-1-0"
  },
  "1.1": {
    "soap-enc": "http://schemas.xmlsoap.org/soap/encoding/",
    "soap-env": "http://schemas.xmlsoap.org/soap/envelope/",
    xsd: "http://www.w3.org/2001/XMLSchema",
    xsi: "http://www.w3.org/2001/XMLSchema-instance",
    cwmp: "urn:dslforum-org:cwmp-1-1"
  },
  "1.2": {
    "soap-enc": "http://schemas.xmlsoap.org/soap/encoding/",
    "soap-env": "http://schemas.xmlsoap.org/soap/envelope/",
    xsd: "http://www.w3.org/2001/XMLSchema",
    xsi: "http://www.w3.org/2001/XMLSchema-instance",
    cwmp: "urn:dslforum-org:cwmp-1-2"
  },
  "1.3": {
    "soap-enc": "http://schemas.xmlsoap.org/soap/encoding/",
    "soap-env": "http://schemas.xmlsoap.org/soap/envelope/",
    xsd: "http://www.w3.org/2001/XMLSchema",
    xsi: "http://www.w3.org/2001/XMLSchema-instance",
    cwmp: "urn:dslforum-org:cwmp-1-2"
  },
  "1.4": {
    "soap-enc": "http://schemas.xmlsoap.org/soap/encoding/",
    "soap-env": "http://schemas.xmlsoap.org/soap/envelope/",
    xsd: "http://www.w3.org/2001/XMLSchema",
    xsi: "http://www.w3.org/2001/XMLSchema-instance",
    cwmp: "urn:dslforum-org:cwmp-1-3"
  }
};

const namespacesAttrs = {
  "1.0": Object.entries(NAMESPACES["1.0"])
    .map(([k, v]) => `xmlns:${k}="${v}"`)
    .join(" "),
  "1.1": Object.entries(NAMESPACES["1.1"])
    .map(([k, v]) => `xmlns:${k}="${v}"`)
    .join(" "),
  "1.2": Object.entries(NAMESPACES["1.2"])
    .map(([k, v]) => `xmlns:${k}="${v}"`)
    .join(" "),
  "1.3": Object.entries(NAMESPACES["1.3"])
    .map(([k, v]) => `xmlns:${k}="${v}"`)
    .join(" "),
  "1.4": Object.entries(NAMESPACES["1.4"])
    .map(([k, v]) => `xmlns:${k}="${v}"`)
    .join(" ")
};


const gzipPromisified = promisify(zlib.gzip);
const deflatePromisified = promisify(zlib.deflate);

/**
 * returns ACS response as an array of format [code, headers, XML data]
 * @param rpc 
 */
export function response(rpc): { code: number; headers: {}; data: string } {
  const headers = {
    Server: SERVER_NAME,
    SOAPServer: SERVER_NAME
  };

  if (!rpc) return { code: 204, headers: headers, data: "" }; //if rpc doesn't exist, return error code 204

  //#region
  /*let body;
  if (rpc.acsResponse) { //assign function based on acsResponse
    switch (rpc.acsResponse.name) {
      case "InformResponse":
        body = methods.InformResponse();
        break;
      case "GetRPCMethodsResponse":
        body = methods.GetRPCMethodsResponse(rpc.acsResponse);
        break;
      /*case "TransferCompleteResponse":
        body = TransferCompleteResponse();
        break;
      case "RequestDownloadResponse":
        body = RequestDownloadResponse();
        break;
      default:
        throw new Error(`Unknown method response type ${rpc.acsResponse.name}`);
    }
  } else if (rpc.acsRequest) { //assign function based on acsRequest
    switch (rpc.acsRequest.name) {
      case "GetParameterNames":
        body = methods.GetParameterNames(rpc.acsRequest);
        break;
      case "GetParameterValues":
        body = methods.GetParameterValues(rpc.acsRequest);
        break;
      case "SetParameterValues":
        body = methods.SetParameterValues(rpc.acsRequest);
        break;
      /*case "AddObject":
        body = AddObject(rpc.acsRequest);
        break;
      case "DeleteObject":
        body = DeleteObject(rpc.acsRequest);
        break;
      case "Reboot":
        body = Reboot(rpc.acsRequest);
        break;
      case "FactoryReset":
        body = FactoryReset();
        break;
      case "Download":
        body = Download(rpc.acsRequest);
        break;
      default:
        throw new Error(`Unknown method request ${rpc.acsRequest.name}`);
    }
  }*/
  //#endregion

  headers["Content-Type"] = 'text/xml; charset="utf-8"';
  return {
    code: 200,
    headers: headers,
    data: `<?xml version="1.0" encoding="UTF-8"?>\n<soap-env:Envelope ${
      namespacesAttrs[rpc.cwmpVersion]
      }><soap-env:Header><cwmp:ID soap-env:mustUnderstand="1">${
      rpc.id
      }</cwmp:ID></soap-env:Header><soap-env:Body>${rpc.body}</soap-env:Body></soap-env:Envelope>`
  };
}

export async function writeResponse(
  sessionContext: SessionContext,
  res,
  close = false
): Promise<void> {
  // Close connection after last request in session
  if (close) res.headers["Connection"] = "close";

  let data = res.data;

  // Respond using the same content-encoding as the request
  if (sessionContext.httpRequest.headers["content-encoding"] && res.data.length > 0) {
    switch (sessionContext.httpRequest.headers["content-encoding"]) {
      case "gzip":
        res.headers["Content-Encoding"] = "gzip";
        data = await gzipPromisified(data);
        break;
      case "deflate":
        res.headers["Content-Encoding"] = "deflate";
        data = await deflatePromisified(data);
    }
  }

  const httpResponse = sessionContext.httpResponse;

  httpResponse.setHeader("Content-Length", Buffer.byteLength(data));
  httpResponse.writeHead(res.code, res.headers);
  httpResponse.end(data);
}