import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readdirSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {chromium} from 'playwright';
import sharp from 'sharp';
import {createApp} from '../server/app';

const root=process.cwd(),run=resolve('runtime','images-ui-'+Date.now());mkdirSync(run,{recursive:true});
const origin='http://127.0.0.1:4333';
const app=await createApp({root,databasePath:join(run,'test.sqlite'),dataDir:run,host:'127.0.0.1',origin,platform:'win32',imageExe:resolve('desktop-dev/小羊图片工坊.exe'),launcher:async()=>{}});
await app.listen({host:'127.0.0.1',port:4333});
let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
const checks:string[]=[],errors:string[]=[];
try {
  const svg=Buffer.from('<svg width="720" height="480"><rect width="720" height="480" fill="#dcebfa"/><rect x="50" y="50" width="620" height="380" rx="24" fill="#f9fbff"/><path d="M100 360L260 160L390 310L510 220L625 360Z" fill="#1483ff"/><circle cx="530" cy="135" r="40" fill="#f6ba5a"/></svg>');
  const photo=join(run,'风景.png'),transparent=join(run,'透明图.png');
  await sharp(svg).png().toFile(photo);await sharp({create:{width:500,height:300,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite([{input:Buffer.from('<svg width="300" height="200"><rect width="300" height="200" rx="25" fill="#1483ff"/><circle cx="150" cy="100" r="60" fill="white"/></svg>')}]).png().toFile(transparent);
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1200,height:860}});page.setDefaultTimeout(15000);
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/?window=images');assert.equal(await page.getByLabel('图片格式转换',{exact:true}).count(),0);
  await page.getByLabel('密码',{exact:true}).fill('Workbox-Local-Dev-2026!');await page.getByRole('button',{name:'登录',exact:true}).click();await page.getByRole('button',{name:'格式转换',exact:true}).click();await page.getByRole('button',{name:'添加图片',exact:true}).waitFor();checks.push('login gates tool UI');
  await page.getByRole('button',{name:'浅色',exact:true}).click();await page.screenshot({path:join(run,'empty-light.png'),fullPage:true});
  await page.getByLabel('添加图片文件',{exact:true}).setInputFiles([photo,transparent]);
  await page.getByText('2 张 · 已选 2 张',{exact:true}).waitFor();checks.push('batch import selects files and previews transparency');
  await page.getByLabel('输出格式',{exact:true}).selectOption('jpeg');await page.getByLabel('透明区域填充颜色',{exact:true}).fill('#f4c36a');
  await page.getByLabel('转换质量',{exact:true}).fill('92');await page.getByRole('button',{name:'开始转换',exact:true}).click();
  await page.getByText('完成 · 2 / 2 张成功',{exact:true}).waitFor();
  const output=join(run,'图片工坊导出');assert.deepEqual(readdirSync(output).sort(),['透明图.jpg','风景.jpg'].sort());
  const jpg=await sharp(join(output,'透明图.jpg')).raw().toBuffer();assert.ok(Math.abs(jpg[0]-244)<4&&Math.abs(jpg[1]-195)<4&&Math.abs(jpg[2]-106)<4);
  checks.push('real JPEG batch outputs and chosen alpha fill');
  await page.screenshot({path:join(run,'converted-light.png'),fullPage:true});
  await page.getByRole('button',{name:'深色',exact:true}).click();await page.waitForTimeout(200);await page.setViewportSize({width:1104,height:681});
  await page.screenshot({path:join(run,'converted-dark-min.png'),fullPage:true});
  const overflow=await page.evaluate(()=>({width:document.documentElement.scrollWidth>innerWidth,height:document.documentElement.scrollHeight>innerHeight,footer:document.querySelector('.images-footer')!.getBoundingClientRect().bottom,preview:document.querySelector('.images-preview')!.getBoundingClientRect().bottom}));
  assert.equal(overflow.width,false);assert.ok(overflow.footer<=681,'primary action fits minimum native client area');
  checks.push('light/dark and minimum viewport remain usable');
  await page.getByLabel('输出格式',{exact:true}).selectOption('webp');await page.getByLabel('无损 WebP',{exact:true}).check();assert.equal(await page.getByLabel('转换质量',{exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'开始转换',exact:true}).click();await page.getByText('完成 · 2 / 2 张成功',{exact:true}).waitFor();
  for(let i=0;i<100&&!readdirSync(output).includes('透明图.webp');i++)await page.waitForTimeout(50);
  assert.equal((await sharp(join(output,'透明图.webp')).metadata()).hasAlpha,true);checks.push('lossless WebP keeps transparency');
  await page.getByLabel('选择 风景.png',{exact:true}).uncheck();await page.getByRole('button',{name:'移除选中',exact:true}).click();await page.getByText('1 张 · 已选 0 张',{exact:true}).waitFor();
  await page.getByRole('button',{name:'清空',exact:true}).click();await page.getByText('拖入图片，或点击添加',{exact:true}).waitFor();assert.deepEqual(readdirSync(join(run,'image-workshop-temp')),[]);assert.equal(readdirSync(output).length,4);checks.push('clear removes temp inputs and preserves exported files');
  // Exercise the actual drop handler with a local File, without external requests.
  const data=await page.evaluateHandle(bytes=>{const transfer=new DataTransfer();transfer.items.add(new File([new Uint8Array(bytes)],'拖入.png',{type:'image/png'}));return transfer;},Array.from(readFileSync(photo)));
  await page.locator('.images-app').dispatchEvent('drop',{dataTransfer:data});await page.getByText('1 张 · 已选 1 张',{exact:true}).waitFor();checks.push('drag/drop import');
  await page.getByRole('button',{name:'退出登录',exact:true}).click();await page.getByRole('button',{name:'登录',exact:true}).waitFor();assert.equal(await page.locator('.images-app').count(),0);assert.deepEqual(readdirSync(join(run,'image-workshop-temp')),[]);checks.push('logout removes tool and temp inputs');
  assert.deepEqual(errors,[]);writeFileSync(join(run,'results.json'),JSON.stringify({checks,errors,overflow},null,2));console.log('Image UI passed: '+join(run,'results.json'));
} finally {await browser?.close();await app.close();}
