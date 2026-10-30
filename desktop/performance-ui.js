(() => {
 const panel=document.getElementById('performance-dialog'), values=document.getElementById('performance-values'); let timer=null, generation=0;
 async function update() { const run=generation; try { const data=await window.workbench.performanceSample(); if (!panel.open || run!==generation) return; values.replaceChildren(); const lines=[`CPU：${data.cpuPercent === null ? '等待第二次采样' : data.cpuPercent.toFixed(1)+'%'}`,`内存：${(data.usedBytes/2**30).toFixed(1)} / ${(data.totalBytes/2**30).toFixed(1)} GB`,...data.gpus.map(g=>`${g.name}：${g.usage}% · 显存 ${g.usedMiB} / ${g.totalMiB} MiB`), data.gpus.length ? '' : 'GPU：不可用或未支持',`采样时间：${new Date(data.sampledAt).toLocaleTimeString()}`];for(const text of lines.filter(Boolean)){const p=document.createElement('p');p.textContent=text;values.append(p);} } catch { if (panel.open) values.textContent='读取失败，请稍后重试。'; } }
 document.getElementById('open-performance').onclick=()=>{panel.showModal();generation++;update();clearInterval(timer);timer=setInterval(update,10000);};
 document.getElementById('close-performance').onclick=()=>panel.close();
 panel.addEventListener('close',()=>{generation++;clearInterval(timer);timer=null;});
 document.getElementById('refresh-performance').onclick=update;
})();
