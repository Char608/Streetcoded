const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, pingInterval: 2000, pingTimeout: 5000 });

app.use(express.static(path.join(__dirname, '../public')));

const WORLD_W = 2400, WORLD_H = 1800;
const TICK_MS = 50; // 20 ticks/sec
const MODES = { FFA:'ffa', BR:'br', ZONE:'zone' };

function buildWalls() {
  const walls = [];
  const add = (x,y,w,h) => walls.push({x,y,w,h});
  add(0,0,WORLD_W,30); add(0,WORLD_H-30,WORLD_W,30);
  add(0,0,30,WORLD_H); add(WORLD_W-30,0,30,WORLD_H);
  const bldgs=[{x:120,y:120,w:300,h:200},{x:550,y:80,w:240,h:180},{x:900,y:100,w:200,h:250},{x:1200,y:80,w:300,h:200},{x:1600,y:120,w:280,h:220},{x:100,y:450,w:220,h:280},{x:420,y:500,w:260,h:240},{x:800,y:420,w:180,h:200},{x:1050,y:480,w:250,h:300},{x:1400,y:440,w:200,h:260},{x:1700,y:400,w:350,h:280},{x:120,y:900,w:300,h:200},{x:550,y:850,w:280,h:250},{x:900,y:880,w:220,h:220},{x:1200,y:820,w:300,h:260},{x:1600,y:860,w:280,h:200},{x:200,y:1250,w:260,h:200},{x:600,y:1200,w:300,h:280},{x:1000,y:1300,w:240,h:220},{x:1300,y:1200,w:350,h:280},{x:1750,y:1250,w:280,h:200}];
  const t=20;
  bldgs.forEach(b=>{add(b.x,b.y,b.w,t);add(b.x,b.y+b.h-t,b.w,t);add(b.x,b.y,t,b.h);add(b.x+b.w-t,b.y,t,b.h);});
  [{x:470,y:200,w:20,h:80},{x:780,y:300,w:80,h:20},{x:1150,y:320,w:20,h:80},{x:1380,y:200,w:80,h:20},{x:350,y:700,w:20,h:100},{x:760,y:650,w:100,h:20},{x:1250,y:750,w:20,h:80},{x:1570,y:700,w:80,h:20}].forEach(c=>add(c.x,c.y,c.w,c.h));
  return walls;
}

function collidesWalls(x,y,walls){const hw=11,hh=11;return walls.some(w=>x-hw<w.x+w.w&&x+hw>w.x&&y-hh<w.y+w.h&&y+hh>w.y);}
function getSpawn(walls){for(let i=0;i<300;i++){const x=80+Math.random()*(WORLD_W-160),y=80+Math.random()*(WORLD_H-160);if(!collidesWalls(x,y,walls))return{x,y};}return{x:300,y:300};}

function genLoot(walls){
  const pts=[];
  for(let r=0;r<6;r++)for(let c=0;c<8;c++)pts.push({x:200+c*280,y:380+r*240});
  [{x:120,y:120,w:300,h:200},{x:550,y:80,w:240,h:180},{x:900,y:100,w:200,h:250},{x:1200,y:80,w:300,h:200},{x:1600,y:120,w:280,h:220},{x:100,y:450,w:220,h:280},{x:420,y:500,w:260,h:240},{x:800,y:420,w:180,h:200}].forEach(b=>{pts.push({x:b.x+b.w/2-20,y:b.y+b.h/2});pts.push({x:b.x+b.w/2+30,y:b.y+b.h/2});});
  const items=[];
  pts.forEach(pt=>{
    if(Math.random()<0.55&&!collidesWalls(pt.x,pt.y,walls)){
      const r=Math.random();
      const type=r<0.35?'health':r<0.5?'shield':r<0.62?'shotgun':r<0.72?'bounce':r<0.725?'golden':'health';
      items.push({id:uuidv4(),x:pt.x,y:pt.y,type});
    }
  });
  return items;
}

