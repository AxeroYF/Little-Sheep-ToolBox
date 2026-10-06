import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {chromium} from 'playwright';
import sharp from 'sharp';
import {createApp} from '../server/app';
const root=process.cwd(),run=resolve('runtime','photos-ui-'+Date.now());mkdirSync(run,{recursive:true});
const origin='http://127.0.0.1:4334',app=await createApp({root,databasePath:join(run,'test.sqlite'),dataDir:run,host:'127.0.0.1',origin,platform:'win32'});
await app.listen({host:'127.0.0.1',port:4334});let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
const checks:string[]=[],errors:string[]=[];
try{
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1200,height:860}});page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/?window=images');await page.getByLabel('密码',{exact:true}).fill('Workbox-Local-Dev-2026!');await page.getByRole('button',{name:'登录',exact:true}).click();
  await page.getByRole('button',{name:'添加照片',exact:true}).waitFor();await page.getByRole('button',{name:'浅色',exact:true}).click();
  await page.getByLabel('导入照片文件').setInputFiles(resolve('runtime/raw-fixtures/a7cii-compressed.ARW'));
  await page.getByRole('button',{name:'查看照片 a7cii-compressed.ARW',exact:true}).waitFor();await page.getByAltText('照片编辑预览').waitFor();
  await page.locator('.photo-rendering').waitFor({state:'hidden'});await page.waitForFunction(()=>{const image=document.querySelector<HTMLImageElement>('.photo-view>img');return image?.complete&&image.naturalWidth>0;});assert.equal(await page.locator('.photo-histogram path').count(),3);checks.push('ARW import and actual RAW preview');
  await page.getByRole('button',{name:'信息',exact:true}).click();await page.getByText('ILCE-7CM2',{exact:true}).last().waitFor();
  await page.getByLabel('照片标签').fill('公开样本,相机测试');await page.getByRole('button',{name:'调整',exact:true}).click();await page.locator('.photo-app[aria-busy=false]').waitFor();
  await page.getByRole('button',{name:'4 星',exact:true}).click();await page.locator('.photo-app[aria-busy=false]').waitFor();
  await page.getByRole('button',{name:'精选照片',exact:true}).click();await page.locator('.photo-app[aria-busy=false]').waitFor();
  await page.getByLabel('曝光 EV',{exact:true}).focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');
  await page.getByRole('button',{name:'保存调整',exact:true}).click();await page.getByRole('button',{name:'调整已保存',exact:true}).waitFor();
  await page.locator('.photo-rendering').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector<HTMLImageElement>('.photo-view>img')?.naturalWidth!>0);await page.screenshot({path:join(run,'library-light.png'),fullPage:true});
  const state=await page.evaluate(async()=>await(await fetch('/api/photos')).json());assert.equal(state.photos[0].edits.exposure,.2);assert.equal(state.photos[0].rating,4);assert.equal(state.photos[0].flag,'pick');assert.deepEqual(state.photos[0].tags,['公开样本','相机测试']);checks.push('edits, stars, flags and tags persist');
  await page.getByRole('button',{name:'原片对比',exact:true}).click();await page.getByText('未调整',{exact:true}).waitFor();await page.locator('.photo-rendering').waitFor({state:'hidden'});await page.getByRole('button',{name:'原片对比',exact:true}).click();
  await page.getByText('旋转与裁切',{exact:true}).click();await page.getByLabel('裁切比例').selectOption('1');await page.getByRole('button',{name:'向右旋转照片',exact:true}).click();
  await page.getByLabel('导出长边').selectOption('2048');await page.getByRole('button',{name:'导出 1 张',exact:true}).click();try{await page.getByText('导出完成 · 1 / 1 张',{exact:true}).waitFor();}catch(e){console.log(await page.locator('.photo-app').innerText());console.log(await page.evaluate(async()=>await(await fetch('/api/photos/status')).json()));await page.screenshot({path:join(run,'failure.png'),fullPage:true});throw e;}
  const output=join(run,'照片导出',readdirSync(join(run,'照片导出'))[0]);const meta=await sharp(output).metadata();assert.equal(meta.width,2048);assert.equal(meta.height,2048);assert.ok(meta.icc);checks.push('crop/rotation auto-save and real sized JPG export');
  await page.getByRole('button',{name:'深色',exact:true}).click();await page.setViewportSize({width:1104,height:681});await page.locator('.photo-rendering').waitFor({state:'hidden'});await page.waitForTimeout(300);await page.screenshot({path:join(run,'library-dark-min.png'),fullPage:true});
  const layout=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight,exportBottom:document.querySelector('.photo-export')!.getBoundingClientRect().bottom,stage:document.querySelector('.photo-view')!.getBoundingClientRect().height}));assert.equal(layout.overflow,false);assert.ok(layout.exportBottom<=681);assert.ok(layout.stage>180);checks.push('light/dark and minimum native viewport');
  await page.getByLabel('搜索照片').fill('无匹配照片');assert.equal(await page.locator('.photo-item').count(),0);await page.getByLabel('搜索照片').fill('');
  await page.getByRole('button',{name:'格式转换',exact:true}).click();await page.getByRole('button',{name:'添加图片',exact:true}).waitFor();await page.getByRole('button',{name:'照片库',exact:true}).click();checks.push('search and original converter remain available');
  await page.getByLabel('曝光 EV',{exact:true}).focus();await page.keyboard.press('ArrowRight');await page.getByRole('button',{name:'退出登录',exact:true}).click();await page.getByRole('button',{name:'登录',exact:true}).waitFor();
  await page.getByLabel('密码',{exact:true}).fill('Workbox-Local-Dev-2026!');await page.getByRole('button',{name:'登录',exact:true}).click();await page.getByRole('button',{name:'查看照片 a7cii-compressed.ARW',exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector<HTMLSelectElement>('select[aria-label="裁切比例"]')?.value==='1');
  const restored=await page.evaluate(async()=>await(await fetch('/api/photos')).json());assert.equal(restored.photos[0].edits.exposure,.3);checks.push('logout saves outstanding edits and library survives login');
  assert.deepEqual(errors,[]);writeFileSync(join(run,'results.json'),JSON.stringify({checks,errors,layout},null,2));console.log(run);
}finally{await browser?.close();await app.close();}
