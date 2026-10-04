const puppeteer = require('puppeteer-core');
(async()=>{const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:'new'});const p=await b.newPage();await p.setViewport({width:1360,height:900});
const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://localhost:3012/en/sets/70824',{waitUntil:'networkidle2'});await p.click('.locale-toggle');await new Promise(r=>setTimeout(r,400));await p.screenshot({path:'shots/en-set.png'});
await p.goto('http://localhost:3012/fr',{waitUntil:'networkidle2'});await p.screenshot({path:'shots/fr-home.png'});
console.log(errs);await b.close();})();
