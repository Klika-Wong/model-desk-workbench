(() => {
 const $=id=>document.getElementById(id),root=document.documentElement;
 let settings={enabled:false,image:'',opacity:.86,shade:.18,blur:10},timer=null,revision=0;
 try{const s=JSON.parse(localStorage.getItem('workbench.appearance'));if(s&&typeof s==='object'){settings.enabled=s.enabled===true;for(const [key,min,max] of [['opacity',.75,.98],['shade',0,.6],['blur',0,20]])if(Number.isFinite(s[key]))settings[key]=Math.max(min,Math.min(max,s[key]));if(typeof s.image==='string'&&s.image.length<3000000&&new RegExp('^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$').test(s.image))settings.image=s.image;}}catch{}
 function apply(persist=true){
  root.classList.toggle('wallpaper-on',settings.enabled);
  root.style.setProperty('--wallpaper-image',settings.image?`url("${settings.image}")`:'linear-gradient(135deg,#354b67,#609187 48%,#c4ac8c)');
  root.style.setProperty('--glass-rgb',root.dataset.theme==='dark'?'23,29,32':'255,255,255');
  root.style.setProperty('--glass-alpha',String(settings.opacity));root.style.setProperty('--wallpaper-shade',String(settings.shade));root.style.setProperty('--glass-blur',settings.blur+'px');
  $('wallpaper-enabled').checked=settings.enabled;
  for(const key of ['opacity','shade','blur']){$('wallpaper-'+key).value=key==='blur'?settings[key]:Math.round(settings[key]*100);$('wallpaper-'+key+'-label').textContent=key==='blur'?settings[key]+'px':Math.round(settings[key]*100)+'%';}
  let persisted=true;
  if(persist)try{localStorage.setItem('workbench.appearance',JSON.stringify(settings));}catch{persisted=false;$('wallpaper-status').textContent='本机存储已满：当前效果可用，但无法保存到下次启动。';}
  clearTimeout(timer);const version=++revision;timer=setTimeout(async()=>{try{const r=await window.workbench.appearanceApply({...settings,theme:root.dataset.theme});if(version===revision&&!r.ok)$('wallpaper-status').textContent=r.error;}catch{if(version===revision)$('wallpaper-status').textContent='主窗口已更新，完整工作台样式同步失败。';}},120);return persisted;
 }
 $('wallpaper-enabled').onchange=()=>{settings.enabled=$('wallpaper-enabled').checked;apply();};
 for(const key of ['opacity','shade','blur'])$('wallpaper-'+key).oninput=()=>{settings[key]=Number($('wallpaper-'+key).value)/(key==='blur'?1:100);apply();};
 $('wallpaper-choose').onclick=()=>$('wallpaper-file').click();
 $('wallpaper-remove').onclick=()=>{settings.image='';apply();$('wallpaper-status').textContent='已恢复内置渐变背景。';};
 $('wallpaper-file').onchange=async()=>{const file=$('wallpaper-file').files[0];if(!file)return;try{
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>20*1024*1024)throw Error('请选择不超过 20MB 的 PNG、JPEG 或 WebP 静态图片。');
  const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('图片读取失败。'));reader.readAsDataURL(file);});
  const img=new Image();img.src=data;await img.decode();
  if(img.width>16000||img.height>16000)throw Error('图片尺寸过大，请选择较小的壁纸。');
  const ratio=Math.min(1,1920/Math.max(img.width,img.height));const canvas=document.createElement('canvas');canvas.width=Math.round(img.width*ratio);canvas.height=Math.round(img.height*ratio);canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);let compressed=canvas.toDataURL('image/jpeg',.85);for(const quality of [.7,.55]){if(compressed.length<=3000000)break;compressed=canvas.toDataURL('image/jpeg',quality);}
  if(compressed.length>3000000)throw Error('压缩后图片仍过大，请选择较简单的图片。');settings.image=compressed;settings.enabled=true;const persisted=apply();if(persisted)$('wallpaper-status').textContent='已使用本机图片（压缩副本）；原图未修改，未上传网络。';
 }catch(e){$('wallpaper-status').textContent=e.message;}finally{$('wallpaper-file').value='';}};
 new MutationObserver(()=>apply(false)).observe(root,{attributes:true,attributeFilter:['data-theme']});
 apply(false);
})();
