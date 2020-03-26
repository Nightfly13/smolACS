
import * as cluster from "cluster";
import { Server, Socket } from "net";
import { cpus } from "os";
import { GetAcsRequest } from "./interfaces";

let respawnTimestamp: number = 0;
let crashes: number[] = [];

function fork(): cluster.Worker {
  const w: cluster.Worker = cluster.fork();
  w.on("error", (err: NodeJS.ErrnoException) => {
    // Avoid exception when attempting to kill the process just as it's exiting
    if (err.code !== "EPIPE") throw err;
    setTimeout(() => {
      if (!w.isDead()) throw err;
    }, 50);
  });
  return w;
}

function restartWorker(worker: { process: { pid: number; }; }, code: number, signal: string): void {
  const msg = {
    message: "Worker died",
    pid: worker.process.pid,
    exitCode: null,
    signal: null
  };

  if (code != null) msg.exitCode = code;

  if (signal != null) msg.signal = signal;

  console.error(msg);

  const now = Date.now();
  crashes.push(now);

  let min1: number = 0,
    min2: number = 0,
    min3: number = 0;

  crashes = crashes.filter(n => {
    if (n > now - 60000) ++min1;
    else if (n > now - 120000) ++min2;
    else if (n > now - 180000) ++min3;
    else return false;
    return true;
  });

  if (min1 > 5 && min2 > 5 && min3 > 5) {
    process.exitCode = 1;
    cluster.removeListener("exit", restartWorker);
    for (const pid in cluster.workers) cluster.workers[pid].kill();

    console.error({
      message: "Too many crashes, exiting",
      pid: process.pid
    });
    return;
  }

  respawnTimestamp = Math.max(now, respawnTimestamp + 2000);
  if (respawnTimestamp === now) {
    fork();
    return;
  }

  setTimeout(() => {
    if (process.exitCode) return;
    fork();
  }, respawnTimestamp - now);
}

/**
 * Create workers
 * @param workerCount 
 * @param servicePort 
 * @param serviceAddress 
 * @param acsRequests 
 */
export function start(workerCount: number, servicePort: number, serviceAddress: string, acsRequests?: GetAcsRequest[]): void {
  cluster.on("listening", (worker, address) => {
    if (
      (address.addressType === 4 || address.addressType === 6) &&
      address.address === serviceAddress &&
      address.port === servicePort
    ) {
    }
  });

  cluster.on("exit", restartWorker);

  cluster.on("message", (worker: cluster.Worker, message: {topic: string}, handle: Socket | Server) => {
    if (message.topic && message.topic === "acsRequests"){
      worker.send({
        acsRequests: acsRequests
      })
    }
  })

  if (!workerCount) workerCount = Math.max(2, cpus().length);

  for (let i = 0; i < workerCount; ++i) fork();
}

/**
 * Kills worker
 */
export function stop(): void {
  cluster.removeListener("exit", restartWorker);
  for (const pid in cluster.workers) cluster.workers[pid].kill();
}

export const worker = cluster.worker;
