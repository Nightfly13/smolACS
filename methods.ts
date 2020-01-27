import {Element, InformRequest, CpeFault, AcsResponse, CpeGetResponse, CpeSetResponse} from "./interfaces"
import * as soap from "./soap"
import * as parseFuncs from "./parseFuncs"
/**
 * returns object with name, parameter list, device ID, event and retry counter
 * @param xml inform xml object
 */
export function Inform(xml: Element): InformRequest {
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
                parameterList = soap.parameterValueList(c);
                break;
            case "DeviceId"://set values of deviceId
                for (const cc of c.children) {
                    const n = cc.localName;
                    if (n in deviceId) deviceId[n] = parseFuncs.decodeEntities(cc.text);
                }
                break;
            case "Event"://set evnt equal to the event code of the xml
                evnt = parseFuncs.event(c);
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


export function fault(xml: Element): CpeFault {
    let faultCode, faultString, detail;
    for (const c of xml.children) {
        switch (c.localName) {
            case "faultcode":
                faultCode = c.text;
                break;
            case "faultstring":
                faultString = parseFuncs.decodeEntities(c.text);
                break;
            case "detail":
                detail = soap.faultStruct(c.children.find(n => n.localName === "Fault"));
                break;
        }
    }

    return { faultCode, faultString, detail };
}

export function GetRPCMethods(): AcsResponse {
    return { name: "GetRPCMethods" };
}

export function GetParameterNamesResponse(xml): CpeGetResponse {
    return {
        name: "GetParameterNamesResponse",
        parameterList: soap.parameterInfoList(
            xml.children.find(n => n.localName === "ParameterList")
        )
    };
}

export function GetParameterValuesResponse(xml: Element): CpeGetResponse {
    return {
        name: "GetParameterValuesResponse",
        parameterList: soap.parameterValueList(
            xml.children.find(n => n.localName === "ParameterList")
        )
    };
}

export function SetParameterValuesResponse(xml: Element): CpeSetResponse {
    return {
        name: "SetParameterValuesResponse",
        status: parseInt(xml.children.find(n => n.localName === "Status").text)
    };
}
