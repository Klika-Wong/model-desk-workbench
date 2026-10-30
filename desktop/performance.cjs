const os = require('node:os');
const { execFile } = require('node:child_process');
let previous = null, cached = null, pending = null;
function cpuTimes() { return os.cpus().reduce((sum, cpu) => { sum.idle += cpu.times.idle; sum.total += Object.values(cpu.times).reduce((a,b) => a+b,0); return sum; }, {idle:0,total:0}); }
function readGpu() { return new Promise(resolve => { execFile('nvidia-smi', ['--query-gpu=name,utilization.gpu,memory.used,memory.total','--format=csv,noheader,nounits'], { windowsHide:true, timeout:3000, maxBuffer:16384 }, (error, stdout) => {
 if (error) return resolve([]);
 const rows = stdout.trim().split(/\r?\n/).map(line => { const [name, usage, used, total] = line.split(',').map(s => s.trim()); return {name,usage:Number(usage),usedMiB:Number(used),totalMiB:Number(total)}; });
 resolve(rows.filter(g => [g.usage,g.usedMiB,g.totalMiB].every(Number.isFinite) && g.usage >= 0 && g.usage <=100 && g.totalMiB > 0));
 }); }); }
async function sample() {
 if (cached && Date.now()-cached.sampledAt < 10000) return cached;
 if (pending) return pending;
 pending = (async () => { const now = cpuTimes(); const delta = previous ? now.total-previous.total : 0; const cpuPercent = delta > 0 ? Math.max(0,Math.min(100,100*(1-(now.idle-previous.idle)/delta))) : null; previous=now;
 const gpus=await readGpu(); cached={sampledAt:Date.now(),cpuPercent,totalBytes:os.totalmem(),usedBytes:os.totalmem()-os.freemem(),gpus,modelAttribution:'unknown'};return cached; })();
 try { return await pending; } finally { pending=null; }
}
module.exports={sample};
