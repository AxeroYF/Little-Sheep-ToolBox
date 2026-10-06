import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type Database from "better-sqlite3";
import { z } from "zod";
import { roomPlanSchema, furnitureModuleSchema, readStoredRoomPlan } from "../shared/room";

export function registerRooms(app: FastifyInstance, options: {db: Database.Database; authorize: (req:FastifyRequest,reply:FastifyReply)=>Promise<unknown>; userId:(req:FastifyRequest)=>string}) {
  const {db,authorize,userId}=options;
  db.exec(`CREATE TABLE IF NOT EXISTS room_plans (id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, data TEXT NOT NULL, revision INTEGER NOT NULL, updatedAt INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS room_plan_owner ON room_plans(userId,updatedAt);`);
  db.exec(`CREATE TABLE IF NOT EXISTS furniture_modules (id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, data TEXT NOT NULL, updatedAt INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS furniture_module_owner ON furniture_modules(userId);`);
  app.get('/api/room-modules',{preHandler:authorize},async req=>({modules:(db.prepare('SELECT data FROM furniture_modules WHERE userId=? ORDER BY updatedAt DESC').all(userId(req)) as {data:string}[]).map(r=>JSON.parse(r.data))}));
  app.post('/api/room-modules',{preHandler:authorize},async(req,reply)=>{
    const module=furnitureModuleSchema.parse(req.body), owner=userId(req);
    if((db.prepare('SELECT count(*) AS n FROM furniture_modules WHERE userId=?').get(owner) as {n:number}).n>=100)return reply.code(409).send({error:'最多保存 100 个家具模块'});
    if(db.prepare('SELECT id FROM furniture_modules WHERE id=?').get(module.id))return reply.code(409).send({error:'模块编号已存在，请重新保存'});
    db.prepare('INSERT INTO furniture_modules VALUES (?,?,?,?)').run(module.id,owner,JSON.stringify(module),Date.now());
    return {module};
  });
  app.get('/api/rooms',{preHandler:authorize},async req=>({plans:db.prepare('SELECT id,name,updatedAt FROM room_plans WHERE userId=? ORDER BY updatedAt DESC').all(userId(req))}));
  app.get<{Params:{id:string}}>('/api/rooms/:id',{preHandler:authorize},async(req,reply)=>{
    const row=db.prepare('SELECT data,revision,updatedAt FROM room_plans WHERE id=? AND userId=?').get(req.params.id,userId(req)) as {data:string;revision:number;updatedAt:number}|undefined;
    if(!row)return reply.code(404).send({error:'方案不存在'});
    return {plan:readStoredRoomPlan(JSON.parse(row.data)),revision:row.revision,updatedAt:row.updatedAt};
  });
  app.put<{Params:{id:string}}>('/api/rooms/:id',{preHandler:authorize,bodyLimit:256*1024},async(req,reply)=>{
    const {plan,revision}=z.object({plan:roomPlanSchema,revision:z.number().int().min(0)}).strict().parse(req.body);
    if(plan.id!==req.params.id)return reply.code(400).send({error:'方案编号不一致'});
    const owner=userId(req), now=Date.now();
    const save=db.transaction(()=>{
      const row=db.prepare('SELECT userId,revision FROM room_plans WHERE id=?').get(plan.id) as {userId:string;revision:number}|undefined;
      if(row?.userId && row.userId!==owner)return {code:404,error:'方案不存在'};
      if((row?.revision??0)!==revision)return {code:409,error:'方案已在另一窗口更新，请重新打开后再编辑'};
      if(!row && (db.prepare('SELECT count(*) AS n FROM room_plans WHERE userId=?').get(owner) as {n:number}).n>=100)return {code:409,error:'最多保存 100 个方案'};
      db.prepare('INSERT INTO room_plans VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,data=excluded.data,revision=excluded.revision,updatedAt=excluded.updatedAt').run(plan.id,owner,plan.name,JSON.stringify(plan),revision+1,now);
      return {code:200};
    })();
    if(save.code!==200)return reply.code(save.code).send({error:save.error});
    return {plan,revision:revision+1,updatedAt:now};
  });
}
