import { writeFileSync } from "fs";
import { CpeGetResponse } from "./interfaces";
import * as http from "http"

export function writeResponseToFile(cpeResponse: CpeGetResponse): void {
  let fileName = cpeResponse.name + ".json";
  let data: string = "{";

  console.log(cpeResponse.name)
  console.log(cpeResponse.parameterList)

  switch (cpeResponse.name) {
    case "GetParameterValuesResponse":
      data += (cpeResponse.parameterList as [string, string | number | boolean, string][]).map(struct => { return `"${struct[0]}":{"value":"${struct[1]}","type":"${struct[2]}"}` }).join(",")
      break;
    case "GetParameterNamesResponse":
      data += (cpeResponse.parameterList as [string, boolean][]).map(struct => { return `"${struct[0]}":"${struct[1]}"` }).join(",")
      break;
    case "GetParameterAttributesResponse":
      data += (cpeResponse.parameterList as [string, string, string[]][]).map(struct => { return `"${struct[0]}":{"notification":${struct[1]},"accessList":["${struct[2].join("\",\"")}"]}` }).join(",")
      break;
    default:
      throw Error("Unknown cpeResponse")
  }
  data += "}\n"

  writeFileSync(fileName, data, { flag: "a" })
}

export function getConnectionInfo(GetParameterValuesResponse: CpeGetResponse) {
  let parameterList = GetParameterValuesResponse.parameterList as [string, string | number | boolean, string][]
  let freq5: boolean = true
  let freq2: boolean = true

  if (!parameterList[0][0].includes("Device.WiFi.AccessPoint.1.")) { freq2 = false }
  if (!parameterList[0][0].includes("Device.WiFi.AccessPoint.5.")) { freq5 = false }
  if (!freq2 && !freq5) { return }

  let numEntries: number = parameterList.find((parameter) => parameter[0] == `Device.WiFi.AccessPoint.${freq5 ? "5" : "1"}.AssociatedDeviceNumberOfEntries`)[1] as number

  if (numEntries == 0) { return }

  let devices: { deviceMac: string; freq: number; signal_str: number; }[] = []

  for (let index = 1; index <= numEntries; index++) {
    let macAddr: string = parameterList.find((parameter) => parameter[0] == `Device.WiFi.AccessPoint.${freq5 ? "5" : "1"}.AssociatedDevice.${index}.MACAddress`)[1] as string
    let signalStr: number = parameterList.find((parameter) => parameter[0] == `Device.WiFi.AccessPoint.${freq5 ? "5" : "1"}.AssociatedDevice.${index}.SignalStrength`)[1] as number
    devices.push({ deviceMac: macAddr, freq: freq5 ? 50 : 24, signal_str: signalStr })
  }


  let reqOpts = {
    hostname: '127.0.0.1',
    port: 7555,
    path: '/addConnection',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  }

  devices.forEach(async device => {
    let data = JSON.stringify(device)
    let req = http.request(reqOpts)
    req.write(data)
    req.end()
  });
}