const WSTATS={default:{dmg:10,spd:10,bnc:0,pel:1,spr:0.04},shotgun:{dmg:8,spd:9,bnc:0,pel:6,spr:0.3},bounce:{dmg:15,spd:8,bnc:3,pel:1,spr:0.01},plasma:{dmg:20,spd:12,bnc:0,pel:1,spr:0.0},web:{dmg:15,spd:9,bnc:0,pel:1,spr:0.02},blade:{dmg:8,spd:10,bnc:0,pel:5,spr:0.25}};
const SKINCOLORS=['#ff6666','#aaaaff','#88ccff','#ffff44','#44aaff','#ff8822','#cc66ff','#ffdd44'];
const WCOLORS={bounce:'#44ffaa',shotgun:'#ffaa44',plasma:'#00eeff',web:'#ffffff',blade:'#ff44ff'};

const sessions={};
function findOrCreate(mode){
  for(const sid in sessions){const s=sessions[sid];if(s.mode===mode&&s.phase!=='ended'&&Object.keys(s.players).length<(mode===MODES.BR?20:16))return s;}
  const id=uuidv4(),walls=buildWalls(),s={id,mode,players:{},bullets:{},loot:genLoot(walls),walls,zone:{x:0,y:0,w:WORLD_W,h:WORLD_H,shrinking:false},zoneTimer:120000,chat:[],phase:'waiting',interval:null};
  sessions[id]=s; return s;
}

function startTick(session){
  if(session.interval)return;
  session.phase='active';
  session.interval=setInterval(()=>{
    if(session.phase==='ended'||Object.keys(session.players).length===0){clearInterval(session.interval);setTimeout(()=>delete sessions[session.id],30000);return;}
    tick(session);
  },TICK_MS);
}

function tick(session){
  // Zone
  if(session.mode===MODES.BR){
    session.zoneTimer-=TICK_MS;
    if(session.zoneTimer<=0)session.zone.shrinking=true;
    if(session.zone.shrinking){const sr=0.25;session.zone.x+=sr;session.zone.y+=sr;session.zone.w=Math.max(200,session.zone.w-sr*2);session.zone.h=Math.max(200,session.zone.h-sr*2);}
    Object.values(session.players).forEach(p=>{
      if(p.alive&&(p.x<session.zone.x||p.x>session.zone.x+session.zone.w||p.y<session.zone.y||p.y>session.zone.y+session.zone.h)){
        p.hp=Math.max(0,p.hp-0.1);if(p.hp<=0){p.alive=false;io.to(session.id).emit('player_killed',{killedId:p.id,killedName:p.name,killerName:'THE ZONE'});}
      }
    });
  }

  // Bullets
  const remove=[];
  Object.values(session.bullets).forEach(b=>{
    b.x+=b.vx;b.y+=b.vy;b.life--;
    if(b.life<=0||b.x<0||b.x>WORLD_W||b.y<0||b.y>WORLD_H){remove.push(b.id);return;}
    let hw=false;
    for(const w of session.walls){if(b.x>w.x&&b.x<w.x+w.w&&b.y>w.y&&b.y<w.y+w.h){if(b.bnc>0){const cx=b.x-(b.x>w.x+w.w/2?w.x+w.w:w.x),cy=b.y-(b.y>w.y+w.h/2?w.y+w.h:w.y);if(Math.abs(cx)<Math.abs(cy))b.vx*=-1;else b.vy*=-1;b.bnc--;b.dmg=Math.round(b.dmg*0.75);}else hw=true;break;}}
    if(hw){remove.push(b.id);return;}
    Object.values(session.players).forEach(p=>{
      if(!p.alive||p.id===b.owner)return;
      const dx=b.x-p.x,dy=b.y-p.y;
      if(Math.sqrt(dx*dx+dy*dy)<14){
        remove.push(b.id);
        let dmg=b.dmg;
        if(p.shield>0){const sd=Math.min(p.shield,dmg);p.shield-=sd;dmg-=sd;}
        p.hp=Math.max(0,p.hp-dmg);
        io.to(p.id).emit('you_hit',{hp:p.hp,shield:p.shield});
        io.to(session.id).emit('player_damaged',{id:p.id,hp:p.hp,shield:p.shield});
        if(p.hp<=0){
          p.alive=false;
          const killer=session.players[b.owner];
          io.to(session.id).emit('player_killed',{killedId:p.id,killedName:p.name,killerName:killer?killer.name:'Unknown'});
          if(session.mode!==MODES.BR){setTimeout(()=>{if(session.players[p.id]){const sp=getSpawn(session.walls);p.x=sp.x;p.y=sp.y;p.hp=150;p.shield=0;p.alive=true;io.to(session.id).emit('player_respawned',{id:p.id,x:sp.x,y:sp.y});}},3000);}
        }
      }
    });
  });
  remove.forEach(id=>delete session.bullets[id]);

  // State broadcast
  const pStates={};
  Object.values(session.players).forEach(p=>{pStates[p.id]={x:p.x,y:p.y,angle:p.angle,alive:p.alive,hp:p.hp,shield:p.shield,name:p.name,skin:p.skin,golden:p.golden};});
  io.to(session.id).emit('state',{players:pStates,zone:session.zone});

  // BR win check
  if(session.mode===MODES.BR){const alive=Object.values(session.players).filter(p=>p.alive);if(alive.length<=1&&Object.keys(session.players).length>1){io.to(session.id).emit('game_over',{winner:alive[0]?alive[0].name:'Nobody'});session.phase='ended';}}
}

