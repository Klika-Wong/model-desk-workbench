function validateAppearance(value={}) {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('外观设置无效。');
 const opacity=Number(value.opacity??.86),blur=Number(value.blur??10),shade=Number(value.shade??.18);
 if(!Number.isFinite(opacity)||opacity<.75||opacity>.98||!Number.isFinite(blur)||blur<0||blur>20||!Number.isFinite(shade)||shade<0||shade>.6)throw Error('外观参数超出范围。');
 const image=value.image||'';
 if(typeof image!=='string'||image.length>3000000||(image&&!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image)))throw Error('只支持本机导入的静态图片，大小需小于约 2MB。');
 return {enabled:value.enabled===true,theme:value.theme==='dark'?'dark':'light',opacity,blur,shade,image};
}
function panelCss(input){const p=validateAppearance(input),dark=p.theme==='dark',rgb=dark?'23,29,32':'255,255,255',bg=dark?'#0f1315':'#f6f7f5',ink=dark?'#e6ece8':'#1d2420',muted=p.enabled?(dark?'#c0cec6':'#35443c'):(dark?'#92a09a':'#6b7873'),accent=dark?'#4fbf9a':'#1f6f57';
 const image=p.image?`url("${p.image}")`:'linear-gradient(135deg,#354b67,#609187 48%,#c4ac8c)';
 return `:root,html[data-theme]{--bg:${bg};--surface:${p.enabled?`rgba(${rgb},${p.opacity})`:bg};--surface-hover:${dark?'#202b28':'#e9efe8'};--inset:${dark?'#1b2226':'#f2f4f1'};--ink:${ink};--ink-soft:${ink};--muted:${muted};--accent:${accent};--btn-primary-bg:${accent};--btn-primary-bg-hover:${accent};--btn-primary-ink:${dark?'#08130f':'#fff'};--line:${dark?'#354245':'#d6dfd8'};--focus:${accent};}body{font-family:"Segoe UI","Microsoft YaHei",sans-serif!important;font-size:13px!important;background:${p.enabled?`linear-gradient(rgba(0,0,0,${p.shade}),rgba(0,0,0,${p.shade})),${image}`:bg}!important;background-size:cover!important;background-attachment:fixed!important;color:var(--ink)!important;}button,input,select,textarea{font-family:inherit!important;border-radius:7px!important}button{min-height:30px}input,select,textarea{background:${dark?'#10171a':'#fff'}!important;color:${ink}!important}.card,.panel,.sidebar,aside,header,.toolbar{${p.enabled?`background:rgba(${rgb},${p.opacity})!important;backdrop-filter:blur(${p.blur}px);`:''}}dialog,[role=dialog]{background:${dark?'#171d20':'#fff'}!important;color:${ink}!important}`;
}
module.exports={validateAppearance,panelCss};
