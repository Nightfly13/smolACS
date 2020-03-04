import { extractValueType, parseBool } from "./parsefuncs"
import { SetParameterAttributesStruct, GetAcsRequest } from "./interfaces";
import { question, keyInYN }  from 'readline-sync';

export function generateSetParameterValuesRequest(): GetAcsRequest {
    let parameterList: [string, string | number | boolean, string][] = [], name: string, value: string, type: string;
    let answer: string | boolean;
    while (true) {
        answer = question("Please enter the name\n")
        if ((answer as string).length > 0) name = answer as string;
        answer = question("Please enter the value\n")
        if ((answer as string).length > 0) value = answer as string;
        type = extractValueType(value);
        parameterList.push([name, value, type]);
        answer = keyInYN("Do you want to add another value? \n")
        if (!answer) return { name: "SetParameterValues", parameterList: parameterList };
    }
}

export function generateGetParameterValuesRequest(): GetAcsRequest {
    let parameterNames: string[] = [], name: string;
    let answer: string | boolean;
    while (true) {
        answer = question("Please enter the name\n")
        if ((answer as string).length > 0) name = answer as string;
        parameterNames.push(name);
        answer = keyInYN("Do you want to add another value? \n")
        if (!answer) return { name: "GetParameterValues", parameterNames: parameterNames };
    }
}

export function generateGetParameterNamesRequest(): GetAcsRequest {
    let parameterPath: string, nextLevel: boolean;
    let answer: string;
    answer = question("Please enter the parameter path\n")
    if (answer.length > 0) parameterPath = answer;
    answer = question("Please enter the value for nextLevel\n")
    if (answer.length > 0 && parseBool(answer) !== null) nextLevel = parseBool(answer);
    return { name: "GetParameterNames", parameterPath: parameterPath, nextLevel: nextLevel };
}

export function generateSetParameterAttributesRequest(): GetAcsRequest {
    let setParameterAttributes: SetParameterAttributesStruct[] = [], name: string, notificationChange: boolean, notification: 0 | 1 | 2 | 3 | 4 | 5 | 6, accessListChange: boolean, accessList: string[] = [];
    let answer: string | boolean;
    while (true) {
        answer = question("Please enter the name\n")
        if ((answer as string).length > 0) name = answer as string;
        answer = question("Please enter the value for notificationChange\n")
        if ((answer as string).length > 0 && parseBool(answer) !== null) notificationChange = !!answer;
        if (parseBool(notificationChange)) {
            answer = question("Please enter the value for notification\n")
            if ((answer as string).length > 0 && parseInt((answer as string)) >= 0 && parseInt((answer as string)) <= 6) notification = (answer as unknown as 0 | 1 | 2 | 3 | 4 | 5 | 6);
        }
        answer = question("Please enter the value for accessListChange\n")
        if ((answer as string).length > 0 && parseBool(answer) !== null) accessListChange = !!answer;
        if (parseBool(accessListChange)) {
            let runloop = true
            while (runloop) {
                answer = question("What do you want to add to access list?\n")
                if ((answer as string).length > 0) {
                    accessList.push((answer as string))
                } else {
                    runloop = false
                }
            }
        }
        setParameterAttributes.push({name: name, notificationChange: notificationChange, notification: notification, accessListChange: accessListChange, accessList:accessList});
        answer = keyInYN("Do you want to add another value? \n")
        if (!answer) return { name: "SetParameterAttributes", setParameterAttributes: setParameterAttributes };
    }
}

export function generateGetParameterAttributesRequest(): GetAcsRequest {
    let parameterNames: string[]= [], name: string;
    let answer: string | boolean;
    while (true) {
        answer = question("Please enter the name\n")
        if ((answer as string).length > 0) name = answer as string;
        parameterNames.push(name);
        answer = keyInYN("Do you want to add another value? \n")
        if (!answer) return { name: "GetParameterAttributes", parameterNames: parameterNames };
    }
}

export function generateAddObjectRequest(): GetAcsRequest {
    let objectName: string;
    let answer: string;
    answer = question("Please enter the object name\n")
    if (answer.length > 0) objectName = answer;
    return { name: "AddObject", objectName: objectName };
}

export function generateDeleteObjectRequest(): GetAcsRequest {
    let objectName: string;
    let answer: string;
    answer = question("Please enter the object name\n")
    if (answer.length > 0) objectName = answer;
    return { name: "DeleteObject", objectName: objectName };
}

export function generateDownloadRequest(): GetAcsRequest {
    let answer: string;
    let answer2: GetAcsRequest["fileType"];
    let fileType: GetAcsRequest["fileType"], URL: string, username: string, password: string;
    answer2 = question("Please enter the file type\n") as GetAcsRequest["fileType"];
    if (answer2.length > 0) fileType = answer2;
    answer = question("Please enter the URL\n")
    if (answer.length > 0) URL = answer;
    answer = question("Please enter the username\n")
    if (answer.length > 0) username = answer;
    answer = question("Please enter the password\n")
    if (answer.length > 0) password = answer;
    return { name: "Download", fileType: fileType, DownloadParams:{ URL: URL, username: username, password: password} }
}

export function generateRebootRequest(): GetAcsRequest {
    let answer: string | boolean;
    answer = keyInYN("Are you sure you want to reboot? \n")
    if (answer) return { name: "Reboot" }
}
