import { Element, InformRequest, CpeFault, AcsResponse, CpeGetResponse, CpeSetResponse, TransferCompleteRequest, CpeRequest } from "./interfaces"
import * as soap from "./soap"
import * as parseFuncs from "./parseFuncs"

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

//#region Generate ACS RPC responses
export function GetRPCMethodsResponse(methodResponse): string {
  return `<cwmp:GetRPCMethodsResponse><MethodList soap-enc:arrayType="xsd:string[${
    methodResponse.methodList.length
    }]">${methodResponse.methodList
      .map(m => `<string>${m}</string>`)
      .join("")}</MethodList></cwmp:GetRPCMethodsResponse>`;
}

export function InformResponse(): string {
  return "<cwmp:InformResponse><MaxEnvelopes>1</MaxEnvelopes></cwmp:InformResponse>";
}

export function TransferCompleteResponse(): string {
  return "<cwmp:TransferCompleteResponse></cwmp:TransferCompleteResponse>";
}

//To-do: add AutonomousTransferCompleteResponse

export function RequestDownloadResponse(): string {
  return "<cwmp:RequestDownloadResponse></cwmp:RequestDownloadResponse>";
}
//#endregion

//#region Parse CPE RPC response values
export function SetParameterValuesResponse(xml: Element): CpeSetResponse {
  return {
    name: "SetParameterValuesResponse",
    status: parseInt(xml.children.find(n => n.localName === "Status").text)
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

export function GetParameterNamesResponse(xml): CpeGetResponse {
  return {
    name: "GetParameterNamesResponse",
    parameterList: soap.parameterInfoList(
      xml.children.find(n => n.localName === "ParameterList")
    )
  };
}

export function SetParameterAttributesResponse(xml): CpeSetResponse {
  return {
    name: "SetParameterAttributesResponse",
    parameterList: soap.parameterInfoList(
      xml.children.find(n => n.localName === "ParameterList")
    )
  };
}

export function GetParameterAttributesResponse(xml): CpeGetResponse {
  return {
    name: "GetParameterAttributesResponse",
    parameterList: soap.parameterInfoList(
      xml.children.find(n => n.localName === "ParameterList")
    )
  };
}

export function AddObjectResponse(xml: Element): CpeSetResponse {
  let instanceNumber, status;
  for (const c of xml.children) {
    switch (c.localName) {
      case "InstanceNumber":
        instanceNumber = parseInt(c.text);
        break;
      case "Status":
        status = parseInt(c.text);
        break;
    }
  }

  return {
    name: "AddObjectResponse",
    instanceNumber: instanceNumber,
    status: status
  };
}

export function DeleteObjectResponse(xml: Element): CpeSetResponse {
  return {
    name: "DeleteObjectResponse",
    status: parseInt(xml.children.find(n => n.localName === "Status").text)
  };
}

export function DownloadResponse(xml: Element): CpeSetResponse {
  let status, startTime, completeTime;
  for (const c of xml.children) {
    switch (c.localName) {
      case "Status":
        status = parseInt(c.text);
        break;
      case "StartTime":
        startTime = Date.parse(c.text);
        break;
      case "CompleteTime":
        completeTime = Date.parse(c.text);
        break;
    }
  }

  return {
    name: "DownloadResponse",
    status: status,
    startTime: startTime,
    completeTime: completeTime
  };
}

export function RebootResponse(): CpeSetResponse {
  return {
    name: "RebootResponse"
  };
}

//Additional optional CPE response parsing 
export function FactoryResetResponse(): CpeSetResponse {
  return {
    name: "FactoryResetResponse"
  };
}
//#endregion

//#region Parse CPE RPC requests
export function GetRPCMethods(): AcsResponse {
  return { name: "GetRPCMethods" };
}

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

export function TransferComplete(xml: Element): TransferCompleteRequest {
  let commandKey, _faultStruct, startTime, completeTime;
  for (const c of xml.children) {
    switch (c.localName) {
      case "CommandKey":
        commandKey = c.text;
        break;
      case "FaultStruct":
        _faultStruct = soap.faultStruct(c);
        break;
      case "StartTime":
        startTime = Date.parse(c.text);
        break;
      case "CompleteTime":
        completeTime = Date.parse(c.text);
        break;
    }
  }

  return {
    name: "TransferComplete",
    commandKey: commandKey,
    faultStruct: _faultStruct,
    startTime: startTime,
    completeTime: completeTime
  };
}

//To-do: add AutonomousTransferComplete

export function RequestDownload(xml: Element): CpeRequest {
  return {
    name: "RequestDownload",
    fileType: xml.children.find(n => n.localName === "FileType").text
  };
}
//#endregion

//#region Generate ACS RPC requests
export function SetParameterValues(methodRequest): string {
  const params = methodRequest.parameterList.map(p => {
    let val = p[1];
    if (p[2] === "xsd:dateTime" && typeof val === "number") {
      val = new Date(val).toISOString().replace(".000", "");
    }
    if (p[2] === "xsd:boolean" && typeof val === "boolean")
      val = +val;
    return `<ParameterValueStruct><Name>${p[0]}</Name><Value xsi:type="${p[2]}">${parseFuncs.encodeEntities("" + val)}</Value></ParameterValueStruct>`;
  });

  return `<cwmp:SetParameterValues><ParameterList soap-enc:arrayType="cwmp:ParameterValueStruct[${
    methodRequest.parameterList.length
    }]">${params.join(
      ""
    )}</ParameterList><ParameterKey>${methodRequest.parameterKey ||
    ""}</ParameterKey></cwmp:SetParameterValues>`;
}

export function GetParameterValues(methodRequest): string {
  return `<cwmp:GetParameterValues><ParameterNames soap-enc:arrayType="xsd:string[${
    methodRequest.parameterNames.length
    }]">${methodRequest.parameterNames
      .map(p => `<string>${p}</string>`)
      .join("")}</ParameterNames></cwmp:GetParameterValues>`;
}

export function GetParameterNames(methodRequest): string {
  return `<cwmp:GetParameterNames><ParameterPath>${
    methodRequest.parameterPath
    }</ParameterPath><NextLevel>${+methodRequest.nextLevel}</NextLevel></cwmp:GetParameterNames>`;
}

export function SetParameterAttributes(): string {
  return ""
}

export function GetParameterAttributes(): string {
  return ""
}

export function AddObject(methodRequest): string {
  return `<cwmp:AddObject><ObjectName>${
    methodRequest.objectName
    }</ObjectName><ParameterKey>${methodRequest.parameterKey ||
    ""}</ParameterKey></cwmp:AddObject>`;
}

export function DeleteObject(methodRequest): string {
  return `<cwmp:DeleteObject><ObjectName>${
    methodRequest.objectName
    }</ObjectName><ParameterKey>${methodRequest.parameterKey ||
    ""}</ParameterKey></cwmp:DeleteObject>`;
}

export function Download(methodRequest): string {
  return `<cwmp:Download><CommandKey>${methodRequest.commandKey ||
    ""}</CommandKey><FileType>${methodRequest.fileType}</FileType><URL>${
    methodRequest.url
    }</URL><Username>${parseFuncs.encodeEntities(
      methodRequest.username || ""
    )}</Username><Password>${parseFuncs.encodeEntities(
      methodRequest.password || ""
    )}</Password><FileSize>${methodRequest.fileSize ||
    "0"}</FileSize><TargetFileName>${parseFuncs.encodeEntities(
      methodRequest.targetFileName || ""
    )}</TargetFileName><DelaySeconds>${methodRequest.delaySeconds ||
    "0"}</DelaySeconds><SuccessURL>${parseFuncs.encodeEntities(
      methodRequest.successUrl || ""
    )}</SuccessURL><FailureURL>${parseFuncs.encodeEntities(
      methodRequest.failureUrl || ""
    )}</FailureURL></cwmp:Download>`;
}

export function Reboot(methodRequest): string {
  return `<cwmp:Reboot><CommandKey>${methodRequest.commandKey ||
    ""}</CommandKey></cwmp:Reboot>`;
}

//Additional optional ACS RPC requests
export function FactoryReset(): string {
  return "<cwmp:FactoryReset></cwmp:FactoryReset>";
}
//#endregion