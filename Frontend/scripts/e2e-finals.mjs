// Real Neon + Chrome + standalone Python runner. All writes are to two disposable schemas.
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync,openSync,closeSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {lookup} from 'node:dns/promises';
import tls from 'node:tls';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {splitSql} from './sql-statements.mjs';
import {pinLookup} from './e2e-network.mjs';
const require=createRequire(import.meta.url);require('@next/env').loadEnvConfig(process.cwd());
const {neon,neonConfig}=require('@neondatabase/serverless');const sql=neon(process.env.DATABASE_URL),bcrypt=require('bcryptjs');
const host=new URL(neonConfig.fetchEndpoint(new URL(process.env.DATABASE_URL).hostname,5432)).hostname;
const addresses=await lookup(host,{all:true});
const address=await Promise.any(addresses.filter(a=>a.family===4).map(a=>new Promise((resolve,reject)=>{const s=tls.connect({host:a.address,port:443,servername:host});s.setTimeout(3000,()=>s.destroy(new Error('TLS timeout')));s.once('error',reject);s.once('secureConnect',()=>{resolve(a.address);s.end();});})));
pinLookup(host,address);
const tag=Date.now()+'_'+randomUUID().slice(0,6),source='ott_finals_e2e_'+tag,finals='finals_e2e_'+tag;
assert.match(source,/^ott_finals_e2e_\d+_[a-f0-9]+$/);assert.match(finals,/^finals_e2e_\d+_[a-f0-9]+$/);
const dir=path.resolve('../logs',source);mkdirSync(dir,{recursive:true});
const base='http://localhost:3101',password='Finals_'+randomUUID(),python=process.env.FINALS_TEST_PYTHON||'/tmp/oantuti-worker-tests/bin/python';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function retry(fn){for(let i=0;;i++){try{return await fn();}catch(e){if(i>=3||!/fetch failed|connect|timeout/i.test(e.message))throw e;await pause(500*(i+1));}}}
const scoped=async(text,values=[],schema=source)=>(await retry(()=>sql.transaction(tx=>[tx`SELECT set_config('search_path',${schema},true)`,tx.query(text,values)])))[1];
const fq=(text,values=[])=>scoped(text,values,finals);
async function wait(name,fn,seconds=60){const deadline=Date.now()+seconds*1000;while(Date.now()<deadline){const result=await fn();if(result)return result;await pause(250);}throw Error('Timeout: '+name);}
let server,runner,browser,judge,created=false,passed=false,failNext=false,failure;
const checks=[];async function check(name,fn){await fn();checks.push(name);console.log('PASS '+name);}
const cycle=[{from_col:1,from_row:3,to_col:0,to_row:3},{from_col:7,from_row:5,to_col:8,to_row:5},{from_col:0,from_row:3,to_col:1,to_row:3},{from_col:8,from_row:5,to_col:7,to_row:5}];
const code='def agent(observation, configuration):\n    moves = '+JSON.stringify(cycle)+'\n    return moves[observation["move_count"] % 4]\n';
try{
 try{await fetch(base,{signal:AbortSignal.timeout(1000)});throw Error('Port 3101 occupied');}catch(e){if(e.message==='Port 3101 occupied')throw e;}
 await sql.query(`CREATE SCHEMA ${source}`);created=true;
 const normal=['database.sql','arena_schema.sql','tournament_schema.sql','trueskill_migration.sql','friendly_challenge_migration.sql','execution_token_migration.sql','adaptive_rating_migration.sql','teams_migration.sql','private_trials_migration.sql'].flatMap(f=>splitSql(readFileSync(f,'utf8')));
 await sql.transaction(tx=>[tx`SELECT set_config('search_path',${source},true)`,...normal.map(s=>tx.query(s)),...splitSql(readFileSync('finals_migration.sql','utf8').replaceAll('__FINALS_SCHEMA__',finals)).map(s=>tx.query(s))]);
 await scoped("INSERT INTO users(username,password_hash) SELECT 'player'||n,'hash' FROM generate_series(2,18) n");
 await scoped('UPDATE users SET password_hash=$1',[bcrypt.hashSync(password,4)]);
 await scoped("INSERT INTO arena_agents(user_id,agent_name,code,status,is_active,is_public,rating) SELECT n,'Finalist '||n,$1,'active',n<18,true,1000+n FROM generate_series(1,18) n",[code]);
 await scoped("INSERT INTO rated_matches(kind,agent1_id,agent2_id,status,outcome,finished_at) SELECT 'rating',n,18,'finished','draw',now() FROM generate_series(1,17) n CROSS JOIN generate_series(1,10) k");
 const baseline=await scoped('SELECT id,rating,wins,losses,draws,code FROM arena_agents ORDER BY id');
 judge=createServer(async(req,res)=>{if(req.method==='POST'&&req.url==='/submissions'){let raw='';for await(const part of req)raw+=part;const data=JSON.parse(raw),input=JSON.parse(data.stdin);await pause(120);res.setHeader('Content-Type','application/json');if(failNext){failNext=false;res.end(JSON.stringify({status:{id:11,description:'Injected runtime error'}}));}else res.end(JSON.stringify({status:{id:3,description:'Accepted'},stdout:JSON.stringify(cycle[input.observation.move_count%4])}));}else{res.setHeader('Content-Type','application/json');res.end('{}');}});
 await new Promise(r=>judge.listen(0,'127.0.0.1',r));
 const fd=openSync(path.join(dir,'frontend.log'),'a',0o600);
 server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3101'],{stdio:['ignore',fd,fd],env:{...process.env,DATABASE_SCHEMA:source,FINALS_SCHEMA:finals,NEXT_BUILD_DIR:'.next-finals-test',NODE_OPTIONS:`${process.env.NODE_OPTIONS||''} --import=${path.resolve('scripts/e2e-network.mjs')}`.trim(),OTT_E2E_NEON_HOST:host,OTT_E2E_NEON_ADDRESS:address}});closeSync(fd);
 await wait('owned frontend',async()=>{try{return(await fetch(base+'/api/finals')).ok;}catch{return false;}});
 browser=await chromium.launch({executablePath:'/opt/google/chrome/chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const admin=await browser.newContext({viewport:{width:1500,height:1100}}),guest=await browser.newContext({viewport:{width:1500,height:1100}}),errors=[];
 const page=await admin.newPage();page.on('dialog',d=>d.type()==='prompt'?d.accept('E2E controlled reason'):d.accept());page.on('pageerror',e=>errors.push(e.message));
 assert.equal((await admin.request.post(base+'/api/auth/login',{data:{username:'admin',password}})).status(),200);
 async function info(id){return(await admin.request.get(base+'/api/admin/finals?id='+id)).json();}
 async function action(id,action,payload={}){const d=await info(id);const r=await admin.request.post(base+'/api/admin/finals',{data:{action,edition_id:Number(id),revision:d.edition.revision,...payload}});assert.equal(r.status(),200,JSON.stringify(await r.json()));}
 let eid,first,second;
 await check('public preview, admin snapshot UI, rules lock and seeded round',async()=>{
  const index=await(await guest.request.get(base+'/api/finals')).json();assert.equal(index.preview.length,16);
  assert.equal((await guest.request.post(base+'/api/admin/finals',{data:{action:'create'}})).status(),403);
  await page.goto(base+'/admin/finals');await page.getByLabel('Tên đợt chung kết').fill('E2E Finals');await page.getByRole('button',{name:'Chốt top 16 (16/16)',exact:true}).click();
  await page.getByRole('button',{name:'Khóa luật v1',exact:true}).waitFor();
  eid=(await(await admin.request.get(base+'/api/finals')).json()).editions[0].id;
  const snapshot=await(await guest.request.get(base+'/api/finals/'+eid)).json();assert.equal(snapshot.entrants.length,16);assert.ok(!JSON.stringify(snapshot).includes('def agent'));
  await page.getByRole('button',{name:'Khóa luật v1',exact:true}).click();await page.getByRole('button',{name:'Mở Vòng 16',exact:true}).click();
  const data=await wait('round games',async()=>{const d=await info(eid);return d.games.length===16?d:null;});
  first=data.games.find(g=>g.leg===1);second=data.games.find(g=>String(g.pair_id)===String(first.pair_id)&&g.leg===2);
  assert.deepEqual([first.seed1,first.seed2,second.seed1,second.seed2],[1,16,16,1]);
  await page.screenshot({path:path.join(dir,'admin-finals.png'),fullPage:true});
  const publicPage=await guest.newPage();await publicPage.goto(base+'/finals/'+eid);await publicPage.getByLabel('Sơ đồ chung kết 16 hạt giống').waitFor();
  await publicPage.screenshot({path:path.join(dir,'bracket-desktop.png'),fullPage:true});await publicPage.setViewportSize({width:390,height:844});assert.equal(await publicPage.locator('body').evaluate(el=>el.scrollWidth<=innerWidth),true);await publicPage.screenshot({path:path.join(dir,'bracket-mobile.png'),fullPage:true});
 });
 function startRunner(){const out=openSync(path.join(dir,'runner.log'),'a',0o600);runner=spawn(python,['-B','-m','finals_runner','--concurrency','1'],{cwd:path.resolve('..'),stdio:['ignore',out,out],env:{...process.env,FINALS_DATABASE_URL:process.env.DATABASE_URL,FINALS_SCHEMA:finals,FINALS_DB_HOSTADDR:address,FINALS_WORKER_ID:'e2e-finals',FINALS_JUDGE0_URL:`http://127.0.0.1:${judge.address().port}`}});closeSync(out);}
 async function stopRunner(){if(runner&&runner.exitCode===null){runner.kill('SIGTERM');await new Promise(r=>runner.once('exit',r));}runner=undefined;}
 await check('standalone SQL runner commits live moves; private/public boundaries and playback pacing',async()=>{
  await fq("UPDATE games SET status='needs_attention' WHERE id<>$1",[first.id]);
  assert.equal((await guest.request.get(base+'/api/finals/games/'+first.id)).status(),404);
  startRunner();await wait('first live move',async()=>{const d=await info(eid);return d.games.find(g=>String(g.id)===String(first.id)).move_count>=1;});
  await action(eid,'publish',{game_id:Number(first.id)});
  const live=await(await guest.request.get(base+'/api/finals/games/'+first.id)).json();assert.ok(live.moves.length>=1);assert.ok(!JSON.stringify(live).includes('def agent'));
  await wait('threefold terminal result',async()=>(await fq('SELECT status FROM games WHERE id=$1',[first.id]))[0].status==='ready');await stopRunner();
  const result=await(await guest.request.get(base+'/api/finals/games/'+first.id)).json();assert.equal(result.moves.length,8);assert.equal(result.game.outcome,'draw');
  const replay=await guest.newPage();replay.on('pageerror',e=>errors.push(e.message));await replay.goto(base+'/finals/games/'+first.id);await replay.getByText('Nước 0/8',{exact:true}).waitFor();assert.equal(await replay.getByLabel('Tốc độ trình chiếu').inputValue(),'1200');
  await replay.getByRole('button',{name:'Phát',exact:true}).click();await pause(650);assert.equal(await replay.getByLabel('Tua nước chung kết').inputValue(),'0');await pause(850);assert.ok(Number(await replay.getByLabel('Tua nước chung kết').inputValue())>=1);await replay.getByRole('button',{name:'Tạm dừng',exact:true}).click();
  await replay.getByLabel('Tốc độ trình chiếu').selectOption('600');await replay.getByRole('button',{name:'Toàn màn hình / Trình chiếu',exact:true}).click();await pause(300);assert.equal(await replay.locator('body').evaluate(el=>el.scrollHeight<=innerHeight+2),true);await replay.screenshot({path:path.join(dir,'presentation-desktop.png'),fullPage:true});await replay.getByRole('button',{name:'Thoát trình chiếu',exact:true}).click();
  await replay.setViewportSize({width:390,height:844});assert.equal(await replay.locator('body').evaluate(el=>el.scrollWidth<=innerWidth),true);await replay.screenshot({path:path.join(dir,'presentation-mobile.png'),fullPage:true});
 });
 await check('any execution error requires admin, offline bundle run, trusted import and official confirmation',async()=>{
  await action(eid,'retry',{game_id:Number(second.id),reason:'Isolated test retry'});failNext=true;startRunner();
  await wait('failed attempt',async()=>(await fq('SELECT active_attempt,status FROM games WHERE id=$1',[second.id]))[0].active_attempt!=null&&(await fq('SELECT status FROM games WHERE id=$1',[second.id]))[0].status==='needs_attention');await stopRunner();
  const bundleResponse=await admin.request.get(base+`/api/admin/finals/${eid}/bundle`);assert.equal(bundleResponse.status(),200);assert.equal((await guest.request.get(base+`/api/admin/finals/${eid}/bundle`)).status(),403);
  const bundlePath=path.join(dir,'offline.bundle.json'),outputPath=path.join(dir,'offline.record.json');writeFileSync(bundlePath,await bundleResponse.text(),{mode:0o600});
  const fd=openSync(path.join(dir,'offline.log'),'a',0o600);const child=spawn(python,['-B','-m','finals_runner','--bundle',bundlePath,'--game',String(second.id),'--output',outputPath],{cwd:path.resolve('..'),stdio:['ignore',fd,fd],env:{...process.env,FINALS_JUDGE0_URL:`http://127.0.0.1:${judge.address().port}`}});closeSync(fd);assert.equal(await new Promise(r=>child.once('exit',r)),0);
  const record=JSON.parse(readFileSync(outputPath,'utf8'));assert.equal(record.moves.length,8);
  await page.reload();await page.getByLabel('Nhập bản ghi ván '+second.id).setInputFiles(outputPath);
  await wait('browser file import',async()=>(await info(eid)).games.find(g=>String(g.id)===String(second.id))?.source==='import');
  await action(eid,'publish',{game_id:Number(second.id)});
  const imported=await(await guest.request.get(base+'/api/finals/games/'+second.id)).json();assert.equal(imported.game.source,'import');assert.equal(imported.moves.length,8);
  let visible=await(await guest.request.get(base+'/api/finals/'+eid)).json();assert.equal(visible.pairs.find(p=>String(p.id)===String(first.pair_id)).winner_seed,null);
  await action(eid,'confirm_pair',{pair_id:Number(first.pair_id)});visible=await(await guest.request.get(base+'/api/finals/'+eid)).json();assert.equal(visible.pairs.find(p=>String(p.id)===String(first.pair_id)).winner_seed,1);
  const data=await info(eid);assert.ok(data.attempts.filter(a=>String(a.game_id)===String(second.id)).length>=2);
 });
 await check('regular ratings, counters and source remain unchanged',async()=>{assert.deepEqual(await scoped('SELECT id,rating,wins,losses,draws,code FROM arena_agents ORDER BY id'),baseline);assert.equal((await scoped('SELECT count(*)::int AS n FROM rated_matches'))[0].n,170);});
 assert.deepEqual(errors,[]);passed=true;
}catch(error){failure=String(error.stack||error);throw error;}finally{
 if(runner&&runner.exitCode===null){runner.kill('SIGTERM');await new Promise(r=>runner.once('exit',r));}
 await browser?.close();if(server&&server.exitCode===null){server.kill('SIGTERM');await new Promise(r=>server.once('exit',r));}
 await new Promise(r=>judge?judge.close(r):r());
 const cleanupErrors=[];
 if(created){for(const schema of [finals,source]){try{await retry(()=>sql.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`));}catch(error){cleanupErrors.push(schema+': '+error.message);}}}
 writeFileSync(path.join(dir,'report.json'),JSON.stringify({passed,checks,source,finals,cleanedUp:!cleanupErrors.length,cleanupErrors,failure,judge0:'isolated deterministic stub; no real Judge0 jobs'},null,2));console.log('Report: '+dir+'/report.json');
 if(cleanupErrors.length){console.error('Cleanup requires retry for owned schemas:',cleanupErrors);process.exitCode=1;}
}
