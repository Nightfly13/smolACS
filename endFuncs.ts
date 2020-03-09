import { ChildProcess } from "child_process";

const processes: { [script: string]: ChildProcess } = {};

/**
 * Shuts down worker ungracefully
 */
export function exitWorkerUngracefully(): void {
    killAll().then(() => {
      process.exit(1);
    });
  }

/**
 * kills a child process 
 * @param process 
 */
function kill(process: ChildProcess): Promise<void> {
    return new Promise(resolve => {
      const timeToKill = Date.now() + 5000;
  
      process.kill(); //kill process
  
      const t = setInterval(() => { //set an interval for every 100ms
        if (!process.connected) { //if process is dead
          clearInterval(t); //clear the interval
          resolve(); //resolve promise
        } else if (Date.now() > timeToKill) { //otherwise, if time to kill ran out
          process.kill("SIGKILL"); //hardkill process
          clearInterval(t); //clear the intercal
          resolve(); //resolve promise
        }
      }, 100);
    });
  }
/**
 * kill all active processes
 */
async function killAll(): Promise<void> {
    await Promise.all(
      Object.entries(processes).map(([k, p]) => {
        delete processes[k];
        return kill(p);
      })
    );
  }
  
  
