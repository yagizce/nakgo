#!/usr/bin/env node
/* Yerel geliştirme sunucusu. Paket indirmez; yalnızca localhost üzerinde dinler. */
const http=require("node:http"),fs=require("node:fs"),path=require("node:path");
const root=path.resolve(__dirname,"..");
const types={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json",".webmanifest":"application/manifest+json",".svg":"image/svg+xml",".png":"image/png"};
function createServer() {
    return http.createServer((req,res)=>{
        const reply=(code,text)=>{res.writeHead(code,{"Content-Type":"text/plain; charset=utf-8"});res.end(text);};
        if(!["GET","HEAD"].includes(req.method)) return reply(405,"Yalnızca GET / HEAD");
        let pathname;
        try { pathname=decodeURIComponent(new URL(req.url,"http://localhost").pathname); } catch {return reply(400,"Geçersiz yol");}
        const parts=pathname.split(/[\\/]+/);
        if(parts.some(p=>p.startsWith(".")||p.includes(":"))||pathname.includes("\0")) return reply(403,"Erişim yok");
        const file=path.resolve(root,"."+(pathname==="/"?"/index.html":pathname));
        if(!file.startsWith(root+path.sep)) return reply(403,"Erişim yok");
        fs.stat(file,(err,stat)=>{
            if(err||!stat.isFile()) return reply(404,"Bulunamadı");
            res.writeHead(200,{"Content-Type":types[path.extname(file)]||"application/octet-stream","Content-Length":stat.size,"X-Content-Type-Options":"nosniff","Cache-Control":"no-cache"});
            if(req.method==="HEAD")return res.end();
            fs.createReadStream(file).on("error",()=>res.destroy()).pipe(res);
        });
    });
}
if(require.main===module){const server=createServer(),port=Number(process.env.PORT||3000);server.listen(port,"127.0.0.1",()=>console.log("NakGo: http://127.0.0.1:"+server.address().port));server.on("error",e=>{console.error(e.message);process.exitCode=1;});}
module.exports={createServer};