io.on('connection',socket=>{
  let session=null, pid=socket.id;

  socket.on('join',({name,skin,mode})=>{
    session=findOrCreate(mode||MODES.FFA);
    const sp=getSpawn(session.walls);
    const p={id:pid,name:(name||'PLAYER').slice(0,12).toUpperCase(),skin:skin||0,x:sp.x,y:sp.y,angle:0,hp:150,shield:0,alive:true,weapon:'default',inventory:[null,null],golden:null};
    session.players[pid]=p;
    socket.join(session.id);
    startTick(session);
    socket.emit('joined',{sessionId:session.id,playerId:pid,spawnX:sp.x,spawnY:sp.y,loot:session.loot,walls:session.walls,zone:session.zone,mode:session.mode,players:Object.values(session.players).map(pp=>({id:pp.id,name:pp.name,skin:pp.skin,x:pp.x,y:pp.y,hp:pp.hp,alive:pp.alive}))});
    socket.to(session.id).emit('player_joined',{id:pid,name:p.name,skin:p.skin,x:sp.x,y:sp.y,hp:150});
  });

  socket.on('move',({x,y,angle})=>{
    if(!session)return; const p=session.players[pid]; if(!p||!p.alive)return;
    p.x=Math.max(30,Math.min(WORLD_W-30,x));p.y=Math.max(30,Math.min(WORLD_H-30,y));p.angle=angle;
  });

  socket.on('shoot',({angle,weaponType})=>{
    if(!session)return; const p=session.players[pid]; if(!p||!p.alive)return;
    const ws=WSTATS[weaponType||p.weapon]||WSTATS.default;
    const col=WCOLORS[weaponType]||(SKINCOLORS[p.skin]||'#fff');
    const newBullets=[];
    for(let i=0;i<ws.pel;i++){
      const ang=angle+(Math.random()-0.5)*ws.spr+(ws.pel>1?(i-ws.pel/2)*0.12:0);
      const b={id:uuidv4(),x:p.x+Math.cos(ang)*18,y:p.y+Math.sin(ang)*18,vx:Math.cos(ang)*ws.spd,vy:Math.sin(ang)*ws.spd,dmg:ws.dmg,bnc:ws.bnc,owner:pid,life:120};
      session.bullets[b.id]=b;
      newBullets.push({id:b.id,x:b.x,y:b.y,vx:b.vx,vy:b.vy,color:col,weaponType:weaponType||p.weapon});
    }
    if(newBullets.length)io.to(session.id).emit('bullets_fired',newBullets);
  });

  socket.on('pickup_loot',({lootId})=>{
    if(!session)return; const p=session.players[pid]; if(!p)return;
    const idx=session.loot.findIndex(l=>l.id===lootId); if(idx<0)return;
    const loot=session.loot[idx];
    const dx=loot.x-p.x,dy=loot.y-p.y; if(Math.sqrt(dx*dx+dy*dy)>55)return;
    session.loot.splice(idx,1);
    io.to(session.id).emit('loot_removed',lootId);
    if(loot.type==='shotgun'||loot.type==='bounce'){p.weapon=loot.type;socket.emit('weapon_changed',{weapon:loot.type});}
    else if(loot.type==='health'){const s=p.inventory[0]===null?0:p.inventory[1]===null?1:-1;if(s>=0){p.inventory[s]='health';socket.emit('inventory_update',p.inventory);}}
    else if(loot.type==='shield'){const s=p.inventory[0]===null?0:p.inventory[1]===null?1:-1;if(s>=0){p.inventory[s]='shield';socket.emit('inventory_update',p.inventory);}}
    else if(loot.type==='golden'){
      const heroes=['plasma','web','blade'];
      p.golden=heroes[Math.floor(Math.random()*heroes.length)];p.weapon=p.golden;p.inventory=[null,null];
      socket.emit('golden_transform',{hero:p.golden});io.to(session.id).emit('player_transformed',{id:pid,hero:p.golden});
      setTimeout(()=>{if(session.players[pid]){session.players[pid].golden=null;session.players[pid].weapon='default';socket.emit('golden_end');}},45000);
    }
    setTimeout(()=>{if(session&&session.phase!=='ended'){const nl={id:uuidv4(),x:loot.x,y:loot.y,type:loot.type};session.loot.push(nl);io.to(session.id).emit('loot_spawned',nl);}},30000);
  });

  socket.on('use_item',()=>{
    if(!session)return; const p=session.players[pid]; if(!p)return;
    for(let i=0;i<2;i++){if(p.inventory[i]==='health'&&p.hp<150){p.hp=Math.min(150,p.hp+25);p.inventory[i]=null;socket.emit('you_hit',{hp:p.hp,shield:p.shield});socket.emit('inventory_update',p.inventory);return;}if(p.inventory[i]==='shield'){p.shield=Math.min(25,p.shield+25);p.inventory[i]=null;socket.emit('you_hit',{hp:p.hp,shield:p.shield});socket.emit('inventory_update',p.inventory);return;}}
  });

  socket.on('chat_global',({message})=>{
    if(!session)return; const p=session.players[pid]; if(!p)return;
    const msg={from:p.name,fromId:pid,message:message.slice(0,200),time:Date.now()};
    session.chat.push(msg);if(session.chat.length>100)session.chat.shift();
    io.to(session.id).emit('chat_global',msg);
  });

  socket.on('chat_dm',({toId,message})=>{
    if(!session)return; const p=session.players[pid]; if(!p)return;
    const msg={from:p.name,fromId:pid,toId,message:message.slice(0,200),time:Date.now()};
    socket.emit('chat_dm',msg);io.to(toId).emit('chat_dm',msg);
  });

  socket.on('request_player_list',()=>{
    if(!session)return;
    socket.emit('player_list',Object.values(session.players).map(p=>({id:p.id,name:p.name,alive:p.alive,hp:p.hp})));
  });

  // WebRTC voice signaling
  socket.on('voice_offer',({toId,offer})=>io.to(toId).emit('voice_offer',{fromId:pid,offer}));
  socket.on('voice_answer',({toId,answer})=>io.to(toId).emit('voice_answer',{fromId:pid,answer}));
  socket.on('voice_ice',({toId,candidate})=>io.to(toId).emit('voice_ice',{fromId:pid,candidate}));

  socket.on('disconnect',()=>{
    if(!session)return; const p=session.players[pid]; if(p){socket.to(session.id).emit('player_left',{id:pid,name:p.name});delete session.players[pid];}
  });
});

app.get('/health',(req,res)=>res.json({status:'ok',sessions:Object.keys(sessions).length}));
const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log(`STREETCODE running on :${PORT}`));
