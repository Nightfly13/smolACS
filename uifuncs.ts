import { extractValueType, parseBool } from "./parsefuncs"
import { SetParameterAttributesStruct, GetAcsRequest } from "./interfaces";

export function generateSetParameterValuesRequest(readline): GetAcsRequest {
    let parameterList: [string, string | number | boolean, string][] = [], name: string, value: string, type: string;
    let answer: string;
    while (true) {
        answer = readline.question("Please enter the name\n")
        if (answer.length > 0) name = answer;
        answer = readline.question("Please enter the value\n")
        if (answer.length > 0) value = answer;
        type = extractValueType(value);
        parameterList.push([name, value, type]);
        answer = readline.keyInYN("Do you want to add another value? \n")
        if (!answer) return { name: "SetParameterValues", parameterList: parameterList };
    }
}

export function generateGetParameterValuesRequest(readline): GetAcsRequest {
    let parameterNames: string[] = [], name: string;
    let answer: string;
    while (true) {
        answer = readline.question("Please enter the name\n")
        if (answer.length > 0) name = answer;
        parameterNames.push(name);
        answer = readline.keyInYN("Do you want to add another value? \n")
        if (!answer) return { name: "GetParameterValues", parameterNames: parameterNames };
    }
}

export function generateGetParameterNamesRequest(readline): GetAcsRequest {
    let parameterPath: string, nextLevel: boolean;
    let answer: any;
    answer = readline.question("Please enter the parameter path\n")
    if (answer.length > 0) parameterPath = answer;
    answer = readline.question("Please enter the value for nextLevel\n")
    if (answer.length > 0 && parseBool(answer) !== null) nextLevel = answer;
    return { name: "GetParameterNames", parameterPath: parameterPath, nextLevel: nextLevel };
}

export function generateSetParameterAttributesRequest(readline): GetAcsRequest {
    let setParameterAttributes: SetParameterAttributesStruct[] = [], name: string, notificationChange: boolean, notification: 0 | 1 | 2 | 3 | 4 | 5 | 6, accessListChange: boolean, accessList: string[] = [];
    let answer: any;
    while (true) {
        answer = readline.question("Please enter the name\n")
        if (answer.length > 0) name = answer;
        answer = readline.question("Please enter the value for notificationChange\n")
        if (answer.length > 0 && parseBool(answer) !== null) notificationChange = answer;
        if (parseBool(notificationChange)) {
            answer = readline.question("Please enter the value for notification\n")
            if (answer.length > 0 && parseInt(answer) >= 0 && parseInt(answer) <= 6) notification = answer;
        }
        answer = readline.question("Please enter the value for accessListChange\n")
        if (answer.length > 0 && parseBool(answer) !== null) accessListChange = answer;
        if (parseBool(accessListChange)) {
            let runloop = true
            while (runloop) {
                answer = readline.question("What do you want to add to access list?\n")
                if (answer.length > 0) {
                    accessList.push(answer)
                } else {
                    runloop = false
                }
            }
        }
        setParameterAttributes.push({name: name, notificationChange: notificationChange, notification: notification, accessListChange: accessListChange, accessList:accessList});
        answer = readline.keyInYN("Do you want to add another value? \n")
        if (!answer) return { name: "SetParameterAttributes", setParameterAttributes: setParameterAttributes };
    }
}

export function generateGetParameterAttributesRequest(readline): GetAcsRequest {
    let parameterNames: string[]= [], name: string;
    let answer: string;
    while (true) {
        answer = readline.question("Please enter the name\n")
        if (answer.length > 0) name = answer;
        parameterNames.push(name);
        answer = readline.keyInYN("Do you want to add another value? \n")
        if (!answer) return { name: "GetParameterAttributes", parameterNames: parameterNames };
    }
}

export function generateAddObjectRequest(readline): GetAcsRequest {
    let objectName: string;
    let answer: string;
    answer = readline.question("Please enter the object name\n")
    if (answer.length > 0) objectName = answer;
    return { name: "AddObject", objectName: objectName };
}

export function generateDeleteObjectRequest(readline): GetAcsRequest {
    let objectName: string;
    let answer: string;
    answer = readline.question("Please enter the object name\n")
    if (answer.length > 0) objectName = answer;
    return { name: "DeleteObject", objectName: objectName };
}

export function generateDownloadRequest(readline): GetAcsRequest {
    let answer: string;
    let answer2: GetAcsRequest["fileType"];
    let fileType: GetAcsRequest["fileType"], URL: string, username: string, password: string;
    answer2 = readline.question("Please enter the file type\n")
    if (answer2.length > 0) fileType = answer2;
    answer = readline.question("Please enter the URL\n")
    if (answer.length > 0) URL = answer;
    answer = readline.question("Please enter the username\n")
    if (answer.length > 0) username = answer;
    answer = readline.question("Please enter the password\n")
    if (answer.length > 0) password = answer;
    return { name: "Download", fileType: fileType, URL: URL, username: username, password: password }
}

export function generateRebootRequest(readline): GetAcsRequest {
    let answer: string;
    answer = readline.keyInYN("Are you sure you want to reboot? \n")
    if (answer) return { name: "Reboot" }
}
