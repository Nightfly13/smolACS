import { writeFileSync } from "fs";
import { CpeGetResponse } from "./interfaces";

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

export function getConnectionInfo(GetParameterValuesResponse: CpeGetResponse){
  throw Error("NotImplemented")
}