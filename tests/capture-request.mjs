const origin="http://127.0.0.1:4330";
const headers={origin,"content-type":"application/json"};
const auth=await fetch(origin+"/api/auth/login",{method:"POST",headers,body:JSON.stringify({username:"小羊",password:"Workbox-Local-Dev-2026!"})});
headers.cookie=auth.headers.get("set-cookie").split(";")[0];
const [command="status",parentId]=process.argv.slice(2);
const path=command==="list"?"":command==="status"?"/status":command==="cancel"?"/cancel":"/capture";
const r=await fetch(origin+"/api/screenshots"+path,{headers,method:command==="list"||command==="status"?"GET":"POST",body:command==="list"||command==="status"?undefined:JSON.stringify({mode:command,parentId})});
console.log(r.status,await r.json());
