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

export interface SessionContext{
    cpeRequests: string[];
    acsRequests?: string[];
}