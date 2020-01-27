import * as parsefuncs from "./parseFuncs"
import {Element, FaultStruct, SpvFault, SoapMessage, SessionContext} from "./interfaces"
import * as methods from "./methods"
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

    sessionContext.cpeRequests.push(methodElement.localName)

    switch (methodElement.localName) {
        case "Inform":
            rpc.cpeRequest = methods.Inform(methodElement);
            break;
        case "GetRPCMethods":
            rpc.cpeRequest = methods.GetRPCMethods();
            break;
        /*case "TransferComplete":
          rpc.cpeRequest = TransferComplete(methodElement);
          break;
        case "RequestDownload":
          rpc.cpeRequest = RequestDownload(methodElement);
          break;*/
        case "GetParameterNamesResponse":
            rpc.cpeResponse = methods.GetParameterNamesResponse(methodElement);
            break;
        case "GetParameterValuesResponse":
            rpc.cpeResponse = methods.GetParameterValuesResponse(methodElement);
            break;
        case "SetParameterValuesResponse":
            rpc.cpeResponse = methods.SetParameterValuesResponse(methodElement);
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
