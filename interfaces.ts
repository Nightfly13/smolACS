import { IncomingMessage, ServerResponse } from "http";

export interface Attribute {
    name: string;
    namespace: string;
    localName: string;
    value: string;
}

export interface CpeGetResponse extends CpeResponse {
    name: "GetParameterNamesResponse" | "GetParameterValuesResponse";
    parameterList?:
    | [string, boolean][]
    | [string, string | number | boolean, string][];
}

export interface Element {
    name: string;
    namespace: string;
    localName: string;
    attrs: string;
    text: string;
    bodyIndex: number;
    children: Element[];
}

export interface CpeRequest {
    name: string;
    fileType?: string;
}

export interface CpeResponse {
    name: string;
}

export interface CpeFault {
    faultCode: string;
    faultString: string;
    detail?: FaultStruct;
}

export interface FaultStruct {
    faultCode: string;
    faultString: string;
    setParameterValuesFault?: SpvFault[];
}

export interface SpvFault {
    parameterName: string;
    faultCode: string;
    faultString: string;
}

export interface SoapMessage {
    id: string;
    cwmpVersion: string;
    sessionTimeout: number;
    cpeRequest?: CpeRequest;
    cpeFault?: CpeFault;
    cpeResponse?: CpeResponse;
}

export interface InformRequest extends CpeRequest {
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

export interface AcsResponse {
    name: string;
    commandKey?: string;
    faultStruct?: FaultStruct;
}

export interface CpeSetResponse extends CpeResponse {
    name:
    | "SetParameterValuesResponse"
    | "AddObjectResponse"
    | "DeleteObjectResponse"
    | "RebootResponse"
    | "FactoryResetResponse"
    | "DownloadResponse";
    status?: number;
    instanceNumber?: string;
    startTime?: number;
    completeTime?: number;
}

export interface SessionContext {
    cpeRequests: string[];
    acsRequests?: GetAcsRequest[];
    httpRequest?: IncomingMessage;
    httpResponse?: ServerResponse;
    cwmpVersion: string;
}

export interface AcsRequest {
    name: string;
    next?: string;
}

export interface GetAcsRequest extends AcsRequest {
    name: 
    | "GetParameterNames" 
    | "GetParameterValues" 
    | "SetParameterValues" 
    | "AddObject" 
    | "DeleteObject"
    | "Reboot" 
    | "FactoryReset" 
    | "Download";
    parameterNames?: string[];
    parameterPath?: string;
    nextLevel?: boolean;
    parameterList?: [string, string | number | boolean, string][];
    objectName?: string;
    fileType?: 
    | "1 Firmware Upgrade Image"
    | "2 Web Content"
    | "3 Vendor Configuration File"
    | "4 Tone File"
    | "5 Ringer File"
    | "6 Stored Firmware Image"
    URL?: string;
    username?: string;
    password?: string;
    fileSize?: number;
    targetFileName?: string;
    delaySeconds?: number;
    successURL?: string;
    failureURL?: string; 
}


