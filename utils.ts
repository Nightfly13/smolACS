import { writeFileSync } from "fs";
import { CpeResponse } from "./interfaces";

export function writeResponseToFile(cpeResponse): void {
    let fileName = cpeResponse.name + ".json";
    let data: string = "{";
  
    console.log(cpeResponse.name)
    console.log(cpeResponse.parameterList)
  
    switch (cpeResponse.name) {
      case "GetParameterValuesResponse":
        data += cpeResponse.parameterList.map(struct => { return `"${struct[0]}":{"value":"${struct[1]}","type":"${struct[2]}"}` }).join(",")
        break;
      case "GetParameterNamesResponse":
        data += cpeResponse.parameterList.map(struct => { return `"${struct[0]}":"${struct[1]}"` }).join(",")
        break;
      case "GetParameterAttributesResponse":
        data += cpeResponse.parameterList.map(struct => { return `"${struct[0]}":{"notification":${struct[1]},"accessList":["${struct[2].join("\",\"")}"]}` }).join(",")
        break;
      default:
        throw Error("Unknown cpeResponse")
    }
    data += "}\n"
  
    writeFileSync(fileName, data, { flag: "a" })
  }