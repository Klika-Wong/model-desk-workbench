const test=require('node:test'),assert=require('node:assert/strict');const {validateAppearance,panelCss}=require('./appearance.cjs');
test('拒绝外网图片与注入字符串',()=>{for(const image of ['https://example.com/a.png','file:///secret.png','data:image/svg+xml;base64,AAAA','x");body{display:none}'])assert.throws(()=>validateAppearance({image}));});
test('透明度模糊遮罩限制',()=>{for(const v of [{opacity:.1},{blur:100},{shade:-1},{opacity:NaN}])assert.throws(()=>validateAppearance(v));});
test('两种模式保留文字与输入框的实色，壁纸可移除',()=>{const image='data:image/png;base64,AAAA';const a=panelCss({enabled:true,image,theme:'dark'});assert.match(a,/rgba\(23,29,32,0.86\)/);assert.ok(a.includes(image));const b=panelCss({enabled:false,image});assert.ok(!b.includes(image));assert.match(b,/font-family/);});

test('最透明表面上的次要文字满足4.5对比度',()=>{
 const lum=rgb=>{const c=rgb.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return c[0]*.2126+c[1]*.7152+c[2]*.0722;};
 for(const [fg,bg] of [[[53,68,60],[191.25,191.25,191.25]],[[192,206,198],[81,85.5,87.75]]]){const a=lum(fg),b=lum(bg);assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5);}
});
